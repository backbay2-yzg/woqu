package services

import (
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"

	"woqu/backend/internal/config"
	"woqu/backend/internal/db"
	"woqu/backend/internal/models"
)

type AssetService struct {
	store *db.Store
	cfg   *config.Config
}

func NewAssetService(store *db.Store, cfg *config.Config) *AssetService {
	return &AssetService{store: store, cfg: cfg}
}

// SaveUpload persists an uploaded file to data/uploads/YYYY/MM/<uuid><ext> and records it in assets.
func (s *AssetService) SaveUpload(filename, mimeType string, pageID *string, r io.Reader) (*models.Asset, error) {
	nowTime := time.Now().UTC()
	subDir := filepath.Join(nowTime.Format("2006"), nowTime.Format("01"))
	targetDir := filepath.Join(s.cfg.UploadsDir, subDir)
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return nil, err
	}

	ext := strings.ToLower(filepath.Ext(filename))
	if ext == "" && mimeType != "" {
		if exts, err := mime.ExtensionsByType(mimeType); err == nil && len(exts) > 0 {
			ext = exts[0]
		}
	}
	id := uuid.NewString()
	storedName := id + ext
	storageRel := filepath.ToSlash(filepath.Join(subDir, storedName))
	fullPath := filepath.Join(targetDir, storedName)

	out, err := os.Create(fullPath)
	if err != nil {
		return nil, err
	}
	n, copyErr := io.Copy(out, r)
	closeErr := out.Close()
	if copyErr != nil {
		_ = os.Remove(fullPath)
		return nil, copyErr
	}
	if closeErr != nil {
		return nil, closeErr
	}

	if mimeType == "" {
		mimeType = mime.TypeByExtension(ext)
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
	}

	now := nowTime.Format(time.RFC3339Nano)
	_, err = s.store.DB().Exec(`
		INSERT INTO assets (id, filename, storage_path, mime_type, size_bytes, page_id, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		id, filename, storageRel, mimeType, n, pageID, now)
	if err != nil {
		return nil, err
	}

	return &models.Asset{
		ID:          id,
		Filename:    filename,
		StoragePath: storageRel,
		URL:         fmt.Sprintf("/uploads/%s", storageRel),
		MimeType:    mimeType,
		SizeBytes:   n,
		PageID:      pageID,
		CreatedAt:   now,
	}, nil
}

// ResolvePath safely resolves a requested /uploads/<relPath> to an on-disk path inside cfg.UploadsDir.
func (s *AssetService) ResolvePath(relPath string) (string, error) {
	cleaned := filepath.Clean(filepath.FromSlash(strings.TrimPrefix(relPath, "/")))
	if strings.HasPrefix(cleaned, "..") || filepath.IsAbs(cleaned) {
		return "", fmt.Errorf("invalid asset path")
	}
	full := filepath.Join(s.cfg.UploadsDir, cleaned)
	absBase, _ := filepath.Abs(s.cfg.UploadsDir)
	absTarget, _ := filepath.Abs(full)
	if !strings.HasPrefix(absTarget, absBase+string(filepath.Separator)) && absTarget != absBase {
		return "", fmt.Errorf("path escapes uploads dir")
	}
	return absTarget, nil
}
