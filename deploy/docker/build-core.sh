#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
ENV_FILE="$SCRIPT_DIR/.env"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

: "${LIBRERTC_CORE_REPO:=https://github.com/svllvsxprod/librertc-core.git}"
: "${LIBRERTC_CORE_REF:=main}"
: "${LIBRERTC_CORE_WORKDIR:=/opt/librertc-core}"
: "${LIBRERTC_CORE_GO_IMAGE:=golang:1.26-bookworm}"
: "${LIBRERTC_OLCRTC_BINARY:=deploy/docker/bin/olcrtc}"

case "$LIBRERTC_OLCRTC_BINARY" in
  /*) output="$LIBRERTC_OLCRTC_BINARY" ;;
  *) output="$REPO_ROOT/$LIBRERTC_OLCRTC_BINARY" ;;
esac

command -v git >/dev/null 2>&1 || { echo "error: git is required" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "error: docker is required" >&2; exit 1; }

if [ ! -d "$LIBRERTC_CORE_WORKDIR/.git" ]; then
  rm -rf "$LIBRERTC_CORE_WORKDIR"
  git clone "$LIBRERTC_CORE_REPO" "$LIBRERTC_CORE_WORKDIR"
else
  git -C "$LIBRERTC_CORE_WORKDIR" remote set-url origin "$LIBRERTC_CORE_REPO"
fi

git -C "$LIBRERTC_CORE_WORKDIR" fetch --tags origin "$LIBRERTC_CORE_REF"
git -C "$LIBRERTC_CORE_WORKDIR" checkout --detach FETCH_HEAD

mkdir -p "$(dirname -- "$output")"
docker run --rm \
  -v "$LIBRERTC_CORE_WORKDIR:/src" \
  -v "$(dirname -- "$output"):/out" \
  -w /src \
  "$LIBRERTC_CORE_GO_IMAGE" \
  sh -c 'go mod download && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/olcrtc ./cmd/olcrtc'

chmod 0755 "$output"
echo "built $output from $LIBRERTC_CORE_REPO@$LIBRERTC_CORE_REF"
