package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"woqu/backend/internal/config"
	"woqu/backend/internal/db"
	"woqu/backend/internal/services"
)

func TestHTTPAPIAuthPagesDatabaseAndShare(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("WOQU_DATA_DIR", dir)
	cfg, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}
	store, err := db.Open(filepath.Join(dir, "woqu.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	authSvc := services.NewAuthService(store, cfg)
	verSvc := services.NewVersionService(store)
	linkSvc := services.NewLinkService(store)
	pageSvc := services.NewPageService(store, verSvc, linkSvc)
	dbSvc := services.NewDatabaseService(store, pageSvc)
	searchSvc := services.NewSearchService(store)
	aiSvc := services.NewAIService(store, cfg, pageSvc, dbSvc)
	agentSvc := services.NewAIAgentService(store, aiSvc, searchSvc, pageSvc, dbSvc, verSvc)
	tplSvc := services.NewTemplateService(store, pageSvc)
	shareSvc := services.NewShareService(store, pageSvc, dbSvc)
	clipSvc := services.NewClipperService(cfg, pageSvc, aiSvc)
	assetSvc := services.NewAssetService(store, cfg)
	ioSvc := services.NewIOService(pageSvc, dbSvc, assetSvc)

	router := NewRouter(&Server{
		Cfg: cfg, Store: store, Auth: authSvc, Pages: pageSvc, Versions: verSvc,
		Links: linkSvc, DBs: dbSvc, Search: searchSvc, AI: aiSvc, Agent: agentSvc,
		Template: tplSvc, Share: shareSvc, Clipper: clipSvc, IO: ioSvc, Assets: assetSvc,
	})

	// 1. Unauthenticated request to protected endpoint returns 401
	req := httptest.NewRequest(http.MethodGet, "/api/v1/pages/tree", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 before auth, got %d", rec.Code)
	}

	// 2. Setup workspace and get auth cookie
	setupBody, _ := json.Marshal(map[string]any{
		"password":       "woqu1234",
		"workspace_name": "测试空间",
	})
	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/setup", bytes.NewReader(setupBody))
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("setup failed: %d %s", rec.Code, rec.Body.String())
	}
	cookies := rec.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("expected auth cookie after setup")
	}

	// 3. Authenticated pages tree (seeded welcome page + sample db)
	req = httptest.NewRequest(http.MethodGet, "/api/v1/pages/tree", nil)
	req.AddCookie(cookies[0])
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("pages/tree failed: %d", rec.Code)
	}
	var tree []map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &tree)
	if len(tree) < 2 {
		t.Fatalf("expected seeded welcome pages, got %d", len(tree))
	}

	// 4. Search seeded Chinese keyword
	req = httptest.NewRequest(http.MethodGet, "/api/v1/search?q=%E7%9C%8B%E6%9D%BF", nil) // "看板"
	req.AddCookie(cookies[0])
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("search failed: %d", rec.Code)
	}
	var hits []map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &hits)
	if len(hits) == 0 {
		t.Fatal("expected search hit for '看板'")
	}
}
