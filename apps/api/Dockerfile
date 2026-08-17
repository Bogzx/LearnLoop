# Trailhead API image.
#
# Build context is the REPO ROOT (not apps/api) — this is an npm workspace
# monorepo, so the install needs the root package.json, the lockfile, and every
# workspace manifest before `npm ci` can reproduce the lockfile exactly.
#
#   docker build -f apps/api/Dockerfile -t trailhead-api .
#
# The API runs TypeScript directly through tsx (see apps/api package.json
# "start"), so there is no compile step — but tsx is a devDependency, which is
# why the install must include dev deps.

FROM node:22-alpine

WORKDIR /app

# --- Dependency layer -------------------------------------------------------
# Manifests only, so this layer is cached until a package.json actually changes.
# `npm ci` refuses to run unless the lockfile matches the full workspace set,
# so every workspace manifest has to be present — even ones the API never
# imports. apps/landing-page has no package.json and is not a workspace.
COPY package.json package-lock.json ./
COPY apps/api/package.json                apps/api/
COPY apps/browser-ext/package.json        apps/browser-ext/
COPY apps/dashboard/package.json          apps/dashboard/
COPY apps/mcp-server/package.json         apps/mcp-server/
COPY apps/vscode-ext/package.json         apps/vscode-ext/
COPY packages/score-card/package.json     packages/score-card/
COPY packages/scoring/package.json        packages/scoring/
COPY packages/shared/package.json         packages/shared/

# --include=dev is explicit rather than implied: tsx is a devDependency and the
# runtime needs it. NODE_ENV is deliberately not set to production until after
# the install so npm doesn't silently prune it.
RUN npm ci --include=dev

# --- Source layer -----------------------------------------------------------
# Only what the API actually needs at runtime. packages/ carries the raw .ts
# that @trailhead/shared and @trailhead/scoring resolve to via the workspace
# symlinks npm ci created above.
COPY packages/ packages/
COPY apps/api/ apps/api/

ENV NODE_ENV=production
# The container always listens on 3000; docker-compose.yml maps a host port to
# it. DATABASE_URL and GEMINI_API_KEY are injected by compose — the API throws
# at startup naming them if they are missing.
ENV PORT=3000
EXPOSE 3000

# Run as the image's built-in non-root user.
USER node

CMD ["npm", "--workspace=apps/api", "start"]
