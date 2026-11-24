package db

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestSQLiteCJKFTS5AndBackupRestore(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "woqu.db")
	uploadsDir := filepath.Join(tmpDir, "uploads")
	if err := os.MkdirAll(uploadsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(uploadsDir, "hello.txt"), []byte("attachment-data"), 0o644); err != nil {
		t.Fatal(err)
	}

	store, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer store.Close()

	now := "2026-11-23T12:00:00Z"
	_, err = store.DB().Exec(`
		INSERT INTO pages (id, title, plain_text, summary, created_at, updated_at)
		VALUES ('p1', '产品设计文档', '这是一个支持多维看板和自动摘要的系统，支持Go与React。', '核心摘要内容', ?, ?)`,
		now, now)
	if err != nil {
		t.Fatalf("insert page failed: %v", err)
	}

	_, err = store.DB().Exec(`
		INSERT INTO pages_fts (page_id, title_seg, content_seg, summary_seg, tags_seg)
		VALUES ('p1', ?, ?, ?, '')`,
		SegmentCJK("产品设计文档"),
		SegmentCJK("这是一个支持多维看板和自动摘要的系统，支持Go与React。"),
		SegmentCJK("核心摘要内容"))
	if err != nil {
		t.Fatalf("insert fts failed: %v", err)
	}

	for _, kw := range []string{"看板", "摘要", "设计", "React", "Go"} {
		q := BuildFTSQuery(kw)
		var id string
		err := store.DB().QueryRow(`SELECT page_id FROM pages_fts WHERE pages_fts MATCH ?`, q).Scan(&id)
		if err != nil || id != "p1" {
			t.Fatalf("FTS5 search for %q (query=%q) failed: id=%q err=%v", kw, q, id, err)
		}
	}

	// Verify special punctuation doesn't break FTS5 MATCH
	if q := BuildFTSQuery(`C++ / (看板): "test"-1`); q == "" {
		t.Fatal("expected non-empty sanitized FTS query")
	} else {
		rows, err := store.DB().Query(`SELECT page_id FROM pages_fts WHERE pages_fts MATCH ?`, q)
		if err != nil {
			t.Fatalf("sanitized query caused FTS5 syntax error: %v", err)
		}
		_ = rows.Close()
	}

	// Backup to zip
	var buf bytes.Buffer
	if err := CreateBackupZip(store, tmpDir, &buf); err != nil {
		t.Fatalf("CreateBackupZip failed: %v", err)
	}

	// Mutate DB and remove attachment
	_, _ = store.DB().Exec(`DELETE FROM pages WHERE id = 'p1'`)
	_ = os.Remove(filepath.Join(uploadsDir, "hello.txt"))

	// Restore from zip
	if err := RestoreBackupZip(store, tmpDir, bytes.NewReader(buf.Bytes()), int64(buf.Len())); err != nil {
		t.Fatalf("RestoreBackupZip failed: %v", err)
	}

	var restoredTitle string
	if err := store.DB().QueryRow(`SELECT title FROM pages WHERE id = 'p1'`).Scan(&restoredTitle); err != nil {
		t.Fatalf("expected restored page p1: %v", err)
	}
	if restoredTitle != "产品设计文档" {
		t.Fatalf("unexpected restored title: %q", restoredTitle)
	}
	data, err := os.ReadFile(filepath.Join(uploadsDir, "hello.txt"))
	if err != nil || string(data) != "attachment-data" {
		t.Fatalf("expected restored upload file, got %q err=%v", string(data), err)
	}
}
