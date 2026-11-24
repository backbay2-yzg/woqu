package services

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"

	"woqu/backend/internal/db"
	"woqu/backend/internal/models"
)

type VersionService struct {
	store *db.Store
}

func NewVersionService(store *db.Store) *VersionService {
	return &VersionService{store: store}
}

// SaveSnapshot creates a version snapshot. For 'auto' snapshots, it debounces within 5 minutes
// if content and title haven't changed. 'manual' and 'pre_ai' snapshots are always saved.
func (s *VersionService) SaveSnapshot(pageID, source, note string) (*models.PageVersion, error) {
	conn := s.store.DB()
	var title, contentJSON, propsJSON string
	err := conn.QueryRow(`SELECT title, content_json, properties_json FROM pages WHERE id = ?`, pageID).
		Scan(&title, &contentJSON, &propsJSON)
	if err != nil {
		return nil, err
	}

	if source == "" {
		source = "auto"
	}

	if source == "auto" {
		var lastTitle, lastContent, lastCreated string
		err := conn.QueryRow(`
			SELECT title, content_json, created_at FROM page_versions
			WHERE page_id = ? ORDER BY created_at DESC LIMIT 1`, pageID).
			Scan(&lastTitle, &lastContent, &lastCreated)
		if err == nil {
			if lastTitle == title && lastContent == contentJSON {
				return nil, nil
			}
			if t, parseErr := time.Parse(time.RFC3339, lastCreated); parseErr == nil {
				if time.Since(t) < 5*time.Minute {
					return nil, nil
				}
			}
		}
	}

	id := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err = conn.Exec(`
		INSERT INTO page_versions (id, page_id, title, content_json, properties_json, source, note, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id, pageID, title, contentJSON, propsJSON, source, note, now)
	if err != nil {
		return nil, err
	}

	// Keep at most 80 versions per page to avoid unbounded DB growth
	_, _ = conn.Exec(`
		DELETE FROM page_versions WHERE id IN (
			SELECT id FROM page_versions WHERE page_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET 80
		)`, pageID)

	var props map[string]any
	_ = json.Unmarshal([]byte(propsJSON), &props)
	return &models.PageVersion{
		ID:          id,
		PageID:      pageID,
		Title:       title,
		ContentJSON: json.RawMessage(contentJSON),
		Properties:  props,
		Source:      source,
		Note:        note,
		CreatedAt:   now,
	}, nil
}

func (s *VersionService) ListVersions(pageID string) ([]models.PageVersion, error) {
	rows, err := s.store.DB().Query(`
		SELECT id, page_id, title, content_json, properties_json, source, note, created_at
		FROM page_versions WHERE page_id = ? ORDER BY created_at DESC`, pageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []models.PageVersion
	for rows.Next() {
		var v models.PageVersion
		var contentStr, propsStr string
		if err := rows.Scan(&v.ID, &v.PageID, &v.Title, &contentStr, &propsStr, &v.Source, &v.Note, &v.CreatedAt); err != nil {
			return nil, err
		}
		v.ContentJSON = json.RawMessage(contentStr)
		_ = json.Unmarshal([]byte(propsStr), &v.Properties)
		if v.Properties == nil {
			v.Properties = map[string]any{}
		}
		result = append(result, v)
	}
	if result == nil {
		result = []models.PageVersion{}
	}
	return result, nil
}

func (s *VersionService) GetVersion(pageID, versionID string) (*models.PageVersion, error) {
	var v models.PageVersion
	var contentStr, propsStr string
	err := s.store.DB().QueryRow(`
		SELECT id, page_id, title, content_json, properties_json, source, note, created_at
		FROM page_versions WHERE id = ? AND page_id = ?`, versionID, pageID).
		Scan(&v.ID, &v.PageID, &v.Title, &contentStr, &propsStr, &v.Source, &v.Note, &v.CreatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errors.New("version not found")
		}
		return nil, err
	}
	v.ContentJSON = json.RawMessage(contentStr)
	_ = json.Unmarshal([]byte(propsStr), &v.Properties)
	return &v, nil
}
