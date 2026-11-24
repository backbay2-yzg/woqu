package services

import (
	"bufio"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"woqu/backend/internal/config"
	"woqu/backend/internal/crypto"
	"woqu/backend/internal/db"
	"woqu/backend/internal/models"
)

const settingAIRouting = "ai_routing_json"

type AIService struct {
	store      *db.Store
	cfg        *config.Config
	pageSvc    *PageService
	dbSvc      *DatabaseService
	httpClient *http.Client
}

func NewAIService(store *db.Store, cfg *config.Config, pageSvc *PageService, dbSvc *DatabaseService) *AIService {
	svc := &AIService{
		store:      store,
		cfg:        cfg,
		pageSvc:    pageSvc,
		dbSvc:      dbSvc,
		httpClient: &http.Client{Timeout: 120 * time.Second},
	}
	svc.seedBuiltinPromptTemplates()
	return svc
}

type rawProvider struct {
	ID           string
	Name         string
	ProviderType string
	BaseURL      string
	APIKey       string
	Models       []string
	IsEnabled    bool
}

type LLMMessage struct {
	Role       string        `json:"role"` // system, user, assistant, tool
	Content    string        `json:"content"`
	ToolCalls  []LLMToolCall `json:"tool_calls,omitempty"`
	ToolCallID string        `json:"tool_call_id,omitempty"`
}

type LLMToolDef struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  map[string]any `json:"parameters"`
}

type LLMToolCall struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments"`
	RawArgs   string         `json:"-"`
}

type LLMResponse struct {
	Content   string
	ToolCalls []LLMToolCall
}

type UpsertProviderInput struct {
	Name         string   `json:"name"`
	ProviderType string   `json:"provider_type"` // openai_compatible, anthropic, gemini
	BaseURL      string   `json:"base_url"`
	APIKey       *string  `json:"api_key"`
	Models       []string `json:"models"`
	IsEnabled    *bool    `json:"is_enabled"`
}

func (s *AIService) ListProviders() ([]models.AIProvider, error) {
	rows, err := s.store.DB().Query(`
		SELECT id, name, provider_type, base_url, api_key_encrypted, models_json, is_enabled, created_at, updated_at
		FROM ai_providers ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []models.AIProvider
	for rows.Next() {
		var p models.AIProvider
		var encKey, modelsStr string
		var enabled int
		if err := rows.Scan(&p.ID, &p.Name, &p.ProviderType, &p.BaseURL, &encKey, &modelsStr, &enabled, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		p.IsEnabled = enabled == 1
		_ = json.Unmarshal([]byte(modelsStr), &p.Models)
		if p.Models == nil {
			p.Models = []string{}
		}
		if encKey != "" {
			if plain, err := crypto.Decrypt(encKey, s.cfg.MasterKey); err == nil && plain != "" {
				p.HasAPIKey = true
				p.APIKeyMasked = crypto.MaskSecret(plain)
			}
		}
		list = append(list, p)
	}
	if list == nil {
		list = []models.AIProvider{}
	}
	return list, nil
}

func (s *AIService) CreateProvider(in UpsertProviderInput) (*models.AIProvider, error) {
	if strings.TrimSpace(in.Name) == "" {
		return nil, errors.New("provider name is required")
	}
	pType := in.ProviderType
	if pType == "" {
		pType = "openai_compatible"
	}
	baseURL := strings.TrimRight(strings.TrimSpace(in.BaseURL), "/")
	if baseURL == "" {
		switch pType {
		case "openai_compatible":
			baseURL = "https://api.openai.com/v1"
		case "anthropic":
			baseURL = "https://api.anthropic.com"
		case "gemini":
			baseURL = "https://generativelanguage.googleapis.com"
		}
	}

	var encKey string
	if in.APIKey != nil && strings.TrimSpace(*in.APIKey) != "" {
		var err error
		encKey, err = crypto.Encrypt(strings.TrimSpace(*in.APIKey), s.cfg.MasterKey)
		if err != nil {
			return nil, err
		}
	}
	modelsList := in.Models
	if modelsList == nil {
		modelsList = []string{}
	}
	modelsBytes, _ := json.Marshal(modelsList)
	enabled := 1
	if in.IsEnabled != nil && !*in.IsEnabled {
		enabled = 0
	}

	id := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := s.store.DB().Exec(`
		INSERT INTO ai_providers (id, name, provider_type, base_url, api_key_encrypted, models_json, is_enabled, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, strings.TrimSpace(in.Name), pType, baseURL, encKey, string(modelsBytes), enabled, now, now)
	if err != nil {
		return nil, err
	}

	// Auto-wire default routing if unset
	routing := s.GetRouting()
	if len(modelsList) > 0 && routing.Chat == nil {
		target := &models.AIModelTarget{ProviderID: id, Model: modelsList[0]}
		routing.Chat = target
		routing.Writing = target
		routing.Summary = target
		routing.Autofill = target
		_ = s.SaveRouting(routing)
	}

	return s.getMaskedProvider(id)
}

func (s *AIService) UpdateProvider(id string, in UpsertProviderInput) (*models.AIProvider, error) {
	raw, err := s.getRawProvider(id)
	if err != nil {
		return nil, err
	}
	name := raw.Name
	if strings.TrimSpace(in.Name) != "" {
		name = strings.TrimSpace(in.Name)
	}
	pType := raw.ProviderType
	if in.ProviderType != "" {
		pType = in.ProviderType
	}
	baseURL := raw.BaseURL
	if strings.TrimSpace(in.BaseURL) != "" {
		baseURL = strings.TrimRight(strings.TrimSpace(in.BaseURL), "/")
	}
	modelsList := raw.Models
	if in.Models != nil {
		modelsList = in.Models
	}
	enabled := raw.IsEnabled
	if in.IsEnabled != nil {
		enabled = *in.IsEnabled
	}
	enabledInt := 0
	if enabled {
		enabledInt = 1
	}

	var encKey string
	if in.APIKey != nil {
		trimmed := strings.TrimSpace(*in.APIKey)
		if trimmed != "" {
			encKey, err = crypto.Encrypt(trimmed, s.cfg.MasterKey)
			if err != nil {
				return nil, err
			}
		}
	} else {
		_ = s.store.DB().QueryRow(`SELECT api_key_encrypted FROM ai_providers WHERE id = ?`, id).Scan(&encKey)
	}

	modelsBytes, _ := json.Marshal(modelsList)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err = s.store.DB().Exec(`
		UPDATE ai_providers SET name = ?, provider_type = ?, base_url = ?, api_key_encrypted = ?, models_json = ?, is_enabled = ?, updated_at = ?
		WHERE id = ?`,
		name, pType, baseURL, encKey, string(modelsBytes), enabledInt, now, id)
	if err != nil {
		return nil, err
	}
	return s.getMaskedProvider(id)
}

func (s *AIService) DeleteProvider(id string) error {
	_, err := s.store.DB().Exec(`DELETE FROM ai_providers WHERE id = ?`, id)
	return err
}

func (s *AIService) getMaskedProvider(id string) (*models.AIProvider, error) {
	list, err := s.ListProviders()
	if err != nil {
		return nil, err
	}
	for i := range list {
		if list[i].ID == id {
			return &list[i], nil
		}
	}
	return nil, errors.New("provider not found")
}

func (s *AIService) getRawProvider(id string) (*rawProvider, error) {
	var rp rawProvider
	var encKey, modelsStr string
	var enabled int
	err := s.store.DB().QueryRow(`
		SELECT id, name, provider_type, base_url, api_key_encrypted, models_json, is_enabled
		FROM ai_providers WHERE id = ?`, id).
		Scan(&rp.ID, &rp.Name, &rp.ProviderType, &rp.BaseURL, &encKey, &modelsStr, &enabled)
	if err != nil {
		return nil, err
	}
	rp.IsEnabled = enabled == 1
	_ = json.Unmarshal([]byte(modelsStr), &rp.Models)
	if encKey != "" {
		plain, err := crypto.Decrypt(encKey, s.cfg.MasterKey)
		if err != nil {
			return nil, fmt.Errorf("failed to decrypt provider api key: %w", err)
		}
		rp.APIKey = plain
	}
	return &rp, nil
}

func (s *AIService) GetRouting() models.AIRouting {
	var raw string
	_ = s.store.DB().QueryRow(`SELECT value FROM app_settings WHERE key = ?`, settingAIRouting).Scan(&raw)
	var r models.AIRouting
	if raw != "" {
		_ = json.Unmarshal([]byte(raw), &r)
	}
	return r
}

func (s *AIService) SaveRouting(r models.AIRouting) error {
	b, _ := json.Marshal(r)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := s.store.DB().Exec(`
		INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		settingAIRouting, string(b), now)
	return err
}

func (s *AIService) resolveTarget(task, overrideProviderID, overrideModel string) (*rawProvider, string, error) {
	if overrideProviderID != "" {
		rp, err := s.getRawProvider(overrideProviderID)
		if err != nil {
			return nil, "", err
		}
		m := overrideModel
		if m == "" && len(rp.Models) > 0 {
			m = rp.Models[0]
		}
		if m == "" {
			return nil, "", errors.New("no model specified for provider")
		}
		return rp, m, nil
	}

	routing := s.GetRouting()
	var target *models.AIModelTarget
	switch task {
	case "writing":
		target = routing.Writing
	case "summary":
		target = routing.Summary
	case "autofill":
		target = routing.Autofill
	case "embedding":
		target = routing.Embedding
	default:
		target = routing.Chat
	}
	if target == nil && task != "embedding" {
		target = routing.Chat
	}
	if target != nil && target.ProviderID != "" {
		if rp, err := s.getRawProvider(target.ProviderID); err == nil && rp.IsEnabled {
			m := target.Model
			if m == "" && len(rp.Models) > 0 {
				m = rp.Models[0]
			}
			if m != "" {
				return rp, m, nil
			}
		}
	}

	if task == "embedding" {
		return nil, "", errors.New("未配置 Embedding 向量模型")
	}

	// Fallback: first enabled provider with at least 1 model
	list, err := s.ListProviders()
	if err == nil {
		for _, p := range list {
			if p.IsEnabled && len(p.Models) > 0 {
				rp, err := s.getRawProvider(p.ID)
				if err == nil {
					return rp, rp.Models[0], nil
				}
			}
		}
	}
	return nil, "", errors.New("尚未配置可用的 AI 模型，请先前往「设置 → AI 模型中心」添加模型")
}

// TestProvider verifies connectivity against a configured provider using a short chat completion request.
func (s *AIService) TestProvider(ctx context.Context, id, model string) (string, int64, error) {
	rp, m, err := s.resolveTarget("chat", id, model)
	if err != nil {
		return "", 0, err
	}
	start := time.Now()
	resp, err := s.callChat(ctx, rp, m, []LLMMessage{
		{Role: "user", Content: "Reply with only OK."},
	}, nil, nil)
	if err != nil {
		return "", 0, err
	}
	return resp.Content, time.Since(start).Milliseconds(), nil
}

// StreamText streams a single-turn AI writing/rewrite completion for editor inline tools or prompts.
func (s *AIService) StreamText(ctx context.Context, task, providerID, model, systemPrompt, userPrompt string, onDelta func(string) error) (string, error) {
	rp, m, err := s.resolveTarget(task, providerID, model)
	if err != nil {
		return "", err
	}
	msgs := []LLMMessage{}
	if strings.TrimSpace(systemPrompt) != "" {
		msgs = append(msgs, LLMMessage{Role: "system", Content: systemPrompt})
	}
	msgs = append(msgs, LLMMessage{Role: "user", Content: userPrompt})
	resp, err := s.callChat(ctx, rp, m, msgs, nil, onDelta)
	if err != nil {
		return "", err
	}
	return resp.Content, nil
}

// SummarizePage generates a concise summary + key points + action items for a page.
func (s *AIService) SummarizePage(ctx context.Context, pageID string, save bool, onDelta func(string) error) (string, error) {
	p, err := s.pageSvc.GetPage(pageID)
	if err != nil {
		return "", err
	}
	body := strings.TrimSpace(p.PlainText)
	if body == "" {
		body = "（该页面暂无正文内容）"
	}
	if len([]rune(body)) > 12000 {
		body = string([]rune(body)[:12000]) + "\n...(已截断)"
	}

	sys := "你是一个高效精准的知识库助手。请使用中文总结用户提供的文档，输出清晰简洁的 Markdown 结构：\n1. **核心摘要**（2-3 句话概括主旨）\n2. **关键要点**（3-5 条列表）\n3. **提取的待办事项 / 行动项**（如文中无明确待办，可注明暂无）"
	user := fmt.Sprintf("文档标题：%s\n\n正文内容：\n%s", p.Title, body)

	full, err := s.StreamText(ctx, "summary", "", "", sys, user, onDelta)
	if err != nil {
		return "", err
	}
	if save {
		trimmed := strings.TrimSpace(full)
		_, _ = s.pageSvc.UpdatePage(pageID, UpdatePageInput{Summary: &trimmed})
	}
	return full, nil
}

// AutofillDatabase runs AI generation for an ai_autofill column across rows.
func (s *AIService) AutofillDatabase(ctx context.Context, dbID, propID string, rowIDs []string) (int, error) {
	dbMeta, err := s.dbSvc.GetDatabase(dbID)
	if err != nil {
		return 0, err
	}
	var targetProp *models.PropertySchema
	propNames := make(map[string]string)
	for i := range dbMeta.Schema {
		propNames[dbMeta.Schema[i].ID] = dbMeta.Schema[i].Name
		if dbMeta.Schema[i].ID == propID {
			targetProp = &dbMeta.Schema[i]
		}
	}
	if targetProp == nil || targetProp.Type != "ai_autofill" {
		return 0, errors.New("target property is not an ai_autofill column")
	}

	rows, err := s.dbSvc.ListRows(dbID)
	if err != nil {
		return 0, err
	}
	rowFilter := make(map[string]bool)
	for _, rid := range rowIDs {
		rowFilter[rid] = true
	}

	rp, m, err := s.resolveTarget("autofill", "", "")
	if err != nil {
		return 0, err
	}

	updated := 0
	for _, row := range rows {
		if len(rowFilter) > 0 && !rowFilter[row.ID] {
			continue
		}
		if len(rowFilter) == 0 {
			if existingVal, ok := row.Properties[propID].(string); ok && strings.TrimSpace(existingVal) != "" {
				continue
			}
		}

		var ctxBuf strings.Builder
		ctxBuf.WriteString("记录标题: " + row.Title + "\n")
		for _, srcID := range targetProp.AISourcePropIDs {
			if val, ok := row.Properties[srcID]; ok && val != nil {
				ctxBuf.WriteString(fmt.Sprintf("%s: %v\n", propNames[srcID], val))
			}
		}
		if strings.TrimSpace(row.PlainText) != "" {
			ctxBuf.WriteString("正文内容:\n" + truncateRunes(row.PlainText, 2500))
		}

		prompt := targetProp.AIPrompt
		if strings.TrimSpace(prompt) == "" {
			prompt = "请用 1-2 句简洁的中文总结该条目的核心内容。"
		}

		resp, err := s.callChat(ctx, rp, m, []LLMMessage{
			{Role: "system", Content: "你是多维数据库字段自动填充助手。只输出最终应填入单元格的精炼内容，不要添加多余前缀或解释。"},
			{Role: "user", Content: fmt.Sprintf("任务要求：%s\n\n数据上下文：\n%s", prompt, ctxBuf.String())},
		}, nil, nil)
		if err != nil {
			return updated, err
		}

		val := strings.TrimSpace(resp.Content)
		if _, err := s.dbSvc.UpdateRow(dbID, row.ID, nil, map[string]any{propID: val}); err == nil {
			updated++
		}
	}
	return updated, nil
}

// ComputeEmbeddings satisfies search.EmbedFunc using the configured embedding model.
func (s *AIService) ComputeEmbeddings(ctx context.Context, texts []string) ([][]float32, string, error) {
	rp, m, err := s.resolveTarget("embedding", "", "")
	if err != nil {
		return nil, "", err
	}

	switch rp.ProviderType {
	case "gemini":
		var vecs [][]float32
		for _, t := range texts {
			url := fmt.Sprintf("%s/v1beta/models/%s:embedContent?key=%s", rp.BaseURL, m, rp.APIKey)
			body, _ := json.Marshal(map[string]any{
				"content": map[string]any{
					"parts": []map[string]string{{"text": t}},
				},
			})
			req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			resp, err := s.httpClient.Do(req)
			if err != nil {
				return nil, "", err
			}
			respBytes, _ := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			if resp.StatusCode >= 300 {
				return nil, "", fmt.Errorf("gemini embedding error (%d): %s", resp.StatusCode, string(respBytes))
			}
			var parsed struct {
				Embedding struct {
					Values []float32 `json:"values"`
				} `json:"embedding"`
			}
			if err := json.Unmarshal(respBytes, &parsed); err != nil {
				return nil, "", err
			}
			vecs = append(vecs, parsed.Embedding.Values)
		}
		return vecs, m, nil

	default: // openai_compatible
		url := rp.BaseURL + "/embeddings"
		if !strings.HasSuffix(rp.BaseURL, "/v1") && !strings.Contains(rp.BaseURL, "/v1") {
			url = rp.BaseURL + "/v1/embeddings"
		}
		body, _ := json.Marshal(map[string]any{
			"model": m,
			"input": texts,
		})
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if rp.APIKey != "" {
			req.Header.Set("Authorization", "Bearer "+rp.APIKey)
		}
		resp, err := s.httpClient.Do(req)
		if err != nil {
			return nil, "", err
		}
		respBytes, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode >= 300 {
			return nil, "", fmt.Errorf("embedding error (%d): %s", resp.StatusCode, string(respBytes))
		}
		var parsed struct {
			Data []struct {
				Index     int       `json:"index"`
				Embedding []float32 `json:"embedding"`
			} `json:"data"`
		}
		if err := json.Unmarshal(respBytes, &parsed); err != nil {
			return nil, "", err
		}
		vecs := make([][]float32, len(parsed.Data))
		for i, d := range parsed.Data {
			idx := d.Index
			if idx < 0 || idx >= len(vecs) {
				idx = i
			}
			vecs[idx] = d.Embedding
		}
		return vecs, m, nil
	}
}

func (s *AIService) callChat(
	ctx context.Context,
	rp *rawProvider,
	model string,
	messages []LLMMessage,
	tools []LLMToolDef,
	onDelta func(string) error,
) (*LLMResponse, error) {
	switch rp.ProviderType {
	case "anthropic":
		return s.callAnthropic(ctx, rp, model, messages, tools, onDelta)
	case "gemini":
		return s.callGemini(ctx, rp, model, messages, tools, onDelta)
	default:
		return s.callOpenAICompat(ctx, rp, model, messages, tools, onDelta)
	}
}

func (s *AIService) callOpenAICompat(
	ctx context.Context,
	rp *rawProvider,
	model string,
	messages []LLMMessage,
	tools []LLMToolDef,
	onDelta func(string) error,
) (*LLMResponse, error) {
	endpoint := rp.BaseURL + "/chat/completions"
	if !strings.HasSuffix(rp.BaseURL, "/v1") && !strings.Contains(rp.BaseURL, "/v1/") && !strings.Contains(rp.BaseURL, "/compatible-mode/") {
		endpoint = rp.BaseURL + "/v1/chat/completions"
	}

	var apiMsgs []map[string]any
	for _, m := range messages {
		msgMap := map[string]any{
			"role":    m.Role,
			"content": m.Content,
		}
		if len(m.ToolCalls) > 0 {
			var tcs []map[string]any
			for _, tc := range m.ToolCalls {
				argsBytes, _ := json.Marshal(tc.Arguments)
				tcs = append(tcs, map[string]any{
					"id":   tc.ID,
					"type": "function",
					"function": map[string]any{
						"name":      tc.Name,
						"arguments": string(argsBytes),
					},
				})
			}
			msgMap["tool_calls"] = tcs
		}
		if m.ToolCallID != "" {
			msgMap["tool_call_id"] = m.ToolCallID
		}
		apiMsgs = append(apiMsgs, msgMap)
	}

	payload := map[string]any{
		"model":    model,
		"messages": apiMsgs,
		"stream":   onDelta != nil,
	}
	if len(tools) > 0 {
		var toolDefs []map[string]any
		for _, t := range tools {
			toolDefs = append(toolDefs, map[string]any{
				"type": "function",
				"function": map[string]any{
					"name":        t.Name,
					"description": t.Description,
					"parameters":  t.Parameters,
				},
			})
		}
		payload["tools"] = toolDefs
	}

	bodyBytes, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if rp.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+rp.APIKey)
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		errBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("OpenAI API error (%d): %s", resp.StatusCode, string(errBody))
	}

	if onDelta == nil {
		raw, err := io.ReadAll(resp.Body)
		if err != nil {
			return nil, err
		}
		var parsed struct {
			Choices []struct {
				Message struct {
					Content   string `json:"content"`
					ToolCalls []struct {
						ID       string `json:"id"`
						Function struct {
							Name      string `json:"name"`
							Arguments string `json:"arguments"`
						} `json:"function"`
					} `json:"tool_calls"`
				} `json:"message"`
			} `json:"choices"`
		}
		if err := json.Unmarshal(raw, &parsed); err != nil {
			return nil, err
		}
		if len(parsed.Choices) == 0 {
			return &LLMResponse{}, nil
		}
		res := &LLMResponse{Content: parsed.Choices[0].Message.Content}
		for _, tc := range parsed.Choices[0].Message.ToolCalls {
			args := map[string]any{}
			_ = json.Unmarshal([]byte(tc.Function.Arguments), &args)
			res.ToolCalls = append(res.ToolCalls, LLMToolCall{
				ID:        tc.ID,
				Name:      tc.Function.Name,
				Arguments: args,
				RawArgs:   tc.Function.Arguments,
			})
		}
		return res, nil
	}

	// Streaming SSE parse (also aggregates streamed tool_calls cleanly)
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 2*1024*1024)
	var contentBuf strings.Builder
	toolMap := make(map[int]*LLMToolCall)
	var toolOrder []int

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" || data == "[DONE]" {
			continue
		}
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content   string `json:"content"`
					ToolCalls []struct {
						Index    int    `json:"index"`
						ID       string `json:"id"`
						Function struct {
							Name      string `json:"name"`
							Arguments string `json:"arguments"`
						} `json:"function"`
					} `json:"tool_calls"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil || len(chunk.Choices) == 0 {
			continue
		}
		delta := chunk.Choices[0].Delta
		if delta.Content != "" {
			contentBuf.WriteString(delta.Content)
			if err := onDelta(delta.Content); err != nil {
				return nil, err
			}
		}
		for _, tc := range delta.ToolCalls {
			entry, exists := toolMap[tc.Index]
			if !exists {
				entry = &LLMToolCall{ID: tc.ID, Name: tc.Function.Name}
				toolMap[tc.Index] = entry
				toolOrder = append(toolOrder, tc.Index)
			}
			if tc.ID != "" {
				entry.ID = tc.ID
			}
			if tc.Function.Name != "" {
				entry.Name = tc.Function.Name
			}
			entry.RawArgs += tc.Function.Arguments
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}

	res := &LLMResponse{Content: contentBuf.String()}
	for _, idx := range toolOrder {
		tc := toolMap[idx]
		if tc.ID == "" {
			tc.ID = uuid.NewString()
		}
		args := map[string]any{}
		_ = json.Unmarshal([]byte(tc.RawArgs), &args)
		tc.Arguments = args
		res.ToolCalls = append(res.ToolCalls, *tc)
	}
	return res, nil
}

func (s *AIService) callAnthropic(
	ctx context.Context,
	rp *rawProvider,
	model string,
	messages []LLMMessage,
	tools []LLMToolDef,
	onDelta func(string) error,
) (*LLMResponse, error) {
	endpoint := rp.BaseURL + "/v1/messages"
	if strings.HasSuffix(rp.BaseURL, "/v1") {
		endpoint = rp.BaseURL + "/messages"
	}

	var sysText string
	var apiMsgs []map[string]any
	for _, m := range messages {
		if m.Role == "system" {
			if sysText != "" {
				sysText += "\n"
			}
			sysText += m.Content
			continue
		}
		if m.Role == "tool" {
			apiMsgs = append(apiMsgs, map[string]any{
				"role": "user",
				"content": []map[string]any{{
					"type":        "tool_result",
					"tool_use_id": m.ToolCallID,
					"content":     m.Content,
				}},
			})
			continue
		}
		if m.Role == "assistant" && len(m.ToolCalls) > 0 {
			var blocks []map[string]any
			if m.Content != "" {
				blocks = append(blocks, map[string]any{"type": "text", "text": m.Content})
			}
			for _, tc := range m.ToolCalls {
				blocks = append(blocks, map[string]any{
					"type":  "tool_use",
					"id":    tc.ID,
					"name":  tc.Name,
					"input": tc.Arguments,
				})
			}
			apiMsgs = append(apiMsgs, map[string]any{"role": "assistant", "content": blocks})
			continue
		}
		apiMsgs = append(apiMsgs, map[string]any{"role": m.Role, "content": m.Content})
	}

	payload := map[string]any{
		"model":      model,
		"max_tokens": 4096,
		"messages":   apiMsgs,
		"stream":     onDelta != nil,
	}
	if sysText != "" {
		payload["system"] = sysText
	}
	if len(tools) > 0 {
		var toolDefs []map[string]any
		for _, t := range tools {
			toolDefs = append(toolDefs, map[string]any{
				"name":         t.Name,
				"description":  t.Description,
				"input_schema": t.Parameters,
			})
		}
		payload["tools"] = toolDefs
	}

	bodyBytes, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", rp.APIKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		errBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Anthropic API error (%d): %s", resp.StatusCode, string(errBody))
	}

	if onDelta == nil {
		raw, _ := io.ReadAll(resp.Body)
		var parsed struct {
			Content []struct {
				Type  string         `json:"type"`
				Text  string         `json:"text"`
				ID    string         `json:"id"`
				Name  string         `json:"name"`
				Input map[string]any `json:"input"`
			} `json:"content"`
		}
		if err := json.Unmarshal(raw, &parsed); err != nil {
			return nil, err
		}
		res := &LLMResponse{}
		var textBuf strings.Builder
		for _, b := range parsed.Content {
			switch b.Type {
			case "text":
				textBuf.WriteString(b.Text)
			case "tool_use":
				res.ToolCalls = append(res.ToolCalls, LLMToolCall{
					ID:        b.ID,
					Name:      b.Name,
					Arguments: b.Input,
				})
			}
		}
		res.Content = textBuf.String()
		return res, nil
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 2*1024*1024)
	var textBuf strings.Builder
	activeTools := make(map[int]*LLMToolCall)
	var toolOrder []int

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		var evt struct {
			Type         string `json:"type"`
			Index        int    `json:"index"`
			ContentBlock struct {
				Type string `json:"type"`
				ID   string `json:"id"`
				Name string `json:"name"`
			} `json:"content_block"`
			Delta struct {
				Type        string `json:"type"`
				Text        string `json:"text"`
				PartialJSON string `json:"partial_json"`
			} `json:"delta"`
		}
		if err := json.Unmarshal([]byte(data), &evt); err != nil {
			continue
		}
		switch evt.Type {
		case "content_block_start":
			if evt.ContentBlock.Type == "tool_use" {
				activeTools[evt.Index] = &LLMToolCall{
					ID:   evt.ContentBlock.ID,
					Name: evt.ContentBlock.Name,
				}
				toolOrder = append(toolOrder, evt.Index)
			}
		case "content_block_delta":
			if evt.Delta.Type == "text_delta" && evt.Delta.Text != "" {
				textBuf.WriteString(evt.Delta.Text)
				if err := onDelta(evt.Delta.Text); err != nil {
					return nil, err
				}
			} else if evt.Delta.Type == "input_json_delta" {
				if tc, ok := activeTools[evt.Index]; ok {
					tc.RawArgs += evt.Delta.PartialJSON
				}
			}
		}
	}
	res := &LLMResponse{Content: textBuf.String()}
	for _, idx := range toolOrder {
		tc := activeTools[idx]
		args := map[string]any{}
		_ = json.Unmarshal([]byte(tc.RawArgs), &args)
		tc.Arguments = args
		res.ToolCalls = append(res.ToolCalls, *tc)
	}
	return res, scanner.Err()
}

func (s *AIService) callGemini(
	ctx context.Context,
	rp *rawProvider,
	model string,
	messages []LLMMessage,
	tools []LLMToolDef,
	onDelta func(string) error,
) (*LLMResponse, error) {
	action := "generateContent"
	if onDelta != nil {
		action = "streamGenerateContent?alt=sse&"
	} else {
		action = "generateContent?"
	}
	endpoint := fmt.Sprintf("%s/v1beta/models/%s:%skey=%s", rp.BaseURL, model, action, rp.APIKey)

	var sysParts []map[string]string
	var contents []map[string]any
	for _, m := range messages {
		if m.Role == "system" {
			sysParts = append(sysParts, map[string]string{"text": m.Content})
			continue
		}
		role := "user"
		if m.Role == "assistant" {
			role = "model"
		}
		if m.Role == "tool" {
			contents = append(contents, map[string]any{
				"role": "user",
				"parts": []map[string]any{{
					"functionResponse": map[string]any{
						"name":     m.ToolCallID,
						"response": map[string]any{"result": m.Content},
					},
				}},
			})
			continue
		}
		if m.Role == "assistant" && len(m.ToolCalls) > 0 {
			var parts []map[string]any
			if m.Content != "" {
				parts = append(parts, map[string]any{"text": m.Content})
			}
			for _, tc := range m.ToolCalls {
				parts = append(parts, map[string]any{
					"functionCall": map[string]any{
						"name": tc.Name,
						"args": tc.Arguments,
					},
				})
			}
			contents = append(contents, map[string]any{"role": "model", "parts": parts})
			continue
		}
		contents = append(contents, map[string]any{
			"role":  role,
			"parts": []map[string]string{{"text": m.Content}},
		})
	}

	payload := map[string]any{
		"contents": contents,
	}
	if len(sysParts) > 0 {
		payload["systemInstruction"] = map[string]any{"parts": sysParts}
	}
	if len(tools) > 0 {
		var funcDecls []map[string]any
		for _, t := range tools {
			funcDecls = append(funcDecls, map[string]any{
				"name":        t.Name,
				"description": t.Description,
				"parameters":  t.Parameters,
			})
		}
		payload["tools"] = []map[string]any{{"functionDeclarations": funcDecls}}
	}

	bodyBytes, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		errBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Gemini API error (%d): %s", resp.StatusCode, string(errBody))
	}

	parseGeminiParts := func(raw []byte, emit bool) (string, []LLMToolCall, error) {
		var parsed struct {
			Candidates []struct {
				Content struct {
					Parts []struct {
						Text         string `json:"text"`
						FunctionCall *struct {
							Name string         `json:"name"`
							Args map[string]any `json:"args"`
						} `json:"functionCall"`
					} `json:"parts"`
				} `json:"content"`
			} `json:"candidates"`
		}
		if err := json.Unmarshal(raw, &parsed); err != nil || len(parsed.Candidates) == 0 {
			return "", nil, nil
		}
		var txt strings.Builder
		var calls []LLMToolCall
		for _, pt := range parsed.Candidates[0].Content.Parts {
			if pt.Text != "" {
				txt.WriteString(pt.Text)
				if emit && onDelta != nil {
					if err := onDelta(pt.Text); err != nil {
						return "", nil, err
					}
				}
			}
			if pt.FunctionCall != nil {
				calls = append(calls, LLMToolCall{
					ID:        pt.FunctionCall.Name,
					Name:      pt.FunctionCall.Name,
					Arguments: pt.FunctionCall.Args,
				})
			}
		}
		return txt.String(), calls, nil
	}

	if onDelta == nil {
		raw, _ := io.ReadAll(resp.Body)
		txt, calls, err := parseGeminiParts(raw, false)
		if err != nil {
			return nil, err
		}
		return &LLMResponse{Content: txt, ToolCalls: calls}, nil
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 2*1024*1024)
	var full strings.Builder
	var allCalls []LLMToolCall
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		txt, calls, err := parseGeminiParts([]byte(data), true)
		if err != nil {
			return nil, err
		}
		full.WriteString(txt)
		allCalls = append(allCalls, calls...)
	}
	return &LLMResponse{Content: full.String(), ToolCalls: allCalls}, scanner.Err()
}

// Prompt Templates CRUD
func (s *AIService) seedBuiltinPromptTemplates() {
	var count int
	if err := s.store.DB().QueryRow(`SELECT count(*) FROM ai_prompt_templates WHERE is_builtin = 1`).Scan(&count); err == nil && count > 0 {
		return
	}
	builtins := []struct {
		id, name, cat, icon, sys, usr string
		pos                           int
	}{
		{"pt_polish", "润色文字", "writing", "✨", "你是专业中文编辑，请润色用户选中的文字，使表达更流畅精准、逻辑清晰，保留原意。直接返回修改后的文本，不要加额外解释。", "请润色以下文本：\n\n{{selection}}", 1},
		{"pt_expand", "扩写内容", "writing", "📝", "你是内容创作助手，请根据用户选中的要点进行自然丰富的扩写与举例说明，保持原有语境。直接返回扩写结果。", "请扩写以下内容：\n\n{{selection}}", 2},
		{"pt_shorten", "精简压缩", "writing", "✂️", "你是资深文字编辑，请删去冗余词句，保留核心信息，输出更紧凑精炼的表达。直接返回精简后的文本。", "请精简以下内容：\n\n{{selection}}", 3},
		{"pt_fix", "纠错与语法修正", "writing", "🔍", "请检查并修正错别字、标点错误和语病，尽可能维持原文句式风格。直接返回修正后的文本。", "请检查并修正：\n\n{{selection}}", 4},
		{"pt_tone_pro", "转为专业正式语气", "writing", "💼", "请将文本改写为严谨、专业、适合工作汇报或商务沟通的语气。直接返回改写后的文本。", "请改写为专业语气：\n\n{{selection}}", 5},
		{"pt_tone_casual", "转为轻松自然语气", "writing", "☕", "请将文本改写为亲切、自然、通俗易懂的表达方式。直接返回改写后的文本。", "请改写为轻松语气：\n\n{{selection}}", 6},
		{"pt_to_en", "翻译为英文", "translate", "🌐", "你是专业双语译者，请将中文内容地道准确地翻译为英文。直接返回译文。", "Translate to English:\n\n{{selection}}", 7},
		{"pt_to_zh", "翻译为中文", "translate", "🇨🇳", "你是专业双语译者，请将文本地道流畅地翻译为简体中文。直接返回译文。", "请翻译为简体中文：\n\n{{selection}}", 8},
	}

	now := time.Now().UTC().Format(time.RFC3339)
	for _, b := range builtins {
		_, _ = s.store.DB().Exec(`
			INSERT OR IGNORE INTO ai_prompt_templates (id, name, category, icon, system_prompt, user_prompt_template, is_builtin, position, created_at)
			VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
			b.id, b.name, b.cat, b.icon, b.sys, b.usr, b.pos, now)
	}
}

func (s *AIService) ListPromptTemplates() ([]models.AIPromptTemplate, error) {
	rows, err := s.store.DB().Query(`
		SELECT id, name, category, icon, system_prompt, user_prompt_template, is_builtin, position, created_at
		FROM ai_prompt_templates ORDER BY position ASC, created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []models.AIPromptTemplate
	for rows.Next() {
		var t models.AIPromptTemplate
		var isB int
		if err := rows.Scan(&t.ID, &t.Name, &t.Category, &t.Icon, &t.SystemPrompt, &t.UserPromptTemplate, &isB, &t.Position, &t.CreatedAt); err != nil {
			return nil, err
		}
		t.IsBuiltin = isB == 1
		list = append(list, t)
	}
	if list == nil {
		list = []models.AIPromptTemplate{}
	}
	return list, nil
}

func (s *AIService) CreatePromptTemplate(name, category, icon, systemPrompt, userPromptTemplate string) (*models.AIPromptTemplate, error) {
	if strings.TrimSpace(name) == "" || strings.TrimSpace(userPromptTemplate) == "" {
		return nil, errors.New("模板名称与用户 Prompt 不能为空")
	}
	if category == "" {
		category = "custom"
	}
	if icon == "" {
		icon = "⚡"
	}
	var maxPos sql.NullInt64
	_ = s.store.DB().QueryRow(`SELECT MAX(position) FROM ai_prompt_templates`).Scan(&maxPos)
	pos := 10
	if maxPos.Valid {
		pos = int(maxPos.Int64) + 1
	}
	id := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.store.DB().Exec(`
		INSERT INTO ai_prompt_templates (id, name, category, icon, system_prompt, user_prompt_template, is_builtin, position, created_at)
		VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
		id, strings.TrimSpace(name), category, icon, systemPrompt, userPromptTemplate, pos, now)
	if err != nil {
		return nil, err
	}
	return &models.AIPromptTemplate{
		ID:                 id,
		Name:               strings.TrimSpace(name),
		Category:           category,
		Icon:               icon,
		SystemPrompt:       systemPrompt,
		UserPromptTemplate: userPromptTemplate,
		IsBuiltin:          false,
		Position:           pos,
		CreatedAt:          now,
	}, nil
}

func (s *AIService) DeletePromptTemplate(id string) error {
	res, err := s.store.DB().Exec(`DELETE FROM ai_prompt_templates WHERE id = ? AND is_builtin = 0`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return errors.New("内置模板不可删除或模板不存在")
	}
	return nil
}
