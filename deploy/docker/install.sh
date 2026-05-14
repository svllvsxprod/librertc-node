#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
ENV_FILE="$SCRIPT_DIR/.env"
ENV_EXAMPLE="$SCRIPT_DIR/.env.example"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
CONFIG_SAMPLE="$SCRIPT_DIR/config.sample.json"
DEFAULT_REPO="https://github.com/svllvsxprod/librertc-node.git"
DEFAULT_REF="main"
DEFAULT_INSTALL_DIR="/opt/librertc-node"

usage() {
  cat <<EOF
LibreRTC Node Docker installer

Usage: $0 [command] [options]

Commands:
  deploy    One-command server deployment from GitHub
  init      Create local .env and config template without starting containers
  check     Validate local deployment prerequisites
  build-core Build the runtime binary from LibreRTC Core
  build-image Build the Docker image locally
  start     Validate and start with docker compose
  stop      Stop containers
  restart   Restart containers
  status    Show compose status
  logs      Follow service logs
  health    Query local health endpoint

Deploy options:
  --mode port|domain       Publish directly on a port or through Caddy
  --port PORT              Host port for the panel (default: 18888)
  --domain DOMAIN          Domain name for Caddy mode
  --repo URL               Git repository to deploy (default: $DEFAULT_REPO)
  --ref REF                Git ref to deploy (default: $DEFAULT_REF)
  --install-dir DIR        Install directory (default: $DEFAULT_INSTALL_DIR)

No command starts an interactive deployment wizard.
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

require_option_value() {
  opt="$1"
  [ "$#" -ge 2 ] || die "$opt requires a value"
  [ -n "$2" ] || die "$opt requires a value"
}

need_root() {
  [ "$(id -u)" = "0" ] || die "this command must run as root"
}

apt_install() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y "$@"
}

ensure_base_packages() {
  command_exists apt-get || die "automatic install currently supports Debian/Ubuntu with apt-get"
  missing=""
  for pkg in ca-certificates curl git openssl iproute2; do
    command_exists "$pkg" || missing="$missing $pkg"
  done
  [ -z "$missing" ] || apt_install $missing
}

ensure_docker() {
  if ! command_exists docker; then
    apt_install docker.io
  fi
  if ! docker compose version >/dev/null 2>&1 && ! command_exists docker-compose; then
    apt-get install -y docker-compose-v2 || apt-get install -y docker-compose
  fi
  systemctl enable --now docker >/dev/null 2>&1 || true
}

bootstrap_repo_if_needed() {
  first_arg="${1:-}"
  [ -z "$first_arg" ] || [ "$first_arg" = "deploy" ] || return 0
  [ -f "$COMPOSE_FILE" ] && return 0
  if [ "$#" -eq 0 ]; then
    original_args="deploy"
  else
    original_args="$*"
  fi

  need_root
  ensure_base_packages

  repo="$DEFAULT_REPO"
  ref="$DEFAULT_REF"
  install_dir="$DEFAULT_INSTALL_DIR"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --repo) require_option_value "$@"; repo="$2"; shift 2 ;;
      --ref) require_option_value "$@"; ref="$2"; shift 2 ;;
      --install-dir) require_option_value "$@"; install_dir="$2"; shift 2 ;;
      *) shift ;;
    esac
  done

  if [ ! -d "$install_dir/.git" ]; then
    rm -rf "$install_dir"
    git clone "$repo" "$install_dir"
  else
    git -C "$install_dir" remote set-url origin "$repo"
  fi
  git -C "$install_dir" fetch --tags origin "$ref"
  git -C "$install_dir" checkout --detach FETCH_HEAD
  # shellcheck disable=SC2086
  exec sh "$install_dir/deploy/docker/install.sh" $original_args
}

bootstrap_repo_if_needed "$@"

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
  : "${LIBRERTC_NODE_IMAGE:=ghcr.io/svllvsxprod/librertc-node:latest}"
  : "${LIBRERTC_ALLOW_PUBLIC_BIND:=0}"
}

config_dir_abs() {
  case "$LIBRERTC_NODE_CONFIG_DIR" in
    /*) printf '%s\n' "$LIBRERTC_NODE_CONFIG_DIR" ;;
    *) printf '%s\n' "$SCRIPT_DIR/$LIBRERTC_NODE_CONFIG_DIR" ;;
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

random_hex() {
  bytes="$1"
  if command_exists openssl; then
    openssl rand -hex "$bytes"
  else
    dd if=/dev/urandom bs="$bytes" count=1 2>/dev/null | od -An -tx1 | tr -d ' \n'
  fi
}

random_password() {
  random_hex 18
}

generate_room_id() {
  pull_image
  room_id="$(docker run --rm --entrypoint /usr/local/bin/olcrtc "$LIBRERTC_NODE_IMAGE" -mode gen -carrier jazz -dns 1.1.1.1:53 -amount 1 2>/dev/null | sed -n '1p')" || die "failed to generate room id"
  [ -n "$room_id" ] || die "olcrtc generated an empty room id"
  printf '%s\n' "$room_id"
}

write_deploy_env() {
  mode="$1"
  port="$2"
  cfg_dir="$3"
  if [ "$mode" = "domain" ]; then
    bind="127.0.0.1"
    allow_public="0"
  else
    bind="0.0.0.0"
    allow_public="1"
  fi
  cat >"$ENV_FILE" <<EOF
LIBRERTC_NODE_IMAGE=ghcr.io/svllvsxprod/librertc-node:latest
LIBRERTC_NODE_CONTAINER=librertc-node
LIBRERTC_NODE_HOST_BIND=$bind
LIBRERTC_NODE_HOST_PORT=$port
LIBRERTC_ALLOW_PUBLIC_BIND=$allow_public
LIBRERTC_NODE_CONFIG_DIR=$cfg_dir
LIBRERTC_NODE_DATA_VOLUME=librertc-node-data
LIBRERTC_NODE_LOGS_VOLUME=librertc-node-logs
LIBRERTC_NODE_NETWORK=librertc-node
LIBRERTC_CORE_REPO=https://github.com/svllvsxprod/librertc-core.git
LIBRERTC_CORE_REF=main
EOF
}

pull_image() {
  load_env
  if docker pull "$LIBRERTC_NODE_IMAGE"; then
    return
  fi
  docker image inspect "$LIBRERTC_NODE_IMAGE" >/dev/null 2>&1 || die "failed to pull Docker image: $LIBRERTC_NODE_IMAGE"
}

build_image() {
  load_env
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -f "$SCRIPT_DIR/docker-compose.build.yml" build
}

write_deploy_config() {
  cfg_dir="$1"
  mkdir -p "$cfg_dir"
  if [ -f "$cfg_dir/config.json" ]; then
    info "kept existing $cfg_dir/config.json"
    return
  fi
  room_id="$(generate_room_id)"
  key="$(random_hex 32)"
  cat >"$cfg_dir/config.json" <<EOF
{
  "version": 1,
  "name": "LibreRTC Node",
  "port": 8888,
  "clients": [
    {
      "client-id": "default",
      "quota": {"speed_mbps": 0, "traffic_gb": 0},
      "locations": [
        {
          "name": "Default",
          "endpoint": {"room_id": "$room_id", "key": "$key"},
          "carrier": "jazz",
          "transport": {"type": "datachannel"},
          "link": "direct",
          "data": "data",
          "dns": "1.1.1.1:53"
        }
      ]
    }
  ]
}
EOF
  chmod 0600 "$cfg_dir/config.json" 2>/dev/null || true
}

write_temporary_panel_credentials() {
  cfg_dir="$1"
  if [ -f "$cfg_dir/panel.env" ]; then
    setup_required="$(sed -n "s/^OLCRTC_MANAGER_SETUP_REQUIRED='\(.*\)'$/\1/p" "$cfg_dir/panel.env" | sed -n '1p')"
    if [ "$setup_required" = "1" ]; then
      DEPLOY_PANEL_CREDENTIALS_CREATED=1
      DEPLOY_ADMIN_USER="$(sed -n "s/^OLCRTC_MANAGER_USER='\(.*\)'$/\1/p" "$cfg_dir/panel.env" | sed -n '1p')"
      DEPLOY_ADMIN_PASS="$(sed -n "s/^OLCRTC_MANAGER_PASS='\(.*\)'$/\1/p" "$cfg_dir/panel.env" | sed -n '1p')"
    else
      DEPLOY_PANEL_CREDENTIALS_CREATED=0
      DEPLOY_ADMIN_USER=""
      DEPLOY_ADMIN_PASS=""
    fi
    info "kept existing $cfg_dir/panel.env"
    return
  fi
  user="admin-$(random_hex 4)"
  pass="$(random_password)"
  cat >"$cfg_dir/panel.env" <<EOF
OLCRTC_MANAGER_USER='${user}'
OLCRTC_MANAGER_PASS='${pass}'
OLCRTC_MANAGER_SETUP_REQUIRED='1'
EOF
  chmod 0600 "$cfg_dir/panel.env" 2>/dev/null || true
  DEPLOY_PANEL_CREDENTIALS_CREATED=1
  DEPLOY_ADMIN_USER="$user"
  DEPLOY_ADMIN_PASS="$pass"
}

ensure_caddy() {
  if ! command_exists caddy; then
    apt_install caddy
  fi
  systemctl enable --now caddy >/dev/null 2>&1 || true
}

configure_caddy() {
  domain="$1"
  port="$2"
  ensure_caddy
  mkdir -p /etc/caddy/conf.d
  touch /etc/caddy/Caddyfile
  if ! grep -q '^import /etc/caddy/conf.d/\*.caddy' /etc/caddy/Caddyfile; then
    printf '\nimport /etc/caddy/conf.d/*.caddy\n' >>/etc/caddy/Caddyfile
  fi
  cat >/etc/caddy/conf.d/librertc-node.caddy <<EOF
# Managed by LibreRTC Node installer. Manual edits may be overwritten.
$domain {
  encode gzip
  reverse_proxy 127.0.0.1:$port
}
EOF
  caddy validate --config /etc/caddy/Caddyfile
  systemctl reload caddy || systemctl restart caddy
}

server_ip() {
  ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1; i<=NF; i++) if ($i=="src") {print $(i+1); exit}}'
}

prompt_value() {
  name="$1"
  default="$2"
  [ -r /dev/tty ] || die "interactive setup requires a TTY; use 'deploy --mode ...' for non-interactive install"
  printf '%s [%s]: ' "$name" "$default" >/dev/tty
  read value </dev/tty
  printf '%s\n' "${value:-$default}"
}

prompt_deploy_wizard() {
  cat >/dev/tty <<EOF

LibreRTC Node setup

Choose how the admin panel should be published:
  1) Domain with Caddy and HTTPS
  2) Raw public port
EOF
  choice="$(prompt_value 'Mode' '1')"
  case "$choice" in
    1|domain|Domain) mode="domain" ;;
    2|port|Port) mode="port" ;;
    *) die "mode must be 1/domain or 2/port" ;;
  esac

  if [ "$mode" = "domain" ]; then
    domain="$(prompt_value 'Domain' '')"
    [ -n "$domain" ] || die "domain is required"
    port="$(prompt_value 'Internal panel port' "$port")"
  else
    port="$(prompt_value 'Public panel port' "$port")"
  fi
}

deploy_server() {
  need_root
  mode=""
  port="18888"
  domain=""
  repo="$DEFAULT_REPO"
  ref="$DEFAULT_REF"
  install_dir="$DEFAULT_INSTALL_DIR"

  shift
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -h|--help|help) usage; exit 0 ;;
      --mode) require_option_value "$@"; mode="$2"; shift 2 ;;
      --port) require_option_value "$@"; port="$2"; shift 2 ;;
      --domain) require_option_value "$@"; domain="$2"; shift 2 ;;
      --repo) require_option_value "$@"; repo="$2"; shift 2 ;;
      --ref) require_option_value "$@"; ref="$2"; shift 2 ;;
      --install-dir) require_option_value "$@"; install_dir="$2"; shift 2 ;;
      *) die "unknown deploy option: $1" ;;
    esac
  done

  if [ -z "$mode" ]; then
    prompt_deploy_wizard
  fi
  case "$mode" in port|domain) ;; *) die "mode must be port or domain" ;; esac
  if [ "$mode" = "domain" ] && [ -z "$domain" ]; then
    domain="$(prompt_value 'Domain' '')"
  fi
  [ "$mode" = "port" ] || [ -n "$domain" ] || die "domain is required in domain mode"

  ensure_base_packages
  ensure_docker
  write_deploy_env "$mode" "$port" "./local"
  load_env
  cfg_dir="$(config_dir_abs)"
  pull_image
  write_deploy_config "$cfg_dir"
  write_temporary_panel_credentials "$cfg_dir"
  compose down --remove-orphans >/dev/null 2>&1 || true
  check_prerequisites
  compose up -d
  if [ "$mode" = "domain" ]; then
    configure_caddy "$domain" "$port"
    url="https://$domain/admin"
  else
    ip_addr="$(server_ip)"
    url="http://${ip_addr:-SERVER_IP}:$port/admin"
  fi
  cat <<EOF

LibreRTC Node deployed.
URL: $url
EOF
  if [ "${DEPLOY_PANEL_CREDENTIALS_CREATED:-0}" = "1" ]; then
    cat <<EOF
Temporary login: $DEPLOY_ADMIN_USER
Temporary password: $DEPLOY_ADMIN_PASS

The first login will require changing both login and password.
EOF
  else
    cat <<EOF
Existing panel credentials were preserved.
EOF
  fi
}

check_prerequisites() {
  load_env
  command_exists docker || die "docker is required"
  compose version >/dev/null

  case "$LIBRERTC_NODE_HOST_BIND" in
    127.0.0.1|localhost) ;;
    *)
      [ "$LIBRERTC_ALLOW_PUBLIC_BIND" = "1" ] || die "public bind requires LIBRERTC_ALLOW_PUBLIC_BIND=1; prefer reverse proxy for production"
      ;;
  esac

  case "$LIBRERTC_NODE_HOST_PORT" in
    ''|*[!0-9]*) die "LIBRERTC_NODE_HOST_PORT must be numeric" ;;
  esac

  if port_in_use "$LIBRERTC_NODE_HOST_PORT"; then
    die "host port $LIBRERTC_NODE_HOST_PORT is already in use; change it in $ENV_FILE"
  fi

  docker image inspect "$LIBRERTC_NODE_IMAGE" >/dev/null 2>&1 || die "Docker image is missing: $LIBRERTC_NODE_IMAGE"

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

cmd=${1:-deploy}
case "$cmd" in
  deploy)
    deploy_server "$@"
    ;;
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
  build-image)
    init_files
    build_image
    ;;
  start)
    init_files
    pull_image
    check_prerequisites
    compose up -d
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
