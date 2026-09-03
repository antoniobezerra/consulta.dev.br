package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
)

const maxBodyBytes = 1_000_000

var payloadPattern = regexp.MustCompile(`^[A-Za-z0-9+/]+={0,2}$`)

type config struct {
	apiBaseURL    string
	apiKey        string
	projectID     string
	partnerOrigin string
}

type sessionRequest struct {
	ProtocolVersion int    `json:"protocol_version"`
	DocumentType    string `json:"document_type"`
}

type decodeRequest struct {
	ProtocolVersion int    `json:"protocol_version"`
	SessionToken    string `json:"session_token"`
	PayloadBase64   string `json:"payload_base64"`
	IncludePhoto    *bool  `json:"include_photo"`
}

type rateLimiter struct {
	mu      sync.Mutex
	windows map[string][]time.Time
}

func (r *rateLimiter) allow(key string, limit int) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	entries := r.windows[key]
	cutoff := now.Add(-time.Minute)
	kept := entries[:0]
	for _, entry := range entries {
		if entry.After(cutoff) {
			kept = append(kept, entry)
		}
	}
	if len(kept) >= limit {
		r.windows[key] = kept
		return false
	}
	r.windows[key] = append(kept, now)
	return true
}

func main() {
	settings := loadConfig()
	limiter := &rateLimiter{windows: map[string][]time.Time{}}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/consulta-autofill/session", partnerHandler(settings, limiter, "session"))
	mux.HandleFunc("POST /api/consulta-autofill/decode", partnerHandler(settings, limiter, "decode"))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	server := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	slog.Info("Consulta Autofill partner bridge listening", "port", port)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server stopped", "reason", err.Error())
		os.Exit(1)
	}
}

func loadConfig() config {
	settings := config{
		apiBaseURL:    strings.TrimRight(defaultValue(os.Getenv("CONSULTA_API_BASE_URL"), "https://consulta.dev.br"), "/"),
		apiKey:        os.Getenv("CONSULTA_API_KEY"),
		projectID:     os.Getenv("CONSULTA_PROJECT_ID"),
		partnerOrigin: os.Getenv("CONSULTA_PARTNER_ORIGIN"),
	}
	if settings.apiKey == "" || settings.projectID == "" || settings.partnerOrigin == "" {
		panic("define CONSULTA_API_KEY, CONSULTA_PROJECT_ID and CONSULTA_PARTNER_ORIGIN in server environment")
	}
	origin, err := url.Parse(settings.partnerOrigin)
	if err != nil || origin.String() != settings.partnerOrigin || origin.Scheme != "https" || origin.Host == "" || origin.User != nil || origin.Path != "" || origin.RawQuery != "" || origin.Fragment != "" {
		panic("CONSULTA_PARTNER_ORIGIN must be an exact HTTPS origin")
	}
	return settings
}

func partnerHandler(settings config, limiter *rateLimiter, action string) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		if origin := request.Header.Get("Origin"); origin != "" && origin != settings.partnerOrigin {
			writeError(writer, "INVALID_ORIGIN", "Origem não autorizada.", http.StatusForbidden)
			return
		}
		if !requirePartnerAccess(request) {
			writeError(writer, "UNAUTHENTICATED", "Não autorizado.", http.StatusUnauthorized)
			return
		}
		ip, _, _ := net.SplitHostPort(request.RemoteAddr)
		if !limiter.allow(action+":"+ip, map[string]int{"session": 20, "decode": 60}[action]) {
			writeError(writer, "RATE_LIMITED", "Muitas solicitações; tente novamente em breve.", http.StatusTooManyRequests)
			return
		}

		var body any
		var path string
		if action == "session" {
			var input sessionRequest
			if !decodeStrictJSON(writer, request, &input) || !validSession(input) {
				writeError(writer, "INVALID_REQUEST", "Sessão Autofill inválida.", http.StatusBadRequest)
				return
			}
			body = map[string]any{"protocol_version": input.ProtocolVersion, "document_type": input.DocumentType, "partner_origin": settings.partnerOrigin}
			path = "/api/v1/autofill/sessions"
		} else {
			var input decodeRequest
			if !decodeStrictJSON(writer, request, &input) || !validDecode(input) {
				writeError(writer, "INVALID_REQUEST", "Decode Autofill inválido.", http.StatusBadRequest)
				return
			}
			body = input
			path = "/api/v1/autofill/decode"
		}
		forward(writer, request.Context(), settings, path, body)
	}
}

func requirePartnerAccess(_ *http.Request) bool {
	// TODO: conecte à sessão/RBAC do seu produto. Nunca escolha projeto por dado do browser.
	return true
}

func decodeStrictJSON(writer http.ResponseWriter, request *http.Request, target any) bool {
	request.Body = http.MaxBytesReader(writer, request.Body, maxBodyBytes)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return false
	}
	return decoder.Decode(&struct{}{}) == io.EOF
}

func validSession(input sessionRequest) bool {
	return input.ProtocolVersion == 1 && (input.DocumentType == "auto" || input.DocumentType == "cnh-e" || input.DocumentType == "crlv-e")
}

func validDecode(input decodeRequest) bool {
	return input.ProtocolVersion == 1 && input.IncludePhoto != nil && len(input.SessionToken) >= 32 && len(input.SessionToken) <= 4096 && len(input.PayloadBase64) >= 4 && len(input.PayloadBase64) <= maxBodyBytes && payloadPattern.MatchString(input.PayloadBase64)
}

func forward(writer http.ResponseWriter, parent context.Context, settings config, path string, body any) {
	encoded, err := json.Marshal(body)
	if err != nil {
		writeError(writer, "INTERNAL_ERROR", "Erro interno.", http.StatusInternalServerError)
		return
	}
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, settings.apiBaseURL+path, strings.NewReader(string(encoded)))
	if err != nil {
		writeError(writer, "UPSTREAM_UNAVAILABLE", "Serviço temporariamente indisponível.", http.StatusServiceUnavailable)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", settings.apiKey)
	req.Header.Set("X-Consulta-Product", "autofill")
	req.Header.Set("X-Consulta-Project-ID", settings.projectID)
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		// Não logue body, token, QR, foto ou campos.
		writeError(writer, "UPSTREAM_UNAVAILABLE", "Serviço temporariamente indisponível.", http.StatusServiceUnavailable)
		return
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 6*1024*1024))
	if err != nil || !json.Valid(data) {
		writeError(writer, "UPSTREAM_UNAVAILABLE", "Serviço temporariamente indisponível.", http.StatusServiceUnavailable)
		return
	}
	writer.Header().Set("Content-Type", "application/json")
	writer.Header().Set("Cache-Control", "no-store")
	writer.WriteHeader(response.StatusCode)
	_, _ = writer.Write(data)
}

func writeError(writer http.ResponseWriter, code, message string, status int) {
	writer.Header().Set("Content-Type", "application/json")
	writer.Header().Set("Cache-Control", "no-store")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(map[string]any{
		"success":    false,
		"error":      map[string]any{"code": code, "message": message, "retryable": status >= 500},
		"request_id": "partner_local",
	})
}

func defaultValue(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
