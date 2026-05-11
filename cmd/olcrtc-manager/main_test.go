package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
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

	req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	for _, cookie := range rec.Result().Cookies() {
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
	apiV1ClientsHandler(supervisor).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/clients", nil))

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
	apiV1ClientsHandler(supervisor).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/clients/user", nil))

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
	apiV1ClientsHandler(supervisor).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/clients/user/subscription", nil))

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
	apiV1ClientsHandler(supervisor).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/clients/user/qr", nil))

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
	apiV1ClientsHandler(supervisor).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/clients/missing/subscription", nil))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "CLIENT_NOT_FOUND") {
		t.Fatalf("response missing stable error code: %s", rec.Body.String())
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
