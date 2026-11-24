package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"

	"woqu/backend/internal/config"
	"woqu/backend/internal/db"
	"woqu/backend/internal/middleware"
	"woqu/backend/internal/models"
	"woqu/backend/internal/services"
	"woqu/backend/internal/static"
)

type Server struct {
	Cfg      *config.Config
	Store    *db.Store
	Auth     *services.AuthService
	Pages    *services.PageService
	Versions *services.VersionService
	Links    *services.LinkService
	DBs      *services.DatabaseService
	Search   *services.SearchService
	AI       *services.AIService
	Agent    *services.AIAgentService
	Template *services.TemplateService
	Share    *services.ShareService
	Clipper  *services.ClipperService
	IO       *services.IOService
	Assets   *services.AssetService
}

func NewRouter(s *Server) http.Handler {
	r := chi.NewRouter()
	r.Use(chimw.Recoverer)
	r.Use(chimw.RealIP)
	r.Use(middleware.CORSMiddleware(s.Cfg.DevMode))

	// Uploaded files
	r.Get("/uploads/*", s.handleServeUpload)

	// Public APIs
	r.Route("/api/v1", func(api chi.Router) {
		api.Get("/health", func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		})

		api.Get("/auth/status", s.handleAuthStatus)
		api.Post("/auth/setup", s.handleAuthSetup)
		api.Post("/auth/login", s.handleAuthLogin)
		api.Post("/auth/logout", s.handleAuthLogout)

		api.Get("/public/share/{token}", s.handlePublicShareGet)
		api.Post("/public/share/{token}/verify", s.handlePublicShareVerify)

		// Protected APIs
		api.Group(func(priv chi.Router) {
			priv.Use(middleware.AuthMiddleware(s.Auth, s.Cfg.JWTSecret))

			// Auth & Settings
			priv.Post("/auth/password", s.handleChangePassword)
			priv.Get("/settings", s.handleGetSettings)
			priv.Patch("/settings", s.handleUpdateSettings)

			// Pages
			priv.Get("/pages/tree", s.handlePagesTree)
			priv.Get("/pages/all", s.handlePagesAll)
			priv.Get("/pages/trash", s.handlePagesTrash)
			priv.Post("/pages", s.handleCreatePage)
			priv.Get("/pages/{id}", s.handleGetPage)
			priv.Patch("/pages/{id}", s.handleUpdatePage)
			priv.Post("/pages/{id}/move", s.handleMovePage)
			priv.Post("/pages/{id}/duplicate", s.handleDuplicatePage)
			priv.Delete("/pages/{id}", s.handleDeletePage)
			priv.Post("/pages/{id}/restore", s.handleRestorePage)
			priv.Delete("/pages/{id}/permanent", s.handlePermanentDeletePage)

			// Versions & Links & Graph
			priv.Get("/pages/{id}/versions", s.handleListVersions)
			priv.Post("/pages/{id}/versions", s.handleCreateVersion)
			priv.Post("/pages/{id}/versions/{versionId}/restore", s.handleRestoreVersion)
			priv.Get("/pages/{id}/backlinks", s.handleGetBacklinks)
			priv.Get("/graph", s.handleGetGraph)

			// Export single page
			priv.Get("/pages/{id}/export/markdown", s.handleExportMarkdown)
			priv.Get("/pages/{id}/export/html", s.handleExportHTML)

			// Page share management
			priv.Get("/pages/{id}/share", s.handleGetPageShare)
			priv.Put("/pages/{id}/share", s.handlePutPageShare)
			priv.Delete("/pages/{id}/share", s.handleDeletePageShare)

			// Databases
			priv.Get("/databases", s.handleListDatabases)
			priv.Post("/databases", s.handleCreateDatabase)
			priv.Get("/databases/by-page/{pageId}", s.handleGetDatabaseByPage)
			priv.Get("/databases/{id}", s.handleGetDatabaseFull)
			priv.Patch("/databases/{id}", s.handleUpdateDatabase)
			priv.Put("/databases/{id}/schema", s.handleUpdateDatabaseSchema)
			priv.Post("/databases/{id}/views", s.handleCreateDatabaseView)
			priv.Patch("/databases/{id}/views/{viewId}", s.handleUpdateDatabaseView)
			priv.Delete("/databases/{id}/views/{viewId}", s.handleDeleteDatabaseView)
			priv.Post("/databases/{id}/rows", s.handleCreateDatabaseRow)
			priv.Patch("/databases/{id}/rows/{rowId}", s.handleUpdateDatabaseRow)
			priv.Delete("/databases/{id}/rows/{rowId}", s.handleDeleteDatabaseRow)
			priv.Post("/databases/{id}/autofill", s.handleDatabaseAutofill)

			// Search
			priv.Get("/search", s.handleSearch)
			priv.Post("/search/reindex", s.handleReindex)

			// AI Center & Streams & Agent
			priv.Get("/ai/providers", s.handleListProviders)
			priv.Post("/ai/providers", s.handleCreateProvider)
			priv.Patch("/ai/providers/{id}", s.handleUpdateProvider)
			priv.Delete("/ai/providers/{id}", s.handleDeleteProvider)
			priv.Post("/ai/providers/{id}/test", s.handleTestProvider)
			priv.Get("/ai/routing", s.handleGetRouting)
			priv.Put("/ai/routing", s.handleSaveRouting)
			priv.Get("/ai/prompts", s.handleListPromptTemplates)
			priv.Post("/ai/prompts", s.handleCreatePromptTemplate)
			priv.Delete("/ai/prompts/{id}", s.handleDeletePromptTemplate)
			priv.Post("/ai/stream", s.handleAIStream)
			priv.Post("/ai/summarize", s.handleAISummarize)

			priv.Get("/ai/conversations", s.handleListConversations)
			priv.Post("/ai/conversations", s.handleCreateConversation)
			priv.Delete("/ai/conversations/{id}", s.handleDeleteConversation)
			priv.Get("/ai/conversations/{id}/messages", s.handleListMessages)
			priv.Post("/ai/conversations/{id}/messages", s.handleSendMessageStream)
			priv.Post("/ai/conversations/{id}/messages/{msgId}/actions/{actionId}/confirm", s.handleConfirmAction)
			priv.Post("/ai/conversations/{id}/messages/{msgId}/actions/{actionId}/reject", s.handleRejectAction)

			// Templates
			priv.Get("/templates", s.handleListTemplates)
			priv.Post("/templates/from-page", s.handleCreateTemplateFromPage)
			priv.Post("/templates/{id}/instantiate", s.handleInstantiateTemplate)
			priv.Delete("/templates/{id}", s.handleDeleteTemplate)

			// Web Clipper
			priv.Post("/clip", s.handleClipURL)

			// Import & Backup
			priv.Post("/import/markdown", s.handleImportMarkdown)
			priv.Post("/import/notion-zip", s.handleImportNotionZip)
			priv.Get("/backup/download", s.handleBackupDownload)
			priv.Post("/backup/restore", s.handleBackupRestore)

			// Assets
			priv.Post("/assets/upload", s.handleUploadAsset)
		})
	})

	// Frontend SPA
	r.Handle("/*", static.SPAHandler())
	return r
}

// Helpers
func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func decodeJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	return json.NewDecoder(io.LimitReader(r.Body, 16*1024*1024)).Decode(dst)
}

func setAuthCookie(w http.ResponseWriter, r *http.Request, token string) {
	secure := r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
	http.SetCookie(w, &http.Cookie{
		Name:     middleware.AuthCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
		MaxAge:   30 * 24 * 3600,
	})
}

func clearAuthCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     middleware.AuthCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		MaxAge:   -1,
	})
}

func setupSSE(w http.ResponseWriter) (func(event string, data any) error, error) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		return nil, fmt.Errorf("streaming unsupported")
	}
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	return func(event string, data any) error {
		b, err := json.Marshal(data)
		if err != nil {
			return err
		}
		if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, string(b)); err != nil {
			return err
		}
		flusher.Flush()
		return nil
	}, nil
}

// Auth Handlers
func (s *Server) handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	authenticated := false
	if c, err := r.Cookie(middleware.AuthCookieName); err == nil {
		authenticated = s.Auth.VerifySessionToken(c.Value)
	}
	writeJSON(w, http.StatusOK, s.Auth.Status(authenticated))
}

func (s *Server) handleAuthSetup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Password      string `json:"password"`
		WorkspaceName string `json:"workspace_name"`
		WorkspaceIcon string `json:"workspace_icon"`
		LocalNoAuth   bool   `json:"local_no_auth"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	tok, err := s.Auth.Setup(body.Password, body.WorkspaceName, body.WorkspaceIcon, body.LocalNoAuth)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.Pages.SeedWelcomeWorkspace(s.DBs)
	setAuthCookie(w, r, tok)
	writeJSON(w, http.StatusOK, s.Auth.Status(true))
}

func (s *Server) handleAuthLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	tok, err := s.Auth.Login(body.Password)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	setAuthCookie(w, r, tok)
	writeJSON(w, http.StatusOK, s.Auth.Status(true))
}

func (s *Server) handleAuthLogout(w http.ResponseWriter, r *http.Request) {
	clearAuthCookie(w)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if err := s.Auth.ChangePassword(body.CurrentPassword, body.NewPassword); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":   s.Auth.Status(true),
		"settings": s.Auth.GetAppSettings(),
	})
}

func (s *Server) handleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var body struct {
		WorkspaceName       *string           `json:"workspace_name"`
		WorkspaceIcon       *string           `json:"workspace_icon"`
		LocalNoAuth         *bool             `json:"local_no_auth"`
		PasswordForDisable  string            `json:"password_for_disable"`
		Settings            map[string]string `json:"settings"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if err := s.Auth.UpdateWorkspaceSettings(body.WorkspaceName, body.WorkspaceIcon, body.LocalNoAuth, body.PasswordForDisable); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	for k, v := range body.Settings {
		_ = s.Auth.SetSetting(k, v)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":   s.Auth.Status(true),
		"settings": s.Auth.GetAppSettings(),
	})
}

// Page Handlers
func (s *Server) handlePagesTree(w http.ResponseWriter, r *http.Request) {
	items, err := s.Pages.ListTree()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handlePagesAll(w http.ResponseWriter, r *http.Request) {
	items, err := s.Pages.ListAllSummaries()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handlePagesTrash(w http.ResponseWriter, r *http.Request) {
	items, err := s.Pages.ListTrash()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleCreatePage(w http.ResponseWriter, r *http.Request) {
	var in services.CreatePageInput
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "无效的页面参数")
		return
	}
	p, err := s.Pages.CreatePage(in)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (s *Server) handleGetPage(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	p, err := s.Pages.GetPage(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "页面不存在")
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) handleUpdatePage(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	rawBytes, err := io.ReadAll(io.LimitReader(r.Body, 16*1024*1024))
	if err != nil {
		writeError(w, http.StatusBadRequest, "读取请求失败")
		return
	}
	var rawMap map[string]json.RawMessage
	if err := json.Unmarshal(rawBytes, &rawMap); err != nil {
		writeError(w, http.StatusBadRequest, "JSON 解析失败")
		return
	}
	var in services.UpdatePageInput
	if err := json.Unmarshal(rawBytes, &in); err != nil {
		writeError(w, http.StatusBadRequest, "参数格式错误")
		return
	}
	if _, hasParent := rawMap["parent_id"]; hasParent {
		in.HasParentID = true
	}
	p, err := s.Pages.UpdatePage(id, in)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) handleMovePage(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body struct {
		ParentID *string `json:"parent_id"`
		Position float64 `json:"position"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if err := s.Pages.MovePage(id, body.ParentID, body.Position); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleDuplicatePage(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	p, err := s.Pages.DuplicatePage(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (s *Server) handleDeletePage(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.Pages.SoftDelete(id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleRestorePage(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	p, err := s.Pages.RestorePage(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) handlePermanentDeletePage(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.Pages.PermanentDelete(id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// Versions & Backlinks & Graph
func (s *Server) handleListVersions(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	list, err := s.Versions.ListVersions(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleCreateVersion(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body struct {
		Note string `json:"note"`
	}
	_ = decodeJSON(r, &body)
	v, err := s.Versions.SaveSnapshot(id, "manual", body.Note)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, v)
}

func (s *Server) handleRestoreVersion(w http.ResponseWriter, r *http.Request) {
	pageID := chi.URLParam(r, "id")
	verID := chi.URLParam(r, "versionId")
	p, err := s.Pages.RestoreVersion(pageID, verID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) handleGetBacklinks(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	list, err := s.Links.GetBacklinks(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleGetGraph(w http.ResponseWriter, r *http.Request) {
	g, err := s.Links.GetGraph()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, g)
}

// Databases
func (s *Server) handleListDatabases(w http.ResponseWriter, r *http.Request) {
	list, err := s.DBs.ListDatabases()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleCreateDatabase(w http.ResponseWriter, r *http.Request) {
	var in services.CreateDatabaseInput
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	d, err := s.DBs.CreateDatabase(in)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	full, err := s.DBs.GetDatabaseFull(d.ID)
	if err != nil {
		writeJSON(w, http.StatusCreated, d)
		return
	}
	writeJSON(w, http.StatusCreated, full)
}

func (s *Server) handleGetDatabaseByPage(w http.ResponseWriter, r *http.Request) {
	pageID := chi.URLParam(r, "pageId")
	d, err := s.DBs.GetDatabaseByPageID(pageID)
	if err != nil {
		writeError(w, http.StatusNotFound, "未找到关联的数据库")
		return
	}
	full, err := s.DBs.GetDatabaseFull(d.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, full)
}

func (s *Server) handleGetDatabaseFull(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	full, err := s.DBs.GetDatabaseFull(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "数据库不存在")
		return
	}
	writeJSON(w, http.StatusOK, full)
}

func (s *Server) handleUpdateDatabase(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body struct {
		Title       *string `json:"title"`
		Icon        *string `json:"icon"`
		Description *string `json:"description"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	d, err := s.DBs.UpdateDatabaseMeta(id, body.Title, body.Icon, body.Description)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, d)
}

func (s *Server) handleUpdateDatabaseSchema(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body struct {
		Schema []models.PropertySchema `json:"schema"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "Schema 格式错误")
		return
	}
	d, err := s.DBs.UpdateSchema(id, body.Schema)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, d)
}

func (s *Server) handleCreateDatabaseView(w http.ResponseWriter, r *http.Request) {
	dbID := chi.URLParam(r, "id")
	var body struct {
		Name   string         `json:"name"`
		Type   string         `json:"type"`
		Config map[string]any `json:"config"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "视图参数错误")
		return
	}
	v, err := s.DBs.CreateView(dbID, body.Name, body.Type, body.Config)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, v)
}

func (s *Server) handleUpdateDatabaseView(w http.ResponseWriter, r *http.Request) {
	viewID := chi.URLParam(r, "viewId")
	var body struct {
		Name   *string        `json:"name"`
		Type   *string        `json:"type"`
		Config map[string]any `json:"config"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "视图参数错误")
		return
	}
	v, err := s.DBs.UpdateView(viewID, body.Name, body.Type, body.Config)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, v)
}

func (s *Server) handleDeleteDatabaseView(w http.ResponseWriter, r *http.Request) {
	viewID := chi.URLParam(r, "viewId")
	if err := s.DBs.DeleteView(viewID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleCreateDatabaseRow(w http.ResponseWriter, r *http.Request) {
	dbID := chi.URLParam(r, "id")
	var body struct {
		Title      string         `json:"title"`
		Properties map[string]any `json:"properties"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	row, err := s.DBs.CreateRow(dbID, body.Title, body.Properties)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, row)
}

func (s *Server) handleUpdateDatabaseRow(w http.ResponseWriter, r *http.Request) {
	dbID := chi.URLParam(r, "id")
	rowID := chi.URLParam(r, "rowId")
	var body struct {
		Title      *string        `json:"title"`
		Properties map[string]any `json:"properties"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if body.Properties == nil {
		body.Properties = map[string]any{}
	}
	row, err := s.DBs.UpdateRow(dbID, rowID, body.Title, body.Properties)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, row)
}

func (s *Server) handleDeleteDatabaseRow(w http.ResponseWriter, r *http.Request) {
	dbID := chi.URLParam(r, "id")
	rowID := chi.URLParam(r, "rowId")
	if err := s.DBs.DeleteRow(dbID, rowID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleDatabaseAutofill(w http.ResponseWriter, r *http.Request) {
	dbID := chi.URLParam(r, "id")
	var body struct {
		PropertyID string   `json:"property_id"`
		RowIDs     []string `json:"row_ids"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	count, err := s.AI.AutofillDatabase(r.Context(), dbID, body.PropertyID, body.RowIDs)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"updated": count})
}

// Search
func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	results, err := s.Search.SearchPages(r.Context(), q, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (s *Server) handleReindex(w http.ResponseWriter, r *http.Request) {
	if err := s.Pages.ReindexAllFTS(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	count, err := s.Search.ReindexAllEmbeddings(r.Context())
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "vectors_indexed": count})
}

// AI Handlers
func (s *Server) handleListProviders(w http.ResponseWriter, r *http.Request) {
	list, err := s.AI.ListProviders()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleCreateProvider(w http.ResponseWriter, r *http.Request) {
	var in services.UpsertProviderInput
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	p, err := s.AI.CreateProvider(in)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (s *Server) handleUpdateProvider(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var in services.UpsertProviderInput
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	p, err := s.AI.UpdateProvider(id, in)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) handleDeleteProvider(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.AI.DeleteProvider(id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleTestProvider(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body struct {
		Model string `json:"model"`
	}
	_ = decodeJSON(r, &body)
	reply, ms, err := s.AI.TestProvider(r.Context(), id, body.Model)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "reply": reply, "latency_ms": ms})
}

func (s *Server) handleGetRouting(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.AI.GetRouting())
}

func (s *Server) handleSaveRouting(w http.ResponseWriter, r *http.Request) {
	var routing models.AIRouting
	if err := decodeJSON(r, &routing); err != nil {
		writeError(w, http.StatusBadRequest, "路由格式错误")
		return
	}
	if err := s.AI.SaveRouting(routing); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, routing)
}

func (s *Server) handleListPromptTemplates(w http.ResponseWriter, r *http.Request) {
	list, err := s.AI.ListPromptTemplates()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleCreatePromptTemplate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name               string `json:"name"`
		Category           string `json:"category"`
		Icon               string `json:"icon"`
		SystemPrompt       string `json:"system_prompt"`
		UserPromptTemplate string `json:"user_prompt_template"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "参数错误")
		return
	}
	pt, err := s.AI.CreatePromptTemplate(body.Name, body.Category, body.Icon, body.SystemPrompt, body.UserPromptTemplate)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, pt)
}

func (s *Server) handleDeletePromptTemplate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.AI.DeletePromptTemplate(id); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleAIStream(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Task         string `json:"task"` // writing, summary, chat
		ProviderID   string `json:"provider_id"`
		Model        string `json:"model"`
		SystemPrompt string `json:"system_prompt"`
		UserPrompt   string `json:"user_prompt"`
		Selection    string `json:"selection"`
		Context      string `json:"context"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	task := body.Task
	if task == "" {
		task = "writing"
	}
	sys := body.SystemPrompt
	if sys == "" {
		sys = "你是专业中文文档写作与编辑助手。直接输出符合要求的内容，避免寒暄和冗余前缀。"
	}
	usr := body.UserPrompt
	if strings.Contains(usr, "{{selection}}") {
		usr = strings.ReplaceAll(usr, "{{selection}}", body.Selection)
	} else if body.Selection != "" && !strings.Contains(usr, body.Selection) {
		usr = usr + "\n\n选中内容：\n" + body.Selection
	}
	if body.Context != "" {
		usr = "参考上下文：\n" + body.Context + "\n\n任务：\n" + usr
	}

	emit, err := setupSSE(w)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	full, err := s.AI.StreamText(r.Context(), task, body.ProviderID, body.Model, sys, usr, func(delta string) error {
		return emit("delta", map[string]string{"text": delta})
	})
	if err != nil {
		_ = emit("error", map[string]string{"error": err.Error()})
		return
	}
	_ = emit("done", map[string]string{"text": full})
}

func (s *Server) handleAISummarize(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PageID string `json:"page_id"`
		Save   bool   `json:"save"`
	}
	if err := decodeJSON(r, &body); err != nil || body.PageID == "" {
		writeError(w, http.StatusBadRequest, "缺少 page_id")
		return
	}
	emit, err := setupSSE(w)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	full, err := s.AI.SummarizePage(r.Context(), body.PageID, body.Save, func(delta string) error {
		return emit("delta", map[string]string{"text": delta})
	})
	if err != nil {
		_ = emit("error", map[string]string{"error": err.Error()})
		return
	}
	_ = emit("done", map[string]string{"summary": full})
}

// AI Agent Conversations
func (s *Server) handleListConversations(w http.ResponseWriter, r *http.Request) {
	list, err := s.Agent.ListConversations()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleCreateConversation(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title         string  `json:"title"`
		ScopeType     string  `json:"scope_type"`
		ScopeTargetID *string `json:"scope_target_id"`
	}
	_ = decodeJSON(r, &body)
	c, err := s.Agent.CreateConversation(body.Title, body.ScopeType, body.ScopeTargetID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

func (s *Server) handleDeleteConversation(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.Agent.DeleteConversation(id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleListMessages(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	list, err := s.Agent.ListMessages(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleSendMessageStream(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "id")
	var body struct {
		Content       string `json:"content"`
		ScopeType     string `json:"scope_type"`
		ScopeTargetID string `json:"scope_target_id"`
		ProviderID    string `json:"provider_id"`
		Model         string `json:"model"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	emit, err := setupSSE(w)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	_, err = s.Agent.SendMessageStream(r.Context(), convID, body.Content, body.ScopeType, body.ScopeTargetID, body.ProviderID, body.Model, emit)
	if err != nil {
		_ = emit("error", map[string]string{"error": err.Error()})
	}
}

func (s *Server) handleConfirmAction(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "id")
	msgID := chi.URLParam(r, "msgId")
	actionID := chi.URLParam(r, "actionId")
	msg, act, err := s.Agent.ConfirmAction(convID, msgID, actionID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error":   err.Error(),
			"message": msg,
			"action":  act,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"message": msg,
		"action":  act,
	})
}

func (s *Server) handleRejectAction(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "id")
	msgID := chi.URLParam(r, "msgId")
	actionID := chi.URLParam(r, "actionId")
	msg, err := s.Agent.RejectAction(convID, msgID, actionID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"message": msg})
}

// Templates
func (s *Server) handleListTemplates(w http.ResponseWriter, r *http.Request) {
	list, err := s.Template.ListTemplates()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleCreateTemplateFromPage(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PageID      string `json:"page_id"`
		Name        string `json:"name"`
		Category    string `json:"category"`
		Icon        string `json:"icon"`
		Description string `json:"description"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "参数错误")
		return
	}
	tpl, err := s.Template.SavePageAsTemplate(body.PageID, body.Name, body.Category, body.Icon, body.Description)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, tpl)
}

func (s *Server) handleInstantiateTemplate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body struct {
		ParentID *string `json:"parent_id"`
	}
	_ = decodeJSON(r, &body)
	p, err := s.Template.InstantiateTemplate(id, body.ParentID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (s *Server) handleDeleteTemplate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.Template.DeleteTemplate(id); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// Public Shares
func (s *Server) handleGetPageShare(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	sh, err := s.Share.GetShareForPage(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"share": sh})
}

func (s *Server) handlePutPageShare(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body struct {
		Password      string  `json:"password"`
		ClearPassword bool    `json:"clear_password"`
		ExpiresAt     *string `json:"expires_at"`
		IsActive      bool    `json:"is_active"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "参数错误")
		return
	}
	sh, err := s.Share.CreateOrUpdateShare(id, body.Password, body.ClearPassword, body.ExpiresAt, body.IsActive)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"share": sh})
}

func (s *Server) handleDeletePageShare(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.Share.RevokeShare(id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handlePublicShareGet(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	payload, err := s.Share.AccessPublicShare(token, "")
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func (s *Server) handlePublicShareVerify(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	var body struct {
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "参数错误")
		return
	}
	payload, err := s.Share.AccessPublicShare(token, body.Password)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

// Clipper
func (s *Server) handleClipURL(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URL           string  `json:"url"`
		ParentID      *string `json:"parent_id"`
		WithAISummary bool    `json:"with_ai_summary"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "参数错误")
		return
	}
	res, err := s.Clipper.ClipURL(r.Context(), body.URL, body.ParentID, body.WithAISummary)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, res)
}

// Export / Import / Backup
func (s *Server) handleExportMarkdown(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	filename, md, err := s.IO.ExportPageMarkdown(id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename*=UTF-8''%s", url.PathEscape(filename)))
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, md)
}

func (s *Server) handleExportHTML(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	filename, htmlStr, err := s.IO.ExportPageHTML(id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename*=UTF-8''%s", url.PathEscape(filename)))
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, htmlStr)
}

func (s *Server) handleImportMarkdown(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "解析上传文件失败")
		return
	}
	var parentID *string
	if p := strings.TrimSpace(r.FormValue("parent_id")); p != "" {
		parentID = &p
	}
	var files []services.ImportedFile
	for _, fh := range r.MultipartForm.File["files"] {
		f, err := fh.Open()
		if err != nil {
			continue
		}
		b, err := io.ReadAll(io.LimitReader(f, 16<<20))
		_ = f.Close()
		if err == nil {
			files = append(files, services.ImportedFile{Filename: fh.Filename, Content: string(b)})
		}
	}
	if len(files) == 0 {
		writeError(w, http.StatusBadRequest, "请上传至少一个 Markdown 文件")
		return
	}
	res, err := s.IO.ImportMarkdownFiles(files, parentID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, res)
}

func (s *Server) handleImportNotionZip(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(256 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "解析 Zip 上传失败")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "请选择 Notion 导出的 Zip 文件")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 256<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	var parentID *string
	if p := strings.TrimSpace(r.FormValue("parent_id")); p != "" {
		parentID = &p
	}
	res, err := s.IO.ImportNotionZip(bytes.NewReader(data), int64(len(data)), parentID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, res)
}

func (s *Server) handleBackupDownload(w http.ResponseWriter, r *http.Request) {
	name := fmt.Sprintf("woqu-backup-%s.zip", time.Now().Format("20060102-150405"))
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", name))
	if err := db.CreateBackupZip(s.Store, s.Cfg.DataDir, w); err != nil {
		// Headers may already be written; log only if partial
		return
	}
}

func (s *Server) handleBackupRestore(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(512 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "解析备份文件失败")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "请选择备份 .zip 文件")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 512<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := db.RestoreBackupZip(s.Store, s.Cfg.DataDir, bytes.NewReader(data), int64(len(data))); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// Assets
func (s *Server) handleUploadAsset(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "文件解析失败")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "未找到上传文件")
		return
	}
	defer file.Close()
	var pageID *string
	if pid := strings.TrimSpace(r.FormValue("page_id")); pid != "" {
		pageID = &pid
	}
	asset, err := s.Assets.SaveUpload(header.Filename, header.Header.Get("Content-Type"), pageID, file)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, asset)
}

func (s *Server) handleServeUpload(w http.ResponseWriter, r *http.Request) {
	rel := chi.URLParam(r, "*")
	fullPath, err := s.Assets.ResolvePath(rel)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	info, err := os.Stat(fullPath)
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}
	if ext := strings.ToLower(filepath.Ext(fullPath)); ext == ".svg" || ext == ".html" {
		w.Header().Set("Content-Security-Policy", "sandbox")
	}
	http.ServeFile(w, r, fullPath)
}
