# 🚀 部署运维、反向代理与 API 参考

---

## 目录

- [1. Docker Compose 部署（推荐）](#1-docker-compose-部署推荐)
- [2. 单二进制编译与跨平台构建](#2-单二进制编译与跨平台构建)
- [3. 本地开发模式](#3-本地开发模式)
- [4. 环境变量完整参考](#4-环境变量完整参考)
- [5. 生产环境反向代理配置 (Nginx / Caddy)](#5-生产环境反向代理配置-nginx--caddy)
- [6. 数据目录结构与备份策略](#6-数据目录结构与备份策略)
- [7. 核心 REST & SSE API 清单](#7-核心-rest--sse-api-清单)
- [8. 常见问题排查 (FAQ)](#8-常见问题排查-faq)

---

## 1. Docker Compose 部署（推荐）

项目根目录已提供多阶段构建的 [`Dockerfile`](../Dockerfile) 与 [`docker-compose.yml`](../docker-compose.yml)：
- **Stage 1 (`node:22-alpine`)**：使用 `pnpm` 构建 React 前端产物；
- **Stage 2 (`golang:1.24-alpine`)**：启用 `CGO_ENABLED=0`，将前端 `dist` 通过 `go:embed` 内嵌编译为静态二进制；
- **Stage 3 (`alpine:3.21`)**：最终运行时镜像极小，只保留单二进制与 CA 证书/时区数据，自带 `/api/v1/health` 健康检查。

### 启动命令
```bash
git clone git@github.com:backbay2/woqu.git
cd woqu
docker compose up -d --build
```

查看运行状态与日志：
```bash
docker compose ps
docker compose logs -f woqu
```

---

## 2. 单二进制编译与跨平台构建

由于 SQLite 驱动采用纯 Go 的 `modernc.org/sqlite`，整个构建链路 **完全不依赖 CGO 或 GCC**，可直接跨平台编译出单文件可执行程序。

```bash
# 1. 构建前端
cd frontend
pnpm install
pnpm build

# 2. 拷贝前端构建产物到 Go 嵌入目录（Windows PowerShell 请使用 Copy-Item）
cd ..
rm -rf backend/internal/static/dist/*
cp -r frontend/dist/* backend/internal/static/dist/

# 3. 编译目标平台单二进制
cd backend
# 当前平台：
CGO_ENABLED=0 go build -ldflags="-s -w" -o ../woqu ./cmd/woqu

# 示例：在 Windows/macOS 上交叉编译 Linux amd64 服务器二进制：
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o ../woqu-linux-amd64 ./cmd/woqu
```

将编译好的单个文件上传到服务器，运行 `./woqu-linux-amd64` 即可直接监听 `:8080` 提供完整服务。

---

## 3. 本地开发模式

Windows 下可直接运行仓库内置脚本一键并行启动后端与前端：

```powershell
./scripts/dev.ps1
```

该脚本会设置 `WOQU_DEV=1` 与 `WOQU_DATA_DIR=./data`，启动：
- Go 后端 (`http://localhost:8080`)
- Vite 前端热更新开发服务器 (`http://localhost:5173`，通过 `vite.config.ts` 自动将 `/api` 和 `/uploads` 代理至 `8080`)

Linux / macOS 下可在两个终端分别执行：
```bash
# 终端 1：后端
cd backend && WOQU_DEV=1 WOQU_DATA_DIR=../data go run ./cmd/woqu

# 终端 2：前端
cd frontend && pnpm dev
```

---

## 4. 环境变量完整参考

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `WOQU_PORT` | `8080` | HTTP 服务监听端口 |
| `WOQU_DATA_DIR` | `./data` | 持久化根目录（自动创建，存放 `woqu.db`、`uploads/` 与 `.secrets.json`） |
| `WOQU_INITIAL_PASSWORD` | 空 | 若设置，首次启动且尚未初始化时自动用该密码初始化工作区（默认名「我趣知识库」） |
| `WOQU_MASTER_KEY` | 自动生成 | AI API Key 的 AES-256-GCM 加密主密钥（支持 64 位 Hex 字符串或任意口令经 SHA-256 派生；未设置时自动生成随机 32 字节密钥持久化至 `data/.secrets.json`） |
| `WOQU_JWT_SECRET` | 自动生成 | JWT HS256 签名密钥（未设置时同样自动生成并持久化至 `data/.secrets.json`） |
| `WOQU_DEV` | `false` | 设为 `1` 或 `true` 开启开发模式 CORS 跨域响应头 |
| `WOQU_ALLOW_PRIVATE_CLIP` | `false` | 设为 `1` 或 `true` 允许网页剪藏请求私有/回环内网 IP（默认安全拦截） |

---

## 5. 生产环境反向代理配置 (Nginx / Caddy)

> [!WARNING]
> **重要：SSE 流式输出必须关闭代理缓冲**
> Woqu 的 AI 划词润色、摘要生成与 Agent 对话均采用 Server-Sent Events (SSE)。如果 Nginx 开启了响应缓冲，你会看到文字很久才整段出现而不是逐字流式吐出。

### Nginx 示例配置
```nginx
server {
    listen 443 ssl http2;
    server_name notes.example.com;

    # 允许上传较大图片、Notion Zip 或整库备份包
    client_max_body_size 512M;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 关键：禁用缓冲以保证 AI SSE 流式实时推送
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
```

### Caddy 示例配置
Caddy 原生支持自动 HTTPS 与流式传输：
```caddyfile
notes.example.com {
    reverse_proxy 127.0.0.1:8080 {
        flush_interval -1
    }
}
```

---

## 6. 数据目录结构与备份策略

运行后所有数据均位于 `WOQU_DATA_DIR`（默认 `./data`）：

```text
data/
├── woqu.db           # SQLite 主库（WAL 模式，存放页面、数据库、版本、FTS5、向量 BLOB、AI 配置）
├── woqu.db-wal       # SQLite 预写日志（运行时存在）
├── woqu.db-shm       # SQLite 共享内存索引（运行时存在）
├── .secrets.json     # 自动生成的 JWT 与 AES-256 主密钥（权限 0600，请妥善保管）
└── uploads/
    └── YYYY/MM/      # 按年月分目录存储的上传图片与附件
```

> [!CAUTION]
> **不要直接用 `cp data/woqu.db` 冷拷贝正在运行的 WAL 数据库文件**，否则可能漏掉尚未 checkpoint 到主文件的 `woqu.db-wal` 数据。请始终使用内置的 **「导入导出与备份 → 下载整库热备份 (.zip)」**（底层调用 SQLite `VACUUM INTO`）或定时请求 `/api/v1/backup/download` 获取一致性全量备份。

---

## 7. 核心 REST & SSE API 清单

所有受保护接口位于 `/api/v1/*`，支持 `HttpOnly Cookie (woqu_token)` 或 `Authorization: Bearer <token>` 鉴权：

- **健康与认证**：`GET /api/v1/health`、`GET /api/v1/auth/status`、`POST /api/v1/auth/setup`、`POST /api/v1/auth/login`、`POST /api/v1/auth/logout`、`POST /api/v1/auth/password`、`GET|PATCH /api/v1/settings`
- **页面与树**：`GET /api/v1/pages/tree`、`GET /api/v1/pages/all`、`GET /api/v1/pages/trash`、`POST /api/v1/pages`、`GET|PATCH|DELETE /api/v1/pages/{id}`、`POST /api/v1/pages/{id}/move`、`POST /api/v1/pages/{id}/duplicate`、`POST /api/v1/pages/{id}/restore`、`DELETE /api/v1/pages/{id}/permanent`
- **版本、双链与图谱**：`GET|POST /api/v1/pages/{id}/versions`、`POST /api/v1/pages/{id}/versions/{versionId}/restore`、`GET /api/v1/pages/{id}/backlinks`、`GET /api/v1/graph`
- **多维数据库**：`GET|POST /api/v1/databases`、`GET /api/v1/databases/by-page/{pageId}`、`GET|PATCH /api/v1/databases/{id}`、`PUT /api/v1/databases/{id}/schema`、`POST /api/v1/databases/{id}/views`、`PATCH|DELETE /api/v1/databases/{id}/views/{viewId}`、`POST /api/v1/databases/{id}/rows`、`PATCH|DELETE /api/v1/databases/{id}/rows/{rowId}`、`POST /api/v1/databases/{id}/autofill`
- **检索与 AI**：`GET /api/v1/search?q=...`、`POST /api/v1/search/reindex`、`GET|POST /api/v1/ai/providers`、`PATCH|DELETE /api/v1/ai/providers/{id}`、`POST /api/v1/ai/providers/{id}/test`、`GET|PUT /api/v1/ai/routing`、`GET|POST /api/v1/ai/prompts`、`DELETE /api/v1/ai/prompts/{id}`、`POST /api/v1/ai/stream` (SSE)、`POST /api/v1/ai/summarize` (SSE)
- **AI Agent**：`GET|POST /api/v1/ai/conversations`、`DELETE /api/v1/ai/conversations/{id}`、`GET|POST /api/v1/ai/conversations/{id}/messages` (SSE)、`POST .../actions/{actionId}/confirm|reject`
- **模板、分享、剪藏与 IO**：`GET /api/v1/templates`、`POST /api/v1/templates/from-page`、`POST /api/v1/templates/{id}/instantiate`、`DELETE /api/v1/templates/{id}`、`GET|PUT|DELETE /api/v1/pages/{id}/share`、`GET /api/v1/public/share/{token}`、`POST /api/v1/public/share/{token}/verify`、`POST /api/v1/clip`、`GET /api/v1/pages/{id}/export/markdown|html`、`POST /api/v1/import/markdown|notion-zip`、`GET /api/v1/backup/download`、`POST /api/v1/backup/restore`、`POST /api/v1/assets/upload`

---

## 8. 常见问题排查 (FAQ)

<details>
<summary><b>Q1：重启容器或二进制后，原来保存的 AI API Key 提示解密失败？</b></summary>

确保你没有在未设置 `WOQU_MASTER_KEY` 的情况下丢失或删除了 `data/.secrets.json`。在 Docker 中务必将 `./data` 挂载到 `/app/data`。

</details>

<details>
<summary><b>Q2：忘记了工作区登录密码怎么办？</b></summary>

如果拥有服务器或本地磁盘权限，可以用 SQLite 客户端打开 `data/woqu.db`，删除 `app_settings` 表中 `key = 'password_hash'` 的记录（或将 `key = 'local_no_auth'` 设为 `'true'`）后重启服务，即可重新设置密码或免登录进入。

</details>

<details>
<summary><b>Q3：AI 返回的文字一卡一顿整段出现，不是打字机流式效果？</b></summary>

请检查前置 Nginx / Cloudflare / 反向代理是否开启了响应缓冲（参考上文第 5 节加上 `proxy_buffering off;`）。

</details>

<details>
<summary><b>Q4：在 Docker 中配置本地 Ollama 时连接超时？</b></summary>

容器内部的 `localhost` 指向容器自身而不是宿主机。请将 Ollama Base URL 设为 `http://host.docker.internal:11434/v1`，并确认宿主机 Ollama 设置了 `OLLAMA_HOST=0.0.0.0`。

</details>
