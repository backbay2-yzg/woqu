package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"woqu/backend/internal/db"
	"woqu/backend/internal/models"
)

type AIAgentService struct {
	store      *db.Store
	aiSvc      *AIService
	searchSvc  *SearchService
	pageSvc    *PageService
	dbSvc      *DatabaseService
	versionSvc *VersionService
}

func NewAIAgentService(
	store *db.Store,
	aiSvc *AIService,
	searchSvc *SearchService,
	pageSvc *PageService,
	dbSvc *DatabaseService,
	versionSvc *VersionService,
) *AIAgentService {
	return &AIAgentService{
		store:      store,
		aiSvc:      aiSvc,
		searchSvc:  searchSvc,
		pageSvc:    pageSvc,
		dbSvc:      dbSvc,
		versionSvc: versionSvc,
	}
}

func (s *AIAgentService) ListConversations() ([]models.AIConversation, error) {
	rows, err := s.store.DB().Query(`
		SELECT id, title, scope_type, scope_target_id, created_at, updated_at
		FROM ai_conversations ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []models.AIConversation
	for rows.Next() {
		var c models.AIConversation
		var targetID sqlNullString
		if err := rows.Scan(&c.ID, &c.Title, &c.ScopeType, &targetID, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		if targetID.Valid {
			c.ScopeTargetID = &targetID.String
		}
		list = append(list, c)
	}
	if list == nil {
		list = []models.AIConversation{}
	}
	return list, nil
}

type sqlNullString struct {
	String string
	Valid  bool
}

func (n *sqlNullString) Scan(value any) error {
	if value == nil {
		n.String, n.Valid = "", false
		return nil
	}
	n.Valid = true
	switch v := value.(type) {
	case string:
		n.String = v
	case []byte:
		n.String = string(v)
	default:
		n.String = fmt.Sprint(v)
	}
	return nil
}

func (s *AIAgentService) CreateConversation(title, scopeType string, scopeTargetID *string) (*models.AIConversation, error) {
	if strings.TrimSpace(title) == "" {
		title = "新对话"
	}
	if scopeType == "" {
		scopeType = "all"
	}
	id := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := s.store.DB().Exec(`
		INSERT INTO ai_conversations (id, title, scope_type, scope_target_id, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
		id, title, scopeType, scopeTargetID, now, now)
	if err != nil {
		return nil, err
	}
	return &models.AIConversation{
		ID:            id,
		Title:         title,
		ScopeType:     scopeType,
		ScopeTargetID: scopeTargetID,
		CreatedAt:     now,
		UpdatedAt:     now,
	}, nil
}

func (s *AIAgentService) DeleteConversation(id string) error {
	_, err := s.store.DB().Exec(`DELETE FROM ai_conversations WHERE id = ?`, id)
	return err
}

func (s *AIAgentService) ListMessages(convID string) ([]models.AIMessage, error) {
	rows, err := s.store.DB().Query(`
		SELECT id, conversation_id, role, content, citations_json, pending_actions_json, action_status, created_at
		FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC`, convID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []models.AIMessage
	for rows.Next() {
		var m models.AIMessage
		var citStr, actStr string
		if err := rows.Scan(&m.ID, &m.ConversationID, &m.Role, &m.Content, &citStr, &actStr, &m.ActionStatus, &m.CreatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(citStr), &m.Citations)
		if m.Citations == nil {
			m.Citations = []models.Citation{}
		}
		_ = json.Unmarshal([]byte(actStr), &m.PendingActions)
		if m.PendingActions == nil {
			m.PendingActions = []models.PendingAction{}
		}
		list = append(list, m)
	}
	if list == nil {
		list = []models.AIMessage{}
	}
	return list, nil
}

// SendMessageStream runs RAG hybrid retrieval + multi-round read-tool / confirmation-gated write-tool Agent execution.
func (s *AIAgentService) SendMessageStream(
	ctx context.Context,
	convID, userText, scopeType, scopeTargetID, providerID, model string,
	emit func(event string, data any) error,
) (*models.AIMessage, error) {
	if strings.TrimSpace(userText) == "" {
		return nil, errors.New("消息内容不能为空")
	}
	if scopeType == "" {
		scopeType = "all"
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	userMsgID := uuid.NewString()
	_, err := s.store.DB().Exec(`
		INSERT INTO ai_messages (id, conversation_id, role, content, citations_json, pending_actions_json, action_status, created_at)
		VALUES (?, ?, 'user', ?, '[]', '[]', 'none', ?)`,
		userMsgID, convID, userText, now)
	if err != nil {
		return nil, err
	}

	// Update conversation title on first prompt if generic
	var curTitle string
	_ = s.store.DB().QueryRow(`SELECT title FROM ai_conversations WHERE id = ?`, convID).Scan(&curTitle)
	if curTitle == "新对话" {
		newTitle := truncateRunes(userText, 24)
		_, _ = s.store.DB().Exec(`UPDATE ai_conversations SET title = ?, scope_type = ?, scope_target_id = ?, updated_at = ? WHERE id = ?`,
			newTitle, scopeType, scopeTargetID, now, convID)
	} else {
		_, _ = s.store.DB().Exec(`UPDATE ai_conversations SET scope_type = ?, scope_target_id = ?, updated_at = ? WHERE id = ?`,
			scopeType, scopeTargetID, now, convID)
	}

	// 1. RAG Hybrid Search
	citations, _ := s.searchSvc.SearchChunks(ctx, userText, scopeType, scopeTargetID, 6)
	if citations == nil {
		citations = []models.Citation{}
	}
	_ = emit("citations", citations)

	// 2. Build conversation history + RAG system context
	rp, resolvedModel, err := s.aiSvc.resolveTarget("chat", providerID, model)
	if err != nil {
		return nil, err
	}

	var ragCtx strings.Builder
	ragCtx.WriteString("你是「我趣文档 Woqu」内置的 AI 知识库与写作 Agent 助手。\n")
	ragCtx.WriteString("回答时优先参考以下知识库检索片段，并在正文对应处用 [1]、[2] 标注引用来源：\n")
	if len(citations) == 0 {
		ragCtx.WriteString("（当前范围未命中直接相关片段，你可以调用只读工具进一步搜索或查看页面。）\n")
	} else {
		for _, c := range citations {
			ragCtx.WriteString(fmt.Sprintf("\n[%d] 页面ID=%s 标题=《%s》 章节=%s\n内容：%s\n",
				c.Index, c.PageID, c.PageTitle, c.HeadingPath, c.Snippet))
		}
	}
	if scopeTargetID != "" && scopeType == "current_page" {
		ragCtx.WriteString(fmt.Sprintf("\n用户当前正聚焦页面 ID: %s。\n", scopeTargetID))
	}
	ragCtx.WriteString("\n规则：\n1. 查询信息可直接调用只读工具（search_knowledge_base, get_page_content, list_pages, query_database）。\n2. 如需新建页面、修改页面或写入多维数据库，请直接调用对应写工具（create_page, update_page_content, append_blocks_to_page, create_database_row, update_database_row），系统会自动生成卡片让用户确认后再落库。\n3. 绝不编造不存在的页面 ID 或数据库内容。")

	history, _ := s.ListMessages(convID)
	llmMsgs := []LLMMessage{{Role: "system", Content: ragCtx.String()}}
	startIdx := 0
	if len(history) > 12 {
		startIdx = len(history) - 12
	}
	for _, h := range history[startIdx:] {
		llmMsgs = append(llmMsgs, LLMMessage{Role: h.Role, Content: h.Content})
	}

	tools := agentToolDefinitions()
	var assistantText strings.Builder
	var pendingActions []models.PendingAction

	const maxRounds = 5
	for round := 0; round < maxRounds; round++ {
		if round > 0 && assistantText.Len() > 0 {
			assistantText.WriteString("\n")
			_ = emit("delta", map[string]string{"text": "\n"})
		}

		resp, err := s.aiSvc.callChat(ctx, rp, resolvedModel, llmMsgs, tools, func(delta string) error {
			assistantText.WriteString(delta)
			return emit("delta", map[string]string{"text": delta})
		})
		if err != nil {
			return nil, err
		}

		if len(resp.ToolCalls) == 0 {
			break
		}

		llmMsgs = append(llmMsgs, LLMMessage{
			Role:      "assistant",
			Content:   resp.Content,
			ToolCalls: resp.ToolCalls,
		})

		hasReadCall := false
		for _, tc := range resp.ToolCalls {
			if isReadAgentTool(tc.Name) {
				hasReadCall = true
				_ = emit("tool_status", map[string]string{
					"tool":   tc.Name,
					"status": "running",
					"label":  toolDisplayName(tc.Name),
				})
				out := s.executeReadTool(ctx, tc)
				llmMsgs = append(llmMsgs, LLMMessage{
					Role:       "tool",
					ToolCallID: tc.ID,
					Content:    out,
				})
			} else {
				pa := s.buildPendingAction(tc)
				pendingActions = append(pendingActions, pa)
				llmMsgs = append(llmMsgs, LLMMessage{
					Role:       "tool",
					ToolCallID: tc.ID,
					Content:    "已提交至前端确认卡片等待用户确认，请勿重复调用相同写操作。",
				})
			}
		}

		if !hasReadCall && len(pendingActions) > 0 {
			if strings.TrimSpace(assistantText.String()) == "" {
				msg := "我已为你生成以下变更建议，请核对内容后点击「确认执行」："
				assistantText.WriteString(msg)
				_ = emit("delta", map[string]string{"text": msg})
			}
			break
		}
	}

	if len(pendingActions) > 0 {
		_ = emit("pending_actions", pendingActions)
	}

	actionStatus := "none"
	if len(pendingActions) > 0 {
		actionStatus = "pending"
	}

	citBytes, _ := json.Marshal(citations)
	actBytes, _ := json.Marshal(pendingActions)
	msgID := uuid.NewString()
	createdAt := time.Now().UTC().Format(time.RFC3339Nano)
	finalText := strings.TrimSpace(assistantText.String())

	_, err = s.store.DB().Exec(`
		INSERT INTO ai_messages (id, conversation_id, role, content, citations_json, pending_actions_json, action_status, created_at)
		VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)`,
		msgID, convID, finalText, string(citBytes), string(actBytes), actionStatus, createdAt)
	if err != nil {
		return nil, err
	}

	saved := &models.AIMessage{
		ID:             msgID,
		ConversationID: convID,
		Role:           "assistant",
		Content:        finalText,
		Citations:      citations,
		PendingActions: pendingActions,
		ActionStatus:   actionStatus,
		CreatedAt:      createdAt,
	}
	_ = emit("done", saved)
	return saved, nil
}

func (s *AIAgentService) ConfirmAction(convID, msgID, actionID string) (*models.AIMessage, *models.PendingAction, error) {
	msg, err := s.getMessage(convID, msgID)
	if err != nil {
		return nil, nil, err
	}

	var targetIdx = -1
	for i := range msg.PendingActions {
		if msg.PendingActions[i].ID == actionID {
			targetIdx = i
			break
		}
	}
	if targetIdx < 0 {
		return nil, nil, errors.New("未找到待确认的操作")
	}
	act := &msg.PendingActions[targetIdx]
	if act.Status != "pending" {
		return nil, nil, fmt.Errorf("该操作已处理 (状态: %s)", act.Status)
	}

	resultID, resultNote, execErr := s.executeWriteAction(act)
	if execErr != nil {
		act.Status = "failed"
		act.ResultNote = execErr.Error()
	} else {
		act.Status = "executed"
		act.ResultID = resultID
		act.ResultNote = resultNote
	}

	msg.ActionStatus = computeAggregateActionStatus(msg.PendingActions)
	if err := s.saveMessageActions(msg); err != nil {
		return nil, nil, err
	}
	if execErr != nil {
		return msg, act, execErr
	}
	return msg, act, nil
}

func (s *AIAgentService) RejectAction(convID, msgID, actionID string) (*models.AIMessage, error) {
	msg, err := s.getMessage(convID, msgID)
	if err != nil {
		return nil, err
	}
	found := false
	for i := range msg.PendingActions {
		if msg.PendingActions[i].ID == actionID {
			if msg.PendingActions[i].Status == "pending" {
				msg.PendingActions[i].Status = "rejected"
				msg.PendingActions[i].ResultNote = "用户已取消"
			}
			found = true
			break
		}
	}
	if !found {
		return nil, errors.New("未找到该操作")
	}
	msg.ActionStatus = computeAggregateActionStatus(msg.PendingActions)
	if err := s.saveMessageActions(msg); err != nil {
		return nil, err
	}
	return msg, nil
}

func (s *AIAgentService) getMessage(convID, msgID string) (*models.AIMessage, error) {
	var m models.AIMessage
	var citStr, actStr string
	err := s.store.DB().QueryRow(`
		SELECT id, conversation_id, role, content, citations_json, pending_actions_json, action_status, created_at
		FROM ai_messages WHERE id = ? AND conversation_id = ?`, msgID, convID).
		Scan(&m.ID, &m.ConversationID, &m.Role, &m.Content, &citStr, &actStr, &m.ActionStatus, &m.CreatedAt)
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(citStr), &m.Citations)
	_ = json.Unmarshal([]byte(actStr), &m.PendingActions)
	return &m, nil
}

func (s *AIAgentService) saveMessageActions(m *models.AIMessage) error {
	b, _ := json.Marshal(m.PendingActions)
	_, err := s.store.DB().Exec(`UPDATE ai_messages SET pending_actions_json = ?, action_status = ? WHERE id = ?`,
		string(b), m.ActionStatus, m.ID)
	return err
}

func computeAggregateActionStatus(actions []models.PendingAction) string {
	hasPending := false
	hasExecuted := false
	for _, a := range actions {
		switch a.Status {
		case "pending":
			hasPending = true
		case "executed":
			hasExecuted = true
		}
	}
	if hasPending {
		return "pending"
	}
	if hasExecuted {
		return "executed"
	}
	return "rejected"
}

func (s *AIAgentService) executeReadTool(ctx context.Context, tc LLMToolCall) string {
	switch tc.Name {
	case "search_knowledge_base":
		q, _ := tc.Arguments["query"].(string)
		res, err := s.searchSvc.SearchPages(ctx, q, 8)
		if err != nil {
			return "搜索失败: " + err.Error()
		}
		b, _ := json.Marshal(res)
		return string(b)

	case "get_page_content":
		pid, _ := tc.Arguments["page_id"].(string)
		p, err := s.pageSvc.GetPage(pid)
		if err != nil {
			return "页面不存在: " + err.Error()
		}
		out := map[string]any{
			"id":         p.ID,
			"title":      p.Title,
			"summary":    p.Summary,
			"tags":       p.Tags,
			"properties": p.Properties,
			"content":    truncateRunes(p.PlainText, 5000),
		}
		b, _ := json.Marshal(out)
		return string(b)

	case "list_pages":
		tree, err := s.pageSvc.ListTree()
		if err != nil {
			return "获取列表失败: " + err.Error()
		}
		if len(tree) > 50 {
			tree = tree[:50]
		}
		dbs, _ := s.dbSvc.ListDatabases()
		out := map[string]any{
			"pages":     tree,
			"databases": dbs,
		}
		b, _ := json.Marshal(out)
		return string(b)

	case "query_database":
		dbID, _ := tc.Arguments["database_id"].(string)
		full, err := s.dbSvc.GetDatabaseFull(dbID)
		if err != nil {
			return "数据库查询失败: " + err.Error()
		}
		rows := full.Rows
		if len(rows) > 30 {
			rows = rows[:30]
		}
		var compact []map[string]any
		for _, r := range rows {
			compact = append(compact, map[string]any{
				"row_id":     r.ID,
				"title":      r.Title,
				"properties": r.Properties,
			})
		}
		out := map[string]any{
			"database_id": full.Database.ID,
			"title":       full.Database.Title,
			"schema":      full.Database.Schema,
			"rows":        compact,
		}
		b, _ := json.Marshal(out)
		return string(b)
	}
	return "unknown read tool"
}

func (s *AIAgentService) buildPendingAction(tc LLMToolCall) models.PendingAction {
	pa := models.PendingAction{
		ID:       uuid.NewString(),
		ToolName: tc.Name,
		Args:     tc.Arguments,
		Status:   "pending",
	}

	switch tc.Name {
	case "create_page":
		title, _ := tc.Arguments["title"].(string)
		pa.TargetTitle = title
		pa.Description = fmt.Sprintf("新建页面《%s》", title)
	case "update_page_content":
		pid, _ := tc.Arguments["page_id"].(string)
		newTitle, _ := tc.Arguments["new_title"].(string)
		if p, err := s.pageSvc.GetPage(pid); err == nil {
			pa.TargetTitle = p.Title
		} else {
			pa.TargetTitle = pid
		}
		if newTitle != "" {
			pa.Description = fmt.Sprintf("修改页面《%s》（并重命名为《%s》）", pa.TargetTitle, newTitle)
		} else {
			pa.Description = fmt.Sprintf("改写页面《%s》正文内容", pa.TargetTitle)
		}
	case "append_blocks_to_page":
		pid, _ := tc.Arguments["page_id"].(string)
		if p, err := s.pageSvc.GetPage(pid); err == nil {
			pa.TargetTitle = p.Title
		} else {
			pa.TargetTitle = pid
		}
		pa.Description = fmt.Sprintf("向页面《%s》末尾追加内容", pa.TargetTitle)
	case "create_database_row":
		dbID, _ := tc.Arguments["database_id"].(string)
		title, _ := tc.Arguments["title"].(string)
		dbTitle := dbID
		if d, err := s.dbSvc.GetDatabase(dbID); err == nil {
			dbTitle = d.Title
		}
		pa.TargetTitle = dbTitle + " / " + title
		pa.Description = fmt.Sprintf("在多维数据库《%s》中新增记录「%s」", dbTitle, title)
	case "update_database_row":
		dbID, _ := tc.Arguments["database_id"].(string)
		rowID, _ := tc.Arguments["row_id"].(string)
		rowTitle := rowID
		if p, err := s.pageSvc.GetPage(rowID); err == nil {
			rowTitle = p.Title
		}
		pa.TargetTitle = rowTitle
		pa.Description = fmt.Sprintf("更新数据库(%s)记录「%s」字段", dbID, rowTitle)
	default:
		pa.Description = "执行写操作: " + tc.Name
	}
	return pa
}

func (s *AIAgentService) executeWriteAction(act *models.PendingAction) (string, string, error) {
	switch act.ToolName {
	case "create_page":
		title, _ := act.Args["title"].(string)
		md, _ := act.Args["markdown_content"].(string)
		icon, _ := act.Args["icon"].(string)
		if icon == "" {
			icon = "📝"
		}
		var parentPtr *string
		if pid, ok := act.Args["parent_id"].(string); ok && strings.TrimSpace(pid) != "" {
			parentPtr = &pid
		}
		var tags []string
		if rawTags, ok := act.Args["tags"].([]any); ok {
			for _, t := range rawTags {
				if ts, ok := t.(string); ok {
					tags = append(tags, ts)
				}
			}
		}
		doc := MarkdownToTipTap(md)
		p, err := s.pageSvc.CreatePage(CreatePageInput{
			ParentID:    parentPtr,
			Title:       title,
			Icon:        icon,
			ContentJSON: doc,
			Tags:        tags,
		})
		if err != nil {
			return "", "", err
		}
		return p.ID, "已创建页面《" + p.Title + "》", nil

	case "update_page_content":
		pid, _ := act.Args["page_id"].(string)
		md, _ := act.Args["markdown_content"].(string)
		if pid == "" {
			return "", "", errors.New("missing page_id")
		}
		// Mandatory pre_ai snapshot before mutating page!
		if _, err := s.versionSvc.SaveSnapshot(pid, "pre_ai", "AI Agent 改写前自动备份"); err != nil {
			return "", "", fmt.Errorf("保存 AI 修改前快照失败: %w", err)
		}
		doc := MarkdownToTipTap(md)
		in := UpdatePageInput{
			ContentJSON: &doc,
			VersionNote: "AI Agent 更新内容",
		}
		if newTitle, ok := act.Args["new_title"].(string); ok && strings.TrimSpace(newTitle) != "" {
			in.Title = &newTitle
		}
		p, err := s.pageSvc.UpdatePage(pid, in)
		if err != nil {
			return "", "", err
		}
		return p.ID, "已保存历史快照并更新页面《" + p.Title + "》", nil

	case "append_blocks_to_page":
		pid, _ := act.Args["page_id"].(string)
		md, _ := act.Args["markdown_content"].(string)
		existing, err := s.pageSvc.GetPage(pid)
		if err != nil {
			return "", "", err
		}
		if _, err := s.versionSvc.SaveSnapshot(pid, "pre_ai", "AI Agent 追加内容前自动备份"); err != nil {
			return "", "", fmt.Errorf("保存 AI 修改前快照失败: %w", err)
		}
		curDoc, _ := ParseTipTapDoc(existing.ContentJSON)
		addDoc, _ := ParseTipTapDoc(MarkdownToTipTap(md))
		curDoc.Content = append(curDoc.Content, addDoc.Content...)
		mergedBytes, _ := json.Marshal(curDoc)
		raw := json.RawMessage(mergedBytes)
		p, err := s.pageSvc.UpdatePage(pid, UpdatePageInput{
			ContentJSON: &raw,
			VersionNote: "AI Agent 追加内容",
		})
		if err != nil {
			return "", "", err
		}
		return p.ID, "已保存历史快照并向《" + p.Title + "》追加内容", nil

	case "create_database_row":
		dbID, _ := act.Args["database_id"].(string)
		title, _ := act.Args["title"].(string)
		props, _ := act.Args["properties"].(map[string]any)
		row, err := s.dbSvc.CreateRow(dbID, title, props)
		if err != nil {
			return "", "", err
		}
		return row.ID, "已新增数据库记录「" + row.Title + "」", nil

	case "update_database_row":
		dbID, _ := act.Args["database_id"].(string)
		rowID, _ := act.Args["row_id"].(string)
		if _, err := s.versionSvc.SaveSnapshot(rowID, "pre_ai", "AI Agent 修改数据库记录前自动备份"); err != nil {
			return "", "", fmt.Errorf("保存 AI 修改前快照失败: %w", err)
		}
		var titlePtr *string
		if t, ok := act.Args["title"].(string); ok && strings.TrimSpace(t) != "" {
			titlePtr = &t
		}
		props, _ := act.Args["properties"].(map[string]any)
		if props == nil {
			props = map[string]any{}
		}
		row, err := s.dbSvc.UpdateRow(dbID, rowID, titlePtr, props)
		if err != nil {
			return "", "", err
		}
		return row.ID, "已更新记录「" + row.Title + "」", nil
	}
	return "", "", fmt.Errorf("unsupported tool: %s", act.ToolName)
}

func isReadAgentTool(name string) bool {
	switch name {
	case "search_knowledge_base", "get_page_content", "list_pages", "query_database":
		return true
	}
	return false
}

func toolDisplayName(name string) string {
	switch name {
	case "search_knowledge_base":
		return "检索知识库"
	case "get_page_content":
		return "读取页面详情"
	case "list_pages":
		return "浏览页面与数据库目录"
	case "query_database":
		return "查询多维数据库"
	default:
		return name
	}
}

func agentToolDefinitions() []LLMToolDef {
	return []LLMToolDef{
		{
			Name:        "search_knowledge_base",
			Description: "Search pages across the user's knowledge base by keyword.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"query": map[string]any{"type": "string", "description": "Search keywords in Chinese or English"},
				},
				"required": []string{"query"},
			},
		},
		{
			Name:        "get_page_content",
			Description: "Fetch full title, properties, and plain text content of a specific page by ID.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"page_id": map[string]any{"type": "string", "description": "Target page UUID"},
				},
				"required": []string{"page_id"},
			},
		},
		{
			Name:        "list_pages",
			Description: "List existing pages in the sidebar tree and all multidimensional databases.",
			Parameters: map[string]any{
				"type":       "object",
				"properties": map[string]any{},
			},
		},
		{
			Name:        "query_database",
			Description: "Inspect schema and rows of a multidimensional database by database_id.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"database_id": map[string]any{"type": "string", "description": "Target database UUID"},
				},
				"required": []string{"database_id"},
			},
		},
		{
			Name:        "create_page",
			Description: "Propose creating a new document page (requires user confirmation).",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"title":            map[string]any{"type": "string", "description": "Page title"},
					"markdown_content": map[string]any{"type": "string", "description": "Page content formatted in clean Markdown"},
					"parent_id":        map[string]any{"type": "string", "description": "Optional parent page ID"},
					"icon":             map[string]any{"type": "string", "description": "Optional single emoji icon"},
					"tags":             map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
				},
				"required": []string{"title", "markdown_content"},
			},
		},
		{
			Name:        "update_page_content",
			Description: "Propose replacing the content of an existing page (requires user confirmation, auto-creates snapshot).",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"page_id":          map[string]any{"type": "string", "description": "Existing page ID"},
					"new_title":        map[string]any{"type": "string", "description": "Optional updated title"},
					"markdown_content": map[string]any{"type": "string", "description": "Updated full page Markdown"},
				},
				"required": []string{"page_id", "markdown_content"},
			},
		},
		{
			Name:        "append_blocks_to_page",
			Description: "Propose appending Markdown blocks to the bottom of an existing page (requires user confirmation).",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"page_id":          map[string]any{"type": "string", "description": "Target page ID"},
					"markdown_content": map[string]any{"type": "string", "description": "Markdown blocks to append"},
				},
				"required": []string{"page_id", "markdown_content"},
			},
		},
		{
			Name:        "create_database_row",
			Description: "Propose adding a new row to a multidimensional database (requires user confirmation).",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"database_id": map[string]any{"type": "string", "description": "Target database ID"},
					"title":       map[string]any{"type": "string", "description": "Row title"},
					"properties":  map[string]any{"type": "object", "description": "Key-value map keyed by schema property ID"},
				},
				"required": []string{"database_id", "title"},
			},
		},
		{
			Name:        "update_database_row",
			Description: "Propose updating fields on an existing database row (requires user confirmation).",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"database_id": map[string]any{"type": "string", "description": "Target database ID"},
					"row_id":      map[string]any{"type": "string", "description": "Row page ID"},
					"title":       map[string]any{"type": "string", "description": "Optional updated row title"},
					"properties":  map[string]any{"type": "object", "description": "Updated property ID -> value map"},
				},
				"required": []string{"database_id", "row_id"},
			},
		},
	}
}
