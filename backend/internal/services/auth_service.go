package services

import (
	"database/sql"
	"errors"
	"strings"
	"time"

	"woqu/backend/internal/config"
	"woqu/backend/internal/crypto"
	"woqu/backend/internal/db"
	"woqu/backend/internal/models"
)

const (
	settingPasswordHash  = "password_hash"
	settingLocalNoAuth   = "local_no_auth"
	settingWorkspaceName = "workspace_name"
	settingWorkspaceIcon = "workspace_icon"
	settingTheme         = "theme"
)

type AuthService struct {
	store *db.Store
	cfg   *config.Config
}

func NewAuthService(store *db.Store, cfg *config.Config) *AuthService {
	svc := &AuthService{store: store, cfg: cfg}
	svc.ensureEnvPasswordBootstrap()
	return svc
}

func (s *AuthService) ensureEnvPasswordBootstrap() {
	if strings.TrimSpace(s.cfg.InitialPassword) == "" {
		return
	}
	if s.IsInitialized() {
		return
	}
	_, _ = s.Setup(s.cfg.InitialPassword, "我趣知识库", "📘", false)
}

func (s *AuthService) getSetting(key string) string {
	var val string
	err := s.store.DB().QueryRow(`SELECT value FROM app_settings WHERE key = ?`, key).Scan(&val)
	if err != nil {
		return ""
	}
	return val
}

func (s *AuthService) setSetting(key, value string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.store.DB().Exec(`
		INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		key, value, now)
	return err
}

func (s *AuthService) IsInitialized() bool {
	return s.getSetting(settingPasswordHash) != "" || s.IsLocalNoAuth()
}

func (s *AuthService) IsLocalNoAuth() bool {
	return s.getSetting(settingLocalNoAuth) == "true"
}

func (s *AuthService) Status(authenticated bool) models.AuthStatus {
	name := s.getSetting(settingWorkspaceName)
	if name == "" {
		name = "我趣文档"
	}
	icon := s.getSetting(settingWorkspaceIcon)
	if icon == "" {
		icon = "✨"
	}
	localNoAuth := s.IsLocalNoAuth()
	return models.AuthStatus{
		Initialized:   s.IsInitialized(),
		Authenticated: authenticated || localNoAuth,
		LocalNoAuth:   localNoAuth,
		WorkspaceName: name,
		WorkspaceIcon: icon,
	}
}

// Setup completes first-time workspace setup and returns a signed JWT token.
func (s *AuthService) Setup(password, workspaceName, workspaceIcon string, localNoAuth bool) (string, error) {
	if s.IsInitialized() {
		return "", errors.New("workspace is already initialized")
	}
	if !localNoAuth && len(strings.TrimSpace(password)) < 4 {
		return "", errors.New("密码长度至少为 4 位")
	}
	if strings.TrimSpace(workspaceName) == "" {
		workspaceName = "我趣文档"
	}
	if strings.TrimSpace(workspaceIcon) == "" {
		workspaceIcon = "✨"
	}

	if password != "" {
		hash, err := crypto.HashPassword(password)
		if err != nil {
			return "", err
		}
		if err := s.setSetting(settingPasswordHash, hash); err != nil {
			return "", err
		}
	}
	if localNoAuth {
		if err := s.setSetting(settingLocalNoAuth, "true"); err != nil {
			return "", err
		}
	} else {
		if err := s.setSetting(settingLocalNoAuth, "false"); err != nil {
			return "", err
		}
	}
	_ = s.setSetting(settingWorkspaceName, workspaceName)
	_ = s.setSetting(settingWorkspaceIcon, workspaceIcon)

	return crypto.GenerateJWT(s.cfg.JWTSecret, "owner", 30*24*time.Hour)
}

func (s *AuthService) Login(password string) (string, error) {
	if !s.IsInitialized() {
		return "", errors.New("workspace not initialized")
	}
	if s.IsLocalNoAuth() {
		return crypto.GenerateJWT(s.cfg.JWTSecret, "owner", 30*24*time.Hour)
	}
	hash := s.getSetting(settingPasswordHash)
	if !crypto.CheckPassword(password, hash) {
		return "", errors.New("密码错误")
	}
	return crypto.GenerateJWT(s.cfg.JWTSecret, "owner", 30*24*time.Hour)
}

func (s *AuthService) VerifySessionToken(token string) bool {
	if s.IsLocalNoAuth() {
		return true
	}
	sub, err := crypto.VerifyJWT(s.cfg.JWTSecret, token)
	return err == nil && sub == "owner"
}

func (s *AuthService) ChangePassword(currentPassword, newPassword string) error {
	if len(strings.TrimSpace(newPassword)) < 4 {
		return errors.New("新密码长度至少为 4 位")
	}
	hash := s.getSetting(settingPasswordHash)
	if hash != "" && !crypto.CheckPassword(currentPassword, hash) {
		return errors.New("当前密码不正确")
	}
	newHash, err := crypto.HashPassword(newPassword)
	if err != nil {
		return err
	}
	return s.setSetting(settingPasswordHash, newHash)
}

func (s *AuthService) UpdateWorkspaceSettings(workspaceName, workspaceIcon *string, localNoAuth *bool, passwordForDisable string) error {
	if workspaceName != nil && strings.TrimSpace(*workspaceName) != "" {
		if err := s.setSetting(settingWorkspaceName, strings.TrimSpace(*workspaceName)); err != nil {
			return err
		}
	}
	if workspaceIcon != nil && strings.TrimSpace(*workspaceIcon) != "" {
		if err := s.setSetting(settingWorkspaceIcon, strings.TrimSpace(*workspaceIcon)); err != nil {
			return err
		}
	}
	if localNoAuth != nil {
		if !*localNoAuth && s.getSetting(settingPasswordHash) == "" {
			if len(strings.TrimSpace(passwordForDisable)) < 4 {
				return errors.New("关闭免登录模式前需先设置至少 4 位的登录密码")
			}
			hash, err := crypto.HashPassword(passwordForDisable)
			if err != nil {
				return err
			}
			if err := s.setSetting(settingPasswordHash, hash); err != nil {
				return err
			}
		}
		val := "false"
		if *localNoAuth {
			val = "true"
		}
		if err := s.setSetting(settingLocalNoAuth, val); err != nil {
			return err
		}
	}
	return nil
}

func (s *AuthService) GetAppSettings() map[string]string {
	rows, err := s.store.DB().Query(`SELECT key, value FROM app_settings`)
	if err != nil {
		return map[string]string{}
	}
	defer rows.Close()
	res := make(map[string]string)
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err == nil {
			if k == settingPasswordHash {
				continue
			}
			res[k] = v
		}
	}
	return res
}

func (s *AuthService) SetSetting(key, value string) error {
	if key == settingPasswordHash {
		return sql.ErrNoRows
	}
	return s.setSetting(key, value)
}
