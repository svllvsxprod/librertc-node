#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
ENV_FILE="$SCRIPT_DIR/.env"
ENV_EXAMPLE="$SCRIPT_DIR/.env.example"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
CONFIG_SAMPLE="$SCRIPT_DIR/config.sample.json"

usage() {
  cat <<EOF
LibreRTC Node Docker installer

Usage: $0 <command>

Commands:
  init      Create local .env and config template without starting containers
  check     Validate local deployment prerequisites
  build-core Build the runtime binary from LibreRTC Core
  start     Validate and start with docker compose
  stop      Stop containers
  restart   Restart containers
  status    Show compose status
  logs      Follow service logs
  health    Query local health endpoint

No command defaults to: init
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

info() {
  echo "==> $*"
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
    return
  fi
  if command_exists docker-compose; then
    docker-compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
    return
  fi
  die "docker compose plugin or docker-compose is required"
}

ensure_env() {
  if [ ! -f "$ENV_FILE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    info "created $ENV_FILE"
  fi
}

load_env() {
  ensure_env
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  : "${LIBRERTC_NODE_HOST_BIND:=127.0.0.1}"
  : "${LIBRERTC_NODE_HOST_PORT:=18888}"
  : "${LIBRERTC_NODE_CONFIG_DIR:=./local}"
  : "${LIBRERTC_OLCRTC_BINARY:=deploy/docker/bin/olcrtc}"
}

config_dir_abs() {
  case "$LIBRERTC_NODE_CONFIG_DIR" in
    /*) printf '%s\n' "$LIBRERTC_NODE_CONFIG_DIR" ;;
    *) printf '%s\n' "$SCRIPT_DIR/$LIBRERTC_NODE_CONFIG_DIR" ;;
  esac
}

binary_abs() {
  case "$LIBRERTC_OLCRTC_BINARY" in
    /*) printf '%s\n' "$LIBRERTC_OLCRTC_BINARY" ;;
    *) printf '%s\n' "$REPO_ROOT/$LIBRERTC_OLCRTC_BINARY" ;;
  esac
}

port_in_use() {
  port="$1"
  if command_exists ss && ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:|\\])${port}$"; then
    return 0
  fi
  if command_exists lsof && lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    return 0
  fi
  if command_exists netstat && netstat -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:|\\])${port}$"; then
    return 0
  fi
  return 1
}

init_files() {
  load_env
  cfg_dir=$(config_dir_abs)
  mkdir -p "$cfg_dir"
  if [ ! -f "$cfg_dir/config.json" ]; then
    cp "$CONFIG_SAMPLE" "$cfg_dir/config.json"
    chmod 0600 "$cfg_dir/config.json" 2>/dev/null || true
    info "created $cfg_dir/config.json"
    info "replace placeholder room_id and key values before start"
  fi
}

check_prerequisites() {
  load_env
  command_exists docker || die "docker is required"
  compose version >/dev/null

  case "$LIBRERTC_NODE_HOST_BIND" in
    127.0.0.1|localhost) ;;
    *) die "LIBRERTC_NODE_HOST_BIND must stay localhost by default; configure reverse proxy instead" ;;
  esac

  case "$LIBRERTC_NODE_HOST_PORT" in
    ''|*[!0-9]*) die "LIBRERTC_NODE_HOST_PORT must be numeric" ;;
  esac

  if port_in_use "$LIBRERTC_NODE_HOST_PORT"; then
    die "host port $LIBRERTC_NODE_HOST_PORT is already in use; change it in $ENV_FILE"
  fi

  olcrtc_bin=$(binary_abs)
  [ -f "$olcrtc_bin" ] || die "olcrtc binary is missing: $olcrtc_bin"

  cfg_dir=$(config_dir_abs)
  cfg="$cfg_dir/config.json"
  [ -f "$cfg" ] || die "config is missing: $cfg; run '$0 init' first"
  if grep -q 'replace-me-' "$cfg"; then
    die "config still contains placeholder values: $cfg"
  fi

  info "checks passed"
}

health_url() {
  printf 'http://%s:%s/api/v1/health\n' "$LIBRERTC_NODE_HOST_BIND" "$LIBRERTC_NODE_HOST_PORT"
}

cmd=${1:-init}
case "$cmd" in
  init)
    init_files
    ;;
  check)
    init_files
    check_prerequisites
    ;;
  build-core)
    init_files
    sh "$SCRIPT_DIR/build-core.sh"
    ;;
  start)
    init_files
    check_prerequisites
    compose up -d --build
    info "started. Health: $(health_url)"
    ;;
  stop)
    ensure_env
    compose down
    ;;
  restart)
    sh "$0" stop
    sh "$0" start
    ;;
  status)
    ensure_env
    compose ps
    ;;
  logs)
    ensure_env
    compose logs -f --tail=200
    ;;
  health)
    load_env
    if command_exists curl; then
      curl -fsS "$(health_url)"
      echo
    elif command_exists wget; then
      wget -qO- "$(health_url)"
      echo
    else
      die "curl or wget is required"
    fi
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage
    exit 2
    ;;
esac
