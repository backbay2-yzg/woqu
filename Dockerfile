# Stage 1: Build Frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
RUN corepack enable
COPY frontend/package.json frontend/pnpm-workspace.yaml frontend/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install
COPY frontend/ ./
RUN pnpm build

# Stage 2: Build Go Single Binary (Pure Go SQLite, CGO_ENABLED=0)
FROM golang:1.24-alpine AS backend-builder
WORKDIR /app/backend
ENV GOPROXY=https://goproxy.cn,direct
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
COPY --from=frontend-builder /app/frontend/dist ./internal/static/dist
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /woqu ./cmd/woqu

# Stage 3: Minimal Runtime Image
FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata wget
WORKDIR /app
COPY --from=backend-builder /woqu /app/woqu
RUN mkdir -p /app/data/uploads
VOLUME ["/app/data"]
EXPOSE 8080
ENV WOQU_PORT=8080 \
    WOQU_DATA_DIR=/app/data
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/v1/health || exit 1
ENTRYPOINT ["/app/woqu"]
