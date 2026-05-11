# LibreRTC Node

LibreRTC Node is the server-side process manager and admin API for LibreRTC deployments.

It runs multiple RTC tunnel server instances, exposes a local admin panel, and provides versioned API endpoints for automation and future clients.

## Current Scope

This repository is focused on the server node MVP:

- local admin panel at `/admin`;
- first-run admin password setup;
- versioned API under `/api/v1`;
- per-client subscriptions and QR payloads;
- process supervision for tunnel locations;
- quota metadata and runtime diagnostics;
- Docker deployment that is safe for VPS hosts with existing projects.

Client applications are intentionally out of scope until the server API and deployment model are stable.

## Requirements

Runtime requirements on Linux:

```sh
ip
iptables
tc
```

The node creates network namespaces, veth interfaces, routes, iptables rules, and optional traffic limits. Docker deployment therefore requires additional network capabilities; see `deploy/docker/README.md`.

## Build

Build frontend assets first, then build the Go binary so the panel is embedded into the node binary:

```sh
pnpm install
pnpm build
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o librertc-node ./cmd/olcrtc-manager
```

Run tests:

```sh
go test ./...
```

## Docker Deployment

Docker deployment files live in `deploy/docker`.

Defaults are intentionally conservative:

- binds to `127.0.0.1` only;
- uses host port `18888`;
- uses `librertc-node-*` Docker resources;
- does not use `network_mode: host`;
- does not edit firewall or reverse proxy configuration.

Initialize local deployment files:

```sh
sh deploy/docker/install.sh init
```

Read the full deployment guide before starting on a VPS:

```text
deploy/docker/README.md
```

## API

Current versioned endpoints:

- `GET /api/v1/health`
- `GET /api/v1/server/info`
- `GET /api/v1/diagnostics`
- `GET /api/v1/clients/{client_id}/subscription`
- `GET /api/v1/clients/{client_id}/qr`

Responses use a stable envelope:

```json
{
  "ok": true,
  "data": {}
}
```

Errors use:

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {}
  }
}
```

## Configuration

The node reads a JSON config passed through `-config`.

Minimal shape:

```json
{
  "version": 1,
  "name": "LibreRTC Node",
  "port": 8888,
  "clients": [
    {
      "client-id": "default",
      "quota": {
        "speed_mbps": 0,
        "traffic_gb": 0
      },
      "locations": [
        {
          "name": "Default",
          "endpoint": {
            "room_id": "concrete-room-id",
            "key": "64-hex-character-key"
          },
          "carrier": "wbstream",
          "transport": {
            "type": "datachannel"
          },
          "link": "direct",
          "data": "data",
          "dns": "1.1.1.1:53"
        }
      ]
    }
  ]
}
```

`endpoint.room_id` must be concrete. Placeholder values are rejected by deployment preflight checks.
