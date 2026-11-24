package models

import "encoding/json"

// AuthStatus represents workspace initialization and authentication state.
type AuthStatus struct {
	Initialized    bool   `json:"initialized"`
	Authenticated  bool   `json:"authenticated"`
	LocalNoAuth    bool   `json:"local_no_auth"`
	WorkspaceName  string `json:"workspace_name"`
	WorkspaceIcon  string `json:"workspace_icon"`
}

// Page represents a document page or a database row page in the unified model.
type Page struct {
	ID             string          `json:"id"`
	ParentID       *string         `json:"parent_id"`
	DatabaseID     *string         `json:"database_id"`
	Title          string          `json:"title"`
	Icon           string          `json:"icon"`
	CoverURL       string          `json:"cover_url"`
	IsDatabase     bool            `json:"is_database"`
	ContentJSON    json.RawMessage `json:"content_json"`
	PlainText      string          `json:"plain_text"`
	Summary        string          `json:"summary"`
	Tags           []string        `json:"tags"`
	Properties     map[string]any  `json:"properties"`
	Position       float64         `json:"position"`
	IsFavorite     bool            `json:"is_favorite"`
	IsFullWidth    bool            `json:"is_full_width"`
	IsTrashed      bool            `json:"is_trashed"`
	TrashedAt      *string         `json:"trashed_at,omitempty"`
	CreatedAt      string          `json:"created_at"`
	UpdatedAt      string          `json:"updated_at"`
}

// PageTreeItem is a lightweight summary used for the sidebar hierarchy.
type PageTreeItem struct {
	ID          string  `json:"id"`
	ParentID    *string `json:"parent_id"`
	DatabaseID  *string `json:"database_id"`
	Title       string  `json:"title"`
	Icon        string  `json:"icon"`
	IsDatabase  bool    `json:"is_database"`
	Position    float64 `json:"position"`
	IsFavorite  bool    `json:"is_favorite"`
	UpdatedAt   string  `json:"updated_at"`
}

// PageVersion stores a historical snapshot of a page.
type PageVersion struct {
	ID             string          `json:"id"`
	PageID         string          `json:"page_id"`
	Title          string          `json:"title"`
	ContentJSON    json.RawMessage `json:"content_json"`
	Properties     map[string]any  `json:"properties"`
	Source         string          `json:"source"`
	Note           string          `json:"note"`
	CreatedAt      string          `json:"created_at"`
}

// BacklinkItem represents an incoming link from another page.
type BacklinkItem struct {
	SourcePageID string `json:"source_page_id"`
	Title        string `json:"title"`
	Icon         string `json:"icon"`
	Excerpt      string `json:"excerpt"`
	UpdatedAt    string `json:"updated_at"`
}

// GraphData represents the knowledge graph nodes and edges.
type GraphData struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
}

type GraphNode struct {
	ID         string   `json:"id"`
	Title      string   `json:"title"`
	Icon       string   `json:"icon"`
	IsDatabase bool     `json:"is_database"`
	Tags       []string `json:"tags"`
	LinkCount  int      `json:"link_count"`
}

type GraphEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
}

// PropertyOption defines a select or multi_select tag choice.
type PropertyOption struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

// PropertySchema defines one column/property in a multidimensional database.
type PropertySchema struct {
	ID                 string           `json:"id"`
	Name               string           `json:"name"`
	Type               string           `json:"type"` // title, text, number, select, multi_select, date, checkbox, url, email, phone, person, files, relation, rollup, formula, ai_autofill, created_time, updated_time
	Width              int              `json:"width,omitempty"`
	Options            []PropertyOption `json:"options,omitempty"`
	NumberFormat       string           `json:"number_format,omitempty"` // number, currency, percent
	RelationDatabaseID string           `json:"relation_database_id,omitempty"`
	SyncedPropertyID   string           `json:"synced_property_id,omitempty"`
	IsTwoWay           bool             `json:"is_two_way,omitempty"`
	RollupRelationID   string           `json:"rollup_relation_id,omitempty"`
	RollupTargetPropID string           `json:"rollup_target_prop_id,omitempty"`
	RollupAggregation  string           `json:"rollup_aggregation,omitempty"`
	FormulaExpression  string           `json:"formula_expression,omitempty"`
	AIPrompt           string           `json:"ai_prompt,omitempty"`
	AISourcePropIDs    []string         `json:"ai_source_prop_ids,omitempty"`
}

// Database represents a multidimensional database metadata entry.
type Database struct {
	ID          string           `json:"id"`
	PageID      *string          `json:"page_id"`
	Title       string           `json:"title"`
	Icon        string           `json:"icon"`
	Description string           `json:"description"`
	IsInline    bool             `json:"is_inline"`
	Schema      []PropertySchema `json:"schema"`
	Views       []DatabaseView   `json:"views,omitempty"`
	CreatedAt   string           `json:"created_at"`
	UpdatedAt   string           `json:"updated_at"`
}

// DatabaseView represents a saved view (table, kanban, calendar, gallery).
type DatabaseView struct {
	ID         string         `json:"id"`
	DatabaseID string         `json:"database_id"`
	Name       string         `json:"name"`
	Type       string         `json:"type"` // table, kanban, calendar, gallery
	Config     map[string]any `json:"config"`
	Position   float64        `json:"position"`
	CreatedAt  string         `json:"created_at"`
	UpdatedAt  string         `json:"updated_at"`
}

// DatabaseFull bundles database metadata, views, and all non-trashed rows.
type DatabaseFull struct {
	Database Database       `json:"database"`
	Views    []DatabaseView `json:"views"`
	Rows     []Page         `json:"rows"`
}

// AIProvider stores a configured LLM provider with masked API key for transport.
type AIProvider struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	ProviderType string   `json:"provider_type"` // openai_compatible, anthropic, gemini
	BaseURL      string   `json:"base_url"`
	APIKeyMasked string   `json:"api_key_masked"`
	HasAPIKey    bool     `json:"has_api_key"`
	Models       []string `json:"models"`
	IsEnabled    bool     `json:"is_enabled"`
	CreatedAt    string   `json:"created_at"`
	UpdatedAt    string   `json:"updated_at"`
}

// AIRouting maps high-level AI tasks to specific provider + model pairs.
type AIRouting struct {
	Chat      *AIModelTarget `json:"chat"`
	Writing   *AIModelTarget `json:"writing"`
	Summary   *AIModelTarget `json:"summary"`
	Autofill  *AIModelTarget `json:"autofill"`
	Embedding *AIModelTarget `json:"embedding"`
}

type AIModelTarget struct {
	ProviderID string `json:"provider_id"`
	Model      string `json:"model"`
}

// AIPromptTemplate stores builtin or user-defined AI prompt shortcuts.
type AIPromptTemplate struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	Category           string `json:"category"` // writing, summarize, translate, extract, custom
	Icon               string `json:"icon"`
	SystemPrompt       string `json:"system_prompt"`
	UserPromptTemplate string `json:"user_prompt_template"`
	IsBuiltin          bool   `json:"is_builtin"`
	Position           int    `json:"position"`
	CreatedAt          string `json:"created_at"`
}

// AIConversation represents an AI sidebar chat thread.
type AIConversation struct {
	ID            string  `json:"id"`
	Title         string  `json:"title"`
	ScopeType     string  `json:"scope_type"` // current_page, folder, all
	ScopeTargetID *string `json:"scope_target_id"`
	CreatedAt     string  `json:"created_at"`
	UpdatedAt     string  `json:"updated_at"`
}

// Citation references a knowledge base page chunk retrieved for RAG.
type Citation struct {
	Index       int     `json:"index"`
	PageID      string  `json:"page_id"`
	PageTitle   string  `json:"page_title"`
	PageIcon    string  `json:"page_icon"`
	HeadingPath string  `json:"heading_path"`
	Snippet     string  `json:"snippet"`
	Score       float64 `json:"score"`
}

// PendingAction represents an AI Agent write proposal waiting for user confirmation.
type PendingAction struct {
	ID          string         `json:"id"`
	ToolName    string         `json:"tool_name"`
	Description string         `json:"description"`
	TargetTitle string         `json:"target_title"`
	Args        map[string]any `json:"args"`
	Status      string         `json:"status"` // pending, executed, rejected, failed
	ResultNote  string         `json:"result_note,omitempty"`
	ResultID    string         `json:"result_id,omitempty"`
}

// AIMessage represents a single message in an AI conversation.
type AIMessage struct {
	ID             string          `json:"id"`
	ConversationID string          `json:"conversation_id"`
	Role           string          `json:"role"` // user, assistant
	Content        string          `json:"content"`
	Citations      []Citation      `json:"citations"`
	PendingActions []PendingAction `json:"pending_actions"`
	ActionStatus   string          `json:"action_status"` // none, pending, executed, rejected
	CreatedAt      string          `json:"created_at"`
}

// SearchResult represents a page match from FTS5 + optional vector hybrid search.
type SearchResult struct {
	PageID    string  `json:"page_id"`
	Title     string  `json:"title"`
	Icon      string  `json:"icon"`
	Snippet   string  `json:"snippet"`
	Score     float64 `json:"score"`
	UpdatedAt string  `json:"updated_at"`
}

// Template represents a builtin or custom reusable page template.
type Template struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Category    string          `json:"category"`
	Icon        string          `json:"icon"`
	Description string          `json:"description"`
	ContentJSON json.RawMessage `json:"content_json"`
	IsBuiltin   bool            `json:"is_builtin"`
	CreatedAt   string          `json:"created_at"`
}

// PublicShare represents a read-only share configuration for a page.
type PublicShare struct {
	ID          string  `json:"id"`
	PageID      string  `json:"page_id"`
	Token       string  `json:"token"`
	HasPassword bool    `json:"has_password"`
	ExpiresAt   *string `json:"expires_at"`
	IsActive    bool    `json:"is_active"`
	ViewCount   int     `json:"view_count"`
	CreatedAt   string  `json:"created_at"`
}

// Asset stores uploaded image or file attachment metadata.
type Asset struct {
	ID          string  `json:"id"`
	Filename    string  `json:"filename"`
	StoragePath string  `json:"storage_path"`
	URL         string  `json:"url"`
	MimeType    string  `json:"mime_type"`
	SizeBytes   int64   `json:"size_bytes"`
	PageID      *string `json:"page_id"`
	CreatedAt   string  `json:"created_at"`
}
