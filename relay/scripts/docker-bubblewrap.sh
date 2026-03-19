#!/bin/bash

# No-sandbox launcher for Docker. Container isolation replaces bubblewrap here.
ulimit -t 3600

GAME_DIR="${1:?missing game directory}"
USE_CUSTOM="${2:-false}"

uses_local_gameserver_path() {
  grep -q '"dir": "../lean4game/server"' "lake-manifest.json" 2>/dev/null || \
    grep -q 'path = "../lean4game/server"' "lakefile.toml" 2>/dev/null || \
    grep -q 'DependencySrc.path "../lean4game/server"' "lakefile.lean" 2>/dev/null
}

ensure_local_gameserver_path() {
  local bundled_server="/app/lean4game/server"
  local expected_parent
  local expected_server

  if ! uses_local_gameserver_path; then
    return 0
  fi

  expected_parent="$(dirname "$GAME_DIR")/lean4game"
  expected_server="$expected_parent/server"

  if [ -d "$expected_server" ] || [ -L "$expected_server" ]; then
    return 0
  fi

  if [ -e "$expected_server" ]; then
    echo "[bubblewrap] unexpected GameServer path exists but is not usable: $expected_server" >&2
    exit 1
  fi

  if [ ! -d "$bundled_server" ]; then
    echo "[bubblewrap] bundled GameServer missing: $bundled_server" >&2
    exit 1
  fi

  mkdir -p "$expected_parent" || exit 1
  ln -s "$bundled_server" "$expected_server" || exit 1
  echo "[bubblewrap] linked GameServer path: $expected_server -> $bundled_server" >&2
}

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
  ensure_local_gameserver_path
  echo "[bubblewrap] manifest mathlib url: $(manifest_mathlib_url)" >&2
  echo "[bubblewrap] git remote mathlib url: $(git_mathlib_url)" >&2
  echo "[bubblewrap] running: lake env lean --server" >&2
  exec lake env lean --server
fi
