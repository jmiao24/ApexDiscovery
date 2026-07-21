# ApexDiscovery web server — the desktop workbench, self-hosted for a browser.
# Build:  docker build -t apexdiscovery .
# Run:    docker run -p 3411:3411 -e APEX_TOKEN=<token> -e OPENAI_API_KEY=<key> -v apex-data:/data apexdiscovery
# Then open http://localhost:3411 and sign in with the token.

# ---- 1. Frontend: the same React app the desktop ships ----------------------
FROM node:20-slim AS frontend
RUN corepack enable
WORKDIR /src
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/desktop/package.json apps/desktop/package.json
COPY packages packages
RUN pnpm install --frozen-lockfile --filter @ai4s/desktop...
COPY apps/desktop apps/desktop
RUN pnpm --filter @ai4s/desktop build

# ---- 2. Codex bridge: production dependency closure ------------------------
FROM node:20-slim AS codex-bridge
RUN corepack enable
WORKDIR /src
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/codex-bridge/package.json apps/codex-bridge/package.json
RUN pnpm install --frozen-lockfile --prod --filter @ai4s/codex-bridge...
COPY apps/codex-bridge apps/codex-bridge
RUN pnpm --filter @ai4s/codex-bridge deploy --prod /codex-bridge

# ---- 3. Assets: bundled scientific skill packs -----------------------------
FROM debian:bookworm-slim AS assets
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY scripts/dev scripts/dev
COPY runtime runtime
COPY examples examples
RUN bash scripts/dev/fetch-skills.sh
# Assemble the resource dir in the same layout the desktop bundles
# (tauri.conf.json resources): skills/, skills-office/, skills-core/, harness/,
# examples/climate-trends/.
RUN mkdir -p /resources/examples \
    && cp -R runtime/skills/external/ai4s-skills /resources/skills \
    && cp -R runtime/skills/external/anthropic-skills /resources/skills-office \
    && cp -R runtime/skills/core /resources/skills-core \
    && cp -R runtime/harness /resources/harness \
    && cp -R examples/climate-trends /resources/examples/climate-trends

# ---- 4. Server binary -------------------------------------------------------
FROM rust:1-slim-bookworm AS server
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config gcc libc6-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY crates crates
COPY apps/server apps/server
RUN cargo build --release --manifest-path apps/server/Cargo.toml

# ---- 5. Runtime image -------------------------------------------------------
# Node is part of the image so users never install it; @openai/codex-sdk brings
# its pinned native Codex runtime for the image architecture.
FROM node:20-bookworm-slim
# The agent's working tools: git (workspace snapshots + repos), python3 (the
# default analysis runtime), curl/ca-certificates (providers, literature APIs).
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl git python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=server /src/apps/server/target/release/apexdiscovery-server /app/apexdiscovery-server
COPY --from=frontend /src/apps/desktop/dist /app/dist
COPY --from=assets /resources /app/resources
COPY --from=codex-bridge /codex-bridge /app/codex-bridge

# Everything the app writes lives under /data (mount a volume to persist):
# HOME=/data puts the default workspace base at /data/Documents/OpenScience.
ENV HOME=/data \
    APEX_DATA_DIR=/data/app \
    APEX_FRONTEND_DIR=/app/dist \
    APEX_RESOURCE_DIR=/app/resources \
    APEX_OPENCODE_BIN=/app/codex-bridge/src/server.mjs \
    APEX_HOST=0.0.0.0 \
    APEX_PORT=3411
VOLUME /data
EXPOSE 3411

CMD ["/app/apexdiscovery-server"]
