#!/usr/bin/env bash
set -euo pipefail

out="${1:-browser-lean-libs}"
root="$(cd "$(dirname "$0")/.." && pwd)"
nng4="$root/../NNG4"
visualtest="$root/../VisualTest"

rm -rf "$out"
mkdir -p "$out/lean-lib"

copy_tree() {
  local source="$1"
  local label="$2"
  [[ -d "$source" ]] || return 0
  echo "Collecting $label from $source"
  while IFS= read -r -d '' file; do
    local relative="${file#"$source"/}"
    local target="$out/lean-lib/$relative"
    mkdir -p "$(dirname "$target")"
    if [[ -e "$target" ]] && ! cmp -s "$file" "$target"; then
      echo "Conflicting browser library file: $relative" >&2
      exit 1
    fi
    cp "$file" "$target"
  done < <(find "$source" -type f \( -name '*.olean' -o -name '*.ir' -o -name '*.ir.sig' \) -print0)
}

# Lake packages include Batteries, i18n, importGraph, and Cli. Collect every
# build tree because imported modules must use the same pointer-width/githash.
while IFS= read -r -d '' tree; do
  copy_tree "$tree" "dependency"
done < <(find "$root/server/.lake/packages" \
  -type d -path '*/.lake/build/lib/lean' -print0 2>/dev/null)

# NNG4 has a separate Lake package directory. Only dependency build trees
# reached by `lake build` exist here, so this is the compiled import closure
# rather than the full dependency source trees.
if [[ "${INCLUDE_NNG4:-false}" == "true" ]]; then
  while IFS= read -r -d '' tree; do
    copy_tree "$tree" "NNG4 dependency"
  done < <(find "$nng4/.lake/packages" \
    -type d -path '*/.lake/build/lib/lean' -print0 2>/dev/null)
fi

copy_tree "$root/server/.lake/build/lib/lean" "GameServer"

if [[ "${INCLUDE_NNG4:-false}" == "true" ]]; then
  copy_tree "$nng4/.lake/build/lib/lean" "NNG4"
  mkdir -p "$out/gamedata/NNG4"
  if [[ -d "$nng4/.lake/gamedata" ]]; then
    cp -R "$nng4/.lake/gamedata/." "$out/gamedata/NNG4/"
  fi
fi

mkdir -p "$out/gamedata/VisualTest"
if [[ -d "$visualtest/.lake/gamedata" ]]; then
  cp -R "$visualtest/.lake/gamedata/." "$out/gamedata/VisualTest/"
fi

find "$out/lean-lib" -type f -printf '%P\n' | LC_ALL=C sort > "$out/lean-lib-files.txt"

olean_count="$(find "$out/lean-lib" -type f -name '*.olean' | wc -l | tr -d ' ')"
ir_count="$(find "$out/lean-lib" -type f -name '*.ir' | wc -l | tr -d ' ')"
if [[ "$olean_count" == 0 ]]; then
  echo 'No .olean files were packaged.' >&2
  exit 1
fi
if [[ "$ir_count" == 0 ]]; then
  echo 'No .ir files were produced. The browser interpreter needs IR for executable library code.' >&2
  exit 1
fi

missing_ir=0
while IFS= read -r -d '' olean; do
  ir="${olean%.olean}.ir"
  ir_sig="${olean%.olean}.ir.sig"
  if [[ ! -f "$ir" || ! -f "$ir_sig" ]]; then
    echo "Missing browser IR beside ${olean#"$out/lean-lib/"}" >&2
    missing_ir=1
  fi
done < <(find "$out/lean-lib/GameServer" "$out/lean-lib/Game" -type f -name '*.olean' -print0 2>/dev/null)
if [[ "$missing_ir" != 0 ]]; then
  echo 'GameServer and game modules must all use Lean module-system builds.' >&2
  exit 1
fi

cat > "$out/build-info.json" <<EOF
{
  "format": 1,
  "leanGithash": "${CAULI_LEAN_SHA:?}",
  "leanBuildRunId": "${CAULI_LEAN_RUN_ID:?}",
  "lean4gameRef": "${LEAN4GAME_REF:-unknown}",
  "nng4Ref": "$(if [[ "${INCLUDE_NNG4:-false}" == "true" ]]; then git -C "$nng4" rev-parse HEAD; else echo null; fi)",
  "visualTestRef": "$(git -C "$visualtest" rev-parse HEAD)",
  "oleanFiles": $olean_count,
  "irFiles": $ir_count
}
EOF

du -sh "$out"
cat "$out/build-info.json"
