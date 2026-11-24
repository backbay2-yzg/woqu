package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"syscall"
	"time"

	"golang.org/x/net/html"

	"woqu/backend/internal/config"
	"woqu/backend/internal/models"
)

type ClipperService struct {
	cfg     *config.Config
	pageSvc *PageService
	aiSvc   *AIService
}

func NewClipperService(cfg *config.Config, pageSvc *PageService, aiSvc *AIService) *ClipperService {
	return &ClipperService{
		cfg:     cfg,
		pageSvc: pageSvc,
		aiSvc:   aiSvc,
	}
}

type ClipResult struct {
	Page      *models.Page `json:"page"`
	AIWarning string       `json:"ai_warning,omitempty"`
}

func (s *ClipperService) ClipURL(ctx context.Context, rawURL string, parentID *string, withAISummary bool) (*ClipResult, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return nil, errors.New("请输入有效的 http/https 网址")
	}

	if err := s.validateHostSSRF(ctx, parsed.Hostname()); err != nil {
		return nil, err
	}

	client := s.buildSafeHTTPClient()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; WoquClipper/1.0)")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("抓取网页失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("目标网站返回 HTTP %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, 5*1024*1024))
	if err != nil {
		return nil, err
	}

	finalURL := resp.Request.URL
	title, blocks := extractArticleTipTap(string(bodyBytes), finalURL)
	if title == "" {
		title = finalURL.Host
	}

	// Prepend bookmark source card
	allBlocks := []TipTapNode{
		{
			Type: "bookmark",
			Attrs: map[string]any{
				"url":         finalURL.String(),
				"title":       title,
				"description": "剪藏来源：" + finalURL.Host,
			},
		},
	}
	allBlocks = append(allBlocks, blocks...)
	if len(allBlocks) == 1 {
		allBlocks = append(allBlocks, TipTapNode{Type: "paragraph"})
	}

	docBytes, _ := json.Marshal(TipTapNode{
		Type:    "doc",
		Content: allBlocks,
	})

	page, err := s.pageSvc.CreatePage(CreatePageInput{
		ParentID:    parentID,
		Title:       title,
		Icon:        "🌐",
		ContentJSON: docBytes,
		Tags:        []string{"网页剪藏"},
	})
	if err != nil {
		return nil, err
	}

	res := &ClipResult{Page: page}
	if withAISummary && s.aiSvc != nil {
		if _, aiErr := s.aiSvc.SummarizePage(ctx, page.ID, true, nil); aiErr != nil {
			res.AIWarning = "网页已保存，但自动生成 AI 摘要失败：" + aiErr.Error()
		} else if updated, err := s.pageSvc.GetPage(page.ID); err == nil {
			res.Page = updated
		}
	}
	return res, nil
}

func (s *ClipperService) validateHostSSRF(ctx context.Context, host string) error {
	if s.cfg.AllowPrivateClip {
		return nil
	}
	lower := strings.ToLower(host)
	if lower == "localhost" || strings.HasSuffix(lower, ".local") || strings.HasSuffix(lower, ".internal") {
		return errors.New("安全拦截：不允许剪藏本地或内网地址")
	}
	if ip := net.ParseIP(host); ip != nil {
		if !isPublicIP(ip) {
			return errors.New("安全拦截：不允许剪藏私有/回环 IP 地址")
		}
		return nil
	}
	ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
	if err != nil || len(ips) == 0 {
		return errors.New("域名解析失败")
	}
	for _, ip := range ips {
		if !isPublicIP(ip) {
			return errors.New("安全拦截：目标域名解析到内网或保留 IP")
		}
	}
	return nil
}

func (s *ClipperService) buildSafeHTTPClient() *http.Client {
	dialer := &net.Dialer{
		Timeout: 10 * time.Second,
		Control: func(network, address string, c syscall.RawConn) error {
			if s.cfg.AllowPrivateClip {
				return nil
			}
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			ip := net.ParseIP(host)
			if ip == nil || !isPublicIP(ip) {
				return errors.New("blocked non-public IP connection")
			}
			return nil
		},
	}
	tr := &http.Transport{
		DialContext: dialer.DialContext,
	}
	return &http.Client{
		Timeout:   20 * time.Second,
		Transport: tr,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("too many redirects")
			}
			if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
				return errors.New("invalid redirect scheme")
			}
			return s.validateHostSSRF(req.Context(), req.URL.Hostname())
		},
	}
}

func isPublicIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return false
	}
	return true
}

func extractArticleTipTap(htmlStr string, baseURL *url.URL) (string, []TipTapNode) {
	doc, err := html.Parse(strings.NewReader(htmlStr))
	if err != nil {
		return "", []TipTapNode{{Type: "paragraph", Content: []TipTapNode{{Type: "text", Text: htmlStr}}}}
	}

	title := findHTMLTitle(doc)
	contentRoot := findBestContentRoot(doc)
	if contentRoot == nil {
		contentRoot = doc
	}

	var blocks []TipTapNode
	extractHTMLBlocks(contentRoot, baseURL, &blocks)
	return strings.TrimSpace(title), blocks
}

func findHTMLTitle(n *html.Node) string {
	var ogTitle, docTitle string
	var walk func(*html.Node)
	walk = func(cur *html.Node) {
		if cur.Type == html.ElementNode {
			if cur.Data == "title" && cur.FirstChild != nil && docTitle == "" {
				docTitle = strings.TrimSpace(cur.FirstChild.Data)
			}
			if cur.Data == "meta" {
				var prop, content string
				for _, a := range cur.Attr {
					if a.Key == "property" || a.Key == "name" {
						prop = strings.ToLower(a.Val)
					} else if a.Key == "content" {
						content = a.Val
					}
				}
				if (prop == "og:title" || prop == "twitter:title") && content != "" {
					ogTitle = strings.TrimSpace(content)
				}
			}
		}
		for c := cur.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	if ogTitle != "" {
		return ogTitle
	}
	return docTitle
}

func findBestContentRoot(doc *html.Node) *html.Node {
	var articleNode, mainNode, bodyNode *html.Node
	var walk func(*html.Node)
	walk = func(cur *html.Node) {
		if cur.Type == html.ElementNode {
			switch cur.Data {
			case "article":
				if articleNode == nil {
					articleNode = cur
				}
			case "main":
				if mainNode == nil {
					mainNode = cur
				}
			case "body":
				if bodyNode == nil {
					bodyNode = cur
				}
			}
		}
		for c := cur.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	if articleNode != nil {
		return articleNode
	}
	if mainNode != nil {
		return mainNode
	}
	return bodyNode
}

func shouldSkipTag(tag string) bool {
	switch tag {
	case "script", "style", "noscript", "nav", "footer", "aside", "header", "svg", "iframe", "form", "button":
		return true
	}
	return false
}

func extractHTMLBlocks(n *html.Node, baseURL *url.URL, out *[]TipTapNode) {
	if n.Type == html.ElementNode {
		if shouldSkipTag(n.Data) {
			return
		}
		switch n.Data {
		case "h1", "h2", "h3", "h4", "h5", "h6":
			lvl := int(n.Data[1] - '0')
			if lvl > 3 {
				lvl = 3
			}
			inlines := extractHTMLInlines(n, baseURL, nil)
			if len(inlines) > 0 {
				*out = append(*out, TipTapNode{
					Type:    "heading",
					Attrs:   map[string]any{"level": lvl},
					Content: inlines,
				})
			}
			return
		case "p":
			inlines := extractHTMLInlines(n, baseURL, nil)
			if len(inlines) > 0 {
				*out = append(*out, TipTapNode{Type: "paragraph", Content: inlines})
			}
			return
		case "blockquote":
			var inner []TipTapNode
			extractHTMLBlocksChildren(n, baseURL, &inner)
			if len(inner) == 0 {
				inlines := extractHTMLInlines(n, baseURL, nil)
				if len(inlines) > 0 {
					inner = []TipTapNode{{Type: "paragraph", Content: inlines}}
				}
			}
			if len(inner) > 0 {
				*out = append(*out, TipTapNode{Type: "blockquote", Content: inner})
			}
			return
		case "pre":
			code := collectRawText(n)
			code = strings.TrimRight(code, "\n")
			if code != "" {
				*out = append(*out, TipTapNode{
					Type:    "codeBlock",
					Attrs:   map[string]any{"language": ""},
					Content: []TipTapNode{{Type: "text", Text: code}},
				})
			}
			return
		case "ul", "ol":
			listType := "bulletList"
			if n.Data == "ol" {
				listType = "orderedList"
			}
			var items []TipTapNode
			for c := n.FirstChild; c != nil; c = c.NextSibling {
				if c.Type == html.ElementNode && c.Data == "li" {
					inlines := extractHTMLInlines(c, baseURL, nil)
					if len(inlines) > 0 {
						items = append(items, TipTapNode{
							Type:    "listItem",
							Content: []TipTapNode{{Type: "paragraph", Content: inlines}},
						})
					}
				}
			}
			if len(items) > 0 {
				*out = append(*out, TipTapNode{Type: listType, Content: items})
			}
			return
		case "img":
			src := resolveAttrURL(n, "src", baseURL)
			if src != "" {
				*out = append(*out, TipTapNode{
					Type:  "image",
					Attrs: map[string]any{"src": src, "alt": getHTMLAttr(n, "alt")},
				})
			}
			return
		case "hr":
			*out = append(*out, TipTapNode{Type: "horizontalRule"})
			return
		}
	}
	extractHTMLBlocksChildren(n, baseURL, out)
}

func extractHTMLBlocksChildren(n *html.Node, baseURL *url.URL, out *[]TipTapNode) {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		extractHTMLBlocks(c, baseURL, out)
	}
}

func extractHTMLInlines(n *html.Node, baseURL *url.URL, marks []TipTapMark) []TipTapNode {
	var out []TipTapNode
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.TextNode {
			txt := collapseHTMLSpaces(c.Data)
			if txt != "" {
				node := TipTapNode{Type: "text", Text: txt}
				if len(marks) > 0 {
					node.Marks = append([]TipTapMark{}, marks...)
				}
				out = append(out, node)
			}
			continue
		}
		if c.Type == html.ElementNode {
			if shouldSkipTag(c.Data) {
				continue
			}
			nextMarks := append([]TipTapMark{}, marks...)
			switch c.Data {
			case "strong", "b":
				nextMarks = append(nextMarks, TipTapMark{Type: "bold"})
			case "em", "i":
				nextMarks = append(nextMarks, TipTapMark{Type: "italic"})
			case "code":
				nextMarks = append(nextMarks, TipTapMark{Type: "code"})
			case "s", "del":
				nextMarks = append(nextMarks, TipTapMark{Type: "strike"})
			case "a":
				if href := resolveAttrURL(c, "href", baseURL); href != "" {
					nextMarks = append(nextMarks, TipTapMark{Type: "link", Attrs: map[string]any{"href": href}})
				}
			case "br":
				out = append(out, TipTapNode{Type: "hardBreak"})
				continue
			}
			out = append(out, extractHTMLInlines(c, baseURL, nextMarks)...)
		}
	}
	return out
}

func collapseHTMLSpaces(s string) string {
	fields := strings.Fields(s)
	if len(fields) == 0 {
		return ""
	}
	res := strings.Join(fields, " ")
	if strings.HasPrefix(s, " ") || strings.HasPrefix(s, "\n") || strings.HasPrefix(s, "\t") {
		res = " " + res
	}
	if strings.HasSuffix(s, " ") || strings.HasSuffix(s, "\n") || strings.HasSuffix(s, "\t") {
		res += " "
	}
	return res
}

func collectRawText(n *html.Node) string {
	if n.Type == html.TextNode {
		return n.Data
	}
	var b strings.Builder
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		b.WriteString(collectRawText(c))
	}
	return b.String()
}

func getHTMLAttr(n *html.Node, key string) string {
	for _, a := range n.Attr {
		if a.Key == key {
			return a.Val
		}
	}
	return ""
}

func resolveAttrURL(n *html.Node, key string, baseURL *url.URL) string {
	val := strings.TrimSpace(getHTMLAttr(n, key))
	if val == "" || strings.HasPrefix(val, "javascript:") || strings.HasPrefix(val, "data:") {
		return ""
	}
	if baseURL == nil {
		return val
	}
	ref, err := url.Parse(val)
	if err != nil {
		return ""
	}
	resolved := baseURL.ResolveReference(ref)
	if resolved.Scheme != "http" && resolved.Scheme != "https" {
		return ""
	}
	return resolved.String()
}
