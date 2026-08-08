# Stage 1: build web dist (heavy build — runs on CI / strong machine, see docs/deploy-plan.md §4.1)
FROM oven/bun:1.3 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun run build

# Stage 2: runtime (Bun + file-bridge, zero runtime deps)
FROM oven/bun:1.3-slim AS runtime
WORKDIR /app
COPY custom/file-bridge ./file-bridge
COPY --from=build /app/dist ./dist

ENV DESIGN_ROOT=/data/design
ENV STATE_DIR=/data/state
ENV BRIDGE_PORT=8080
ENV BRIDGE_TOKEN=changeme

EXPOSE 8080
VOLUME ["/data/design", "/data/state"]
CMD ["bun", "run", "file-bridge/index.ts"]
