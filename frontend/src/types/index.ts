export interface AuthStatus {
  initialized: boolean;
  authenticated: boolean;
  local_no_auth: boolean;
  workspace_name: string;
  workspace_icon: string;
}

export interface Page {
  id: string;
  parent_id: string | null;
  database_id: string | null;
  title: string;
  icon: string;
  cover_url: string;
  is_database: boolean;
  content_json: TipTapJSON;
  plain_text: string;
  summary: string;
  tags: string[];
  properties: Record<string, unknown>;
  position: number;
  is_favorite: boolean;
  is_full_width: boolean;
  is_trashed: boolean;
  trashed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PageTreeItem {
  id: string;
  parent_id: string | null;
  database_id: string | null;
  title: string;
  icon: string;
  is_database: boolean;
  position: number;
  is_favorite: boolean;
  updated_at: string;
}

export interface PageVersion {
  id: string;
  page_id: string;
  title: string;
  content_json: TipTapJSON;
  properties: Record<string, unknown>;
  source: 'auto' | 'manual' | 'pre_ai' | 'pre_restore' | string;
  note: string;
  created_at: string;
}

export interface BacklinkItem {
  source_page_id: string;
  title: string;
  icon: string;
  excerpt: string;
  updated_at: string;
}

export interface GraphNode {
  id: string;
  title: string;
  icon: string;
  is_database: boolean;
  tags: string[];
  link_count: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type PropertyType =
  | 'title'
  | 'text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'date'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'phone'
  | 'person'
  | 'files'
  | 'relation'
  | 'rollup'
  | 'formula'
  | 'ai_autofill'
  | 'created_time'
  | 'updated_time';

export interface PropertyOption {
  id: string;
  name: string;
  color: string;
}

export interface PropertySchema {
  id: string;
  name: string;
  type: PropertyType;
  width?: number;
  options?: PropertyOption[];
  number_format?: 'number' | 'currency' | 'percent' | string;
  relation_database_id?: string;
  synced_property_id?: string;
  is_two_way?: boolean;
  rollup_relation_id?: string;
  rollup_target_prop_id?: string;
  rollup_aggregation?: string;
  formula_expression?: string;
  ai_prompt?: string;
  ai_source_prop_ids?: string[];
}

export type DatabaseViewType = 'table' | 'kanban' | 'calendar' | 'gallery';

export interface ViewFilterRule {
  id: string;
  property_id: string;
  operator:
    | 'equals'
    | 'not_equals'
    | 'contains'
    | 'not_contains'
    | 'gt'
    | 'lt'
    | 'gte'
    | 'lte'
    | 'is_empty'
    | 'is_not_empty'
    | 'is_checked'
    | 'is_not_checked';
  value: string;
}

export interface ViewSortRule {
  property_id: string;
  direction: 'asc' | 'desc';
}

export interface DatabaseViewConfig {
  filters?: ViewFilterRule[];
  sorts?: ViewSortRule[];
  group_by?: string;
  date_property?: string;
  card_size?: 'small' | 'medium' | 'large';
  show_properties?: string[];
  hidden_properties?: string[];
}

export interface DatabaseView {
  id: string;
  database_id: string;
  name: string;
  type: DatabaseViewType;
  config: DatabaseViewConfig;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface DatabaseMeta {
  id: string;
  page_id: string | null;
  title: string;
  icon: string;
  description: string;
  is_inline: boolean;
  schema: PropertySchema[];
  views?: DatabaseView[];
  created_at: string;
  updated_at: string;
}

export interface DatabaseFull {
  database: DatabaseMeta;
  views: DatabaseView[];
  rows: Page[];
}

export interface AIProvider {
  id: string;
  name: string;
  provider_type: 'openai_compatible' | 'anthropic' | 'gemini';
  base_url: string;
  api_key_masked: string;
  has_api_key: boolean;
  models: string[];
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AIModelTarget {
  provider_id: string;
  model: string;
}

export interface AIRouting {
  chat?: AIModelTarget | null;
  writing?: AIModelTarget | null;
  summary?: AIModelTarget | null;
  autofill?: AIModelTarget | null;
  embedding?: AIModelTarget | null;
}

export interface AIPromptTemplate {
  id: string;
  name: string;
  category: string;
  icon: string;
  system_prompt: string;
  user_prompt_template: string;
  is_builtin: boolean;
  position: number;
  created_at: string;
}

export interface AIConversation {
  id: string;
  title: string;
  scope_type: 'current_page' | 'folder' | 'all';
  scope_target_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Citation {
  index: number;
  page_id: string;
  page_title: string;
  page_icon: string;
  heading_path: string;
  snippet: string;
  score: number;
}

export interface PendingAction {
  id: string;
  tool_name: string;
  description: string;
  target_title: string;
  args: Record<string, unknown>;
  status: 'pending' | 'executed' | 'rejected' | 'failed';
  result_note?: string;
  result_id?: string;
}

export interface AIMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  pending_actions: PendingAction[];
  action_status: string;
  created_at: string;
}

export interface SearchResult {
  page_id: string;
  title: string;
  icon: string;
  snippet: string;
  score: number;
  updated_at: string;
}

export interface TemplateItem {
  id: string;
  name: string;
  category: string;
  icon: string;
  description: string;
  content_json: TipTapJSON;
  is_builtin: boolean;
  created_at: string;
}

export interface PublicShare {
  id: string;
  page_id: string;
  token: string;
  has_password: boolean;
  expires_at: string | null;
  is_active: boolean;
  view_count: number;
  created_at: string;
}

export interface PublicSharePayload {
  needs_password: boolean;
  title?: string;
  icon?: string;
  page?: Page;
  database?: DatabaseFull;
  inline_databases?: DatabaseFull[];
}

export interface TipTapJSON {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapJSON[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}
