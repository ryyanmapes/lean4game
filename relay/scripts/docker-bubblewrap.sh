#!/bin/bash

# No-sandbox launcher for Docker. Container isolation replaces bubblewrap here.
ulimit -t 3600

GAME_DIR="${1:?missing game directory}"
USE_CUSTOM="${2:-false}"

manifest_mathlib_url() {
  if [ ! -f "lake-manifest.json" ]; then
    printf '<missing lake-manifest.json>\n'
    return 0
  fi

  python3 - <<'PY' 2>&1
import json

try:
    with open("lake-manifest.json", encoding="utf-8") as handle:
        manifest = json.load(handle)
    for package in manifest.get("packages", []):
        if package.get("name") == "mathlib":
            print(package.get("url", "<missing url>"))
            break
    else:
        print("<mathlib package not found>")
except Exception as exc:
    print(f"<manifest read failed: {exc}>")
PY
}

git_mathlib_url() {
  if [ ! -d ".lake/packages/mathlib/.git" ]; then
    printf '<missing .lake/packages/mathlib git checkout>\n'
    return 0
  fi

  git -C .lake/packages/mathlib remote get-url origin 2>&1 || true
}

echo "[bubblewrap] GAME_DIR=$GAME_DIR USE_CUSTOM=$USE_CUSTOM" >&2

if [ "$USE_CUSTOM" = "true" ]; then
  BINARY="$GAME_DIR/.lake/packages/GameServer/server/.lake/build/bin/gameserver"
  echo "[bubblewrap] running custom server: $BINARY" >&2
  cd "$(dirname "$BINARY")" || exit 1
  exec ./gameserver --server "$GAME_DIR"
else
  cd "$GAME_DIR" || exit 1
  echo "[bubblewrap] manifest mathlib url: $(manifest_mathlib_url)" >&2
  echo "[bubblewrap] git remote mathlib url: $(git_mathlib_url)" >&2
  echo "[bubblewrap] running: lake env lean --server" >&2
  exec lake env lean --server
fi
