package services

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"woqu/backend/internal/models"
)

func TestMultiProviderStreamingAndEmbeddings(t *testing.T) {
	store, cfg := setupTestEnv(t)
	verSvc := NewVersionService(store)
	linkSvc := NewLinkService(store)
	pageSvc := NewPageService(store, verSvc, linkSvc)
	dbSvc := NewDatabaseService(store, pageSvc)
	searchSvc := NewSearchService(store)
	aiSvc := NewAIService(store, cfg, pageSvc, dbSvc)
	searchSvc.SetEmbedFunc(aiSvc.ComputeEmbeddings)

	// 1. Mock OpenAI-compatible server (chat SSE + embeddings)
	openaiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/chat/completions"):
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}\n\n")
			_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"世界\"}}]}\n\n")
			_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
		case strings.HasSuffix(r.URL.Path, "/embeddings"):
			var req struct {
				Input []string `json:"input"`
			}
			_ = json.NewDecoder(r.Body).Decode(&req)
			type embItem struct {
				Index     int       `json:"index"`
				Embedding []float32 `json:"embedding"`
			}
			var items []embItem
			for i, txt := range req.Input {
				vec := []float32{0.1, 0.9, 0.0}
				if strings.Contains(txt, "Go") || strings.Contains(txt, "后端") {
					vec = []float32{0.95, 0.05, 0.0}
				}
				items = append(items, embItem{Index: i, Embedding: vec})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": items})
		}
	}))
	defer openaiSrv.Close()

	// 2. Mock Anthropic server
	anthropicSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = fmt.Fprint(w, "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Claude答复\"}}\n\n")
	}))
	defer anthropicSrv.Close()

	// 3. Mock Gemini server
	geminiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = fmt.Fprint(w, "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Gemini答复\"}]}}]}\n\n")
	}))
	defer geminiSrv.Close()

	key := "sk-test-secret-123456"
	pOpenAI, err := aiSvc.CreateProvider(UpsertProviderInput{
		Name:         "MockOpenAI",
		ProviderType: "openai_compatible",
		BaseURL:      openaiSrv.URL + "/v1",
		APIKey:       &key,
		Models:       []string{"gpt-4o-mini", "text-embedding-3-small"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if pOpenAI.APIKeyMasked != "sk-****3456" {
		t.Fatalf("expected masked key, got %q", pOpenAI.APIKeyMasked)
	}

	pAnthropic, err := aiSvc.CreateProvider(UpsertProviderInput{
		Name:         "MockClaude",
		ProviderType: "anthropic",
		BaseURL:      anthropicSrv.URL,
		APIKey:       &key,
		Models:       []string{"claude-3-7-sonnet"},
	})
	if err != nil {
		t.Fatal(err)
	}
	pGemini, err := aiSvc.CreateProvider(UpsertProviderInput{
		Name:         "MockGemini",
		ProviderType: "gemini",
		BaseURL:      geminiSrv.URL,
		APIKey:       &key,
		Models:       []string{"gemini-2.5-flash"},
	})
	if err != nil {
		t.Fatal(err)
	}

	// Test streaming across all 3 providers
	var out1 string
	full, err := aiSvc.StreamText(context.Background(), "writing", pOpenAI.ID, "gpt-4o-mini", "", "hi", func(d string) error {
		out1 += d
		return nil
	})
	if err != nil || full != "你好世界" || out1 != "你好世界" {
		t.Fatalf("openai stream failed: full=%q out=%q err=%v", full, out1, err)
	}

	fullA, err := aiSvc.StreamText(context.Background(), "writing", pAnthropic.ID, "claude-3-7-sonnet", "", "hi", func(string) error { return nil })
	if err != nil || fullA != "Claude答复" {
		t.Fatalf("anthropic stream failed: %q err=%v", fullA, err)
	}

	fullG, err := aiSvc.StreamText(context.Background(), "writing", pGemini.ID, "gemini-2.5-flash", "", "hi", func(string) error { return nil })
	if err != nil || fullG != "Gemini答复" {
		t.Fatalf("gemini stream failed: %q err=%v", fullG, err)
	}

	// Wire embedding routing and verify vector hybrid search
	_ = aiSvc.SaveRouting(models.AIRouting{
		Chat:      &models.AIModelTarget{ProviderID: pOpenAI.ID, Model: "gpt-4o-mini"},
		Embedding: &models.AIModelTarget{ProviderID: pOpenAI.ID, Model: "text-embedding-3-small"},
	})

	p1, _ := pageSvc.CreatePage(CreatePageInput{
		Title:       "服务端指南",
		ContentJSON: MarkdownToTipTap("使用 Go 语言开发后端服务，结合 SQLite WAL 模式。"),
	})
	p2, _ := pageSvc.CreatePage(CreatePageInput{
		Title:       "美食记录",
		ContentJSON: MarkdownToTipTap("今天去吃了火锅和奶茶。"),
	})

	count, err := searchSvc.ReindexAllEmbeddings(context.Background())
	if err != nil || count < 2 {
		t.Fatalf("ReindexAllEmbeddings failed: count=%d err=%v", count, err)
	}

	hits, err := searchSvc.SearchPages(context.Background(), "后端", 5)
	if err != nil || len(hits) == 0 || hits[0].PageID != p1.ID {
		t.Fatalf("expected p1 (%s) ranked first, got %+v err=%v", p1.ID, hits, err)
	}
	_ = p2
}

func TestAIAgentReadAutoAndWriteConfirmation(t *testing.T) {
	store, cfg := setupTestEnv(t)
	verSvc := NewVersionService(store)
	linkSvc := NewLinkService(store)
	pageSvc := NewPageService(store, verSvc, linkSvc)
	dbSvc := NewDatabaseService(store, pageSvc)
	searchSvc := NewSearchService(store)
	aiSvc := NewAIService(store, cfg, pageSvc, dbSvc)
	agentSvc := NewAIAgentService(store, aiSvc, searchSvc, pageSvc, dbSvc, verSvc)

	existingPage, _ := pageSvc.CreatePage(CreatePageInput{
		Title:       "产品路线图",
		ContentJSON: MarkdownToTipTap("第一季度目标：完成核心编辑器开发。"),
	})

	var turn int32
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&turn, 1)
		w.Header().Set("Content-Type", "text/event-stream")
		if n == 1 {
			// Round 1: invoke read tool get_page_content
			argsJSON, _ := json.Marshal(map[string]any{"page_id": existingPage.ID})
			chunk := map[string]any{
				"choices": []map[string]any{{
					"delta": map[string]any{
						"tool_calls": []map[string]any{{
							"index": 0,
							"id":    "call_read_1",
							"function": map[string]any{
								"name":      "get_page_content",
								"arguments": string(argsJSON),
							},
						}},
					},
				}},
			}
			b, _ := json.Marshal(chunk)
			_, _ = fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", string(b))
			return
		}
		// Round 2: propose write tool update_page_content (must NOT auto execute!)
		argsJSON, _ := json.Marshal(map[string]any{
			"page_id":          existingPage.ID,
			"markdown_content": "## 更新路线图\n\n- 完成 AI Agent 确认卡片机制",
		})
		chunk := map[string]any{
			"choices": []map[string]any{{
				"delta": map[string]any{
					"content": "我已读取原文档并为你准备好了更新方案：",
					"tool_calls": []map[string]any{{
						"index": 0,
						"id":    "call_write_1",
						"function": map[string]any{
							"name":      "update_page_content",
							"arguments": string(argsJSON),
						},
					}},
				},
			}},
		}
		b, _ := json.Marshal(chunk)
		_, _ = fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", string(b))
	}))
	defer mockLLM.Close()

	key := "sk-agent"
	_, _ = aiSvc.CreateProvider(UpsertProviderInput{
		Name:         "AgentMock",
		ProviderType: "openai_compatible",
		BaseURL:      mockLLM.URL + "/v1",
		APIKey:       &key,
		Models:       []string{"gpt-4o"},
	})

	conv, err := agentSvc.CreateConversation("Agent测试", "all", nil)
	if err != nil {
		t.Fatal(err)
	}

	var events []string
	msg, err := agentSvc.SendMessageStream(context.Background(), conv.ID, "帮我优化产品路线图页面", "all", "", "", "", func(evt string, data any) error {
		events = append(events, evt)
		return nil
	})
	if err != nil {
		t.Fatalf("SendMessageStream failed: %v", err)
	}
	if len(msg.PendingActions) != 1 || msg.ActionStatus != "pending" {
		t.Fatalf("expected 1 pending action, got %+v", msg)
	}

	// Before confirmation, page content must remain untouched!
	beforeConfirm, _ := pageSvc.GetPage(existingPage.ID)
	if strings.Contains(beforeConfirm.PlainText, "确认卡片机制") {
		t.Fatal("write action executed before user confirmation!")
	}

	// Confirm the action
	updatedMsg, act, err := agentSvc.ConfirmAction(conv.ID, msg.ID, msg.PendingActions[0].ID)
	if err != nil {
		t.Fatalf("ConfirmAction failed: %v", err)
	}
	if act.Status != "executed" || updatedMsg.ActionStatus != "executed" {
		t.Fatalf("expected executed action status, got act=%+v msg=%+v", act, updatedMsg)
	}

	// Verify pre_ai version snapshot was created automatically!
	versions, _ := verSvc.ListVersions(existingPage.ID)
	foundPreAI := false
	for _, v := range versions {
		if v.Source == "pre_ai" {
			foundPreAI = true
		}
	}
	if !foundPreAI {
		t.Fatalf("expected pre_ai snapshot before agent write, got versions=%+v", versions)
	}

	afterConfirm, _ := pageSvc.GetPage(existingPage.ID)
	if !strings.Contains(afterConfirm.PlainText, "确认卡片机制") {
		t.Fatalf("expected page updated after confirmation, got %q", afterConfirm.PlainText)
	}
}

func TestTemplatesShareClipperAndNotionZipImport(t *testing.T) {
	store, cfg := setupTestEnv(t)
	cfg.AllowPrivateClip = true // Allow httptest localhost URL in unit test
	verSvc := NewVersionService(store)
	linkSvc := NewLinkService(store)
	pageSvc := NewPageService(store, verSvc, linkSvc)
	dbSvc := NewDatabaseService(store, pageSvc)
	aiSvc := NewAIService(store, cfg, pageSvc, dbSvc)
	tplSvc := NewTemplateService(store, pageSvc)
	shareSvc := NewShareService(store, pageSvc, dbSvc)
	clipSvc := NewClipperService(cfg, pageSvc, aiSvc)
	assetSvc := NewAssetService(store, cfg)
	ioSvc := NewIOService(pageSvc, dbSvc, assetSvc)

	// 1. Templates
	tpls, err := tplSvc.ListTemplates()
	if err != nil || len(tpls) < 5 {
		t.Fatalf("expected >=5 builtin templates, got %d err=%v", len(tpls), err)
	}
	fromTpl, err := tplSvc.InstantiateTemplate(tpls[0].ID, nil)
	if err != nil {
		t.Fatal(err)
	}

	// 2. Public Share with password protection
	sh, err := shareSvc.CreateOrUpdateShare(fromTpl.ID, "secret88", false, nil, true)
	if err != nil || !sh.HasPassword {
		t.Fatalf("CreateOrUpdateShare failed: %+v err=%v", sh, err)
	}
	locked, err := shareSvc.AccessPublicShare(sh.Token, "")
	if err != nil || !locked.NeedsPassword || locked.Page != nil {
		t.Fatalf("expected password challenge, got %+v err=%v", locked, err)
	}
	unlocked, err := shareSvc.AccessPublicShare(sh.Token, "secret88")
	if err != nil || unlocked.NeedsPassword || unlocked.Page == nil {
		t.Fatalf("expected unlocked share page, got %+v err=%v", unlocked, err)
	}

	// 3. Web Clipper + SSRF check
	cfg.AllowPrivateClip = false
	if _, err := clipSvc.ClipURL(context.Background(), "http://127.0.0.1:8080/secret", nil, false); err == nil {
		t.Fatal("expected SSRF block for 127.0.0.1 when AllowPrivateClip=false")
	}

	cfg.AllowPrivateClip = true
	articleSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = fmt.Fprint(w, `<html><head><title>测试剪藏文章</title></head><body><article><h1>技术实践</h1><p>这是一段测试正文内容。</p></article></body></html>`)
	}))
	defer articleSrv.Close()
	clipRes, err := clipSvc.ClipURL(context.Background(), articleSrv.URL, nil, false)
	if err != nil || clipRes.Page.Title != "测试剪藏文章" {
		t.Fatalf("ClipURL failed: %+v err=%v", clipRes, err)
	}

	// 4. Notion Export Zip import (Markdown + CSV database)
	var zipBuf bytes.Buffer
	zw := zip.NewWriter(&zipBuf)
	f1, _ := zw.Create("工作区/项目说明 0123456789abcdef0123456789abcdef.md")
	_, _ = f1.Write([]byte("# 项目说明\n\n参考 [任务清单](任务清单%20abcdef0123456789abcdef0123456789.md)\n"))
	f2, _ := zw.Create("工作区/任务清单 abcdef0123456789abcdef0123456789.md")
	_, _ = f2.Write([]byte("# 任务清单\n\n- [ ] 第一项\n"))
	f3, _ := zw.Create("项目表格 fedcba9876543210fedcba9876543210.csv")
	_, _ = f3.Write([]byte("名称,状态\n任务A,进行中\n"))
	_ = zw.Close()

	impSum, err := ioSvc.ImportNotionZip(bytes.NewReader(zipBuf.Bytes()), int64(zipBuf.Len()), nil)
	if err != nil || impSum.PagesCreated < 2 || impSum.DatabasesCreated != 1 {
		t.Fatalf("ImportNotionZip failed: %+v err=%v", impSum, err)
	}
}
