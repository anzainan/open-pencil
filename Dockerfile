# Stage 1: build web dist (heavy build — runs on CI / strong machine, see docs/deploy-plan.md §4.1)
FROM oven/bun:1.3 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun run build

# Stage 2: runtime (Bun + file-bridge + optional upstream MCP server for in-browser live collab)
FROM oven/bun:1.3-slim AS runtime
WORKDIR /app

# Workspace manifests + lockfile first so bun resolves the workspace graph.
COPY package.json bun.lock ./
COPY packages ./packages
# Production-only deps (hono / ws / @modelcontextprotocol/sdk + core runtime deps).
RUN bun install --frozen-lockfile --production
# Built workspace dists (core etc. — MCP server resolves @open-pencil/* via exports → dist).
COPY --from=build /app/packages ./packages
# Web SPA build output.
COPY --from=build /app/dist ./dist
# file-bridge service.
COPY custom/file-bridge ./custom/file-bridge

ENV DESIGN_ROOT=/data/design
ENV STATE_DIR=/data/state
ENV BRIDGE_PORT=8080
ENV BRIDGE_TOKEN=changeme
# Set MCP_AUTH_TOKEN to enable the in-browser MCP relay (spawned MCP server + same-origin proxy).
ENV MCP_AUTH_TOKEN=

EXPOSE 8080
VOLUME ["/data/design", "/data/state"]
CMD ["bun", "run", "custom/file-bridge/index.ts"]
