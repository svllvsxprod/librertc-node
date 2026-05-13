# One-Script Panel Deploy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the existing LibreRTC node Docker installer so a clean Ubuntu server can deploy the panel from GitHub with one script, either on a raw port or behind Caddy on a domain.

**Architecture:** Reuse `deploy/docker/install.sh` as the single deployment entrypoint. The script installs prerequisites, clones/updates `/opt/librertc-node`, generates temporary admin credentials, starts Docker Compose, and optionally installs/updates Caddy with a managed reverse-proxy block. The manager treats generated credentials as temporary and forces first-login replacement of both login and password.

**Tech Stack:** POSIX shell, Docker Compose, Caddy, Go `net/http`, React/Vite admin UI.

---

### Task 1: Add Temporary Credential Semantics

**Files:**
- Modify: `cmd/olcrtc-manager/main.go`
- Test: `cmd/olcrtc-manager/main_test.go`

**Steps:**
1. Add tests for `OLCRTC_MANAGER_SETUP_REQUIRED=1` in `panel.env`.
2. Verify `/api/auth/me` reports `setup_required: true` while temporary credentials exist.
3. Verify `/api/auth/login` accepts temporary credentials but returns `setup_required: true` so the UI switches to setup.
4. Verify `/api/auth/setup` can replace temporary credentials and clears `OLCRTC_MANAGER_SETUP_REQUIRED`.
5. Extend env read/write helpers to preserve unrelated keys and write user/pass/setup-required safely.
6. Run `go test ./cmd/olcrtc-manager`.

### Task 2: Force Login And Password Change In UI

**Files:**
- Modify: `src/main.tsx`

**Steps:**
1. Update setup screen copy to say temporary login and password must be changed.
2. Require non-empty login in setup mode instead of silently falling back to `admin` in the UI.
3. Use `autoComplete="new-password"` for setup password fields.
4. Ensure login response with `setup_required: true` keeps user on setup form.
5. Run `npm run build`.

### Task 3: Extend Existing Docker Installer

**Files:**
- Modify: `deploy/docker/install.sh`
- Modify if needed: `deploy/docker/.env.example`
- Modify if needed: `deploy/docker/README.md`

**Steps:**
1. Keep existing subcommands (`init`, `start`, `stop`, etc.) working.
2. Add a default interactive deploy flow when run as root on a server: choose `port` or `domain`.
3. Add non-interactive flags: `--mode port|domain`, `--port`, `--domain`, `--repo`, `--ref`, `--install-dir`.
4. Install prerequisites on Ubuntu/Debian: `ca-certificates`, `curl`, `git`, Docker Engine/Compose plugin if missing.
5. Clone or update GitHub repo into `/opt/librertc-node`.
6. Generate strong temporary `OLCRTC_MANAGER_USER`, `OLCRTC_MANAGER_PASS`, and `OLCRTC_MANAGER_SETUP_REQUIRED=1` into `deploy/docker/local/panel.env`.
7. For port mode, bind to `0.0.0.0:<port>` and set `LIBRERTC_ALLOW_PUBLIC_BIND=1`.
8. For domain mode, bind to `127.0.0.1:18888`.
9. Build core runtime via existing `build-core.sh` before `compose up`.
10. Print URL and temporary credentials at the end.

### Task 4: Add Caddy Managed Block

**Files:**
- Modify: `deploy/docker/install.sh`

**Steps:**
1. If Caddy is missing, install it on Ubuntu/Debian.
2. Ensure `/etc/caddy/Caddyfile` exists.
3. Add/update a clearly marked managed block for the selected domain.
4. The block should reverse proxy to `127.0.0.1:<panel-port>`.
5. Run `caddy validate --config /etc/caddy/Caddyfile` before reload.
6. Reload Caddy with `systemctl reload caddy` or start it if inactive.

### Task 5: Verify On Clean Server

**Files:**
- No source edits unless bugs are found.

**Steps:**
1. Run port-mode install on the clean SSH server.
2. Verify container is healthy and panel responds.
3. Log in with generated temporary credentials.
4. Verify first login forces changing both login and password.
5. Verify old temporary credentials no longer work.
6. Run domain/Caddy mode if a test domain is available; otherwise validate Caddyfile generation locally.

### Task 6: Final Verification

**Files:**
- All touched files.

**Steps:**
1. Run `go test ./cmd/olcrtc-manager`.
2. Run `npm run build`.
3. Run `sh deploy/docker/install.sh --help`.
4. Check `git diff` for secrets; no generated credentials or live room keys may be committed.
