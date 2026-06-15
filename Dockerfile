FROM node:22-slim

WORKDIR /app

# Install deps first for better layer caching. better-sqlite3 ships prebuilt
# binaries for linux/x64 + linux/arm64, so no build toolchain is needed.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/chat.db

EXPOSE 3000
VOLUME ["/data"]

CMD ["node", "server.js"]
