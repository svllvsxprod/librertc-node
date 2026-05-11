#!/bin/sh
set -eu

CONFIG_PATH="${LIBRERTC_CONFIG_PATH:-/etc/librertc/config.json}"

if [ ! -f "$CONFIG_PATH" ]; then
  echo "LibreRTC config is missing: $CONFIG_PATH" >&2
  echo "Create it from deploy/docker/config.sample.json and replace placeholder room/key values before starting." >&2
  exit 78
fi

exec "$@"
