package services

import (
	"encoding/json"

	"woqu/backend/internal/db"
	"woqu/backend/internal/models"
)

type LinkService struct {
	store *db.Store
}

func NewLinkService(store *db.Store) *LinkService {
	return &LinkService{store: store}
}

// SyncPageLinks replaces all outgoing links for sourcePageID based on its TipTap content_json.
func (s *LinkService) SyncPageLinks(sourcePageID string, rawContent json.RawMessage) error {
	links := ExtractPageLinks(rawContent)
	conn := s.store.DB()
	tx, err := conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM page_links WHERE source_page_id = ?`, sourcePageID); err != nil {
		return err
	}

	for _, l := range links {
		if l.TargetPageID == sourcePageID {
			continue
		}
		var exists int
		if err := tx.QueryRow(`SELECT 1 FROM pages WHERE id = ? AND is_trashed = 0`, l.TargetPageID).Scan(&exists); err != nil {
			continue
		}
		_, err := tx.Exec(`
			INSERT OR IGNORE INTO page_links (source_page_id, target_page_id, source_block_id, target_block_id)
			VALUES (?, ?, ?, ?)`,
			sourcePageID, l.TargetPageID, l.SourceBlockID, l.TargetBlockID)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

// GetBacklinks returns all non-trashed pages referencing targetPageID along with a snippet excerpt.
func (s *LinkService) GetBacklinks(targetPageID string) ([]models.BacklinkItem, error) {
	rows, err := s.store.DB().Query(`
		SELECT DISTINCT p.id, p.title, p.icon, p.content_json, p.updated_at
		FROM page_links l
		JOIN pages p ON p.id = l.source_page_id
		WHERE l.target_page_id = ? AND p.is_trashed = 0
		ORDER BY p.updated_at DESC`, targetPageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []models.BacklinkItem
	for rows.Next() {
		var item models.BacklinkItem
		var contentStr string
		if err := rows.Scan(&item.SourcePageID, &item.Title, &item.Icon, &contentStr, &item.UpdatedAt); err != nil {
			return nil, err
		}
		links := ExtractPageLinks(json.RawMessage(contentStr))
		for _, l := range links {
			if l.TargetPageID == targetPageID && l.Excerpt != "" {
				item.Excerpt = l.Excerpt
				break
			}
		}
		items = append(items, item)
	}
	if items == nil {
		items = []models.BacklinkItem{}
	}
	return items, nil
}

// GetGraph returns all non-trashed pages as nodes and all valid page_links as edges.
func (s *LinkService) GetGraph() (models.GraphData, error) {
	conn := s.store.DB()
	nodeRows, err := conn.Query(`
		SELECT id, title, icon, is_database, tags_json
		FROM pages WHERE is_trashed = 0
		ORDER BY updated_at DESC`)
	if err != nil {
		return models.GraphData{}, err
	}
	defer nodeRows.Close()

	nodeMap := make(map[string]*models.GraphNode)
	var nodes []models.GraphNode
	for nodeRows.Next() {
		var n models.GraphNode
		var isDB int
		var tagsStr string
		if err := nodeRows.Scan(&n.ID, &n.Title, &n.Icon, &isDB, &tagsStr); err != nil {
			return models.GraphData{}, err
		}
		n.IsDatabase = isDB == 1
		_ = json.Unmarshal([]byte(tagsStr), &n.Tags)
		if n.Tags == nil {
			n.Tags = []string{}
		}
		nodes = append(nodes, n)
	}
	for i := range nodes {
		nodeMap[nodes[i].ID] = &nodes[i]
	}

	edgeRows, err := conn.Query(`
		SELECT DISTINCT l.source_page_id, l.target_page_id
		FROM page_links l
		JOIN pages p1 ON p1.id = l.source_page_id AND p1.is_trashed = 0
		JOIN pages p2 ON p2.id = l.target_page_id AND p2.is_trashed = 0`)
	if err != nil {
		return models.GraphData{}, err
	}
	defer edgeRows.Close()

	var edges []models.GraphEdge
	for edgeRows.Next() {
		var e models.GraphEdge
		if err := edgeRows.Scan(&e.Source, &e.Target); err != nil {
			return models.GraphData{}, err
		}
		edges = append(edges, e)
		if n, ok := nodeMap[e.Source]; ok {
			n.LinkCount++
		}
		if n, ok := nodeMap[e.Target]; ok {
			n.LinkCount++
		}
	}

	if nodes == nil {
		nodes = []models.GraphNode{}
	}
	if edges == nil {
		edges = []models.GraphEdge{}
	}
	return models.GraphData{
		Nodes: nodes,
		Edges: edges,
	}, nil
}
