import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { saveMessage, getMessages } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(join(__dirname, "public")));

// Lazy-loaded message history. Newest-first cursor via ?before=<id>.
app.get("/api/messages", (req, res) => {
  const { before, limit } = req.query;
  res.json(getMessages({ before, limit }));
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

function broadcast(data) {
  const payload = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

const MAX_USERNAME = 32;
const MAX_MESSAGE = 2000;

wss.on("connection", (ws) => {
  ws.username = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "join") {
      const name = String(msg.username || "").trim().slice(0, MAX_USERNAME);
      if (!name) return;
      ws.username = name;
      return;
    }

    if (msg.type === "message") {
      if (!ws.username) return; // must join first
      const text = String(msg.text || "").trim().slice(0, MAX_MESSAGE);
      if (!text) return;
      const saved = saveMessage({
        username: ws.username,
        text,
        ts: Date.now(),
      });
      broadcast({ type: "message", ...saved });
    }
  });
});

server.listen(PORT, () => {
  console.log(`lcb-chat listening on http://0.0.0.0:${PORT}`);
});
