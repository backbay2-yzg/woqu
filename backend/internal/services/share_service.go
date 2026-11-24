package services

import (
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	"woqu/backend/internal/crypto"
	"woqu/backend/internal/db"
	"woqu/backend/internal/models"
)

type ShareService struct {
	store   *db.Store
	pageSvc *PageService
	dbSvc   *DatabaseService
}

func NewShareService(store *db.Store, pageSvc *PageService, dbSvc *DatabaseService) *ShareService {
	return &ShareService{store: store, pageSvc: pageSvc, dbSvc: dbSvc}
}

func (s *ShareService) GetShareForPage(pageID string) (*models.PublicShare, error) {
	var sh models.PublicShare
	var passHash string
	var expiresAt sql.NullString
	var isActive int
	err := s.store.DB().QueryRow(`
		SELECT id, page_id, token, password_hash, expires_at, is_active, view_count, created_at
		FROM public_shares WHERE page_id = ? LIMIT 1`, pageID).
		Scan(&sh.ID, &sh.PageID, &sh.Token, &passHash, &expiresAt, &isActive, &sh.ViewCount, &sh.CreatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	sh.HasPassword = passHash != ""
	sh.IsActive = isActive == 1
	if expiresAt.Valid {
		sh.ExpiresAt = &expiresAt.String
	}
	return &sh, nil
}

func (s *ShareService) CreateOrUpdateShare(pageID, password string, clearPassword bool, expiresAt *string, isActive bool) (*models.PublicShare, error) {
	if _, err := s.pageSvc.GetPage(pageID); err != nil {
		return nil, err
	}
	existing, err := s.GetShareForPage(pageID)
	if err != nil {
		return nil, err
	}

	activeInt := 0
	if isActive {
		activeInt = 1
	}

	if existing == nil {
		token, err := crypto.GenerateRandomHex(12)
		if err != nil {
			return nil, err
		}
		var passHash string
		if strings.TrimSpace(password) != "" {
			passHash, err = crypto.HashPassword(strings.TrimSpace(password))
			if err != nil {
				return nil, err
			}
		}
		id := uuid.NewString()
		now := time.Now().UTC().Format(time.RFC3339)
		_, err = s.store.DB().Exec(`
			INSERT INTO public_shares (id, page_id, token, password_hash, expires_at, is_active, view_count, created_at)
			VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
			id, pageID, token, passHash, expiresAt, activeInt, now)
		if err != nil {
			return nil, err
		}
		return s.GetShareForPage(pageID)
	}

	var curPassHash string
	_ = s.store.DB().QueryRow(`SELECT password_hash FROM public_shares WHERE id = ?`, existing.ID).Scan(&curPassHash)
	if clearPassword {
		curPassHash = ""
	} else if strings.TrimSpace(password) != "" {
		curPassHash, err = crypto.HashPassword(strings.TrimSpace(password))
		if err != nil {
			return nil, err
		}
	}

	_, err = s.store.DB().Exec(`
		UPDATE public_shares SET password_hash = ?, expires_at = ?, is_active = ? WHERE id = ?`,
		curPassHash, expiresAt, activeInt, existing.ID)
	if err != nil {
		return nil, err
	}
	return s.GetShareForPage(pageID)
}

func (s *ShareService) RevokeShare(pageID string) error {
	_, err := s.store.DB().Exec(`DELETE FROM public_shares WHERE page_id = ?`, pageID)
	return err
}

type PublicSharePayload struct {
	NeedsPassword bool                  `json:"needs_password"`
	Title         string                `json:"title,omitempty"`
	Icon          string                `json:"icon,omitempty"`
	Page          *models.Page          `json:"page,omitempty"`
	Database      *models.DatabaseFull  `json:"database,omitempty"`
	InlineDBs     []models.DatabaseFull `json:"inline_databases,omitempty"`
}

func (s *ShareService) AccessPublicShare(token, password string) (*PublicSharePayload, error) {
	var shareID, pageID, passHash string
	var expiresAt sql.NullString
	var isActive int
	err := s.store.DB().QueryRow(`
		SELECT id, page_id, password_hash, expires_at, is_active
		FROM public_shares WHERE token = ?`, token).
		Scan(&shareID, &pageID, &passHash, &expiresAt, &isActive)
	if err != nil {
		return nil, errors.New("分享链接不存在或已被撤销")
	}
	if isActive != 1 {
		return nil, errors.New("该分享链接已关闭")
	}
	if expiresAt.Valid && expiresAt.String != "" {
		if expTime, parseErr := time.Parse(time.RFC3339, expiresAt.String); parseErr == nil {
			if time.Now().After(expTime) {
				return nil, errors.New("该分享链接已过期")
			}
		}
	}

	page, err := s.pageSvc.GetPage(pageID)
	if err != nil || page.IsTrashed {
		return nil, errors.New("分享页面不存在或已被删除")
	}

	if passHash != "" {
		if password == "" || !crypto.CheckPassword(password, passHash) {
			if password != "" {
				return nil, errors.New("访问密码不正确")
			}
			return &PublicSharePayload{
				NeedsPassword: true,
				Title:         page.Title,
				Icon:          page.Icon,
			}, nil
		}
	}

	_, _ = s.store.DB().Exec(`UPDATE public_shares SET view_count = view_count + 1 WHERE id = ?`, shareID)

	payload := &PublicSharePayload{
		NeedsPassword: false,
		Title:         page.Title,
		Icon:          page.Icon,
		Page:          page,
	}

	if page.IsDatabase {
		if dbMeta, err := s.dbSvc.GetDatabaseByPageID(page.ID); err == nil {
			if full, err := s.dbSvc.GetDatabaseFull(dbMeta.ID); err == nil {
				payload.Database = full
			}
		}
	}

	// Collect inline databases referenced inside this page
	if root, err := ParseTipTapDoc(page.ContentJSON); err == nil {
		for _, id := range collectInlineDBIDs(root) {
			if full, err := s.dbSvc.GetDatabaseFull(id); err == nil {
				payload.InlineDBs = append(payload.InlineDBs, *full)
			}
		}
	}
	return payload, nil
}

func collectInlineDBIDs(n TipTapNode) []string {
	var ids []string
	if n.Type == "inlineDatabase" {
		if id := getStrAttr(n.Attrs, "databaseId"); id != "" {
			ids = append(ids, id)
		}
	}
	for _, c := range n.Content {
		ids = append(ids, collectInlineDBIDs(c)...)
	}
	return ids
}
