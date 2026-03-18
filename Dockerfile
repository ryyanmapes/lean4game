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

RUN apt-get update && apt-get install -y --no-install-recommends \
      git curl libatomic1 ca-certificates \
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
WORKDIR /VisualTest
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

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl libatomic1 ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Carry over elan + pre-fetched toolchains so the relay can spawn
# 'lake serve --' without downloading anything at runtime.
COPY --from=lean-builder /root/.elan /root/.elan
ENV PATH="${PATH}:/root/.elan/bin"

WORKDIR /app

# Node relay and compiled client
COPY --from=node-builder /app/relay/dist   ./relay/dist
COPY --from=node-builder /app/client/dist  ./client/dist
COPY --from=node-builder /app/node_modules ./node_modules
COPY --from=node-builder /app/package.json ./package.json

# Games: relay maps URL /g/{owner}/{repo} → games/{owner}/{repo} on disk.
# Docker follows symlinks in COPY so .lake/packages/* are inlined as real dirs.
COPY --from=lean-builder /NNG4       ./games/leanprover-community/nng4
COPY --from=lean-builder /VisualTest ./games/ryyanmapes/visualtest

EXPOSE 8080

ENV NODE_ENV=production \
    PORT=8080 \
    API_PORT=8010

CMD ["node", "relay/dist/src/index.js"]
