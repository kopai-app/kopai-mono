# Stage 1: Build
FROM node:24-slim AS build

RUN apt-get update -qq && apt-get install --no-install-recommends -y -qq ca-certificates && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate

WORKDIR /src
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages/ packages/

RUN pnpm install --frozen-lockfile
RUN pnpm turbo build --filter=@kopai/clickhouse-datasource...
RUN pnpm deploy --filter=@kopai/clickhouse-datasource --prod --legacy /app

# Copy built dist artifacts into the deployed directory
RUN cp -r packages/clickhouse-datasource/dist /app/dist

# Stage 2: Runtime
FROM node:24-slim

WORKDIR /app
COPY --from=build /app /app

ENV HOST=0.0.0.0
ENV NODE_ENV=production

EXPOSE 8000

CMD ["node", "dist/test/server.mjs"]
