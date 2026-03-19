# Docker build for lean4game + all games (NNG4, VisualTest)
#
# Build context: the PARENT directory containing all repos:
#   lean4game/   ← ryyanmapes/lean4game  (relay, client, GameServer)
#   NNG4/        ← ryyanmapes/NNG4
#   VisualTest/  ← ryyanmapes/VisualTest
#
# The Dockerfile is at lean4game/Dockerfile; the context root is one level up.

# ── Stage 1: Build Lean games and GameServer ───────────────────────────────
FROM ubuntu:22.04 AS lean-builder

RUN DEBIAN_FRONTEND=noninteractive apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      git curl libatomic1 ca-certificates tzdata \
    && ln -sf /usr/share/zoneinfo/UTC /etc/localtime \
    && echo "UTC" > /etc/timezone \
    && rm -rf /var/lib/apt/lists/*

# Install elan. The concrete Lean version is determined per-game by lean-toolchain.
RUN curl -sSfL \
      https://github.com/leanprover/elan/releases/download/v3.1.1/elan-x86_64-unknown-linux-gnu.tar.gz \
    | tar xz && ./elan-init -y --default-toolchain none
ENV PATH="${PATH}:/root/.elan/bin"

# Copy the modified GameServer Lean library.
# Both NNG4 and VisualTest depend on this via path = "../lean4game/server",
# so it must live at /lean4game/server for the relative path to resolve.
COPY lean4game/server /lean4game/server

# ── NNG4 ──────────────────────────────────────────────────────────────────
COPY NNG4 /NNG4
WORKDIR /NNG4
# Fetch the toolchain, then download pre-compiled mathlib .olean cache.
# lake exe cache get saves hours of compilation.
RUN elan toolchain install "$(cat lean-toolchain)"
RUN lake exe cache get
RUN lake build

# ── VisualTest ────────────────────────────────────────────────────────────
# lean-toolchain is a symlink → ../lean4game/server/lean-toolchain, which
# resolves to /lean4game/server/lean-toolchain already copied above.
# VisualTest has no mathlib dependency so no cache step needed.
COPY VisualTest /VisualTest
# lean-toolchain is a symlink → ../lean4game/server/lean-toolchain; replace it
# with the real file since Docker cannot follow cross-directory symlinks.
RUN cp /lean4game/server/lean-toolchain /VisualTest/lean-toolchain
WORKDIR /VisualTest
RUN lake update
RUN lake build

# ── Stage 2: Build Node.js relay and client ────────────────────────────────
FROM node:25-slim AS node-builder

WORKDIR /app

# Copy patches/ before npm ci so the postinstall hook (patch-package) finds
# patches/vscode+6.0.3.patch and applies the Windows dirname fix.
COPY lean4game/patches ./patches
COPY lean4game/package.json lean4game/package-lock.json ./
RUN npm ci

COPY lean4game/ ./
RUN npm run build:relay && npm run build:client

# ── Stage 3: Production image ──────────────────────────────────────────────
FROM ubuntu:22.04

RUN DEBIAN_FRONTEND=noninteractive apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      curl libatomic1 ca-certificates bubblewrap tzdata git python3 \
    && ln -sf /usr/share/zoneinfo/UTC /etc/localtime \
    && echo "UTC" > /etc/timezone \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Carry over elan + pre-fetched toolchains so the relay can spawn
# 'lake serve --' without downloading anything at runtime.
COPY --from=lean-builder /root/.elan /root/.elan
ENV PATH="${PATH}:/root/.elan/bin"

WORKDIR /app

# Node relay and compiled client
COPY --from=node-builder /app/relay/dist    ./relay/dist
COPY --from=node-builder /app/relay/scripts ./relay/scripts
COPY --from=node-builder /app/client/dist   ./client/dist
COPY --from=node-builder /app/node_modules  ./node_modules
COPY --from=node-builder /app/package.json  ./package.json
RUN chmod +x ./relay/scripts/*.sh && \
    printf '#!/bin/bash\n# No-sandbox launcher for Docker — bwrap not needed; Docker provides isolation.\nulimit -t 3600\nGAME_DIR="$1"\nUSE_CUSTOM="$2"\necho "[bubblewrap] GAME_DIR=$GAME_DIR USE_CUSTOM=$USE_CUSTOM" >&2\nif [ "$USE_CUSTOM" = "true" ]; then\n    BINARY="$GAME_DIR/.lake/packages/GameServer/server/.lake/build/bin/gameserver"\n    echo "[bubblewrap] running custom server: $BINARY" >&2\n    cd "$(dirname "$BINARY")" || exit 1\n    exec ./gameserver --server "$GAME_DIR"\nelse\n    cd "$GAME_DIR" || exit 1\n    echo "[bubblewrap] manifest mathlib url: $(python3 -c \"import json; d=json.load(open(\\\"lake-manifest.json\\\")); [print(p[\\\"url\\\"]) for p in d[\\\"packages\\\"] if p.get(\\\"name\\\")==\\\"mathlib\\\"]\" 2>&1)" >&2\n    echo "[bubblewrap] git remote mathlib url: $(git -C .lake/packages/mathlib remote get-url origin 2>&1)" >&2\n    echo "[bubblewrap] running: lake env lean --server" >&2\n    exec lake env lean --server\nfi\n' > ./relay/scripts/bubblewrap.sh

# Games: relay maps URL /g/{owner}/{repo} → games/{owner}/{repo} on disk.
# Docker follows symlinks in COPY so .lake/packages/* are inlined as real dirs.
COPY --from=lean-builder /NNG4       ./games/leanprover-community/nng4
COPY --from=lean-builder /VisualTest ./games/ryyanmapes/visualtest

EXPOSE 8080

ENV NODE_ENV=production \
    PORT=8080 \
    API_PORT=8010

CMD ["node", "relay/dist/src/index.js"]
