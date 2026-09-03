package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func testSettings(upstreamURL string) config {
	return config{
		apiBaseURL:    upstreamURL,
		apiKey:        "test_server_key",
		projectID:     "pub_test_project",
		partnerOrigin: "https://partner.example",
	}
}

func allowPartnerAccess(_ *http.Request) bool { return true }

func TestSessionForwardsOnlyPinnedHeadersAndOrigin(t *testing.T) {
	var receivedHeaders http.Header
	var receivedBody map[string]any
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/v1/autofill/sessions" {
			t.Fatalf("unexpected upstream path: %s", request.URL.Path)
		}
		receivedHeaders = request.Header.Clone()
		if err := json.NewDecoder(request.Body).Decode(&receivedBody); err != nil {
			t.Fatalf("decode upstream body: %v", err)
		}
		writer.Header().Set("Content-Type", "application/json")
		writer.WriteHeader(http.StatusCreated)
		_, _ = writer.Write([]byte(`{"success":true,"request_id":"req_synthetic","data":{}}`))
	}))
	defer upstream.Close()

	handler := partnerHandler(testSettings(upstream.URL), &rateLimiter{windows: map[string][]time.Time{}}, allowPartnerAccess, "session")
	request := httptest.NewRequest(http.MethodPost, "/api/consulta-autofill/session", bytes.NewBufferString(`{"protocol_version":1,"document_type":"cnh-e"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://partner.example")
	recorder := httptest.NewRecorder()

	handler(recorder, request)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("expected no-store response, got %q", recorder.Header().Get("Cache-Control"))
	}
	if receivedHeaders.Get("X-API-Key") != "test_server_key" || receivedHeaders.Get("X-Consulta-Product") != "autofill" || receivedHeaders.Get("X-Consulta-Project-ID") != "pub_test_project" {
		t.Fatalf("upstream headers were not pinned: %#v", receivedHeaders)
	}
	if receivedBody["partner_origin"] != "https://partner.example" || receivedBody["document_type"] != "cnh-e" {
		t.Fatalf("upstream body was not server-owned: %#v", receivedBody)
	}
}

func TestRejectsCrossOriginAndMetricFieldsBeforeUpstream(t *testing.T) {
	settings := testSettings("http://127.0.0.1:1")
	limiter := &rateLimiter{windows: map[string][]time.Time{}}

	sessionHandler := partnerHandler(settings, limiter, allowPartnerAccess, "session")
	wrongOrigin := httptest.NewRequest(http.MethodPost, "/api/consulta-autofill/session", bytes.NewBufferString(`{"protocol_version":1,"document_type":"auto"}`))
	wrongOrigin.Header.Set("Content-Type", "application/json")
	wrongOrigin.Header.Set("Origin", "https://attacker.example")
	wrongOriginResponse := httptest.NewRecorder()
	sessionHandler(wrongOriginResponse, wrongOrigin)
	if wrongOriginResponse.Code != http.StatusForbidden {
		t.Fatalf("expected origin rejection, got %d", wrongOriginResponse.Code)
	}

	missingOrigin := httptest.NewRequest(http.MethodPost, "/api/consulta-autofill/session", bytes.NewBufferString(`{"protocol_version":1,"document_type":"auto"}`))
	missingOrigin.Header.Set("Content-Type", "application/json")
	missingOriginResponse := httptest.NewRecorder()
	sessionHandler(missingOriginResponse, missingOrigin)
	if missingOriginResponse.Code != http.StatusForbidden {
		t.Fatalf("expected missing origin rejection, got %d", missingOriginResponse.Code)
	}

	metricHandler := partnerHandler(settings, limiter, allowPartnerAccess, "metrics")
	extraMetric := httptest.NewRequest(http.MethodPost, "/api/consulta-autofill/metrics", bytes.NewBufferString(`{"protocol_version":1,"session_token":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","event":"filled","fields":{"cpf":"00000000000"}}`))
	extraMetric.Header.Set("Content-Type", "application/json")
	extraMetric.Header.Set("Origin", "https://partner.example")
	extraMetricResponse := httptest.NewRecorder()
	metricHandler(extraMetricResponse, extraMetric)
	if extraMetricResponse.Code != http.StatusBadRequest {
		t.Fatalf("expected extra metric fields rejection, got %d", extraMetricResponse.Code)
	}
}

func TestRejectsAnonymousRequestBeforeUpstream(t *testing.T) {
	handler := partnerHandler(testSettings("http://127.0.0.1:1"), &rateLimiter{windows: map[string][]time.Time{}}, denyPartnerAccess, "session")
	request := httptest.NewRequest(http.MethodPost, "/api/consulta-autofill/session", bytes.NewBufferString(`{"protocol_version":1,"document_type":"auto"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://partner.example")
	recorder := httptest.NewRecorder()

	handler(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected anonymous request rejection, got %d: %s", recorder.Code, recorder.Body.String())
	}
}
