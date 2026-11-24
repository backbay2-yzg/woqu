package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"woqu/backend/internal/config"
	"woqu/backend/internal/db"
	"woqu/backend/internal/handlers"
	"woqu/backend/internal/services"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	store, err := db.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("failed to open sqlite db: %v", err)
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
	clipperSvc := services.NewClipperService(cfg, pageSvc, aiSvc)
	assetSvc := services.NewAssetService(store, cfg)
	ioSvc := services.NewIOService(pageSvc, dbSvc, assetSvc)

	// Wire embedding function and async indexing callback
	searchSvc.SetEmbedFunc(aiSvc.ComputeEmbeddings)
	pageSvc.SetOnPageIndexed(func(pageID string) {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			_ = searchSvc.IndexPageEmbeddings(ctx, pageID)
		}()
	})

	if authSvc.IsInitialized() {
		pageSvc.SeedWelcomeWorkspace(dbSvc)
	}

	srv := &handlers.Server{
		Cfg:      cfg,
		Store:    store,
		Auth:     authSvc,
		Pages:    pageSvc,
		Versions: verSvc,
		Links:    linkSvc,
		DBs:      dbSvc,
		Search:   searchSvc,
		AI:       aiSvc,
		Agent:    agentSvc,
		Template: tplSvc,
		Share:    shareSvc,
		Clipper:  clipperSvc,
		IO:       ioSvc,
		Assets:   assetSvc,
	}

	httpServer := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handlers.NewRouter(srv),
		ReadHeaderTimeout: 15 * time.Second,
	}

	go func() {
		log.Printf("Woqu server listening on http://localhost:%s (data: %s)", cfg.Port, cfg.DataDir)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http server error: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
}
