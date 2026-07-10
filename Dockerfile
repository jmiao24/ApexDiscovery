# ApexScience web server — the desktop workbench, self-hosted for a browser.
# Build:  docker build -t apexscience .
# Run:    docker run -p 3411:3411 -e APEX_TOKEN=<token> -v apex-data:/data apexscience
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

# ---- 2. Assets: pinned opencode sidecar + bundled skill packs ---------------
FROM debian:bookworm-slim AS assets
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*
ARG TARGETARCH
WORKDIR /src
COPY scripts/dev scripts/dev
COPY runtime runtime
COPY examples examples
# fetch-opencode.sh keys on the Rust target triple; map from the Docker arch.
RUN TRIPLE=$([ "$TARGETARCH" = "arm64" ] && echo aarch64-unknown-linux-gnu || echo x86_64-unknown-linux-gnu) \
    && mkdir -p apps/desktop/src-tauri \
    && bash scripts/dev/fetch-opencode.sh "$TRIPLE" \
    && mv "apps/desktop/src-tauri/binaries/opencode-$TRIPLE" /opencode \
    && bash scripts/dev/fetch-skills.sh
# Assemble the resource dir in the same layout the desktop bundles
# (tauri.conf.json resources): skills/, skills-office/, skills-core/, harness/,
# examples/climate-trends/.
RUN mkdir -p /resources/examples \
    && cp -R runtime/skills/external/ai4s-skills /resources/skills \
    && cp -R runtime/skills/external/anthropic-skills /resources/skills-office \
    && cp -R runtime/skills/core /resources/skills-core \
    && cp -R runtime/harness /resources/harness \
    && cp -R examples/climate-trends /resources/examples/climate-trends

# ---- 3. Server binary -------------------------------------------------------
FROM rust:1-slim-bookworm AS server
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config gcc libc6-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY crates crates
COPY apps/server apps/server
RUN cargo build --release --manifest-path apps/server/Cargo.toml

# ---- 4. Runtime image -------------------------------------------------------
FROM debian:bookworm-slim
# The agent's working tools: git (workspace snapshots + repos), python3 (the
# default analysis runtime), curl/ca-certificates (providers, literature APIs).
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl git python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=server /src/apps/server/target/release/apexscience-server /app/apexscience-server
COPY --from=frontend /src/apps/desktop/dist /app/dist
COPY --from=assets /resources /app/resources
COPY --from=assets /opencode /app/opencode

# Everything the app writes lives under /data (mount a volume to persist):
# HOME=/data puts the default workspace base at /data/Documents/OpenScience.
ENV HOME=/data \
    APEX_DATA_DIR=/data/app \
    APEX_FRONTEND_DIR=/app/dist \
    APEX_RESOURCE_DIR=/app/resources \
    APEX_OPENCODE_BIN=/app/opencode \
    APEX_HOST=0.0.0.0 \
    APEX_PORT=3411
VOLUME /data
EXPOSE 3411

CMD ["/app/apexscience-server"]
