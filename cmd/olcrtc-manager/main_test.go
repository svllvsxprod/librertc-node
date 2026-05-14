package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSubscriptionUsesDocumentedPayloadKeys(t *testing.T) {
	cfg := Config{
		Name: "ScumVPN",
		Port: 8888,
		Locations: []Location{
			{
				Name:     "Netherlands",
				ClientID: "user",
				Endpoint: Endpoint{RoomID: "room-01", Key: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
				Carrier:  "wbstream",
				Transport: Transport{
					Type: "vp8channel",
					Payload: map[string]string{
						"vp8-fps":   "60",
						"vp8-batch": "64",
					},
				},
				Link: "direct",
				Data: "data",
				DNS:  "1.1.1.1:53",
			},
		},
	}

	got := subscription(cfg, time.Unix(1778011200, 0))

	want := "olcrtc://wbstream?vp8channel<vp8-batch=64&vp8-fps=60>@room-01#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa%user$Netherlands"
	if !strings.Contains(got, want) {
		t.Fatalf("subscription missing URI\nwant: %s\ngot:\n%s", want, got)
	}
	if !strings.Contains(got, "#name: ScumVPN\n#update: 1778011200") {
		t.Fatalf("subscription missing global metadata:\n%s", got)
	}
	if !strings.Contains(got, "##name: Netherlands") {
		t.Fatalf("subscription missing location metadata:\n%s", got)
	}
}

func TestServerArgsMapPayloadToCLIFlags(t *testing.T) {
	loc := Location{
		ClientID: "user",
		Endpoint: Endpoint{RoomID: "room-01", Key: "key"},
		Carrier:  "jazz",
		Transport: Transport{
			Type: "seichannel",
			Payload: map[string]string{
				"fps":    "60",
				"batch":  "64",
				"frag":   "900",
				"ack-ms": "2000",
			},
		},
		Link: "direct",
		Data: "data",
		DNS:  "1.1.1.1:53",
	}

	got := strings.Join(serverArgs(loc), " ")
	for _, part := range []string{
		"-mode srv",
		"-carrier jazz",
		"-transport seichannel",
		"-id room-01",
		"-client-id user",
		"-ack-ms 2000",
		"-batch 64",
		"-fps 60",
		"-frag 900",
	} {
		if !strings.Contains(got, part) {
			t.Fatalf("server args missing %q in %q", part, got)
		}
	}
}

func TestSubscriptionForClientIncludesOnlyClientLocations(t *testing.T) {
	userLoc := testLocation("room-01", "Netherlands")
	otherLoc := testLocation("room-02", "Germany")
	otherLoc.ClientID = "other"
	cfg := testConfig(userLoc, otherLoc)

	got, ok := subscriptionForClient(cfg, "user", time.Unix(1778011200, 0))
	if !ok {
		t.Fatal("subscriptionForClient returned ok=false")
	}
	if !strings.Contains(got, "$Netherlands") {
		t.Fatalf("subscription missing user location:\n%s", got)
	}
	if strings.Contains(got, "$Germany") {
		t.Fatalf("subscription included another client's location:\n%s", got)
	}
}

func TestSubscriptionForClientIncludesQuotaMetadata(t *testing.T) {
	loc := testLocation("room-01", "Netherlands")
	cfg := Config{
		Name: "ScumVPN",
		Port: 8888,
		Clients: []Client{
			{
				ClientID: "user",
				Quota: Quota{
					SpeedMbps: 50,
					TrafficGB: 100,
					UsedGB:    25,
					ExpiresAt: "2026-06-01",
				},
				Locations: []Location{loc},
			},
		},
		Locations: []Location{loc},
	}

	got, ok := subscriptionForClient(cfg, "user", time.Unix(1778011200, 0))
	if !ok {
		t.Fatal("subscriptionForClient returned ok=false")
	}
	for _, want := range []string{
		"#quota-speed-mbps: 50",
		"#quota-traffic-gb: 100",
		"#quota-used-gb: 25",
		"#quota-expires-at: 2026-06-01",
		"#quota-status: active",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("subscription missing %q:\n%s", want, got)
		}
	}
}

func TestSubscriptionForClientRejectsUnknownClient(t *testing.T) {
	cfg := testConfig(testLocation("room-01", "Netherlands"))

	if got, ok := subscriptionForClient(cfg, "missing", time.Unix(1778011200, 0)); ok || got != "" {
		t.Fatalf("subscriptionForClient = %q, %v; want empty, false", got, ok)
	}
}

func TestSubscriptionHandlerServesClientPath(t *testing.T) {
	supervisor := NewSupervisor("olcrtc", func(ctx context.Context, path string, loc Location) (*process, error) {
		return &process{location: loc, logs: newLogBuffer(1), running: true}, nil
	})
	loc := testLocation("room-01", "Netherlands")
	if err := supervisor.StartAll(context.Background(), testConfig(loc)); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/user/", nil)
	rec := httptest.NewRecorder()
	subscriptionHandler(supervisor).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Body.String(); !strings.Contains(got, "%user$Netherlands") {
		t.Fatalf("response missing user subscription:\n%s", got)
	}
}

func TestSubscriptionHandlerRejectsRootAndUnknownClient(t *testing.T) {
	supervisor := NewSupervisor("olcrtc", func(ctx context.Context, path string, loc Location) (*process, error) {
		return &process{location: loc, logs: newLogBuffer(1), running: true}, nil
	})
	if err := supervisor.StartAll(context.Background(), testConfig(testLocation("room-01", "Netherlands"))); err != nil {
		t.Fatal(err)
	}

	for _, path := range []string{"/", "/missing", "/user/extra"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		subscriptionHandler(supervisor).ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("%s status = %d, want %d", path, rec.Code, http.StatusNotFound)
		}
	}
}

func TestFirstRunSetupCreatesAdminSession(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.json")
	t.Setenv("OLCRTC_MANAGER_ENV_FILE", filepath.Join(dir, "panel.env"))
	t.Setenv("OLCRTC_MANAGER_USER", "")
	t.Setenv("OLCRTC_MANAGER_PASS", "")
	adminSessions.Clear()

	rec := httptest.NewRecorder()
	authMeHandler(configPath).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/auth/me", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("auth me status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"setup_required": true`) {
		t.Fatalf("auth me did not request setup: %s", rec.Body.String())
	}

	body := bytes.NewBufferString(`{"user":"admin","password":"firstpass123"}`)
	rec = httptest.NewRecorder()
	setupHandler(configPath).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/auth/setup", body))
	if rec.Code != http.StatusOK {
		t.Fatalf("setup status = %d, body = %s", rec.Code, rec.Body.String())
	}
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("setup cookies = %d, want 1", len(cookies))
	}
	if cookies[0].MaxAge < int((29 * 24 * time.Hour).Seconds()) {
		t.Fatalf("session MaxAge = %d, want persistent cookie", cookies[0].MaxAge)
	}
	if !newSessionStore().Valid(cookies[0].Value, "firstpass123") {
		t.Fatal("session cookie is not valid across a new session store")
	}

	req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	rec = httptest.NewRecorder()
	authMeHandler(configPath).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"authenticated": true`) {
		t.Fatalf("auth me after setup status = %d, body = %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	adminAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/state", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("protected status without session = %d, want 401", rec.Code)
	}
}

func TestTemporaryCredentialsRequireSetupAfterLogin(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.json")
	envPath := filepath.Join(dir, "panel.env")
	t.Setenv("OLCRTC_MANAGER_ENV_FILE", envPath)
	t.Setenv("OLCRTC_MANAGER_USER", "")
	t.Setenv("OLCRTC_MANAGER_PASS", "")
	adminSessions.Clear()

	if err := os.WriteFile(envPath, []byte("OLCRTC_MANAGER_USER='temp-admin'\nOLCRTC_MANAGER_PASS='temp-pass-123'\nOLCRTC_MANAGER_SETUP_REQUIRED='1'\nKEEP_ME='yes'\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	loginHandler(configPath).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewBufferString(`{"user":"temp-admin","password":"temp-pass-123"}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("login status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"setup_required": true`) {
		t.Fatalf("login did not require setup: %s", rec.Body.String())
	}
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("login cookies = %d, want 1", len(cookies))
	}

	rec = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/state", nil)
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	adminAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})).ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("protected status before setup = %d, body = %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/api/auth/setup", bytes.NewBufferString(`{"user":"owner","password":"new-pass-123"}`))
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	rec = httptest.NewRecorder()
	setupHandler(configPath).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("setup status = %d, body = %s", rec.Code, rec.Body.String())
	}

	values, err := readEnvFile(envPath)
	if err != nil {
		t.Fatal(err)
	}
	if values["OLCRTC_MANAGER_USER"] != "owner" || values["OLCRTC_MANAGER_PASS"] != "new-pass-123" {
		t.Fatalf("credentials not replaced: %#v", values)
	}
	if values["OLCRTC_MANAGER_SETUP_REQUIRED"] != "0" {
		t.Fatalf("setup flag = %q, want 0", values["OLCRTC_MANAGER_SETUP_REQUIRED"])
	}
	if values["KEEP_ME"] != "yes" {
		t.Fatalf("unrelated env key was not preserved: %#v", values)
	}
}

func TestAPIV1HealthUsesStableEnvelope(t *testing.T) {
	supervisor := NewSupervisor("olcrtc", func(ctx context.Context, path string, loc Location) (*process, error) {
		return &process{location: loc, logs: newLogBuffer(1), running: true}, nil
	})
	if err := supervisor.StartAll(context.Background(), testConfig(testLocation("room-01", "Netherlands"))); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	apiV1HealthHandler(supervisor).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/health", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["ok"] != true {
		t.Fatalf("ok = %v, body = %s", body["ok"], rec.Body.String())
	}
	data := body["data"].(map[string]any)
	if data["status"] != "ok" || data["service"] != appName {
		t.Fatalf("unexpected health data: %#v", data)
	}
}

func TestAPIV1RejectsWrongMethodWithStableError(t *testing.T) {
	supervisor := NewSupervisor("olcrtc", func(ctx context.Context, path string, loc Location) (*process, error) {
		return &process{location: loc, logs: newLogBuffer(1), running: true}, nil
	})

	rec := httptest.NewRecorder()
	apiV1HealthHandler(supervisor).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/health", nil))

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"ok": false`) || !strings.Contains(rec.Body.String(), "METHOD_NOT_ALLOWED") {
		t.Fatalf("response does not use API error envelope: %s", rec.Body.String())
	}
}

func TestAPIV1DiagnosticsDoesNotExposeLocationSecrets(t *testing.T) {
	supervisor := NewSupervisor("olcrtc", func(ctx context.Context, path string, loc Location) (*process, error) {
		return &process{location: loc, logs: newLogBuffer(1), running: true}, nil
	})
	loc := testLocation("room-01", "Netherlands")
	loc.Endpoint.Key = "super-secret-key"
	if err := supervisor.StartAll(context.Background(), testConfig(loc)); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	apiV1DiagnosticsHandler(supervisor, "olcrtc").ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/diagnostics", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	body := rec.Body.String()
	for _, secret := range []string{"super-secret-key", "olcrtc://", "room-01"} {
		if strings.Contains(body, secret) {
			t.Fatalf("diagnostics exposed %q: %s", secret, body)
		}
	}
	if !strings.Contains(body, `"location_count": 1`) {
		t.Fatalf("diagnostics missing location count: %s", body)
	}
}

func TestAPIV1ClientsListUsesStableEnvelope(t *testing.T) {
	supervisor := NewSupervisor("olcrtc", func(ctx context.Context, path string, loc Location) (*process, error) {
		return &process{location: loc, logs: newLogBuffer(1), running: true}, nil
	})
	if err := supervisor.StartAll(context.Background(), testConfig(testLocation("room-01", "Netherlands"))); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	apiV1ClientsHandler(supervisor, "", "", nil).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/clients", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	body := rec.Body.String()
	for _, want := range []string{`"ok": true`, `"count": 1`, `"client_id": "user"`, `"location_count": 1`, `"running_count": 1`, `"subscription_url": "/api/v1/clients/user/subscription"`, `"qr_url": "/api/v1/clients/user/qr"`} {
		if !strings.Contains(body, want) {
			t.Fatalf("clients list missing %q: %s", want, body)
		}
	}
}

func TestAPIV1ClientDetailUsesStableEnvelope(t *testing.T) {
	supervisor := NewSupervisor("olcrtc", func(ctx context.Context, path string, loc Location) (*process, error) {
		return &process{location: loc, logs: newLogBuffer(1), running: true}, nil
	})
	if err := supervisor.StartAll(context.Background(), testConfig(testLocation("room-01", "Netherlands"))); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	apiV1ClientsHandler(supervisor, "", "", nil).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/clients/user", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	body := rec.Body.String()
	for _, want := range []string{`"ok": true`, `"client_id": "user"`, `"quota_status": "active"`, `"locations"`, `"room_id": "room-01"`, `"uri": "olcrtc://`} {
		if !strings.Contains(body, want) {
			t.Fatalf("client detail missing %q: %s", want, body)
		}
	}
}

func TestAPIV1ClientSubscriptionUsesStableEnvelope(t *testing.T) {
	supervisor := NewSupervisor("olcrtc", func(ctx context.Context, path string, loc Location) (*process, error) {
		return &process{location: loc, logs: newLogBuffer(1), running: true}, nil
	})
	if err := supervisor.StartAll(context.Background(), testConfig(testLocation("room-01", "Netherlands"))); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	apiV1ClientsHandler(supervisor, "", "", nil).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/clients/user/subscription", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"ok": true`) || !strings.Contains(body, `"client_id": "user"`) {
		t.Fatalf("response does not use API envelope: %s", body)
	}
	if !strings.Contains(body, "olcrtc://") || !strings.Contains(body, "%user$Netherlands") {
		t.Fatalf("response missing subscription: %s", body)
	}
}

func TestAPIV1ClientQRReturnsRenderablePayload(t *testing.T) {
	supervisor := NewSupervisor("olcrtc", func(ctx context.Context, path string, loc Location) (*process, error) {
		return &process{location: loc, logs: newLogBuffer(1), running: true}, nil
	})
	if err := supervisor.StartAll(context.Background(), testConfig(testLocation("room-01", "Netherlands"))); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	apiV1ClientsHandler(supervisor, "", "", nil).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/clients/user/qr", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	body := rec.Body.String()
	for _, want := range []string{`"format": "text"`, `"payload"`, "olcrtc://"} {
		if !strings.Contains(body, want) {
			t.Fatalf("QR response missing %q: %s", want, body)
		}
	}
}

func TestAPIV1ClientEndpointRejectsUnknownClient(t *testing.T) {
	supervisor := NewSupervisor("olcrtc", func(ctx context.Context, path string, loc Location) (*process, error) {
		return &process{location: loc, logs: newLogBuffer(1), running: true}, nil
	})
	if err := supervisor.StartAll(context.Background(), testConfig(testLocation("room-01", "Netherlands"))); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	apiV1ClientsHandler(supervisor, "", "", nil).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/clients/missing/subscription", nil))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "CLIENT_NOT_FOUND") {
		t.Fatalf("response missing stable error code: %s", rec.Body.String())
	}
}

func TestAPIV1ClientUpdateMutatesConfigAndReloads(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.json")
	loc := testLocation("room-01", "Netherlands")
	other := testLocation("room-02", "Germany")
	other.ClientID = "other"
	if err := saveConfigWithoutBackup(configPath, testConfig(loc, other)); err != nil {
		t.Fatal(err)
	}
	reloads := 0
	body := bytes.NewBufferString(`{"quota":{"speed_mbps":25},"carrier":"wbstream","transport":"datachannel","dns":"1.1.1.1:53","name":"Updated"}`)
	rec := httptest.NewRecorder()

	apiV1ClientsHandler(nil, configPath, "olcrtc", func() error {
		reloads++
		return nil
	}).ServeHTTP(rec, httptest.NewRequest(http.MethodPatch, "/api/v1/clients/user", body))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if reloads != 1 {
		t.Fatalf("reloads = %d, want 1", reloads)
	}
	cfg, err := loadConfig(configPath)
	if err != nil {
		t.Fatal(err)
	}
	client, ok := testClientByID(cfg, "user")
	if !ok {
		t.Fatalf("updated client not found: %#v", cfg.Clients)
	}
	if got := client.Quota.SpeedMbps; got != 25 {
		t.Fatalf("speed_mbps = %d, want 25", got)
	}
	if got := client.Locations[0].Name; got != "Updated" {
		t.Fatalf("location name = %q, want Updated", got)
	}
}

func TestAPIV1ClientDeleteMutatesConfigAndReloads(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.json")
	loc := testLocation("room-01", "Netherlands")
	other := testLocation("room-02", "Germany")
	other.ClientID = "other"
	if err := saveConfigWithoutBackup(configPath, testConfig(loc, other)); err != nil {
		t.Fatal(err)
	}
	reloads := 0
	rec := httptest.NewRecorder()

	apiV1ClientsHandler(nil, configPath, "olcrtc", func() error {
		reloads++
		return nil
	}).ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/api/v1/clients/other", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if reloads != 1 {
		t.Fatalf("reloads = %d, want 1", reloads)
	}
	cfg, err := loadConfig(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.Clients) != 1 || cfg.Clients[0].ClientID != "user" {
		t.Fatalf("clients after delete = %#v", cfg.Clients)
	}
}

func TestAPIV1ClientCreateValidationUsesStableError(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.json")
	if err := saveConfigWithoutBackup(configPath, testConfig(testLocation("room-01", "Netherlands"))); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()

	apiV1ClientsHandler(nil, configPath, "olcrtc", func() error {
		t.Fatal("reload must not run on failed create")
		return nil
	}).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/clients", bytes.NewBufferString(`{}`)))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "CLIENT_CREATE_FAILED") {
		t.Fatalf("response missing stable error code: %s", rec.Body.String())
	}
}

func TestAPIV1ClientCreateUsesManualRoomID(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.json")
	if err := saveConfigWithoutBackup(configPath, testConfig(testLocation("room-01", "Netherlands"))); err != nil {
		t.Fatal(err)
	}
	reloads := 0
	body := bytes.NewBufferString(`{"client_id":"manual","room_id":"manual-room","carrier":"wbstream","transport":"datachannel","dns":"1.1.1.1:53","name":"Manual"}`)
	rec := httptest.NewRecorder()

	apiV1ClientsHandler(nil, configPath, filepath.Join(t.TempDir(), "missing-olcrtc"), func() error {
		reloads++
		return nil
	}).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/clients", body))

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if reloads != 1 {
		t.Fatalf("reloads = %d, want 1", reloads)
	}
	cfg, err := loadConfig(configPath)
	if err != nil {
		t.Fatal(err)
	}
	client, ok := testClientByID(cfg, "manual")
	if !ok {
		t.Fatalf("created client not found: %#v", cfg.Clients)
	}
	if got := client.Locations[0].Endpoint.RoomID; got != "manual-room" {
		t.Fatalf("room_id = %q, want manual-room", got)
	}
}

func TestAPIV1ClientCreateRequiresManualWBStreamRoomID(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.json")
	if err := saveConfigWithoutBackup(configPath, testConfig(testLocation("room-01", "Netherlands"))); err != nil {
		t.Fatal(err)
	}
	body := bytes.NewBufferString(`{"client_id":"manual","carrier":"wbstream","transport":"datachannel","dns":"1.1.1.1:53","name":"Manual"}`)
	rec := httptest.NewRecorder()

	apiV1ClientsHandler(nil, configPath, filepath.Join(t.TempDir(), "missing-olcrtc"), func() error {
		t.Fatal("reload must not run on failed create")
		return nil
	}).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/clients", body))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "room_id is required for wbstream") {
		t.Fatalf("response missing room_id error: %s", rec.Body.String())
	}
}

func TestAPIV1ReloadUsesStableEnvelope(t *testing.T) {
	reloads := 0
	rec := httptest.NewRecorder()

	apiV1ReloadHandler(func() error {
		reloads++
		return nil
	}).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/reload", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if reloads != 1 || !strings.Contains(rec.Body.String(), `"reloaded": true`) {
		t.Fatalf("unexpected reload response reloads=%d body=%s", reloads, rec.Body.String())
	}
}

func TestConfigRejectsAnyRoomID(t *testing.T) {
	cfg := Config{
		Name: "ScumVPN",
		Port: 8888,
		Locations: []Location{
			{
				ClientID:  "user",
				Endpoint:  Endpoint{RoomID: "any", Key: "key"},
				Carrier:   "wbstream",
				Transport: Transport{Type: "datachannel"},
				Link:      "direct",
				Data:      "data",
				DNS:       "1.1.1.1:53",
			},
		},
	}

	if err := cfg.Validate(); err == nil {
		t.Fatal("expected validation error for room_id=any")
	}
}

func TestConfigAllowsEmptyClients(t *testing.T) {
	cfg := Config{Name: "LibreRTC Node", Port: 8888, Clients: []Client{}}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate() error = %v, want nil", err)
	}
}

func TestTransportUnmarshalPayload(t *testing.T) {
	var cfg Config
	data := []byte(`{
		"version": 4,
		"name": "ScumVPN",
		"port": 8888,
		"locations": [{
			"name": "Netherlands",
			"client-id": "user",
			"endpoint": {"room_id": "room-01", "key": "key"},
			"carrier": "wbstream",
			"transport": {
				"type": "vp8channel",
				"payload": {
					"vp8-fps": 60,
					"vp8-batch": 64
				}
			},
			"link": "direct",
			"data": "data",
			"dns": "1.1.1.1:53"
		}]
	}`)

	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatal(err)
	}
	if got := cfg.Locations[0].Transport.Payload["vp8-fps"]; got != "60" {
		t.Fatalf("vp8-fps = %q, want 60", got)
	}
}

func TestConfigUnmarshalClientsFormat(t *testing.T) {
	var cfg Config
	data := []byte(`{
		"vesion": 1,
		"name": "ScumVPN",
		"port": 8888,
		"clients": [{
			"client-id": "mark",
			"locations": [
				{
					"name": "Netherlands",
					"carrier": "wbstream",
					"transport": {"type": "datachannel"},
					"link": "direct",
					"data": "data",
					"dns": "1.1.1.1:53",
					"endpoint": {"room_id": "room-01", "key": "key"}
				},
				{
					"name": "Netherlands VP8",
					"carrier": "wbstream",
					"transport": {
						"type": "vp8channel",
						"payload": {
							"vp8-fps": 60,
							"vp8-batch": 64
						}
					},
					"link": "direct",
					"data": "data",
					"dns": "1.1.1.1:53",
					"endpoint": {"room_id": "room-02", "key": "key"}
				}
			]
		}]
	}`)

	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatal(err)
	}
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
	if cfg.Version != 1 {
		t.Fatalf("Version = %d, want 1", cfg.Version)
	}
	if len(cfg.Locations) != 2 {
		t.Fatalf("locations = %d, want 2", len(cfg.Locations))
	}
	if got := cfg.Locations[0].ClientID; got != "mark" {
		t.Fatalf("client-id = %q, want mark", got)
	}
	if got := cfg.Locations[1].Transport.Payload["vp8-fps"]; got != "60" {
		t.Fatalf("vp8-fps = %q, want 60", got)
	}
}

func TestSupervisorReloadStartsAddedLocationAndUpdatesSubscription(t *testing.T) {
	loc1 := testLocation("room-01", "Netherlands")
	loc2 := testLocation("room-02", "Germany")
	started := make([]string, 0)
	supervisor := NewSupervisor("olcrtc", func(ctx context.Context, path string, loc Location) (*process, error) {
		started = append(started, locationKey(loc))
		return &process{location: loc, logs: newLogBuffer(1), running: true}, nil
	})

	if err := supervisor.StartAll(context.Background(), testConfig(loc1)); err != nil {
		t.Fatal(err)
	}
	if err := supervisor.Reload(context.Background(), testConfig(loc1, loc2)); err != nil {
		t.Fatal(err)
	}

	if got := strings.Join(started, ","); got != "user:room-01:datachannel,user:room-02:datachannel" {
		t.Fatalf("started = %q, want user:room-01:datachannel,user:room-02:datachannel", got)
	}
	if got := supervisor.Subscription(time.Unix(1778011200, 0)); !strings.Contains(got, "$Germany") {
		t.Fatalf("subscription was not updated:\n%s", got)
	}
}

func TestSupervisorReloadRestartsChangedLocation(t *testing.T) {
	loc := testLocation("room-01", "Netherlands")
	changed := loc
	changed.Endpoint.RoomID = "room-02"
	started := make([]string, 0)
	supervisor := NewSupervisor("olcrtc", func(ctx context.Context, path string, loc Location) (*process, error) {
		started = append(started, loc.Endpoint.RoomID)
		return &process{location: loc, logs: newLogBuffer(1), running: true}, nil
	})

	if err := supervisor.StartAll(context.Background(), testConfig(loc)); err != nil {
		t.Fatal(err)
	}
	if err := supervisor.Reload(context.Background(), testConfig(changed)); err != nil {
		t.Fatal(err)
	}

	if got := strings.Join(started, ","); got != "room-01,room-02" {
		t.Fatalf("started room ids = %q, want room-01,room-02", got)
	}
	if got := supervisor.Subscription(time.Unix(1778011200, 0)); !strings.Contains(got, "@room-02#") {
		t.Fatalf("subscription did not use changed location:\n%s", got)
	}
}

func TestSupervisorReloadFailureKeepsCurrentConfig(t *testing.T) {
	loc1 := testLocation("room-01", "Netherlands")
	loc2 := testLocation("room-02", "Germany")
	startErr := errors.New("boom")
	supervisor := NewSupervisor("olcrtc", func(ctx context.Context, path string, loc Location) (*process, error) {
		if loc.Endpoint.RoomID == "room-02" {
			return nil, startErr
		}
		return &process{location: loc, logs: newLogBuffer(1), running: true}, nil
	})

	if err := supervisor.StartAll(context.Background(), testConfig(loc1)); err != nil {
		t.Fatal(err)
	}
	if err := supervisor.Reload(context.Background(), testConfig(loc1, loc2)); !errors.Is(err, startErr) {
		t.Fatalf("Reload error = %v, want %v", err, startErr)
	}

	if got := supervisor.Subscription(time.Unix(1778011200, 0)); strings.Contains(got, "$Germany") {
		t.Fatalf("failed reload changed subscription:\n%s", got)
	}
}

func TestSupervisorRestartWaitsForOldProcessCleanup(t *testing.T) {
	loc := testLocation("room-01", "Netherlands")
	oldStopped := make(chan struct{})
	starts := 0
	supervisor := NewSupervisor("olcrtc", func(ctx context.Context, path string, loc Location) (*process, error) {
		starts++
		p := &process{location: loc, logs: newLogBuffer(1), running: true, stopped: make(chan struct{})}
		if starts == 1 {
			p.stopped = oldStopped
		}
		return p, nil
	})

	if err := supervisor.StartAll(context.Background(), testConfig(loc)); err != nil {
		t.Fatal(err)
	}

	done := make(chan error, 1)
	go func() {
		done <- supervisor.Restart(context.Background(), loc.ClientID, loc.Endpoint.RoomID, loc.Transport.Type)
	}()

	select {
	case err := <-done:
		t.Fatalf("Restart returned before old process cleanup: %v", err)
	case <-time.After(100 * time.Millisecond):
	}

	close(oldStopped)
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Restart error = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("Restart did not finish after old process cleanup")
	}
	if starts != 2 {
		t.Fatalf("starts = %d, want 2", starts)
	}
}

func testConfig(locations ...Location) Config {
	return Config{
		Name:      "ScumVPN",
		Port:      8888,
		Locations: locations,
	}
}

func testLocation(roomID, name string) Location {
	return Location{
		Name:      name,
		ClientID:  "user",
		Endpoint:  Endpoint{RoomID: roomID, Key: "key"},
		Carrier:   "wbstream",
		Transport: Transport{Type: "datachannel"},
		Link:      "direct",
		Data:      "data",
		DNS:       "1.1.1.1:53",
	}
}

func testClientByID(cfg Config, clientID string) (Client, bool) {
	for _, client := range cfg.Clients {
		if client.ClientID == clientID {
			return client, true
		}
	}
	return Client{}, false
}
