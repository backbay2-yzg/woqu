package services

import (
	"context"
	"encoding/binary"
	"math"
	"sort"
	"strings"
	"unicode/utf8"

	"woqu/backend/internal/db"
	"woqu/backend/internal/models"
)

// EmbedFunc computes dense float32 embeddings for a batch of text chunks.
type EmbedFunc func(ctx context.Context, texts []string) (vectors [][]float32, model string, err error)

type SearchService struct {
	store   *db.Store
	embedFn EmbedFunc
}

func NewSearchService(store *db.Store) *SearchService {
	return &SearchService{store: store}
}

func (s *SearchService) SetEmbedFunc(fn EmbedFunc) {
	s.embedFn = fn
}

// SearchPages performs hybrid FTS5 BM25 + optional Vector RRF search over non-trashed pages.
func (s *SearchService) SearchPages(ctx context.Context, query string, limit int) ([]models.SearchResult, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return []models.SearchResult{}, nil
	}
	if limit <= 0 || limit > 50 {
		limit = 20
	}

	conn := s.store.DB()
	ftsQuery := db.BuildFTSQuery(q)

	ftsRanks := make(map[string]int)
	pageSnippets := make(map[string]string)

	if ftsQuery != "" {
		rows, err := conn.Query(`
			SELECT p.id, p.plain_text, bm25(pages_fts, 10.0, 2.0, 4.0, 3.0) AS rank
			FROM pages_fts
			JOIN pages p ON p.id = pages_fts.page_id
			WHERE pages_fts MATCH ? AND p.is_trashed = 0
			ORDER BY rank ASC
			LIMIT ?`, ftsQuery, limit*2)
		if err == nil {
			idx := 1
			for rows.Next() {
				var pid, plain string
				var rank float64
				if err := rows.Scan(&pid, &plain, &rank); err == nil {
					ftsRanks[pid] = idx
					pageSnippets[pid] = makeExcerpt(plain, q, 140)
					idx++
				}
			}
			_ = rows.Close()
		}
	}

	// Fallback LIKE match if FTS produced very few hits (e.g. partial ASCII substring)
	if len(ftsRanks) < limit {
		like := "%" + q + "%"
		rows, err := conn.Query(`
			SELECT id, plain_text FROM pages
			WHERE is_trashed = 0 AND (title LIKE ? OR plain_text LIKE ? OR summary LIKE ?)
			ORDER BY updated_at DESC LIMIT ?`, like, like, like, limit)
		if err == nil {
			idx := len(ftsRanks) + 1
			for rows.Next() {
				var pid, plain string
				if err := rows.Scan(&pid, &plain); err == nil {
					if _, exists := ftsRanks[pid]; !exists {
						ftsRanks[pid] = idx + 10
						pageSnippets[pid] = makeExcerpt(plain, q, 140)
						idx++
					}
				}
			}
			_ = rows.Close()
		}
	}

	// Optional vector search via RRF if Embedding model is available
	vecRanks := make(map[string]int)
	if s.embedFn != nil {
		if qVecs, _, err := s.embedFn(ctx, []string{q}); err == nil && len(qVecs) == 1 && len(qVecs[0]) > 0 {
			qVec := qVecs[0]
			chunkHits := s.vectorSearchChunks(qVec, nil, limit*3)
			rankIdx := 1
			for _, hit := range chunkHits {
				if _, exists := vecRanks[hit.PageID]; !exists {
					vecRanks[hit.PageID] = rankIdx
					if _, hasSnip := pageSnippets[hit.PageID]; !hasSnip {
						pageSnippets[hit.PageID] = truncateRunes(hit.Content, 140)
					}
					rankIdx++
				}
			}
		}
	}

	// Reciprocal Rank Fusion (k = 60)
	const rrfK = 60.0
	scores := make(map[string]float64)
	for pid, r := range ftsRanks {
		scores[pid] += 1.0 / (rrfK + float64(r))
	}
	for pid, r := range vecRanks {
		scores[pid] += 1.0 / (rrfK + float64(r))
	}

	type scoredID struct {
		id    string
		score float64
	}
	var ordered []scoredID
	for pid, sc := range scores {
		ordered = append(ordered, scoredID{id: pid, score: sc})
	}
	sort.Slice(ordered, func(i, j int) bool {
		return ordered[i].score > ordered[j].score
	})
	if len(ordered) > limit {
		ordered = ordered[:limit]
	}

	var results []models.SearchResult
	for _, item := range ordered {
		var title, icon, updatedAt string
		err := conn.QueryRow(`SELECT title, icon, updated_at FROM pages WHERE id = ? AND is_trashed = 0`, item.id).
			Scan(&title, &icon, &updatedAt)
		if err != nil {
			continue
		}
		results = append(results, models.SearchResult{
			PageID:    item.id,
			Title:     title,
			Icon:      icon,
			Snippet:   pageSnippets[item.id],
			Score:     item.score,
			UpdatedAt: updatedAt,
		})
	}
	if results == nil {
		results = []models.SearchResult{}
	}
	return results, nil
}

type chunkHit struct {
	ChunkID     string
	PageID      string
	PageTitle   string
	PageIcon    string
	HeadingPath string
	Content     string
	Score       float64
}

// SearchChunks retrieves top-K heading chunks for RAG prompts within the chosen scope.
func (s *SearchService) SearchChunks(ctx context.Context, query, scopeType, scopeTargetID string, topK int) ([]models.Citation, error) {
	if topK <= 0 {
		topK = 6
	}
	conn := s.store.DB()

	var allowedPages map[string]bool
	if scopeType == "current_page" && scopeTargetID != "" {
		allowedPages = map[string]bool{scopeTargetID: true}
	} else if scopeType == "folder" && scopeTargetID != "" {
		allowedPages = map[string]bool{scopeTargetID: true}
		queue := []string{scopeTargetID}
		for len(queue) > 0 {
			curr := queue[0]
			queue = queue[1:]
			rows, err := conn.Query(`SELECT id FROM pages WHERE parent_id = ? AND is_trashed = 0`, curr)
			if err == nil {
				for rows.Next() {
					var cid string
					if err := rows.Scan(&cid); err == nil && !allowedPages[cid] {
						allowedPages[cid] = true
						queue = append(queue, cid)
					}
				}
				_ = rows.Close()
			}
		}
	}

	// If scoped directly to a single page, return its chunks directly if few chunks or rank them
	if scopeType == "current_page" && scopeTargetID != "" {
		rows, err := conn.Query(`
			SELECT c.id, c.page_id, p.title, p.icon, c.heading_path, c.content
			FROM page_chunks c
			JOIN pages p ON p.id = c.page_id
			WHERE c.page_id = ? AND p.is_trashed = 0
			ORDER BY c.chunk_index ASC LIMIT ?`, scopeTargetID, topK)
		if err == nil {
			defer rows.Close()
			var citations []models.Citation
			idx := 1
			for rows.Next() {
				var cID, pID, pTitle, pIcon, hPath, content string
				if err := rows.Scan(&cID, &pID, &pTitle, &pIcon, &hPath, &content); err == nil {
					citations = append(citations, models.Citation{
						Index:       idx,
						PageID:      pID,
						PageTitle:   pTitle,
						PageIcon:    pIcon,
						HeadingPath: hPath,
						Snippet:     truncateRunes(content, 260),
						Score:       1.0,
					})
					idx++
				}
			}
			if len(citations) > 0 {
				return citations, nil
			}
		}
	}

	// 1. FTS page candidates -> load chunks
	ftsHits := make(map[string]chunkHit)
	ftsOrder := []string{}
	pagesRes, _ := s.SearchPages(ctx, query, topK*2)
	for rank, pr := range pagesRes {
		if allowedPages != nil && !allowedPages[pr.PageID] {
			continue
		}
		rows, err := conn.Query(`
			SELECT c.id, c.page_id, p.title, p.icon, c.heading_path, c.content
			FROM page_chunks c
			JOIN pages p ON p.id = c.page_id
			WHERE c.page_id = ? AND p.is_trashed = 0
			ORDER BY c.chunk_index ASC LIMIT 2`, pr.PageID)
		if err == nil {
			for rows.Next() {
				var h chunkHit
				if err := rows.Scan(&h.ChunkID, &h.PageID, &h.PageTitle, &h.PageIcon, &h.HeadingPath, &h.Content); err == nil {
					h.Score = 1.0 / float64(60+rank+1)
					ftsHits[h.ChunkID] = h
					ftsOrder = append(ftsOrder, h.ChunkID)
				}
			}
			_ = rows.Close()
		}
	}

	// 2. Vector similarity candidates
	vecScores := make(map[string]float64)
	allChunks := make(map[string]chunkHit)
	for id, h := range ftsHits {
		allChunks[id] = h
	}
	if s.embedFn != nil && strings.TrimSpace(query) != "" {
		if qVecs, _, err := s.embedFn(ctx, []string{query}); err == nil && len(qVecs) == 1 && len(qVecs[0]) > 0 {
			vHits := s.vectorSearchChunks(qVecs[0], allowedPages, topK*2)
			for rank, h := range vHits {
				vecScores[h.ChunkID] = 1.0 / float64(60+rank+1)
				if _, ok := allChunks[h.ChunkID]; !ok {
					allChunks[h.ChunkID] = h
				}
			}
		}
	}

	type combined struct {
		hit   chunkHit
		score float64
	}
	var ranked []combined
	for id, h := range allChunks {
		total := vecScores[id]
		if fh, ok := ftsHits[id]; ok {
			total += fh.Score
		}
		h.Score = total
		ranked = append(ranked, combined{hit: h, score: total})
	}
	sort.Slice(ranked, func(i, j int) bool {
		return ranked[i].score > ranked[j].score
	})
	if len(ranked) > topK {
		ranked = ranked[:topK]
	}

	citations := make([]models.Citation, 0, len(ranked))
	for i, item := range ranked {
		citations = append(citations, models.Citation{
			Index:       i + 1,
			PageID:      item.hit.PageID,
			PageTitle:   item.hit.PageTitle,
			PageIcon:    item.hit.PageIcon,
			HeadingPath: item.hit.HeadingPath,
			Snippet:     item.hit.Content,
			Score:       item.score,
		})
	}
	return citations, nil
}

func (s *SearchService) vectorSearchChunks(queryVec []float32, allowedPages map[string]bool, topK int) []chunkHit {
	rows, err := s.store.DB().Query(`
		SELECT c.id, c.page_id, p.title, p.icon, c.heading_path, c.content, c.embedding_blob, c.embedding_dim
		FROM page_chunks c
		JOIN pages p ON p.id = c.page_id
		WHERE p.is_trashed = 0 AND c.embedding_dim = ?`, len(queryVec))
	if err != nil {
		return nil
	}
	defer rows.Close()

	var hits []chunkHit
	for rows.Next() {
		var h chunkHit
		var blob []byte
		var dim int
		if err := rows.Scan(&h.ChunkID, &h.PageID, &h.PageTitle, &h.PageIcon, &h.HeadingPath, &h.Content, &blob, &dim); err != nil {
			continue
		}
		if allowedPages != nil && !allowedPages[h.PageID] {
			continue
		}
		vec := DecodeFloat32Vector(blob)
		if len(vec) != len(queryVec) {
			continue
		}
		sim := CosineSimilarity(queryVec, vec)
		if sim > 0.1 {
			h.Score = sim
			hits = append(hits, h)
		}
	}
	sort.Slice(hits, func(i, j int) bool {
		return hits[i].Score > hits[j].Score
	})
	if len(hits) > topK {
		hits = hits[:topK]
	}
	return hits
}

// IndexPageEmbeddings computes and persists vector embeddings for chunks of pageID missing vectors.
func (s *SearchService) IndexPageEmbeddings(ctx context.Context, pageID string) error {
	if s.embedFn == nil {
		return nil
	}
	rows, err := s.store.DB().Query(`SELECT id, content FROM page_chunks WHERE page_id = ? AND embedding_dim = 0 ORDER BY chunk_index`, pageID)
	if err != nil {
		return err
	}
	type item struct {
		id      string
		content string
	}
	var pending []item
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.id, &it.content); err == nil && strings.TrimSpace(it.content) != "" {
			pending = append(pending, it)
		}
	}
	_ = rows.Close()
	if len(pending) == 0 {
		return nil
	}

	texts := make([]string, len(pending))
	for i, it := range pending {
		texts[i] = it.content
	}
	vecs, modelName, err := s.embedFn(ctx, texts)
	if err != nil || len(vecs) != len(pending) {
		return err
	}
	for i, it := range pending {
		blob := EncodeFloat32Vector(vecs[i])
		_, _ = s.store.DB().Exec(`
			UPDATE page_chunks SET embedding_blob = ?, embedding_dim = ?, embedding_model = ? WHERE id = ?`,
			blob, len(vecs[i]), modelName, it.id)
	}
	return nil
}

// ReindexAllEmbeddings clears cached vectors and recomputes embeddings across all non-trashed pages.
func (s *SearchService) ReindexAllEmbeddings(ctx context.Context) (int, error) {
	if s.embedFn == nil {
		return 0, nil
	}
	rows, err := s.store.DB().Query(`
		SELECT c.id, c.content
		FROM page_chunks c
		JOIN pages p ON p.id = c.page_id
		WHERE p.is_trashed = 0`)
	if err != nil {
		return 0, err
	}
	type item struct {
		id      string
		content string
	}
	var all []item
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.id, &it.content); err == nil && strings.TrimSpace(it.content) != "" {
			all = append(all, it)
		}
	}
	_ = rows.Close()

	const batchSize = 16
	indexed := 0
	for i := 0; i < len(all); i += batchSize {
		end := i + batchSize
		if end > len(all) {
			end = len(all)
		}
		batch := all[i:end]
		texts := make([]string, len(batch))
		for j, it := range batch {
			texts[j] = it.content
		}
		vecs, modelName, err := s.embedFn(ctx, texts)
		if err != nil {
			return indexed, err
		}
		for j, it := range batch {
			if j < len(vecs) {
				blob := EncodeFloat32Vector(vecs[j])
				_, _ = s.store.DB().Exec(`
					UPDATE page_chunks SET embedding_blob = ?, embedding_dim = ?, embedding_model = ? WHERE id = ?`,
					blob, len(vecs[j]), modelName, it.id)
				indexed++
			}
		}
	}
	return indexed, nil
}

func EncodeFloat32Vector(vec []float32) []byte {
	buf := make([]byte, len(vec)*4)
	for i, v := range vec {
		binary.LittleEndian.PutUint32(buf[i*4:], math.Float32bits(v))
	}
	return buf
}

func DecodeFloat32Vector(blob []byte) []float32 {
	if len(blob)%4 != 0 || len(blob) == 0 {
		return nil
	}
	vec := make([]float32, len(blob)/4)
	for i := range vec {
		vec[i] = math.Float32frombits(binary.LittleEndian.Uint32(blob[i*4:]))
	}
	return vec
}

func CosineSimilarity(a, b []float32) float64 {
	if len(a) != len(b) || len(a) == 0 {
		return 0
	}
	var dot, normA, normB float64
	for i := range a {
		va := float64(a[i])
		vb := float64(b[i])
		dot += va * vb
		normA += va * va
		normB += vb * vb
	}
	denom := math.Sqrt(normA) * math.Sqrt(normB)
	if denom == 0 {
		return 0
	}
	return dot / denom
}

func makeExcerpt(plain, query string, maxRunes int) string {
	if plain == "" {
		return ""
	}
	lowerPlain := strings.ToLower(plain)
	lowerQuery := strings.ToLower(strings.TrimSpace(query))
	byteIdx := strings.Index(lowerPlain, lowerQuery)
	if byteIdx < 0 {
		return truncateRunes(plain, maxRunes)
	}
	runeStart := utf8.RuneCountInString(plain[:byteIdx])
	runes := []rune(plain)
	start := runeStart - 30
	if start < 0 {
		start = 0
	}
	end := start + maxRunes
	if end > len(runes) {
		end = len(runes)
	}
	out := string(runes[start:end])
	if start > 0 {
		out = "..." + out
	}
	if end < len(runes) {
		out += "..."
	}
	return out
}

func truncateRunes(s string, max int) string {
	runes := []rune(strings.TrimSpace(s))
	if len(runes) <= max {
		return string(runes)
	}
	return string(runes[:max]) + "..."
}
