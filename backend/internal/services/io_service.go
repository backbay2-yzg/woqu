package services

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/url"
	"path"
	"regexp"
	"strings"

	"woqu/backend/internal/models"
)

type IOService struct {
	pageSvc  *PageService
	dbSvc    *DatabaseService
	assetSvc *AssetService
}

func NewIOService(pageSvc *PageService, dbSvc *DatabaseService, assetSvc *AssetService) *IOService {
	return &IOService{
		pageSvc:  pageSvc,
		dbSvc:    dbSvc,
		assetSvc: assetSvc,
	}
}

type ImportedFile struct {
	Filename string
	Content  string
}

type ImportSummary struct {
	PagesCreated     int      `json:"pages_created"`
	DatabasesCreated int      `json:"databases_created"`
	AssetsImported   int      `json:"assets_imported"`
	PageIDs          []string `json:"page_ids"`
}

func (s *IOService) ExportPageMarkdown(pageID string) (string, string, error) {
	p, err := s.pageSvc.GetPage(pageID)
	if err != nil {
		return "", "", err
	}
	var b strings.Builder
	if p.Summary != "" || len(p.Tags) > 0 {
		b.WriteString("---\n")
		b.WriteString("title: " + p.Title + "\n")
		if len(p.Tags) > 0 {
			b.WriteString("tags: [" + strings.Join(p.Tags, ", ") + "]\n")
		}
		if p.Summary != "" {
			b.WriteString("summary: " + strings.ReplaceAll(p.Summary, "\n", " ") + "\n")
		}
		b.WriteString("---\n\n")
	}
	b.WriteString(TipTapToMarkdown(p.Title, p.ContentJSON))

	// If standalone database page, also export rows as a Markdown table
	if p.IsDatabase {
		if dbMeta, err := s.dbSvc.GetDatabaseByPageID(p.ID); err == nil {
			if rows, err := s.dbSvc.ListRows(dbMeta.ID); err == nil && len(dbMeta.Schema) > 0 {
				b.WriteString("\n## 数据表内容\n\n| ")
				for _, col := range dbMeta.Schema {
					b.WriteString(col.Name + " | ")
				}
				b.WriteString("\n| ")
				for range dbMeta.Schema {
					b.WriteString("--- | ")
				}
				b.WriteString("\n")
				for _, r := range rows {
					b.WriteString("| ")
					for _, col := range dbMeta.Schema {
						val := r.Properties[col.ID]
						if col.Type == "title" && (val == nil || val == "") {
							val = r.Title
						}
						cell := strings.ReplaceAll(fmt.Sprint(val), "|", "\\|")
						if val == nil {
							cell = ""
						}
						b.WriteString(cell + " | ")
					}
					b.WriteString("\n")
				}
			}
		}
	}

	filename := sanitizeFilename(p.Title) + ".md"
	return filename, b.String(), nil
}

func (s *IOService) ExportPageHTML(pageID string) (string, string, error) {
	p, err := s.pageSvc.GetPage(pageID)
	if err != nil {
		return "", "", err
	}
	root, _ := ParseTipTapDoc(p.ContentJSON)
	var bodyBuf strings.Builder
	for _, n := range root.Content {
		bodyBuf.WriteString(nodeToHTML(n))
	}

	escapedTitle := html.EscapeString(p.Title)
	docHTML := fmt.Sprintf(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>%s</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f2329; background: #ffffff; line-height: 1.75; margin: 0; padding: 48px 20px; }
  main { max-width: 820px; margin: 0 auto; }
  h1.doc-title { font-size: 2.2rem; margin: 0 0 1.2rem; line-height: 1.3; }
  h1, h2, h3 { margin-top: 1.6em; margin-bottom: 0.6em; font-weight: 600; }
  p { margin: 0.7em 0; }
  blockquote { border-left: 4px solid #3b82f6; margin: 1em 0; padding: 0.4em 1em; background: #f8fafc; color: #475569; }
  .callout { display: flex; gap: 10px; padding: 14px 16px; border-radius: 8px; background: #eff6ff; border: 1px solid #dbeafe; margin: 1em 0; }
  pre { background: #1e293b; color: #f8fafc; padding: 14px 16px; border-radius: 8px; overflow-x: auto; font-size: 0.9em; }
  code { background: #f1f5f9; padding: 2px 5px; border-radius: 4px; font-family: ui-monospace, monospace; font-size: 0.9em; }
  pre code { background: none; padding: 0; color: inherit; }
  table { border-collapse: collapse; width: 100%%; margin: 1em 0; }
  th, td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }
  th { background: #f8fafc; font-weight: 600; }
  img { max-width: 100%%; border-radius: 8px; }
  hr { border: none; border-top: 1px solid #e2e8f0; margin: 1.8em 0; }
</style>
</head>
<body>
<main>
  <h1 class="doc-title">%s %s</h1>
  %s
</main>
</body>
</html>`, escapedTitle, html.EscapeString(p.Icon), escapedTitle, bodyBuf.String())

	return sanitizeFilename(p.Title) + ".html", docHTML, nil
}

func nodeToHTML(n TipTapNode) string {
	switch n.Type {
	case "paragraph":
		return "<p>" + inlineToHTML(n.Content) + "</p>\n"
	case "heading":
		lvl := 2
		if l, ok := n.Attrs["level"].(float64); ok && l >= 1 && l <= 6 {
			lvl = int(l)
		}
		return fmt.Sprintf("<h%d>%s</h%d>\n", lvl, inlineToHTML(n.Content), lvl)
	case "bulletList":
		var b strings.Builder
		b.WriteString("<ul>\n")
		for _, item := range n.Content {
			b.WriteString("<li>" + childrenToHTML(item.Content) + "</li>\n")
		}
		b.WriteString("</ul>\n")
		return b.String()
	case "orderedList":
		var b strings.Builder
		b.WriteString("<ol>\n")
		for _, item := range n.Content {
			b.WriteString("<li>" + childrenToHTML(item.Content) + "</li>\n")
		}
		b.WriteString("</ol>\n")
		return b.String()
	case "taskList":
		var b strings.Builder
		b.WriteString("<ul style=\"list-style:none;padding-left:6px;\">\n")
		for _, item := range n.Content {
			checked, _ := item.Attrs["checked"].(bool)
			mark := "☐"
			if checked {
				mark = "☑"
			}
			b.WriteString("<li>" + mark + " " + childrenToHTML(item.Content) + "</li>\n")
		}
		b.WriteString("</ul>\n")
		return b.String()
	case "blockquote":
		return "<blockquote>" + childrenToHTML(n.Content) + "</blockquote>\n"
	case "callout":
		icon := html.EscapeString(getStrAttr(n.Attrs, "icon"))
		return fmt.Sprintf("<div class=\"callout\"><span>%s</span><div>%s</div></div>\n", icon, childrenToHTML(n.Content))
	case "toggle":
		return fmt.Sprintf("<details><summary>%s</summary>%s</details>\n", html.EscapeString(getStrAttr(n.Attrs, "summary")), childrenToHTML(n.Content))
	case "codeBlock":
		return "<pre><code>" + html.EscapeString(inlineToMarkdown(n.Content)) + "</code></pre>\n"
	case "horizontalRule":
		return "<hr />\n"
	case "image":
		return fmt.Sprintf("<p><img src=\"%s\" alt=\"%s\" /></p>\n", html.EscapeString(getStrAttr(n.Attrs, "src")), html.EscapeString(getStrAttr(n.Attrs, "alt")))
	case "bookmark":
		u := html.EscapeString(getStrAttr(n.Attrs, "url"))
		t := html.EscapeString(getStrAttr(n.Attrs, "title"))
		return fmt.Sprintf("<p><a href=\"%s\">🔗 %s</a></p>\n", u, t)
	case "table":
		var b strings.Builder
		b.WriteString("<table>\n")
		for _, row := range n.Content {
			b.WriteString("<tr>")
			for _, cell := range row.Content {
				tag := "td"
				if cell.Type == "tableHeader" {
					tag = "th"
				}
				b.WriteString("<" + tag + ">" + childrenToHTML(cell.Content) + "</" + tag + ">")
			}
			b.WriteString("</tr>\n")
		}
		b.WriteString("</table>\n")
		return b.String()
	}
	return childrenToHTML(n.Content)
}

func childrenToHTML(nodes []TipTapNode) string {
	var b strings.Builder
	for _, n := range nodes {
		b.WriteString(nodeToHTML(n))
	}
	return b.String()
}

func inlineToHTML(nodes []TipTapNode) string {
	var b strings.Builder
	for _, n := range nodes {
		switch n.Type {
		case "text":
			txt := html.EscapeString(n.Text)
			for _, m := range n.Marks {
				switch m.Type {
				case "bold":
					txt = "<strong>" + txt + "</strong>"
				case "italic":
					txt = "<em>" + txt + "</em>"
				case "strike":
					txt = "<del>" + txt + "</del>"
				case "underline":
					txt = "<u>" + txt + "</u>"
				case "code":
					txt = "<code>" + txt + "</code>"
				case "link":
					txt = fmt.Sprintf(`<a href="%s">%s</a>`, html.EscapeString(getStrAttr(m.Attrs, "href")), txt)
				}
			}
			b.WriteString(txt)
		case "hardBreak":
			b.WriteString("<br />")
		case "pageMention":
			b.WriteString("<span>[[" + html.EscapeString(getStrAttr(n.Attrs, "label", "title")) + "]]</span>")
		case "mathInline":
			b.WriteString("<code>" + html.EscapeString(getStrAttr(n.Attrs, "latex")) + "</code>")
		}
	}
	return b.String()
}

func (s *IOService) ImportMarkdownFiles(files []ImportedFile, parentID *string) (*ImportSummary, error) {
	summary := &ImportSummary{}
	for _, f := range files {
		title := strings.TrimSuffix(path.Base(strings.ReplaceAll(f.Filename, "\\", "/")), ".md")
		title = strings.TrimSuffix(title, ".markdown")
		if strings.TrimSpace(title) == "" {
			title = "导入文档"
		}
		content := strings.TrimSpace(f.Content)
		// Strip optional leading "# Title" if matching filename
		lines := strings.Split(content, "\n")
		if len(lines) > 0 && strings.HasPrefix(lines[0], "# ") {
			firstTitle := strings.TrimSpace(strings.TrimPrefix(lines[0], "# "))
			if firstTitle != "" {
				title = firstTitle
				content = strings.Join(lines[1:], "\n")
			}
		}
		doc := MarkdownToTipTap(content)
		p, err := s.pageSvc.CreatePage(CreatePageInput{
			ParentID:    parentID,
			Title:       title,
			Icon:        "📄",
			ContentJSON: doc,
		})
		if err == nil {
			summary.PagesCreated++
			summary.PageIDs = append(summary.PageIDs, p.ID)
		}
	}
	return summary, nil
}

var notionHexSuffixRe = regexp.MustCompile(`\s+[0-9a-fA-F]{32}$`)

func cleanNotionName(name string) string {
	ext := path.Ext(name)
	base := strings.TrimSuffix(name, ext)
	cleaned := notionHexSuffixRe.ReplaceAllString(base, "")
	cleaned = strings.TrimSpace(cleaned)
	if cleaned == "" {
		cleaned = base
	}
	return cleaned
}

// ImportNotionZip imports a Notion Markdown/CSV export archive, reconstructing hierarchy, assets, databases, and links.
func (s *IOService) ImportNotionZip(r io.ReaderAt, size int64, parentID *string) (*ImportSummary, error) {
	zr, err := zip.NewReader(r, size)
	if err != nil {
		return nil, fmt.Errorf("无法解析 Zip 文件: %w", err)
	}

	// Unwrap nested Export-xxx.zip if Notion wrapped the export inside a single outer zip
	if len(zr.File) == 1 && strings.HasSuffix(strings.ToLower(zr.File[0].Name), ".zip") {
		rc, err := zr.File[0].Open()
		if err != nil {
			return nil, err
		}
		innerBytes, err := io.ReadAll(io.LimitReader(rc, 256*1024*1024))
		_ = rc.Close()
		if err != nil {
			return nil, err
		}
		zr, err = zip.NewReader(bytes.NewReader(innerBytes), int64(len(innerBytes)))
		if err != nil {
			return nil, err
		}
	}

	summary := &ImportSummary{}
	assetURLMap := make(map[string]string) // zip path -> /uploads/...

	type mdEntry struct {
		zipPath string
		dir     string
		title   string
		content string
	}
	type csvEntry struct {
		zipPath string
		dir     string
		title   string
		content string
	}

	var mdFiles []mdEntry
	var csvFiles []csvEntry

	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		cleanPath := path.Clean(strings.ReplaceAll(f.Name, "\\", "/"))
		if strings.HasPrefix(cleanPath, "../") || strings.Contains(cleanPath, "/../") {
			continue
		}
		ext := strings.ToLower(path.Ext(cleanPath))

		rc, err := f.Open()
		if err != nil {
			continue
		}
		data, readErr := io.ReadAll(io.LimitReader(rc, 32*1024*1024))
		_ = rc.Close()
		if readErr != nil {
			continue
		}

		switch ext {
		case ".md", ".markdown":
			mdFiles = append(mdFiles, mdEntry{
				zipPath: cleanPath,
				dir:     path.Dir(cleanPath),
				title:   cleanNotionName(path.Base(cleanPath)),
				content: string(data),
			})
		case ".csv":
			csvFiles = append(csvFiles, csvEntry{
				zipPath: cleanPath,
				dir:     path.Dir(cleanPath),
				title:   cleanNotionName(path.Base(cleanPath)),
				content: string(data),
			})
		case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".pdf":
			asset, err := s.assetSvc.SaveUpload(path.Base(cleanPath), "", nil, bytes.NewReader(data))
			if err == nil {
				assetURLMap[cleanPath] = asset.URL
				summary.AssetsImported++
			}
		}
	}

	if len(mdFiles) == 0 && len(csvFiles) == 0 {
		return nil, errors.New("压缩包中未检测到 Markdown 或 CSV 文件")
	}

	// Build folder hierarchy: map directory path -> created parent page ID
	dirPageMap := map[string]*string{".": parentID}
	ensureDir := func(dir string) *string {
		if dir == "." || dir == "" {
			return parentID
		}
		if existing, ok := dirPageMap[dir]; ok {
			return existing
		}
		parts := strings.Split(dir, "/")
		curPath := ""
		curParent := parentID
		for _, part := range parts {
			if curPath == "" {
				curPath = part
			} else {
				curPath += "/" + part
			}
			if cached, ok := dirPageMap[curPath]; ok {
				curParent = cached
				continue
			}
			// Check if there is a markdown file at parent matching this folder name
			folderTitle := cleanNotionName(part)
			p, err := s.pageSvc.CreatePage(CreatePageInput{
				ParentID: curParent,
				Title:    folderTitle,
				Icon:     "📁",
			})
			if err == nil {
				id := p.ID
				dirPageMap[curPath] = &id
				curParent = &id
				summary.PagesCreated++
				summary.PageIDs = append(summary.PageIDs, id)
			}
		}
		return curParent
	}

	// Pass 1: create all Markdown pages
	pathToPage := make(map[string]*models.Page)
	for _, entry := range mdFiles {
		pParent := ensureDir(entry.dir)
		mdBody := rewriteAssetLinks(entry.content, entry.dir, assetURLMap)
		doc := MarkdownToTipTap(mdBody)
		p, err := s.pageSvc.CreatePage(CreatePageInput{
			ParentID:    pParent,
			Title:       entry.title,
			Icon:        "📄",
			ContentJSON: doc,
			Tags:        []string{"Notion导入"},
		})
		if err == nil {
			pathToPage[entry.zipPath] = p
			summary.PagesCreated++
			summary.PageIDs = append(summary.PageIDs, p.ID)
		}
	}

	// Pass 2: resolve internal .md links into pageMention nodes
	mdLinkRe := regexp.MustCompile(`\[([^\]]+)\]\(([^)]+\.md)\)`)
	for _, entry := range mdFiles {
		p, ok := pathToPage[entry.zipPath]
		if !ok {
			continue
		}
		if !mdLinkRe.MatchString(entry.content) {
			continue
		}
		updatedBody := rewriteAssetLinks(entry.content, entry.dir, assetURLMap)
		// Replace internal md links with [[PageTitle]] markers or convert links after parsing
		doc := MarkdownToTipTap(updatedBody)
		root, _ := ParseTipTapDoc(doc)
		changed := rewriteTipTapMDLinks(&root, entry.dir, pathToPage)
		if changed {
			raw, _ := json.Marshal(root)
			rawMsg := json.RawMessage(raw)
			_, _ = s.pageSvc.UpdatePage(p.ID, UpdatePageInput{ContentJSON: &rawMsg})
		}
	}

	// Import CSV databases
	for _, entry := range csvFiles {
		cr := csv.NewReader(strings.NewReader(strings.TrimPrefix(entry.content, "\ufeff")))
		records, err := cr.ReadAll()
		if err != nil || len(records) == 0 {
			continue
		}
		headers := records[0]
		if len(headers) == 0 {
			continue
		}
		pParent := ensureDir(entry.dir)
		dbMeta, err := s.dbSvc.CreateDatabase(CreateDatabaseInput{
			ParentPageID: pParent,
			Title:        entry.title,
			Icon:         "🗃️",
		})
		if err != nil {
			continue
		}
		schema := []models.PropertySchema{{ID: "prop_title", Name: headers[0], Type: "title", Width: 220}}
		colIDs := []string{"prop_title"}
		for i := 1; i < len(headers); i++ {
			cid := fmt.Sprintf("prop_col_%d", i)
			colIDs = append(colIDs, cid)
			schema = append(schema, models.PropertySchema{ID: cid, Name: headers[i], Type: "text", Width: 160})
		}
		_, _ = s.dbSvc.UpdateSchema(dbMeta.ID, schema)
		for _, row := range records[1:] {
			if len(row) == 0 {
				continue
			}
			rowTitle := strings.TrimSpace(row[0])
			props := map[string]any{}
			for i := 1; i < len(row) && i < len(colIDs); i++ {
				props[colIDs[i]] = row[i]
			}
			_, _ = s.dbSvc.CreateRow(dbMeta.ID, rowTitle, props)
		}
		summary.DatabasesCreated++
	}

	return summary, nil
}

func rewriteAssetLinks(md, currentDir string, assetMap map[string]string) string {
	imgRe := regexp.MustCompile(`!\[([^\]]*)\]\(([^)]+)\)`)
	return imgRe.ReplaceAllStringFunc(md, func(match string) string {
		parts := imgRe.FindStringSubmatch(match)
		if len(parts) < 3 {
			return match
		}
		alt := parts[1]
		rawTarget := parts[2]
		decoded, err := url.PathUnescape(rawTarget)
		if err != nil {
			decoded = rawTarget
		}
		joined := path.Clean(path.Join(currentDir, decoded))
		if u, ok := assetMap[joined]; ok {
			return fmt.Sprintf("![%s](%s)", alt, u)
		}
		if u, ok := assetMap[decoded]; ok {
			return fmt.Sprintf("![%s](%s)", alt, u)
		}
		return match
	})
}

func rewriteTipTapMDLinks(n *TipTapNode, currentDir string, pathToPage map[string]*models.Page) bool {
	changed := false
	for i := range n.Content {
		child := &n.Content[i]
		if child.Type == "text" && len(child.Marks) > 0 {
			for _, m := range child.Marks {
				if m.Type == "link" {
					href := getStrAttr(m.Attrs, "href")
					if strings.HasSuffix(strings.ToLower(href), ".md") {
						decoded, err := url.PathUnescape(href)
						if err != nil {
							decoded = href
						}
						targetPath := path.Clean(path.Join(currentDir, decoded))
						if targetPage, ok := pathToPage[targetPath]; ok {
							child.Type = "pageMention"
							child.Text = ""
							child.Marks = nil
							child.Attrs = map[string]any{
								"id":    targetPage.ID,
								"label": targetPage.Title,
							}
							changed = true
							break
						}
					}
				}
			}
		}
		if len(child.Content) > 0 {
			if rewriteTipTapMDLinks(child, currentDir, pathToPage) {
				changed = true
			}
		}
	}
	return changed
}

func sanitizeFilename(name string) string {
	replacer := strings.NewReplacer("/", "_", "\\", "_", ":", "_", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_")
	clean := strings.TrimSpace(replacer.Replace(name))
	if clean == "" {
		return "document"
	}
	return clean
}
