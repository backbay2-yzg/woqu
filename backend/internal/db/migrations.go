package db

import "database/sql"

var schemaStatements = []string{
	`CREATE TABLE IF NOT EXISTS app_settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);`,

	`CREATE TABLE IF NOT EXISTS pages (
		id TEXT PRIMARY KEY,
		parent_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
		database_id TEXT,
		title TEXT NOT NULL DEFAULT '无标题',
		icon TEXT NOT NULL DEFAULT '',
		cover_url TEXT NOT NULL DEFAULT '',
		is_database INTEGER NOT NULL DEFAULT 0,
		content_json TEXT NOT NULL DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}',
		plain_text TEXT NOT NULL DEFAULT '',
		summary TEXT NOT NULL DEFAULT '',
		tags_json TEXT NOT NULL DEFAULT '[]',
		properties_json TEXT NOT NULL DEFAULT '{}',
		position REAL NOT NULL DEFAULT 0,
		is_favorite INTEGER NOT NULL DEFAULT 0,
		is_full_width INTEGER NOT NULL DEFAULT 0,
		is_trashed INTEGER NOT NULL DEFAULT 0,
		trashed_at TEXT,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);`,
	`CREATE INDEX IF NOT EXISTS idx_pages_parent ON pages(parent_id, is_trashed, position);`,
	`CREATE INDEX IF NOT EXISTS idx_pages_database ON pages(database_id, is_trashed);`,
	`CREATE INDEX IF NOT EXISTS idx_pages_updated ON pages(updated_at DESC);`,

	`CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
		page_id UNINDEXED,
		title_seg,
		content_seg,
		summary_seg,
		tags_seg,
		tokenize='unicode61'
	);`,

	`CREATE TABLE IF NOT EXISTS page_versions (
		id TEXT PRIMARY KEY,
		page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
		title TEXT NOT NULL,
		content_json TEXT NOT NULL,
		properties_json TEXT NOT NULL DEFAULT '{}',
		source TEXT NOT NULL DEFAULT 'auto',
		note TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL
	);`,
	`CREATE INDEX IF NOT EXISTS idx_page_versions_page ON page_versions(page_id, created_at DESC);`,

	`CREATE TABLE IF NOT EXISTS page_links (
		source_page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
		target_page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
		source_block_id TEXT NOT NULL DEFAULT '',
		target_block_id TEXT NOT NULL DEFAULT '',
		PRIMARY KEY (source_page_id, target_page_id, source_block_id)
	);`,
	`CREATE INDEX IF NOT EXISTS idx_page_links_target ON page_links(target_page_id);`,

	`CREATE TABLE IF NOT EXISTS databases (
		id TEXT PRIMARY KEY,
		page_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
		title TEXT NOT NULL DEFAULT '未命名数据库',
		icon TEXT NOT NULL DEFAULT '🗃️',
		description TEXT NOT NULL DEFAULT '',
		is_inline INTEGER NOT NULL DEFAULT 0,
		schema_json TEXT NOT NULL DEFAULT '[]',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);`,
	`CREATE INDEX IF NOT EXISTS idx_databases_page ON databases(page_id);`,

	`CREATE TABLE IF NOT EXISTS database_views (
		id TEXT PRIMARY KEY,
		database_id TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
		name TEXT NOT NULL DEFAULT '默认视图',
		type TEXT NOT NULL DEFAULT 'table',
		config_json TEXT NOT NULL DEFAULT '{}',
		position REAL NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);`,
	`CREATE INDEX IF NOT EXISTS idx_database_views_db ON database_views(database_id, position);`,

	`CREATE TABLE IF NOT EXISTS ai_providers (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		provider_type TEXT NOT NULL,
		base_url TEXT NOT NULL DEFAULT '',
		api_key_encrypted TEXT NOT NULL DEFAULT '',
		models_json TEXT NOT NULL DEFAULT '[]',
		is_enabled INTEGER NOT NULL DEFAULT 1,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);`,

	`CREATE TABLE IF NOT EXISTS ai_prompt_templates (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		category TEXT NOT NULL DEFAULT 'custom',
		icon TEXT NOT NULL DEFAULT '✨',
		system_prompt TEXT NOT NULL DEFAULT '',
		user_prompt_template TEXT NOT NULL,
		is_builtin INTEGER NOT NULL DEFAULT 0,
		position INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL
	);`,

	`CREATE TABLE IF NOT EXISTS ai_conversations (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL DEFAULT '新对话',
		scope_type TEXT NOT NULL DEFAULT 'all',
		scope_target_id TEXT,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);`,

	`CREATE TABLE IF NOT EXISTS ai_messages (
		id TEXT PRIMARY KEY,
		conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
		role TEXT NOT NULL,
		content TEXT NOT NULL DEFAULT '',
		citations_json TEXT NOT NULL DEFAULT '[]',
		pending_actions_json TEXT NOT NULL DEFAULT '[]',
		action_status TEXT NOT NULL DEFAULT 'none',
		created_at TEXT NOT NULL
	);`,
	`CREATE INDEX IF NOT EXISTS idx_ai_messages_conv ON ai_messages(conversation_id, created_at);`,

	`CREATE TABLE IF NOT EXISTS page_chunks (
		id TEXT PRIMARY KEY,
		page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
		chunk_index INTEGER NOT NULL,
		heading_path TEXT NOT NULL DEFAULT '',
		content TEXT NOT NULL,
		embedding_blob BLOB,
		embedding_dim INTEGER NOT NULL DEFAULT 0,
		embedding_model TEXT NOT NULL DEFAULT '',
		updated_at TEXT NOT NULL
	);`,
	`CREATE INDEX IF NOT EXISTS idx_page_chunks_page ON page_chunks(page_id, chunk_index);`,

	`CREATE TABLE IF NOT EXISTS templates (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		category TEXT NOT NULL DEFAULT '常用',
		icon TEXT NOT NULL DEFAULT '📄',
		description TEXT NOT NULL DEFAULT '',
		content_json TEXT NOT NULL,
		is_builtin INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL
	);`,

	`CREATE TABLE IF NOT EXISTS public_shares (
		id TEXT PRIMARY KEY,
		page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
		token TEXT NOT NULL UNIQUE,
		password_hash TEXT NOT NULL DEFAULT '',
		expires_at TEXT,
		is_active INTEGER NOT NULL DEFAULT 1,
		view_count INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL
	);`,
	`CREATE INDEX IF NOT EXISTS idx_public_shares_page ON public_shares(page_id);`,

	`CREATE TABLE IF NOT EXISTS assets (
		id TEXT PRIMARY KEY,
		filename TEXT NOT NULL,
		storage_path TEXT NOT NULL,
		mime_type TEXT NOT NULL,
		size_bytes INTEGER NOT NULL,
		page_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
		created_at TEXT NOT NULL
	);`,
	`CREATE INDEX IF NOT EXISTS idx_assets_page ON assets(page_id);`,
}

// RunMigrations initializes all tables and FTS5 virtual tables idempotently.
func RunMigrations(conn *sql.DB) error {
	for _, stmt := range schemaStatements {
		if _, err := conn.Exec(stmt); err != nil {
			return err
		}
	}
	return nil
}
