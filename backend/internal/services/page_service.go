package services

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	"woqu/backend/internal/db"
	"woqu/backend/internal/models"
)

type PageService struct {
	store           *db.Store
	versionSvc      *VersionService
	linkSvc         *LinkService
	onPageIndexed   func(pageID string)
}

func NewPageService(store *db.Store, versionSvc *VersionService, linkSvc *LinkService) *PageService {
	return &PageService{
		store:      store,
		versionSvc: versionSvc,
		linkSvc:    linkSvc,
	}
}

// SetOnPageIndexed registers an optional callback (e.g. async embedding computation) after page chunks are updated.
func (s *PageService) SetOnPageIndexed(fn func(pageID string)) {
	s.onPageIndexed = fn
}

type CreatePageInput struct {
	ParentID    *string         `json:"parent_id"`
	DatabaseID  *string         `json:"database_id"`
	Title       string          `json:"title"`
	Icon        string          `json:"icon"`
	CoverURL    string          `json:"cover_url"`
	IsDatabase  bool            `json:"is_database"`
	ContentJSON json.RawMessage `json:"content_json"`
	Summary     string          `json:"summary"`
	Tags        []string        `json:"tags"`
	Properties  map[string]any  `json:"properties"`
	IsFullWidth bool            `json:"is_full_width"`
}

type UpdatePageInput struct {
	ParentID    *string          `json:"parent_id"`
	HasParentID bool             `json:"-"`
	Title       *string          `json:"title"`
	Icon        *string          `json:"icon"`
	CoverURL    *string          `json:"cover_url"`
	ContentJSON *json.RawMessage `json:"content_json"`
	Summary     *string          `json:"summary"`
	Tags        *[]string        `json:"tags"`
	Properties  map[string]any   `json:"properties"`
	IsFavorite  *bool            `json:"is_favorite"`
	IsFullWidth *bool            `json:"is_full_width"`
	VersionNote string           `json:"version_note"`
}

func (s *PageService) CreatePage(in CreatePageInput) (*models.Page, error) {
	conn := s.store.DB()
	id := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339Nano)

	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = "无标题"
	}
	contentRaw := in.ContentJSON
	if len(contentRaw) == 0 {
		contentRaw = json.RawMessage(`{"type":"doc","content":[{"type":"paragraph"}]}`)
	}
	tags := in.Tags
	if tags == nil {
		tags = []string{}
	}
	tagsBytes, _ := json.Marshal(tags)
	props := in.Properties
	if props == nil {
		props = map[string]any{}
	}
	propsBytes, _ := json.Marshal(props)
	plainText := ExtractPlainText(contentRaw)

	var maxPos sql.NullFloat64
	if in.ParentID == nil {
		_ = conn.QueryRow(`SELECT MAX(position) FROM pages WHERE parent_id IS NULL AND database_id IS NULL AND is_trashed = 0`).Scan(&maxPos)
	} else {
		_ = conn.QueryRow(`SELECT MAX(position) FROM pages WHERE parent_id = ? AND is_trashed = 0`, *in.ParentID).Scan(&maxPos)
	}
	pos := 1000.0
	if maxPos.Valid {
		pos = maxPos.Float64 + 1000.0
	}

	isDBInt := 0
	if in.IsDatabase {
		isDBInt = 1
	}
	isFullInt := 0
	if in.IsFullWidth {
		isFullInt = 1
	}

	_, err := conn.Exec(`
		INSERT INTO pages (
			id, parent_id, database_id, title, icon, cover_url, is_database,
			content_json, plain_text, summary, tags_json, properties_json,
			position, is_favorite, is_full_width, is_trashed, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?)`,
		id, in.ParentID, in.DatabaseID, title, in.Icon, in.CoverURL, isDBInt,
		string(contentRaw), plainText, in.Summary, string(tagsBytes), string(propsBytes),
		pos, isFullInt, now, now)
	if err != nil {
		return nil, err
	}

	s.syncIndexes(id, title, plainText, in.Summary, tags, contentRaw)
	return s.GetPage(id)
}

func (s *PageService) GetPage(id string) (*models.Page, error) {
	row := s.store.DB().QueryRow(`
		SELECT id, parent_id, database_id, title, icon, cover_url, is_database,
		       content_json, plain_text, summary, tags_json, properties_json,
		       position, is_favorite, is_full_width, is_trashed, trashed_at, created_at, updated_at
		FROM pages WHERE id = ?`, id)
	return scanPage(row)
}

func scanPage(scanner interface{ Scan(dest ...any) error }) (*models.Page, error) {
	var p models.Page
	var parentID, dbID, trashedAt sql.NullString
	var isDB, isFav, isFull, isTrashed int
	var contentStr, tagsStr, propsStr string

	err := scanner.Scan(
		&p.ID, &parentID, &dbID, &p.Title, &p.Icon, &p.CoverURL, &isDB,
		&contentStr, &p.PlainText, &p.Summary, &tagsStr, &propsStr,
		&p.Position, &isFav, &isFull, &isTrashed, &trashedAt, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	if parentID.Valid {
		p.ParentID = &parentID.String
	}
	if dbID.Valid {
		p.DatabaseID = &dbID.String
	}
	if trashedAt.Valid {
		p.TrashedAt = &trashedAt.String
	}
	p.IsDatabase = isDB == 1
	p.IsFavorite = isFav == 1
	p.IsFullWidth = isFull == 1
	p.IsTrashed = isTrashed == 1
	p.ContentJSON = json.RawMessage(contentStr)
	_ = json.Unmarshal([]byte(tagsStr), &p.Tags)
	if p.Tags == nil {
		p.Tags = []string{}
	}
	_ = json.Unmarshal([]byte(propsStr), &p.Properties)
	if p.Properties == nil {
		p.Properties = map[string]any{}
	}
	return &p, nil
}

// ListTree returns standalone pages (not database rows) for the sidebar navigation tree.
func (s *PageService) ListTree() ([]models.PageTreeItem, error) {
	rows, err := s.store.DB().Query(`
		SELECT id, parent_id, database_id, title, icon, is_database, position, is_favorite, updated_at
		FROM pages
		WHERE is_trashed = 0 AND database_id IS NULL
		ORDER BY position ASC, created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []models.PageTreeItem
	for rows.Next() {
		var item models.PageTreeItem
		var parentID, dbID sql.NullString
		var isDB, isFav int
		if err := rows.Scan(&item.ID, &parentID, &dbID, &item.Title, &item.Icon, &isDB, &item.Position, &isFav, &item.UpdatedAt); err != nil {
			return nil, err
		}
		if parentID.Valid {
			item.ParentID = &parentID.String
		}
		if dbID.Valid {
			item.DatabaseID = &dbID.String
		}
		item.IsDatabase = isDB == 1
		item.IsFavorite = isFav == 1
		items = append(items, item)
	}
	if items == nil {
		items = []models.PageTreeItem{}
	}
	return items, nil
}

// ListAllSummaries returns all non-trashed pages (including database rows) for mentions and quick switcher.
func (s *PageService) ListAllSummaries() ([]models.PageTreeItem, error) {
	rows, err := s.store.DB().Query(`
		SELECT id, parent_id, database_id, title, icon, is_database, position, is_favorite, updated_at
		FROM pages
		WHERE is_trashed = 0
		ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []models.PageTreeItem
	for rows.Next() {
		var item models.PageTreeItem
		var parentID, dbID sql.NullString
		var isDB, isFav int
		if err := rows.Scan(&item.ID, &parentID, &dbID, &item.Title, &item.Icon, &isDB, &item.Position, &isFav, &item.UpdatedAt); err != nil {
			return nil, err
		}
		if parentID.Valid {
			item.ParentID = &parentID.String
		}
		if dbID.Valid {
			item.DatabaseID = &dbID.String
		}
		item.IsDatabase = isDB == 1
		item.IsFavorite = isFav == 1
		items = append(items, item)
	}
	if items == nil {
		items = []models.PageTreeItem{}
	}
	return items, nil
}

func (s *PageService) UpdatePage(id string, in UpdatePageInput) (*models.Page, error) {
	existing, err := s.GetPage(id)
	if err != nil {
		return nil, err
	}

	// Capture an auto snapshot before significant edits (debounced in VersionService)
	if in.ContentJSON != nil || in.Title != nil {
		_, _ = s.versionSvc.SaveSnapshot(id, "auto", in.VersionNote)
	}

	title := existing.Title
	if in.Title != nil {
		title = strings.TrimSpace(*in.Title)
		if title == "" {
			title = "无标题"
		}
	}
	icon := existing.Icon
	if in.Icon != nil {
		icon = *in.Icon
	}
	coverURL := existing.CoverURL
	if in.CoverURL != nil {
		coverURL = *in.CoverURL
	}
	parentID := existing.ParentID
	if in.HasParentID {
		parentID = in.ParentID
	}
	contentRaw := existing.ContentJSON
	plainText := existing.PlainText
	contentChanged := false
	if in.ContentJSON != nil {
		contentRaw = *in.ContentJSON
		plainText = ExtractPlainText(contentRaw)
		contentChanged = true
	}
	summary := existing.Summary
	if in.Summary != nil {
		summary = *in.Summary
	}
	tags := existing.Tags
	if in.Tags != nil {
		tags = *in.Tags
	}
	if tags == nil {
		tags = []string{}
	}
	props := existing.Properties
	if in.Properties != nil {
		for k, v := range in.Properties {
			props[k] = v
		}
	}
	isFav := existing.IsFavorite
	if in.IsFavorite != nil {
		isFav = *in.IsFavorite
	}
	isFull := existing.IsFullWidth
	if in.IsFullWidth != nil {
		isFull = *in.IsFullWidth
	}

	tagsBytes, _ := json.Marshal(tags)
	propsBytes, _ := json.Marshal(props)
	now := time.Now().UTC().Format(time.RFC3339Nano)

	isFavInt := 0
	if isFav {
		isFavInt = 1
	}
	isFullInt := 0
	if isFull {
		isFullInt = 1
	}

	_, err = s.store.DB().Exec(`
		UPDATE pages SET
			parent_id = ?, title = ?, icon = ?, cover_url = ?,
			content_json = ?, plain_text = ?, summary = ?, tags_json = ?, properties_json = ?,
			is_favorite = ?, is_full_width = ?, updated_at = ?
		WHERE id = ?`,
		parentID, title, icon, coverURL,
		string(contentRaw), plainText, summary, string(tagsBytes), string(propsBytes),
		isFavInt, isFullInt, now, id)
	if err != nil {
		return nil, err
	}

	if existing.IsDatabase && in.Title != nil {
		_, _ = s.store.DB().Exec(`UPDATE databases SET title = ?, icon = ?, updated_at = ? WHERE page_id = ?`, title, icon, now, id)
	}
	if existing.IsDatabase && in.Icon != nil {
		_, _ = s.store.DB().Exec(`UPDATE databases SET icon = ?, updated_at = ? WHERE page_id = ?`, icon, now, id)
	}

	if contentChanged || in.Title != nil || in.Summary != nil || in.Tags != nil {
		s.syncIndexes(id, title, plainText, summary, tags, contentRaw)
	}

	return s.GetPage(id)
}

func (s *PageService) MovePage(id string, newParentID *string, newPosition float64) error {
	if newParentID != nil && *newParentID == id {
		return errors.New("cannot move a page inside itself")
	}
	if newParentID != nil {
		if s.isDescendant(*newParentID, id) {
			return errors.New("cannot move a page into its own descendant")
		}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := s.store.DB().Exec(`UPDATE pages SET parent_id = ?, position = ?, updated_at = ? WHERE id = ?`,
		newParentID, newPosition, now, id)
	return err
}

func (s *PageService) isDescendant(candidateID, ancestorID string) bool {
	curr := candidateID
	visited := map[string]bool{}
	for curr != "" {
		if curr == ancestorID {
			return true
		}
		if visited[curr] {
			break
		}
		visited[curr] = true
		var parent sql.NullString
		err := s.store.DB().QueryRow(`SELECT parent_id FROM pages WHERE id = ?`, curr).Scan(&parent)
		if err != nil || !parent.Valid {
			break
		}
		curr = parent.String
	}
	return false
}

func (s *PageService) DuplicatePage(id string) (*models.Page, error) {
	orig, err := s.GetPage(id)
	if err != nil {
		return nil, err
	}
	return s.CreatePage(CreatePageInput{
		ParentID:    orig.ParentID,
		DatabaseID:  orig.DatabaseID,
		Title:       orig.Title + " (副本)",
		Icon:        orig.Icon,
		CoverURL:    orig.CoverURL,
		ContentJSON: orig.ContentJSON,
		Summary:     orig.Summary,
		Tags:        orig.Tags,
		IsFullWidth: orig.IsFullWidth,
	})
}

func (s *PageService) SoftDelete(id string) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	ids := s.collectSubtreeIDs(id)
	tx, err := s.store.DB().Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, pid := range ids {
		if _, err := tx.Exec(`UPDATE pages SET is_trashed = 1, trashed_at = ? WHERE id = ?`, now, pid); err != nil {
			return err
		}
		_, _ = tx.Exec(`DELETE FROM pages_fts WHERE page_id = ?`, pid)
	}
	return tx.Commit()
}

func (s *PageService) collectSubtreeIDs(rootID string) []string {
	result := []string{rootID}
	queue := []string{rootID}
	seen := map[string]bool{rootID: true}

	for len(queue) > 0 {
		curr := queue[0]
		queue = queue[1:]
		rows, err := s.store.DB().Query(`SELECT id FROM pages WHERE parent_id = ?`, curr)
		if err != nil {
			continue
		}
		for rows.Next() {
			var cid string
			if err := rows.Scan(&cid); err == nil && !seen[cid] {
				seen[cid] = true
				result = append(result, cid)
				queue = append(queue, cid)
			}
		}
		_ = rows.Close()
	}
	return result
}

func (s *PageService) ListTrash() ([]models.Page, error) {
	rows, err := s.store.DB().Query(`
		SELECT id, parent_id, database_id, title, icon, cover_url, is_database,
		       content_json, plain_text, summary, tags_json, properties_json,
		       position, is_favorite, is_full_width, is_trashed, trashed_at, created_at, updated_at
		FROM pages WHERE is_trashed = 1 ORDER BY trashed_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []models.Page
	for rows.Next() {
		p, err := scanPage(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, *p)
	}
	if list == nil {
		list = []models.Page{}
	}
	return list, nil
}

func (s *PageService) RestorePage(id string) (*models.Page, error) {
	p, err := s.GetPage(id)
	if err != nil {
		return nil, err
	}
	parentID := p.ParentID
	if parentID != nil {
		var parentTrashed int
		err := s.store.DB().QueryRow(`SELECT is_trashed FROM pages WHERE id = ?`, *parentID).Scan(&parentTrashed)
		if err != nil || parentTrashed == 1 {
			parentID = nil
		}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err = s.store.DB().Exec(`UPDATE pages SET is_trashed = 0, trashed_at = NULL, parent_id = ?, updated_at = ? WHERE id = ?`,
		parentID, now, id)
	if err != nil {
		return nil, err
	}
	restored, err := s.GetPage(id)
	if err != nil {
		return nil, err
	}
	s.syncIndexes(restored.ID, restored.Title, restored.PlainText, restored.Summary, restored.Tags, restored.ContentJSON)
	return restored, nil
}

func (s *PageService) PermanentDelete(id string) error {
	conn := s.store.DB()
	_, _ = conn.Exec(`DELETE FROM pages_fts WHERE page_id = ?`, id)
	_, err := conn.Exec(`DELETE FROM pages WHERE id = ?`, id)
	return err
}

func (s *PageService) RestoreVersion(pageID, versionID string) (*models.Page, error) {
	v, err := s.versionSvc.GetVersion(pageID, versionID)
	if err != nil {
		return nil, err
	}
	_, _ = s.versionSvc.SaveSnapshot(pageID, "manual", "恢复历史版本前自动备份")
	return s.UpdatePage(pageID, UpdatePageInput{
		Title:       &v.Title,
		ContentJSON: &v.ContentJSON,
		Properties:  v.Properties,
		VersionNote: "从历史版本恢复",
	})
}

func (s *PageService) syncIndexes(pageID, title, plainText, summary string, tags []string, contentRaw json.RawMessage) {
	conn := s.store.DB()
	tagsStr := strings.Join(tags, " ")

	_, _ = conn.Exec(`DELETE FROM pages_fts WHERE page_id = ?`, pageID)
	_, _ = conn.Exec(`
		INSERT INTO pages_fts (page_id, title_seg, content_seg, summary_seg, tags_seg)
		VALUES (?, ?, ?, ?, ?)`,
		pageID,
		db.SegmentCJK(title),
		db.SegmentCJK(plainText),
		db.SegmentCJK(summary),
		db.SegmentCJK(tagsStr),
	)

	if s.linkSvc != nil {
		_ = s.linkSvc.SyncPageLinks(pageID, contentRaw)
	}

	s.syncPageChunks(pageID, title, contentRaw)
	if s.onPageIndexed != nil {
		s.onPageIndexed(pageID)
	}
}

func (s *PageService) syncPageChunks(pageID, title string, contentRaw json.RawMessage) {
	conn := s.store.DB()
	chunks := ExtractChunks(title, contentRaw)

	// Load existing embeddings keyed by content so unchanged chunks keep their vectors
	existing := make(map[string]struct {
		blob  []byte
		dim   int
		model string
	})
	rows, err := conn.Query(`SELECT content, embedding_blob, embedding_dim, embedding_model FROM page_chunks WHERE page_id = ? AND embedding_dim > 0`, pageID)
	if err == nil {
		for rows.Next() {
			var content, model string
			var blob []byte
			var dim int
			if err := rows.Scan(&content, &blob, &dim, &model); err == nil && len(blob) > 0 {
				existing[content] = struct {
					blob  []byte
					dim   int
					model string
				}{blob: blob, dim: dim, model: model}
			}
		}
		_ = rows.Close()
	}

	_, _ = conn.Exec(`DELETE FROM page_chunks WHERE page_id = ?`, pageID)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for _, c := range chunks {
		var blob []byte
		var dim int
		var model string
		if hit, ok := existing[c.Content]; ok {
			blob = hit.blob
			dim = hit.dim
			model = hit.model
		}
		_, _ = conn.Exec(`
			INSERT INTO page_chunks (id, page_id, chunk_index, heading_path, content, embedding_blob, embedding_dim, embedding_model, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			uuid.NewString(), pageID, c.ChunkIndex, c.HeadingPath, c.Content, blob, dim, model, now)
	}
}

// ReindexFTS rebuilds pages_fts and page_chunks for all non-trashed pages.
func (s *PageService) ReindexAllFTS() error {
	rows, err := s.store.DB().Query(`SELECT id, title, plain_text, summary, tags_json, content_json FROM pages WHERE is_trashed = 0`)
	if err != nil {
		return err
	}
	type rowData struct {
		id, title, plain, summary, tagsStr, contentStr string
	}
	var list []rowData
	for rows.Next() {
		var r rowData
		if err := rows.Scan(&r.id, &r.title, &r.plain, &r.summary, &r.tagsStr, &r.contentStr); err == nil {
			list = append(list, r)
		}
	}
	_ = rows.Close()

	for _, r := range list {
		var tags []string
		_ = json.Unmarshal([]byte(r.tagsStr), &tags)
		s.syncIndexes(r.id, r.title, r.plain, r.summary, tags, json.RawMessage(r.contentStr))
	}
	return nil
}

// SeedWelcomeWorkspace seeds initial starter documents and a sample multidimensional database if workspace is empty.
func (s *PageService) SeedWelcomeWorkspace(dbSvc *DatabaseService) {
	var count int
	if err := s.store.DB().QueryRow(`SELECT count(*) FROM pages`).Scan(&count); err != nil || count > 0 {
		return
	}

	welcomeContent := json.RawMessage(`{
		"type":"doc",
		"content":[
			{"type":"callout","attrs":{"icon":"✨","color":"blue"},"content":[{"type":"paragraph","content":[{"type":"text","text":"欢迎来到「我趣文档 Woqu」—— 你的私有化自托管知识库、多维数据库与 AI 写作中枢。"}]}]},
			{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"核心快捷键与用法"}]},
			{"type":"bulletList","content":[
				{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","marks":[{"type":"bold"}],"text":"输入 / "},{"type":"text","text":"打开斜杠命令面板：插入标题、柔色提示块、折叠块、多栏排版、代码块、Mermaid 图表、LaTeX 公式、或内嵌多维数据库。"}]}]},
				{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","marks":[{"type":"bold"}],"text":"输入 [[ "},{"type":"text","text":"搜索并链接其他页面，自动构建双向链接与知识图谱。"}]}]},
				{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","marks":[{"type":"bold"}],"text":"选中任意文字 "},{"type":"text","text":"唤起浮动工具栏，点击「AI 优化」即可进行流式润色、精简、扩写、翻译，并支持可视化 Diff 对比替换。"}]}]},
				{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","marks":[{"type":"bold"}],"text":"Cmd / Ctrl + K "},{"type":"text","text":"打开全局快捷检索，支持中文全文检索与语义混合搜索。"}]}]}
			]},
			{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"新手待办清单"}]},
			{"type":"taskList","content":[
				{"type":"taskItem","attrs":{"checked":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"完成工作区初始化与安全密码设置"}]}]},
				{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"前往右上角「设置 → AI 模型中心」配置 DeepSeek / OpenAI / Claude / Gemini 或本地 Ollama 模型"}]}]},
				{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"体验「项目任务看板」多维数据库的表格、看板、日历与画廊视图"}]}]}
			]},
			{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Mermaid 架构示例"}]},
			{"type":"codeBlock","attrs":{"language":"mermaid"},"content":[{"type":"text","text":"flowchart LR\n  A[笔记与文档] --> B[双向链接图谱]\n  A --> C[多维数据库]\n  B --> D[RAG 知识库问答]\n  C --> D"}]}
		]
	}`)

	welcomePage, err := s.CreatePage(CreatePageInput{
		Title:       "欢迎使用我趣文档",
		Icon:        "🚀",
		ContentJSON: welcomeContent,
		Summary:     "Woqu 自托管知识库快速入门指南，包含编辑器快捷键、双向链接、AI 写作与多维数据库引导。",
		Tags:        []string{"指南", "入门"},
		IsFullWidth: false,
	})
	if err == nil && welcomePage != nil {
		_, _ = s.versionSvc.SaveSnapshot(welcomePage.ID, "manual", "初始引导页快照")
	}

	if dbSvc != nil {
		sampleDB, err := dbSvc.CreateDatabase(CreateDatabaseInput{
			Title:       "项目任务看板",
			Icon:        "📋",
			Description: "多维数据库示例：支持表格、看板、日历、画廊四视图与公式自动计算",
			IsInline:    false,
		})
		if err == nil && sampleDB != nil {
			today := time.Now().Format("2006-01-02")
			tomorrow := time.Now().Add(24 * time.Hour).Format("2006-01-02")
			_, _ = dbSvc.CreateRow(sampleDB.ID, "配置 AI 模型密钥", map[string]any{
				"prop_status":   "进行中",
				"prop_tags":     []string{"AI", "重要"},
				"prop_date":     today,
				"prop_priority": "高",
			})
			_, _ = dbSvc.CreateRow(sampleDB.ID, "导入历史 Markdown 笔记", map[string]any{
				"prop_status":   "待处理",
				"prop_tags":     []string{"文档"},
				"prop_date":     tomorrow,
				"prop_priority": "中",
			})
			_, _ = dbSvc.CreateRow(sampleDB.ID, "测试多维数据库公式与关联", map[string]any{
				"prop_status":   "已完成",
				"prop_tags":     []string{"重要"},
				"prop_date":     today,
				"prop_priority": "高",
			})
		}
	}
}
