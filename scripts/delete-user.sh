#!/bin/sh
set -eu

usage() {
	cat <<'USAGE'
Usage:
  delete-user.sh CONFIG CLIENT_ID [options]

Options:
  --reload URL    POST URL after saving, for example http://127.0.0.1:8888/-/reload.
  -h, --help     Show this help.
USAGE
}

die() {
	printf '%s\n' "$*" >&2
	exit 1
}

[ "$#" -ge 1 ] || {
	usage
	exit 2
}

case "${1:-}" in
	-h|--help)
		usage
		exit 0
		;;
esac

[ "$#" -ge 2 ] || die "CONFIG and CLIENT_ID are required"

config=$1
client_id=$2
shift 2
reload_url=

while [ "$#" -gt 0 ]; do
	case "$1" in
		--reload)
			[ "$#" -ge 2 ] || die "--reload requires URL"
			reload_url=$2
			shift 2
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			die "unknown option: $1"
			;;
	esac
done

[ -f "$config" ] || die "config does not exist: $config"

tmp=$(mktemp "${config}.tmp.XXXXXX")
trap 'rm -f "$tmp"' EXIT HUP INT TERM

python3 - "$config" "$tmp" "$client_id" <<'PY'
import json
import sys

config_path, tmp_path, client_id = sys.argv[1:]

with open(config_path, "r", encoding="utf-8") as f:
    cfg = json.load(f)

clients = cfg.get("clients")
if clients is None:
    before = len(cfg.get("locations", []))
    cfg["locations"] = [loc for loc in cfg.get("locations", []) if loc.get("client-id") != client_id]
    if len(cfg["locations"]) == before:
        raise SystemExit(f"client not found: {client_id}")
else:
    before = len(clients)
    cfg["clients"] = [c for c in clients if c.get("client-id") != client_id]
    if len(cfg["clients"]) == before:
        raise SystemExit(f"client not found: {client_id}")

with open(tmp_path, "w", encoding="utf-8") as f:
    json.dump(cfg, f, ensure_ascii=False, indent=2)
    f.write("\n")
PY

mv "$tmp" "$config"
trap - EXIT HUP INT TERM

if [ -n "$reload_url" ]; then
	curl -fsS -X POST "$reload_url" >/dev/null
fi

printf 'deleted client %s from %s\n' "$client_id" "$config"
