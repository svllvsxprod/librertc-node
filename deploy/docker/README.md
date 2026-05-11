# LibreRTC Node Docker Deployment

This deployment is intentionally isolated for VPS hosts that may already run other projects.

Defaults:

- container name: `librertc-node`
- Docker network: `librertc-node`
- Docker volumes: `librertc-node-*`
- host bind: `127.0.0.1`
- host port: `18888`
- container port: `8888`
- no `network_mode: host`

## Prepare

Build the matching `olcrtc` Linux binary from LibreRTC Core:

```bash
sh deploy/docker/install.sh build-core
```

This writes the binary here:

```text
deploy/docker/bin/olcrtc
```

Then run the installer initialization step:

```bash
sh deploy/docker/install.sh init
```

Change `LIBRERTC_NODE_HOST_PORT` if `18888` is already used.

Replace the placeholder `room_id` and `key` values in `deploy/docker/local/config.json` before starting. The container refuses to auto-create a fake runtime config because invalid tunnel secrets would make the service fail later and hide the real setup problem.

Run preflight checks:

```bash
sh deploy/docker/install.sh check
```

## Start

```bash
sh deploy/docker/install.sh start
```

Open from the VPS itself or through an explicitly configured reverse proxy:

```text
http://127.0.0.1:18888/admin
```

## Safety Notes

- Do not publish the panel to `0.0.0.0` without HTTPS and access control.
- Direct public binding requires `LIBRERTC_ALLOW_PUBLIC_BIND=1`; keep `127.0.0.1` when using a reverse proxy.
- Do not reuse Docker network or volume names from other projects.
- This container needs network administration capabilities for namespaces, veth, iptables, and traffic limits.
- The compose file does not edit host firewall or reverse proxy configuration.
- If the VPS already runs a reverse proxy, add a dedicated upstream to `127.0.0.1:18888` instead of changing this compose file to bind publicly.

## Health Check

```bash
curl -fsS http://127.0.0.1:18888/api/v1/health
```

Or use:

```bash
sh deploy/docker/install.sh health
```

## Operations

```bash
sh deploy/docker/install.sh status
sh deploy/docker/install.sh logs
sh deploy/docker/install.sh restart
sh deploy/docker/install.sh stop
```
