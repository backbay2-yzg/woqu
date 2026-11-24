package services

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	"woqu/backend/internal/db"
	"woqu/backend/internal/models"
)

type DatabaseService struct {
	store   *db.Store
	pageSvc *PageService
}

func NewDatabaseService(store *db.Store, pageSvc *PageService) *DatabaseService {
	return &DatabaseService{
		store:   store,
		pageSvc: pageSvc,
	}
}

type CreateDatabaseInput struct {
	PageID       *string `json:"page_id"`
	ParentPageID *string `json:"parent_page_id"`
	Title        string  `json:"title"`
	Icon         string  `json:"icon"`
	Description  string  `json:"description"`
	IsInline     bool    `json:"is_inline"`
}

func defaultSchema() []models.PropertySchema {
	return []models.PropertySchema{
		{ID: "prop_title", Name: "名称", Type: "title", Width: 240},
		{
			ID:    "prop_status",
			Name:  "状态",
			Type:  "select",
			Width: 130,
			Options: []models.PropertyOption{
				{ID: "opt_todo", Name: "待处理", Color: "gray"},
				{ID: "opt_doing", Name: "进行中", Color: "blue"},
				{ID: "opt_done", Name: "已完成", Color: "green"},
			},
		},
		{
			ID:    "prop_tags",
			Name:  "标签",
			Type:  "multi_select",
			Width: 180,
			Options: []models.PropertyOption{
				{ID: "opt_imp", Name: "重要", Color: "red"},
				{ID: "opt_doc", Name: "文档", Color: "purple"},
				{ID: "opt_ai", Name: "AI", Color: "cyan"},
			},
		},
		{ID: "prop_date", Name: "日期", Type: "date", Width: 140},
		{
			ID:    "prop_priority",
			Name:  "优先级",
			Type:  "select",
			Width: 110,
			Options: []models.PropertyOption{
				{ID: "opt_hi", Name: "高", Color: "red"},
				{ID: "opt_mid", Name: "中", Color: "orange"},
				{ID: "opt_low", Name: "低", Color: "gray"},
			},
		},
	}
}

func (s *DatabaseService) CreateDatabase(in CreateDatabaseInput) (*models.Database, error) {
	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = "未命名数据库"
	}
	icon := strings.TrimSpace(in.Icon)
	if icon == "" {
		icon = "🗃️"
	}

	pageID := in.PageID
	if !in.IsInline && pageID == nil {
		page, err := s.pageSvc.CreatePage(CreatePageInput{
			ParentID:    in.ParentPageID,
			Title:       title,
			Icon:        icon,
			IsDatabase:  true,
			IsFullWidth: true,
		})
		if err != nil {
			return nil, err
		}
		pageID = &page.ID
	}

	id := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	schema := defaultSchema()
	schemaBytes, _ := json.Marshal(schema)

	isInlineInt := 0
	if in.IsInline {
		isInlineInt = 1
	}

	_, err := s.store.DB().Exec(`
		INSERT INTO databases (id, page_id, title, icon, description, is_inline, schema_json, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, pageID, title, icon, in.Description, isInlineInt, string(schemaBytes), now, now)
	if err != nil {
		return nil, err
	}

	views := []struct {
		name string
		typ  string
		cfg  map[string]any
		pos  float64
	}{
		{"表格视图", "table", map[string]any{"hidden_properties": []string{}}, 1000},
		{"看板视图", "kanban", map[string]any{"group_by": "prop_status"}, 2000},
		{"日历视图", "calendar", map[string]any{"date_property": "prop_date"}, 3000},
		{"画廊视图", "gallery", map[string]any{"card_size": "medium", "show_properties": []string{"prop_status", "prop_tags", "prop_date"}}, 4000},
	}

	for _, v := range views {
		cfgBytes, _ := json.Marshal(v.cfg)
		_, _ = s.store.DB().Exec(`
			INSERT INTO database_views (id, database_id, name, type, config_json, position, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			uuid.NewString(), id, v.name, v.typ, string(cfgBytes), v.pos, now, now)
	}

	return s.GetDatabase(id)
}

func (s *DatabaseService) GetDatabase(id string) (*models.Database, error) {
	var d models.Database
	var pageID sql.NullString
	var isInline int
	var schemaStr string
	err := s.store.DB().QueryRow(`
		SELECT id, page_id, title, icon, description, is_inline, schema_json, created_at, updated_at
		FROM databases WHERE id = ?`, id).
		Scan(&d.ID, &pageID, &d.Title, &d.Icon, &d.Description, &isInline, &schemaStr, &d.CreatedAt, &d.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if pageID.Valid {
		d.PageID = &pageID.String
	}
	d.IsInline = isInline == 1
	_ = json.Unmarshal([]byte(schemaStr), &d.Schema)
	if d.Schema == nil {
		d.Schema = []models.PropertySchema{}
	}
	views, err := s.ListViews(id)
	if err == nil {
		d.Views = views
	}
	return &d, nil
}

func (s *DatabaseService) GetDatabaseByPageID(pageID string) (*models.Database, error) {
	var id string
	err := s.store.DB().QueryRow(`SELECT id FROM databases WHERE page_id = ? AND is_inline = 0 LIMIT 1`, pageID).Scan(&id)
	if err != nil {
		return nil, err
	}
	return s.GetDatabase(id)
}

func (s *DatabaseService) ListDatabases() ([]models.Database, error) {
	rows, err := s.store.DB().Query(`
		SELECT d.id, d.page_id, d.title, d.icon, d.description, d.is_inline, d.schema_json, d.created_at, d.updated_at
		FROM databases d
		LEFT JOIN pages p ON p.id = d.page_id
		WHERE p.id IS NULL OR p.is_trashed = 0
		ORDER BY d.updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []models.Database
	for rows.Next() {
		var d models.Database
		var pageID sql.NullString
		var isInline int
		var schemaStr string
		if err := rows.Scan(&d.ID, &pageID, &d.Title, &d.Icon, &d.Description, &isInline, &schemaStr, &d.CreatedAt, &d.UpdatedAt); err != nil {
			return nil, err
		}
		if pageID.Valid {
			d.PageID = &pageID.String
		}
		d.IsInline = isInline == 1
		_ = json.Unmarshal([]byte(schemaStr), &d.Schema)
		list = append(list, d)
	}
	if list == nil {
		list = []models.Database{}
	}
	return list, nil
}

func (s *DatabaseService) GetDatabaseFull(id string) (*models.DatabaseFull, error) {
	dbMeta, err := s.GetDatabase(id)
	if err != nil {
		return nil, err
	}
	views, err := s.ListViews(id)
	if err != nil {
		return nil, err
	}
	rows, err := s.ListRows(id)
	if err != nil {
		return nil, err
	}
	return &models.DatabaseFull{
		Database: *dbMeta,
		Views:    views,
		Rows:     rows,
	}, nil
}

func (s *DatabaseService) UpdateDatabaseMeta(id string, title, icon, description *string) (*models.Database, error) {
	d, err := s.GetDatabase(id)
	if err != nil {
		return nil, err
	}
	newTitle := d.Title
	if title != nil && strings.TrimSpace(*title) != "" {
		newTitle = strings.TrimSpace(*title)
	}
	newIcon := d.Icon
	if icon != nil {
		newIcon = *icon
	}
	newDesc := d.Description
	if description != nil {
		newDesc = *description
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err = s.store.DB().Exec(`UPDATE databases SET title = ?, icon = ?, description = ?, updated_at = ? WHERE id = ?`,
		newTitle, newIcon, newDesc, now, id)
	if err != nil {
		return nil, err
	}
	if !d.IsInline && d.PageID != nil {
		_, _ = s.store.DB().Exec(`UPDATE pages SET title = ?, icon = ?, updated_at = ? WHERE id = ?`, newTitle, newIcon, now, *d.PageID)
	}
	return s.GetDatabase(id)
}

// UpdateSchema updates the database property schema and maintains two-way relation columns automatically.
func (s *DatabaseService) UpdateSchema(id string, newSchema []models.PropertySchema) (*models.Database, error) {
	existing, err := s.GetDatabase(id)
	if err != nil {
		return nil, err
	}

	oldMap := make(map[string]models.PropertySchema)
	for _, prop := range existing.Schema {
		oldMap[prop.ID] = prop
	}
	newMap := make(map[string]models.PropertySchema)
	for i := range newSchema {
		if newSchema[i].ID == "" {
			newSchema[i].ID = "prop_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:10]
		}
		newMap[newSchema[i].ID] = newSchema[i]
	}

	tx, err := s.store.DB().Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// 1. Handle removed two-way relations -> remove synced column on target DB
	for _, oldProp := range existing.Schema {
		if oldProp.Type == "relation" && oldProp.IsTwoWay && oldProp.SyncedPropertyID != "" && oldProp.RelationDatabaseID != "" {
			stillTwoWay := false
			if cur, ok := newMap[oldProp.ID]; ok && cur.Type == "relation" && cur.IsTwoWay && cur.RelationDatabaseID == oldProp.RelationDatabaseID {
				stillTwoWay = true
			}
			if !stillTwoWay {
				if err := removeSyncedPropertyTx(tx, oldProp.RelationDatabaseID, oldProp.SyncedPropertyID); err != nil {
					return nil, err
				}
			}
		}
	}

	// 2. Handle newly enabled two-way relations -> add synced column on target DB
	for i := range newSchema {
		p := &newSchema[i]
		if p.Type == "relation" && p.RelationDatabaseID != "" {
			if p.IsTwoWay && p.SyncedPropertyID == "" {
				syncedID := "prop_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:10]
				p.SyncedPropertyID = syncedID
				reverseName := existing.Title + " 关联"
				if p.RelationDatabaseID == id {
					reverseName = p.Name + " (反向)"
				}
				reverseProp := models.PropertySchema{
					ID:                 syncedID,
					Name:               reverseName,
					Type:               "relation",
					Width:              180,
					RelationDatabaseID: id,
					SyncedPropertyID:   p.ID,
					IsTwoWay:           true,
				}
				if p.RelationDatabaseID == id {
					newSchema = append(newSchema, reverseProp)
				} else {
					if err := addSyncedPropertyTx(tx, p.RelationDatabaseID, reverseProp); err != nil {
						return nil, err
					}
				}
			} else if !p.IsTwoWay {
				p.SyncedPropertyID = ""
			}
		}
	}

	schemaBytes, _ := json.Marshal(newSchema)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := tx.Exec(`UPDATE databases SET schema_json = ?, updated_at = ? WHERE id = ?`, string(schemaBytes), now, id); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetDatabase(id)
}

func addSyncedPropertyTx(tx *sql.Tx, targetDBID string, prop models.PropertySchema) error {
	var schemaStr string
	if err := tx.QueryRow(`SELECT schema_json FROM databases WHERE id = ?`, targetDBID).Scan(&schemaStr); err != nil {
		return err
	}
	var schema []models.PropertySchema
	_ = json.Unmarshal([]byte(schemaStr), &schema)
	for _, existing := range schema {
		if existing.ID == prop.ID {
			return nil
		}
	}
	schema = append(schema, prop)
	updated, _ := json.Marshal(schema)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := tx.Exec(`UPDATE databases SET schema_json = ?, updated_at = ? WHERE id = ?`, string(updated), now, targetDBID)
	return err
}

func removeSyncedPropertyTx(tx *sql.Tx, targetDBID, syncedPropID string) error {
	var schemaStr string
	if err := tx.QueryRow(`SELECT schema_json FROM databases WHERE id = ?`, targetDBID).Scan(&schemaStr); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	var schema []models.PropertySchema
	_ = json.Unmarshal([]byte(schemaStr), &schema)
	var filtered []models.PropertySchema
	for _, p := range schema {
		if p.ID != syncedPropID {
			filtered = append(filtered, p)
		}
	}
	updated, _ := json.Marshal(filtered)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := tx.Exec(`UPDATE databases SET schema_json = ?, updated_at = ? WHERE id = ?`, string(updated), now, targetDBID)
	return err
}

func (s *DatabaseService) ListViews(dbID string) ([]models.DatabaseView, error) {
	rows, err := s.store.DB().Query(`
		SELECT id, database_id, name, type, config_json, position, created_at, updated_at
		FROM database_views WHERE database_id = ? ORDER BY position ASC, created_at ASC`, dbID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []models.DatabaseView
	for rows.Next() {
		var v models.DatabaseView
		var cfgStr string
		if err := rows.Scan(&v.ID, &v.DatabaseID, &v.Name, &v.Type, &cfgStr, &v.Position, &v.CreatedAt, &v.UpdatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(cfgStr), &v.Config)
		if v.Config == nil {
			v.Config = map[string]any{}
		}
		list = append(list, v)
	}
	if list == nil {
		list = []models.DatabaseView{}
	}
	return list, nil
}

func (s *DatabaseService) CreateView(dbID, name, viewType string, config map[string]any) (*models.DatabaseView, error) {
	if strings.TrimSpace(name) == "" {
		name = "新视图"
	}
	if viewType == "" {
		viewType = "table"
	}
	if config == nil {
		config = map[string]any{}
	}
	var maxPos sql.NullFloat64
	_ = s.store.DB().QueryRow(`SELECT MAX(position) FROM database_views WHERE database_id = ?`, dbID).Scan(&maxPos)
	pos := 1000.0
	if maxPos.Valid {
		pos = maxPos.Float64 + 1000.0
	}
	id := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	cfgBytes, _ := json.Marshal(config)
	_, err := s.store.DB().Exec(`
		INSERT INTO database_views (id, database_id, name, type, config_json, position, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id, dbID, name, viewType, string(cfgBytes), pos, now, now)
	if err != nil {
		return nil, err
	}
	return &models.DatabaseView{
		ID:         id,
		DatabaseID: dbID,
		Name:       name,
		Type:       viewType,
		Config:     config,
		Position:   pos,
		CreatedAt:  now,
		UpdatedAt:  now,
	}, nil
}

func (s *DatabaseService) UpdateView(viewID string, name, viewType *string, config map[string]any) (*models.DatabaseView, error) {
	var v models.DatabaseView
	var cfgStr string
	err := s.store.DB().QueryRow(`SELECT id, database_id, name, type, config_json, position, created_at, updated_at FROM database_views WHERE id = ?`, viewID).
		Scan(&v.ID, &v.DatabaseID, &v.Name, &v.Type, &cfgStr, &v.Position, &v.CreatedAt, &v.UpdatedAt)
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(cfgStr), &v.Config)
	if v.Config == nil {
		v.Config = map[string]any{}
	}
	if name != nil && strings.TrimSpace(*name) != "" {
		v.Name = strings.TrimSpace(*name)
	}
	if viewType != nil && *viewType != "" {
		v.Type = *viewType
	}
	if config != nil {
		v.Config = config
	}
	v.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	cfgBytes, _ := json.Marshal(v.Config)
	_, err = s.store.DB().Exec(`UPDATE database_views SET name = ?, type = ?, config_json = ?, updated_at = ? WHERE id = ?`,
		v.Name, v.Type, string(cfgBytes), v.UpdatedAt, viewID)
	if err != nil {
		return nil, err
	}
	return &v, nil
}

func (s *DatabaseService) DeleteView(viewID string) error {
	_, err := s.store.DB().Exec(`DELETE FROM database_views WHERE id = ?`, viewID)
	return err
}

func (s *DatabaseService) ListRows(dbID string) ([]models.Page, error) {
	rows, err := s.store.DB().Query(`
		SELECT id, parent_id, database_id, title, icon, cover_url, is_database,
		       content_json, plain_text, summary, tags_json, properties_json,
		       position, is_favorite, is_full_width, is_trashed, trashed_at, created_at, updated_at
		FROM pages WHERE database_id = ? AND is_trashed = 0
		ORDER BY position ASC, created_at ASC`, dbID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []models.Page
	for rows.Next() {
		p, err := scanPage(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, *p)
	}
	if list == nil {
		list = []models.Page{}
	}
	return list, nil
}

func (s *DatabaseService) CreateRow(dbID, title string, props map[string]any) (*models.Page, error) {
	dbMeta, err := s.GetDatabase(dbID)
	if err != nil {
		return nil, err
	}
	if props == nil {
		props = map[string]any{}
	}

	titlePropID := findTitlePropID(dbMeta.Schema)
	cleanTitle := strings.TrimSpace(title)
	if cleanTitle == "" {
		if t, ok := props[titlePropID].(string); ok && strings.TrimSpace(t) != "" {
			cleanTitle = strings.TrimSpace(t)
		} else {
			cleanTitle = "未命名条目"
		}
	}
	props[titlePropID] = cleanTitle

	rowPage, err := s.pageSvc.CreatePage(CreatePageInput{
		DatabaseID: &dbID,
		Title:      cleanTitle,
		Icon:       "📄",
		Properties: props,
	})
	if err != nil {
		return nil, err
	}

	if err := s.syncTwoWayRelations(dbMeta, rowPage.ID, map[string]any{}, props); err != nil {
		return nil, err
	}
	return s.pageSvc.GetPage(rowPage.ID)
}

func (s *DatabaseService) UpdateRow(dbID, rowID string, title *string, props map[string]any) (*models.Page, error) {
	dbMeta, err := s.GetDatabase(dbID)
	if err != nil {
		return nil, err
	}
	existing, err := s.pageSvc.GetPage(rowID)
	if err != nil {
		return nil, err
	}
	if existing.DatabaseID == nil || *existing.DatabaseID != dbID {
		return nil, errors.New("row does not belong to this database")
	}

	oldProps := cloneMap(existing.Properties)
	mergedProps := cloneMap(existing.Properties)
	for k, v := range props {
		mergedProps[k] = v
	}

	titlePropID := findTitlePropID(dbMeta.Schema)
	finalTitle := existing.Title
	if title != nil {
		finalTitle = strings.TrimSpace(*title)
		if finalTitle == "" {
			finalTitle = "无标题"
		}
		mergedProps[titlePropID] = finalTitle
	} else if t, ok := props[titlePropID].(string); ok {
		finalTitle = strings.TrimSpace(t)
		if finalTitle == "" {
			finalTitle = "无标题"
		}
	}

	updated, err := s.pageSvc.UpdatePage(rowID, UpdatePageInput{
		Title:      &finalTitle,
		Properties: mergedProps,
	})
	if err != nil {
		return nil, err
	}

	if err := s.syncTwoWayRelations(dbMeta, rowID, oldProps, mergedProps); err != nil {
		return nil, err
	}
	return updated, nil
}

func (s *DatabaseService) DeleteRow(dbID, rowID string) error {
	dbMeta, err := s.GetDatabase(dbID)
	if err != nil {
		return err
	}
	existing, err := s.pageSvc.GetPage(rowID)
	if err != nil {
		return err
	}
	// Clear two-way relations pointing to this row before trashing
	emptyProps := cloneMap(existing.Properties)
	for _, prop := range dbMeta.Schema {
		if prop.Type == "relation" {
			emptyProps[prop.ID] = []string{}
		}
	}
	_ = s.syncTwoWayRelations(dbMeta, rowID, existing.Properties, emptyProps)
	return s.pageSvc.SoftDelete(rowID)
}

// syncTwoWayRelations computes added/removed links for two-way relation properties and updates
// target rows atomically in a transaction without triggering recursive updates.
func (s *DatabaseService) syncTwoWayRelations(dbMeta *models.Database, rowID string, oldProps, newProps map[string]any) error {
	var relationProps []models.PropertySchema
	for _, p := range dbMeta.Schema {
		if p.Type == "relation" && p.IsTwoWay && p.SyncedPropertyID != "" {
			relationProps = append(relationProps, p)
		}
	}
	if len(relationProps) == 0 {
		return nil
	}

	tx, err := s.store.DB().Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	now := time.Now().UTC().Format(time.RFC3339Nano)
	for _, p := range relationProps {
		oldSet := toStringSet(oldProps[p.ID])
		newSet := toStringSet(newProps[p.ID])

		for targetID := range newSet {
			if !oldSet[targetID] {
				if targetID == rowID && p.SyncedPropertyID == p.ID {
					continue
				}
				if err := mutateTargetRelationTx(tx, targetID, p.SyncedPropertyID, rowID, true, now); err != nil {
					return err
				}
			}
		}
		for targetID := range oldSet {
			if !newSet[targetID] {
				if err := mutateTargetRelationTx(tx, targetID, p.SyncedPropertyID, rowID, false, now); err != nil {
					return err
				}
			}
		}
	}
	return tx.Commit()
}

func mutateTargetRelationTx(tx *sql.Tx, targetRowID, targetPropID, linkedRowID string, add bool, now string) error {
	var propsStr string
	if err := tx.QueryRow(`SELECT properties_json FROM pages WHERE id = ? AND is_trashed = 0`, targetRowID).Scan(&propsStr); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	var props map[string]any
	_ = json.Unmarshal([]byte(propsStr), &props)
	if props == nil {
		props = map[string]any{}
	}

	cur := toStringSlice(props[targetPropID])
	if add {
		found := false
		for _, id := range cur {
			if id == linkedRowID {
				found = true
				break
			}
		}
		if !found {
			cur = append(cur, linkedRowID)
		}
	} else {
		filtered := make([]string, 0, len(cur))
		for _, id := range cur {
			if id != linkedRowID {
				filtered = append(filtered, id)
			}
		}
		cur = filtered
	}
	props[targetPropID] = cur
	encoded, _ := json.Marshal(props)
	_, err := tx.Exec(`UPDATE pages SET properties_json = ?, updated_at = ? WHERE id = ?`, string(encoded), now, targetRowID)
	return err
}

func findTitlePropID(schema []models.PropertySchema) string {
	for _, p := range schema {
		if p.Type == "title" {
			return p.ID
		}
	}
	return "prop_title"
}

func toStringSlice(val any) []string {
	if val == nil {
		return nil
	}
	switch v := val.(type) {
	case []string:
		return append([]string{}, v...)
	case []any:
		res := make([]string, 0, len(v))
		for _, item := range v {
			if str, ok := item.(string); ok && str != "" {
				res = append(res, str)
			}
		}
		return res
	}
	return nil
}

func toStringSet(val any) map[string]bool {
	res := make(map[string]bool)
	for _, s := range toStringSlice(val) {
		res[s] = true
	}
	return res
}

func cloneMap(in map[string]any) map[string]any {
	out := make(map[string]any, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}
