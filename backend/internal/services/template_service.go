package services

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	"woqu/backend/internal/db"
	"woqu/backend/internal/models"
)

type TemplateService struct {
	store   *db.Store
	pageSvc *PageService
}

func NewTemplateService(store *db.Store, pageSvc *PageService) *TemplateService {
	svc := &TemplateService{store: store, pageSvc: pageSvc}
	svc.seedBuiltinTemplates()
	return svc
}

func (s *TemplateService) seedBuiltinTemplates() {
	var count int
	if err := s.store.DB().QueryRow(`SELECT count(*) FROM templates WHERE is_builtin = 1`).Scan(&count); err == nil && count > 0 {
		return
	}

	builtins := []struct {
		id, name, category, icon, desc, md string
	}{
		{
			id:       "tpl_meeting",
			name:     "高效会议纪要",
			category: "工作协作",
			icon:     "🗓️",
			desc:     "包含参会人员、议程讨论、核心决议与可追踪待办事项",
			md:       "## 会议基本信息\n\n- **时间**：\n- **参会人**：\n- **会议主题**：\n\n## 讨论议题与核心结论\n\n1. **议题一**：\n2. **议题二**：\n\n## 行动项与负责人 (Action Items)\n\n- [ ] 待办任务 1 — @负责人\n- [ ] 待办任务 2 — @负责人\n",
		},
		{
			id:       "tpl_weekly",
			name:     "个人工作周报",
			category: "个人复盘",
			icon:     "📊",
			desc:     "结构化总结本周关键产出、遇到阻塞与下周重点规划",
			md:       "## 本周核心产出\n\n- 完成事项 A（结果与量化指标）\n- 推进事项 B\n\n## 问题与风险思考\n\n> 记录本周遇到的卡点、根因与需要的协同资源。\n\n## 下周重点计划\n\n- [ ] 下周目标 1\n- [ ] 下周目标 2\n",
		},
		{
			id:       "tpl_reading",
			name:     "深度读书笔记",
			category: "知识沉淀",
			icon:     "📚",
			desc:     "记录书籍元数据、一句话总结、金句摘录与行动启发",
			md:       "## 书籍档案\n\n- **作者**：\n- **评分**：⭐⭐⭐⭐⭐\n- **阅读日期**：\n\n## 一句话核心收获\n\n> 用自己的话提炼本书最颠覆认知的一条观点。\n\n## 章节笔记与金句摘录\n\n- 关键概念：\n\n## 落地行动清单\n\n- [ ] 将书中方法应用到实际工作中\n",
		},
		{
			id:       "tpl_project",
			name:     "项目推进方案 (PRD)",
			category: "产品研发",
			icon:     "🚀",
			desc:     "明确项目背景、目标指标、方案设计与里程碑排期",
			md:       "## 一、背景与目标\n\n阐述要解决的核心痛点及预期业务/效率收益。\n\n## 二、核心方案设计\n\n| 模块 | 职责说明 | 优先级 |\n| --- | --- | --- |\n| 核心模块 A | 描述功能边界 | P0 |\n| 扩展模块 B | 描述衍生能力 | P1 |\n\n## 三、里程碑与验收标准\n\n- [ ] M1：完成技术架构评审\n- [ ] M2：核心链路联调上线\n",
		},
		{
			id:       "tpl_okr",
			name:     "季度 OKR 目标复盘",
			category: "目标管理",
			icon:     "🎯",
			desc:     "对齐目标 Objective 与可量化关键结果 Key Results",
			md:       "## Objective 1：核心目标描述\n\n- **KR1**：量化指标从 X 提升至 Y（当前进度：0%）\n- **KR2**：按期交付核心里程碑\n\n## 复盘与策略调整\n\n### 做得好的地方\n- \n\n### 待改进项\n- \n",
		},
	}

	now := time.Now().UTC().Format(time.RFC3339)
	for _, b := range builtins {
		content := MarkdownToTipTap(b.md)
		_, _ = s.store.DB().Exec(`
			INSERT OR IGNORE INTO templates (id, name, category, icon, description, content_json, is_builtin, created_at)
			VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
			b.id, b.name, b.category, b.icon, b.desc, string(content), now)
	}
}

func (s *TemplateService) ListTemplates() ([]models.Template, error) {
	rows, err := s.store.DB().Query(`
		SELECT id, name, category, icon, description, content_json, is_builtin, created_at
		FROM templates ORDER BY is_builtin DESC, created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []models.Template
	for rows.Next() {
		var t models.Template
		var contentStr string
		var isB int
		if err := rows.Scan(&t.ID, &t.Name, &t.Category, &t.Icon, &t.Description, &contentStr, &isB, &t.CreatedAt); err != nil {
			return nil, err
		}
		t.ContentJSON = json.RawMessage(contentStr)
		t.IsBuiltin = isB == 1
		list = append(list, t)
	}
	if list == nil {
		list = []models.Template{}
	}
	return list, nil
}

func (s *TemplateService) SavePageAsTemplate(pageID, name, category, icon, desc string) (*models.Template, error) {
	p, err := s.pageSvc.GetPage(pageID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(name) == "" {
		name = p.Title + " 模板"
	}
	if strings.TrimSpace(category) == "" {
		category = "自定义"
	}
	if strings.TrimSpace(icon) == "" {
		icon = p.Icon
		if icon == "" {
			icon = "📄"
		}
	}
	id := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339)
	_, err = s.store.DB().Exec(`
		INSERT INTO templates (id, name, category, icon, description, content_json, is_builtin, created_at)
		VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
		id, strings.TrimSpace(name), strings.TrimSpace(category), icon, desc, string(p.ContentJSON), now)
	if err != nil {
		return nil, err
	}
	return &models.Template{
		ID:          id,
		Name:        strings.TrimSpace(name),
		Category:    strings.TrimSpace(category),
		Icon:        icon,
		Description: desc,
		ContentJSON: p.ContentJSON,
		IsBuiltin:   false,
		CreatedAt:   now,
	}, nil
}

func (s *TemplateService) InstantiateTemplate(templateID string, parentID *string) (*models.Page, error) {
	var name, icon, contentStr string
	err := s.store.DB().QueryRow(`SELECT name, icon, content_json FROM templates WHERE id = ?`, templateID).
		Scan(&name, &icon, &contentStr)
	if err != nil {
		return nil, errors.New("模板不存在")
	}
	return s.pageSvc.CreatePage(CreatePageInput{
		ParentID:    parentID,
		Title:       name,
		Icon:        icon,
		ContentJSON: json.RawMessage(contentStr),
	})
}

func (s *TemplateService) DeleteTemplate(id string) error {
	res, err := s.store.DB().Exec(`DELETE FROM templates WHERE id = ? AND is_builtin = 0`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return errors.New("内置模板不可删除或模板不存在")
	}
	return nil
}
