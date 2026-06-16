FROM node:24-slim

WORKDIR /app

# Install deps first for better layer caching. better-sqlite3 ships prebuilt
# binaries for linux/x64 + linux/arm64 (incl. Node 24), so no toolchain needed.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

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
