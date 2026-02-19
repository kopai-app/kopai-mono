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
RUN pnpm turbo build --filter=@kopai/app...
RUN pnpm deploy --filter=@kopai/app --prod --legacy /app

# Copy built dist artifacts into the deployed directory
RUN cp -r packages/app/dist /app/dist

# Stage 2: Runtime
FROM dhi.io/node:24-debian13

WORKDIR /app
COPY --chown=node:node --from=build /app /app

ENV HOST=0.0.0.0
ENV SQLITE_DB_FILE_PATH=:memory:
ENV NODE_ENV=production

EXPOSE 8000 4318

USER node

CMD ["node", "dist/cli.mjs", "start"]
