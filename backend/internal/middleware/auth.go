package middleware

import (
	"encoding/json"
	"net/http"
	"strings"

	"woqu/backend/internal/services"
)

const AuthCookieName = "woqu_token"

// AuthMiddleware protects API routes unless local_no_auth mode is active.
func AuthMiddleware(authSvc *services.AuthService, jwtSecret []byte) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if authSvc.IsLocalNoAuth() {
				next.ServeHTTP(w, r)
				return
			}

			tokenStr := ""
			if c, err := r.Cookie(AuthCookieName); err == nil {
				tokenStr = c.Value
			}
			if tokenStr == "" {
				authHeader := r.Header.Get("Authorization")
				if strings.HasPrefix(authHeader, "Bearer ") {
					tokenStr = strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
				}
			}

			if tokenStr == "" || !authSvc.VerifySessionToken(tokenStr) {
				w.Header().Set("Content-Type", "application/json; charset=utf-8")
				w.WriteHeader(http.StatusUnauthorized)
				_ = json.NewEncoder(w).Encode(map[string]string{
					"error": "unauthorized",
				})
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// CORSMiddleware allows frontend dev server requests when DevMode is enabled.
func CORSMiddleware(devMode bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if devMode {
				origin := r.Header.Get("Origin")
				if origin == "" {
					origin = "http://localhost:5173"
				}
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
				if r.Method == http.MethodOptions {
					w.WriteHeader(http.StatusNoContent)
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}
