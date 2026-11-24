package services

import (
	"encoding/json"
	"path/filepath"
	"testing"

	"woqu/backend/internal/config"
	"woqu/backend/internal/db"
	"woqu/backend/internal/models"
)

func setupTestEnv(t *testing.T) (*db.Store, *config.Config) {
	t.Helper()
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
	t.Cleanup(func() { _ = store.Close() })
	return store, cfg
}

func TestAuthLifecycle(t *testing.T) {
	store, cfg := setupTestEnv(t)
	auth := NewAuthService(store, cfg)

	if auth.IsInitialized() {
		t.Fatal("expected uninitialized workspace")
	}

	tok, err := auth.Setup("pass1234", "我的空间", "📘", false)
	if err != nil {
		t.Fatalf("Setup failed: %v", err)
	}
	if !auth.VerifySessionToken(tok) {
		t.Fatal("expected valid JWT after setup")
	}
	if _, err := auth.Login("wrong"); err == nil {
		t.Fatal("expected login error for wrong password")
	}
	if _, err := auth.Login("pass1234"); err != nil {
		t.Fatalf("Login failed: %v", err)
	}
	if err := auth.ChangePassword("pass1234", "newpass567"); err != nil {
		t.Fatalf("ChangePassword failed: %v", err)
	}
	if _, err := auth.Login("newpass567"); err != nil {
		t.Fatalf("Login with new password failed: %v", err)
	}
}

func TestPageLinksVersionsAndTree(t *testing.T) {
	store, _ := setupTestEnv(t)
	verSvc := NewVersionService(store)
	linkSvc := NewLinkService(store)
	pageSvc := NewPageService(store, verSvc, linkSvc)

	target, err := pageSvc.CreatePage(CreatePageInput{
		Title: "架构规范",
		Icon:  "🏗️",
		ContentJSON: json.RawMessage(`{
			"type":"doc",
			"content":[{"type":"paragraph","content":[{"type":"text","text":"关于多维表格的规范说明"}]}]
		}`),
	})
	if err != nil {
		t.Fatal(err)
	}

	source, err := pageSvc.CreatePage(CreatePageInput{
		ParentID: &target.ID,
		Title:    "周会纪要",
		Icon:     "📝",
		ContentJSON: json.RawMessage(`{
			"type":"doc",
			"content":[{
				"type":"paragraph",
				"attrs":{"blockId":"b1"},
				"content":[
					{"type":"text","text":"请参考"},
					{"type":"pageMention","attrs":{"id":"` + target.ID + `","label":"架构规范"}}
				]
			}]
		}`),
	})
	if err != nil {
		t.Fatal(err)
	}

	// Manual snapshot before edit
	if _, err := verSvc.SaveSnapshot(source.ID, "manual", "v1"); err != nil {
		t.Fatal(err)
	}

	// Update source
	newTitle := "周会纪要-更新"
	newContent := json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"已修改内容"}]}]}`)
	if _, err := pageSvc.UpdatePage(source.ID, UpdatePageInput{Title: &newTitle, ContentJSON: &newContent}); err != nil {
		t.Fatal(err)
	}

	// Backlinks before update was cleared after update; restore v1!
	versions, err := verSvc.ListVersions(source.ID)
	if err != nil || len(versions) == 0 {
		t.Fatalf("expected versions, got %d err=%v", len(versions), err)
	}
	restored, err := pageSvc.RestoreVersion(source.ID, versions[len(versions)-1].ID)
	if err != nil {
		t.Fatalf("RestoreVersion failed: %v", err)
	}
	if restored.Title != "周会纪要" {
		t.Fatalf("expected restored title '周会纪要', got %q", restored.Title)
	}

	backlinks, err := linkSvc.GetBacklinks(target.ID)
	if err != nil || len(backlinks) != 1 || backlinks[0].SourcePageID != source.ID {
		t.Fatalf("expected backlink from source after restore, got %+v err=%v", backlinks, err)
	}

	graph, err := linkSvc.GetGraph()
	if err != nil || len(graph.Nodes) != 2 || len(graph.Edges) != 1 {
		t.Fatalf("unexpected graph: %+v err=%v", graph, err)
	}
}

func TestDatabaseTwoWayRelationSync(t *testing.T) {
	store, _ := setupTestEnv(t)
	verSvc := NewVersionService(store)
	linkSvc := NewLinkService(store)
	pageSvc := NewPageService(store, verSvc, linkSvc)
	dbSvc := NewDatabaseService(store, pageSvc)

	projectsDB, err := dbSvc.CreateDatabase(CreateDatabaseInput{Title: "项目库", Icon: "📁"})
	if err != nil {
		t.Fatal(err)
	}
	tasksDB, err := dbSvc.CreateDatabase(CreateDatabaseInput{Title: "任务库", Icon: "✅"})
	if err != nil {
		t.Fatal(err)
	}

	// Add two-way relation on tasksDB -> projectsDB
	updatedTasksSchema := append(tasksDB.Schema, models.PropertySchema{
		ID:                 "prop_project",
		Name:               "所属项目",
		Type:               "relation",
		RelationDatabaseID: projectsDB.ID,
		IsTwoWay:           true,
	})
	tasksDB, err = dbSvc.UpdateSchema(tasksDB.ID, updatedTasksSchema)
	if err != nil {
		t.Fatalf("UpdateSchema failed: %v", err)
	}

	// Find synced property ID created on projectsDB
	projectsDB, err = dbSvc.GetDatabase(projectsDB.ID)
	if err != nil {
		t.Fatal(err)
	}
	var syncedPropID string
	for _, p := range projectsDB.Schema {
		if p.Type == "relation" && p.RelationDatabaseID == tasksDB.ID {
			syncedPropID = p.ID
			break
		}
	}
	if syncedPropID == "" {
		t.Fatal("expected automatic synced two-way relation property on projectsDB")
	}

	projRow, err := dbSvc.CreateRow(projectsDB.ID, "Woqu 核心开发", nil)
	if err != nil {
		t.Fatal(err)
	}
	taskRow, err := dbSvc.CreateRow(tasksDB.ID, "实现双向关联", map[string]any{
		"prop_project": []string{projRow.ID},
	})
	if err != nil {
		t.Fatal(err)
	}

	// Check reverse link automatically synced into projRow
	projReloaded, err := pageSvc.GetPage(projRow.ID)
	if err != nil {
		t.Fatal(err)
	}
	linkedTasks := toStringSlice(projReloaded.Properties[syncedPropID])
	if len(linkedTasks) != 1 || linkedTasks[0] != taskRow.ID {
		t.Fatalf("expected projRow synced relation to contain %s, got %+v", taskRow.ID, linkedTasks)
	}

	// Remove link from taskRow -> check reverse link cleared
	if _, err := dbSvc.UpdateRow(tasksDB.ID, taskRow.ID, nil, map[string]any{
		"prop_project": []string{},
	}); err != nil {
		t.Fatal(err)
	}
	projReloaded, _ = pageSvc.GetPage(projRow.ID)
	linkedTasks = toStringSlice(projReloaded.Properties[syncedPropID])
	if len(linkedTasks) != 0 {
		t.Fatalf("expected projRow synced relation cleared, got %+v", linkedTasks)
	}
}
