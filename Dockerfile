FROM node:24-slim

WORKDIR /app

# Install deps first for better layer caching.
#
# --ignore-scripts is required, not just tidy. better-sqlite3 v13 ships N-API
# prebuilds for linux x64/arm64 (glibc and musl) inside its npm tarball and
# picks the right one at require time. But it also ships a binding.gyp, and npm
# *defaults* to running `node-gyp rebuild` for any package that has one and
# declares no install script of its own. That default tries to compile from
# source, which fails here because slim images carry no Python or toolchain —
# and would be a waste even if it succeeded, since the prebuilt binary is right
# there. Skipping scripts uses the prebuild and keeps the image compiler-free.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY . .

# Image version, surfaced to the client so it can detect when a newer build is
# deployed. CI passes the git SHA; defaults to "dev" for local builds.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/chat.db

EXPOSE 3000
VOLUME ["/data"]

CMD ["node", "server.js"]
