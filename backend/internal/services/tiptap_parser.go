package services

import (
	"encoding/json"
	"fmt"
	"strings"
)

// TipTapNode represents a generic ProseMirror/TipTap JSON node.
type TipTapNode struct {
	Type    string         `json:"type"`
	Attrs   map[string]any `json:"attrs,omitempty"`
	Content []TipTapNode   `json:"content,omitempty"`
	Marks   []TipTapMark   `json:"marks,omitempty"`
	Text    string         `json:"text,omitempty"`
}

// TipTapMark represents an inline formatting mark in TipTap JSON.
type TipTapMark struct {
	Type  string         `json:"type"`
	Attrs map[string]any `json:"attrs,omitempty"`
}

// ExtractedLink captures a pageMention reference found inside a page's TipTap document.
type ExtractedLink struct {
	TargetPageID  string
	SourceBlockID string
	TargetBlockID string
	Excerpt       string
}

// ExtractedChunk captures a heading-scoped text chunk for RAG retrieval and embeddings.
type ExtractedChunk struct {
	ChunkIndex  int
	HeadingPath string
	Content     string
}

// ParseTipTapDoc parses raw JSON bytes into a TipTapNode root.
func ParseTipTapDoc(raw json.RawMessage) (TipTapNode, error) {
	if len(raw) == 0 {
		return TipTapNode{Type: "doc", Content: []TipTapNode{{Type: "paragraph"}}}, nil
	}
	var root TipTapNode
	if err := json.Unmarshal(raw, &root); err != nil {
		return TipTapNode{}, err
	}
	if root.Type == "" {
		root.Type = "doc"
	}
	return root, nil
}

// ExtractPlainText walks a TipTap document and returns clean searchable plain text.
func ExtractPlainText(raw json.RawMessage) string {
	root, err := ParseTipTapDoc(raw)
	if err != nil {
		return ""
	}
	var lines []string
	for _, child := range root.Content {
		if txt := strings.TrimSpace(nodePlainText(child)); txt != "" {
			lines = append(lines, txt)
		}
	}
	return strings.Join(lines, "\n")
}

func nodePlainText(n TipTapNode) string {
	switch n.Type {
	case "text":
		return n.Text
	case "hardBreak":
		return "\n"
	case "pageMention":
		if lbl := getStrAttr(n.Attrs, "label", "title"); lbl != "" {
			return "[[" + lbl + "]]"
		}
		return ""
	case "mathInline", "mathBlock":
		return getStrAttr(n.Attrs, "latex")
	case "bookmark":
		return strings.TrimSpace(getStrAttr(n.Attrs, "title") + " " + getStrAttr(n.Attrs, "description") + " " + getStrAttr(n.Attrs, "url"))
	case "fileBlock":
		return getStrAttr(n.Attrs, "name", "filename")
	case "image":
		return getStrAttr(n.Attrs, "alt", "title")
	case "inlineDatabase":
		if t := getStrAttr(n.Attrs, "title"); t != "" {
			return "[数据库: " + t + "]"
		}
		return ""
	}

	var parts []string
	if n.Type == "toggle" {
		if summary := getStrAttr(n.Attrs, "summary"); summary != "" {
			parts = append(parts, summary)
		}
	}
	for _, c := range n.Content {
		if t := nodePlainText(c); t != "" {
			parts = append(parts, t)
		}
	}
	sep := ""
	switch n.Type {
	case "paragraph", "heading", "listItem", "taskItem", "blockquote", "callout", "toggle", "codeBlock", "tableRow", "column", "columns":
		sep = " "
	case "tableCell", "tableHeader":
		sep = " "
	}
	return strings.TrimSpace(strings.Join(parts, sep))
}

// ExtractPageLinks discovers all pageMention links in a TipTap document along with block context.
func ExtractPageLinks(raw json.RawMessage) []ExtractedLink {
	root, err := ParseTipTapDoc(raw)
	if err != nil {
		return nil
	}
	var links []ExtractedLink
	seen := make(map[string]bool)

	var walk func(n TipTapNode, topBlockID string, blockText string)
	walk = func(n TipTapNode, topBlockID string, blockText string) {
		currentBlockID := topBlockID
		if currentBlockID == "" {
			currentBlockID = getStrAttr(n.Attrs, "blockId")
		}
		if n.Type == "pageMention" {
			targetID := getStrAttr(n.Attrs, "id", "pageId")
			if targetID != "" {
				key := targetID + "::" + currentBlockID
				if !seen[key] {
					seen[key] = true
					excerpt := strings.TrimSpace(blockText)
					if len([]rune(excerpt)) > 160 {
						excerpt = string([]rune(excerpt)[:160]) + "..."
					}
					links = append(links, ExtractedLink{
						TargetPageID:  targetID,
						SourceBlockID: currentBlockID,
						TargetBlockID: getStrAttr(n.Attrs, "blockId"),
						Excerpt:       excerpt,
					})
				}
			}
			return
		}
		for _, c := range n.Content {
			walk(c, currentBlockID, blockText)
		}
	}

	for _, child := range root.Content {
		bText := nodePlainText(child)
		bID := getStrAttr(child.Attrs, "blockId")
		walk(child, bID, bText)
	}
	return links
}

// ExtractChunks splits a page into heading-aware text chunks (~600 runes max) for RAG and vector indexing.
func ExtractChunks(title string, raw json.RawMessage) []ExtractedChunk {
	root, err := ParseTipTapDoc(raw)
	if err != nil {
		return nil
	}

	var headingStack [3]string
	currentHeading := title
	var buf strings.Builder
	var chunks []ExtractedChunk

	flush := func() {
		text := strings.TrimSpace(buf.String())
		if text == "" {
			buf.Reset()
			return
		}
		runes := []rune(text)
		const maxRunes = 600
		const overlap = 80
		for start := 0; start < len(runes); {
			end := start + maxRunes
			if end > len(runes) {
				end = len(runes)
			}
			part := strings.TrimSpace(string(runes[start:end]))
			if part != "" {
				chunks = append(chunks, ExtractedChunk{
					ChunkIndex:  len(chunks),
					HeadingPath: currentHeading,
					Content:     part,
				})
			}
			if end == len(runes) {
				break
			}
			start = end - overlap
		}
		buf.Reset()
	}

	for _, child := range root.Content {
		if child.Type == "heading" {
			flush()
			lvl := 1
			if l, ok := child.Attrs["level"].(float64); ok && l >= 1 && l <= 3 {
				lvl = int(l)
			}
			hText := strings.TrimSpace(nodePlainText(child))
			headingStack[lvl-1] = hText
			for i := lvl; i < 3; i++ {
				headingStack[i] = ""
			}
			var crumbs []string
			if title != "" {
				crumbs = append(crumbs, title)
			}
			for _, h := range headingStack {
				if h != "" {
					crumbs = append(crumbs, h)
				}
			}
			currentHeading = strings.Join(crumbs, " > ")
			if hText != "" {
				buf.WriteString(hText)
				buf.WriteByte('\n')
			}
			continue
		}

		txt := strings.TrimSpace(nodePlainText(child))
		if txt != "" {
			buf.WriteString(txt)
			buf.WriteByte('\n')
			if len([]rune(buf.String())) >= 550 {
				flush()
			}
		}
	}
	flush()

	if len(chunks) == 0 && strings.TrimSpace(title) != "" {
		chunks = append(chunks, ExtractedChunk{
			ChunkIndex:  0,
			HeadingPath: title,
			Content:     title,
		})
	}
	return chunks
}

// TipTapToMarkdown converts a TipTap JSON document into clean Markdown.
func TipTapToMarkdown(title string, raw json.RawMessage) string {
	root, err := ParseTipTapDoc(raw)
	if err != nil {
		return "# " + title + "\n"
	}
	var out strings.Builder
	if strings.TrimSpace(title) != "" {
		out.WriteString("# ")
		out.WriteString(title)
		out.WriteString("\n\n")
	}
	for _, n := range root.Content {
		out.WriteString(nodeToMarkdown(n, 0))
	}
	return strings.TrimRight(out.String(), "\n") + "\n"
}

func nodeToMarkdown(n TipTapNode, indent int) string {
	pad := strings.Repeat("  ", indent)
	switch n.Type {
	case "paragraph":
		txt := inlineToMarkdown(n.Content)
		if txt == "" {
			return "\n"
		}
		return pad + txt + "\n\n"
	case "heading":
		lvl := 1
		if l, ok := n.Attrs["level"].(float64); ok && l >= 1 && l <= 6 {
			lvl = int(l)
		}
		return strings.Repeat("#", lvl) + " " + inlineToMarkdown(n.Content) + "\n\n"
	case "bulletList":
		var b strings.Builder
		for _, item := range n.Content {
			b.WriteString(listItemToMarkdown(item, indent, "- "))
		}
		if indent == 0 {
			b.WriteByte('\n')
		}
		return b.String()
	case "orderedList":
		var b strings.Builder
		for i, item := range n.Content {
			b.WriteString(listItemToMarkdown(item, indent, fmt.Sprintf("%d. ", i+1)))
		}
		if indent == 0 {
			b.WriteByte('\n')
		}
		return b.String()
	case "taskList":
		var b strings.Builder
		for _, item := range n.Content {
			checked, _ := item.Attrs["checked"].(bool)
			prefix := "- [ ] "
			if checked {
				prefix = "- [x] "
			}
			b.WriteString(listItemToMarkdown(item, indent, prefix))
		}
		if indent == 0 {
			b.WriteByte('\n')
		}
		return b.String()
	case "blockquote":
		var b strings.Builder
		for _, c := range n.Content {
			line := strings.TrimSpace(nodeToMarkdown(c, 0))
			for _, l := range strings.Split(line, "\n") {
				b.WriteString("> " + l + "\n")
			}
		}
		b.WriteByte('\n')
		return b.String()
	case "callout":
		icon := getStrAttr(n.Attrs, "icon")
		if icon == "" {
			icon = "💡"
		}
		var inner []string
		for _, c := range n.Content {
			inner = append(inner, strings.TrimSpace(nodeToMarkdown(c, 0)))
		}
		body := strings.Join(inner, "\n> ")
		return fmt.Sprintf("> %s **提示**\n> %s\n\n", icon, body)
	case "toggle":
		summary := getStrAttr(n.Attrs, "summary")
		var b strings.Builder
		b.WriteString("<details>\n<summary>" + summary + "</summary>\n\n")
		for _, c := range n.Content {
			b.WriteString(nodeToMarkdown(c, 0))
		}
		b.WriteString("</details>\n\n")
		return b.String()
	case "columns":
		var b strings.Builder
		for _, col := range n.Content {
			for _, c := range col.Content {
				b.WriteString(nodeToMarkdown(c, 0))
			}
		}
		return b.String()
	case "codeBlock":
		lang := getStrAttr(n.Attrs, "language")
		code := inlineToMarkdown(n.Content)
		return fmt.Sprintf("```%s\n%s\n```\n\n", lang, code)
	case "mathBlock":
		return fmt.Sprintf("$$\n%s\n$$\n\n", getStrAttr(n.Attrs, "latex"))
	case "horizontalRule":
		return "---\n\n"
	case "image":
		src := getStrAttr(n.Attrs, "src")
		alt := getStrAttr(n.Attrs, "alt")
		return fmt.Sprintf("![%s](%s)\n\n", alt, src)
	case "bookmark":
		url := getStrAttr(n.Attrs, "url")
		title := getStrAttr(n.Attrs, "title")
		if title == "" {
			title = url
		}
		return fmt.Sprintf("[%s](%s)\n\n", title, url)
	case "fileBlock":
		return fmt.Sprintf("[%s](%s)\n\n", getStrAttr(n.Attrs, "name", "filename"), getStrAttr(n.Attrs, "url"))
	case "inlineDatabase":
		return fmt.Sprintf("> 🗃️ **内嵌数据库**：%s\n\n", getStrAttr(n.Attrs, "title"))
	case "table":
		return tableToMarkdown(n)
	}
	var b strings.Builder
	for _, c := range n.Content {
		b.WriteString(nodeToMarkdown(c, indent))
	}
	return b.String()
}

func listItemToMarkdown(item TipTapNode, indent int, prefix string) string {
	pad := strings.Repeat("  ", indent)
	var b strings.Builder
	firstPara := true
	for _, c := range item.Content {
		if c.Type == "paragraph" && firstPara {
			b.WriteString(pad + prefix + inlineToMarkdown(c.Content) + "\n")
			firstPara = false
		} else if c.Type == "bulletList" || c.Type == "orderedList" || c.Type == "taskList" {
			b.WriteString(nodeToMarkdown(c, indent+1))
		} else {
			if firstPara {
				b.WriteString(pad + prefix + "\n")
				firstPara = false
			}
			b.WriteString(nodeToMarkdown(c, indent+1))
		}
	}
	if firstPara {
		b.WriteString(pad + prefix + "\n")
	}
	return b.String()
}

func tableToMarkdown(tbl TipTapNode) string {
	var b strings.Builder
	for rIdx, row := range tbl.Content {
		var cells []string
		for _, cell := range row.Content {
			txt := strings.TrimSpace(nodePlainText(cell))
			txt = strings.ReplaceAll(txt, "|", "\\|")
			txt = strings.ReplaceAll(txt, "\n", " ")
			cells = append(cells, txt)
		}
		b.WriteString("| " + strings.Join(cells, " | ") + " |\n")
		if rIdx == 0 {
			seps := make([]string, len(cells))
			for i := range seps {
				seps[i] = "---"
			}
			b.WriteString("| " + strings.Join(seps, " | ") + " |\n")
		}
	}
	b.WriteByte('\n')
	return b.String()
}

func inlineToMarkdown(nodes []TipTapNode) string {
	var b strings.Builder
	for _, n := range nodes {
		switch n.Type {
		case "text":
			txt := n.Text
			for _, m := range n.Marks {
				switch m.Type {
				case "bold":
					txt = "**" + txt + "**"
				case "italic":
					txt = "*" + txt + "*"
				case "strike":
					txt = "~~" + txt + "~~"
				case "code":
					txt = "`" + txt + "`"
				case "link":
					if href := getStrAttr(m.Attrs, "href"); href != "" {
						txt = "[" + txt + "](" + href + ")"
					}
				}
			}
			b.WriteString(txt)
		case "hardBreak":
			b.WriteString("  \n")
		case "pageMention":
			lbl := getStrAttr(n.Attrs, "label", "title")
			b.WriteString("[[" + lbl + "]]")
		case "mathInline":
			b.WriteString("$" + getStrAttr(n.Attrs, "latex") + "$")
		default:
			b.WriteString(inlineToMarkdown(n.Content))
		}
	}
	return b.String()
}

// MarkdownToTipTap converts plain Markdown text into a TipTap document JSON byte slice.
func MarkdownToTipTap(md string) json.RawMessage {
	lines := strings.Split(strings.ReplaceAll(md, "\r\n", "\n"), "\n")
	var blocks []TipTapNode

	i := 0
	for i < len(lines) {
		line := lines[i]
		trimmed := strings.TrimSpace(line)

		if trimmed == "" {
			i++
			continue
		}

		// Fenced code block
		if strings.HasPrefix(trimmed, "```") {
			lang := strings.TrimSpace(strings.TrimPrefix(trimmed, "```"))
			var codeLines []string
			i++
			for i < len(lines) && !strings.HasPrefix(strings.TrimSpace(lines[i]), "```") {
				codeLines = append(codeLines, lines[i])
				i++
			}
			if i < len(lines) {
				i++
			}
			var content []TipTapNode
			codeStr := strings.Join(codeLines, "\n")
			if codeStr != "" {
				content = []TipTapNode{{Type: "text", Text: codeStr}}
			}
			blocks = append(blocks, TipTapNode{
				Type:    "codeBlock",
				Attrs:   map[string]any{"language": lang},
				Content: content,
			})
			continue
		}

		// Math block $$ ... $$
		if trimmed == "$$" {
			var mathLines []string
			i++
			for i < len(lines) && strings.TrimSpace(lines[i]) != "$$" {
				mathLines = append(mathLines, lines[i])
				i++
			}
			if i < len(lines) {
				i++
			}
			blocks = append(blocks, TipTapNode{
				Type:  "mathBlock",
				Attrs: map[string]any{"latex": strings.Join(mathLines, "\n")},
			})
			continue
		}

		// Horizontal rule
		if trimmed == "---" || trimmed == "***" || trimmed == "___" {
			blocks = append(blocks, TipTapNode{Type: "horizontalRule"})
			i++
			continue
		}

		// Headings
		if strings.HasPrefix(trimmed, "#") {
			lvl := 0
			for lvl < len(trimmed) && trimmed[lvl] == '#' {
				lvl++
			}
			if lvl >= 1 && lvl <= 6 && (len(trimmed) == lvl || trimmed[lvl] == ' ') {
				text := strings.TrimSpace(trimmed[lvl:])
				if lvl > 3 {
					lvl = 3
				}
				blocks = append(blocks, TipTapNode{
					Type:    "heading",
					Attrs:   map[string]any{"level": lvl},
					Content: parseInlineMarkdown(text),
				})
				i++
				continue
			}
		}

		// Task list
		if strings.HasPrefix(trimmed, "- [ ] ") || strings.HasPrefix(trimmed, "- [x] ") || strings.HasPrefix(trimmed, "- [X] ") {
			var items []TipTapNode
			for i < len(lines) {
				t := strings.TrimSpace(lines[i])
				var checked bool
				var rest string
				if strings.HasPrefix(t, "- [ ] ") {
					checked = false
					rest = strings.TrimPrefix(t, "- [ ] ")
				} else if strings.HasPrefix(t, "- [x] ") || strings.HasPrefix(t, "- [X] ") {
					checked = true
					rest = t[6:]
				} else {
					break
				}
				items = append(items, TipTapNode{
					Type:    "taskItem",
					Attrs:   map[string]any{"checked": checked},
					Content: []TipTapNode{{Type: "paragraph", Content: parseInlineMarkdown(rest)}},
				})
				i++
			}
			blocks = append(blocks, TipTapNode{Type: "taskList", Content: items})
			continue
		}

		// Bullet list
		if strings.HasPrefix(trimmed, "- ") || strings.HasPrefix(trimmed, "* ") {
			var items []TipTapNode
			for i < len(lines) {
				t := strings.TrimSpace(lines[i])
				if strings.HasPrefix(t, "- [ ] ") || strings.HasPrefix(t, "- [x] ") || strings.HasPrefix(t, "- [X] ") {
					break
				}
				if strings.HasPrefix(t, "- ") || strings.HasPrefix(t, "* ") {
					items = append(items, TipTapNode{
						Type:    "listItem",
						Content: []TipTapNode{{Type: "paragraph", Content: parseInlineMarkdown(t[2:])}},
					})
					i++
				} else {
					break
				}
			}
			blocks = append(blocks, TipTapNode{Type: "bulletList", Content: items})
			continue
		}

		// Ordered list
		if dotIdx := strings.Index(trimmed, ". "); dotIdx > 0 && dotIdx <= 3 && isAllDigits(trimmed[:dotIdx]) {
			var items []TipTapNode
			for i < len(lines) {
				t := strings.TrimSpace(lines[i])
				d := strings.Index(t, ". ")
				if d > 0 && d <= 3 && isAllDigits(t[:d]) {
					items = append(items, TipTapNode{
						Type:    "listItem",
						Content: []TipTapNode{{Type: "paragraph", Content: parseInlineMarkdown(t[d+2:])}},
					})
					i++
				} else {
					break
				}
			}
			blocks = append(blocks, TipTapNode{Type: "orderedList", Content: items})
			continue
		}

		// Blockquote
		if strings.HasPrefix(trimmed, ">") {
			var qLines []string
			for i < len(lines) && strings.HasPrefix(strings.TrimSpace(lines[i]), ">") {
				t := strings.TrimSpace(lines[i])
				t = strings.TrimSpace(strings.TrimPrefix(t, ">"))
				qLines = append(qLines, t)
				i++
			}
			blocks = append(blocks, TipTapNode{
				Type:    "blockquote",
				Content: []TipTapNode{{Type: "paragraph", Content: parseInlineMarkdown(strings.Join(qLines, " "))}},
			})
			continue
		}

		// Markdown Image on its own line
		if strings.HasPrefix(trimmed, "![") && strings.Contains(trimmed, "](") && strings.HasSuffix(trimmed, ")") {
			mid := strings.Index(trimmed, "](")
			alt := trimmed[2:mid]
			src := trimmed[mid+2 : len(trimmed)-1]
			blocks = append(blocks, TipTapNode{
				Type:  "image",
				Attrs: map[string]any{"src": src, "alt": alt},
			})
			i++
			continue
		}

		// Pipe table
		if strings.HasPrefix(trimmed, "|") && strings.HasSuffix(trimmed, "|") && i+1 < len(lines) && strings.Contains(lines[i+1], "---") {
			var rows []TipTapNode
			headerCells := splitPipeRow(trimmed)
			var headerNodes []TipTapNode
			for _, cell := range headerCells {
				headerNodes = append(headerNodes, TipTapNode{
					Type:    "tableHeader",
					Content: []TipTapNode{{Type: "paragraph", Content: parseInlineMarkdown(cell)}},
				})
			}
			rows = append(rows, TipTapNode{Type: "tableRow", Content: headerNodes})
			i += 2
			for i < len(lines) {
				rowTrim := strings.TrimSpace(lines[i])
				if !strings.HasPrefix(rowTrim, "|") {
					break
				}
				cells := splitPipeRow(rowTrim)
				var cellNodes []TipTapNode
				for _, cell := range cells {
					cellNodes = append(cellNodes, TipTapNode{
						Type:    "tableCell",
						Content: []TipTapNode{{Type: "paragraph", Content: parseInlineMarkdown(cell)}},
					})
				}
				rows = append(rows, TipTapNode{Type: "tableRow", Content: cellNodes})
				i++
			}
			blocks = append(blocks, TipTapNode{Type: "table", Content: rows})
			continue
		}

		// Default paragraph
		blocks = append(blocks, TipTapNode{
			Type:    "paragraph",
			Content: parseInlineMarkdown(trimmed),
		})
		i++
	}

	if len(blocks) == 0 {
		blocks = []TipTapNode{{Type: "paragraph"}}
	}
	doc := TipTapNode{Type: "doc", Content: blocks}
	raw, _ := json.Marshal(doc)
	return raw
}

func parseInlineMarkdown(s string) []TipTapNode {
	if s == "" {
		return nil
	}
	// Lightweight inline parser for **bold**, `code`, and [text](url)
	var nodes []TipTapNode
	rest := s
	for len(rest) > 0 {
		// Inline code
		if strings.HasPrefix(rest, "`") {
			if end := strings.Index(rest[1:], "`"); end >= 0 {
				codeText := rest[1 : 1+end]
				if codeText != "" {
					nodes = append(nodes, TipTapNode{
						Type:  "text",
						Text:  codeText,
						Marks: []TipTapMark{{Type: "code"}},
					})
				}
				rest = rest[2+end:]
				continue
			}
		}
		// Bold **...**
		if strings.HasPrefix(rest, "**") {
			if end := strings.Index(rest[2:], "**"); end >= 0 {
				boldText := rest[2 : 2+end]
				if boldText != "" {
					nodes = append(nodes, TipTapNode{
						Type:  "text",
						Text:  boldText,
						Marks: []TipTapMark{{Type: "bold"}},
					})
				}
				rest = rest[4+end:]
				continue
			}
		}
		// Link [text](url)
		if strings.HasPrefix(rest, "[") {
			if mid := strings.Index(rest, "]("); mid > 1 {
				if end := strings.Index(rest[mid+2:], ")"); end >= 0 {
					lbl := rest[1:mid]
					href := rest[mid+2 : mid+2+end]
					if lbl != "" {
						nodes = append(nodes, TipTapNode{
							Type:  "text",
							Text:  lbl,
							Marks: []TipTapMark{{Type: "link", Attrs: map[string]any{"href": href}}},
						})
					}
					rest = rest[mid+2+end+1:]
					continue
				}
			}
		}
		// Find next special marker
		next := len(rest)
		for _, tok := range []string{"`", "**", "["} {
			if idx := strings.Index(rest[1:], tok); idx >= 0 && idx+1 < next {
				next = idx + 1
			}
		}
		nodes = append(nodes, TipTapNode{Type: "text", Text: rest[:next]})
		rest = rest[next:]
	}
	return nodes
}

func splitPipeRow(line string) []string {
	trimmed := strings.Trim(line, "| ")
	if trimmed == "" {
		return nil
	}
	parts := strings.Split(trimmed, "|")
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	return parts
}

func isAllDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func getStrAttr(attrs map[string]any, keys ...string) string {
	if attrs == nil {
		return ""
	}
	for _, k := range keys {
		if v, ok := attrs[k]; ok {
			if s, ok := v.(string); ok && s != "" {
				return s
			}
		}
	}
	return ""
}
