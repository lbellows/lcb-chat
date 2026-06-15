# lcb-chat

A dead-simple single-room chat for family on your local network. Pick a name,
join, and chat. Messages are persisted in SQLite, so history is there when you
come back. No accounts, no passwords.

- **Backend:** Node.js (Express + `ws` WebSockets)
- **Storage:** SQLite (`better-sqlite3`) — one file, easy to back up
- **Frontend:** plain HTML/CSS/JS, no build step
- **History:** newest 50 messages load on join; scroll up / "Load older" pages
  back through the rest.

## Run locally (Node)

```bash
npm install
npm start
# open http://localhost:3000
```

Family members on the same network open `http://<your-machine-ip>:3000`.

## Run with Docker Compose (recommended for the server)

```bash
docker compose up --build -d
```

Open `http://<server-ip>:3000`.

The SQLite database lives on the `chat-data` named volume, so your message
history survives rebuilds and updates.

### Updating

```bash
git pull        # or copy the new files over
docker compose up --build -d
```

The container is replaced; the `chat-data` volume (and your history) stays.

### Backups

The whole chat is one SQLite file inside the `chat-data` volume:

```bash
docker compose cp chat:/data/chat.db ./chat-backup.db
```

## Configuration

| Env var   | Default          | Description                          |
| --------- | ---------------- | ------------------------------------ |
| `PORT`    | `3000`           | HTTP/WebSocket port                  |
| `DB_PATH` | `./data/chat.db` | SQLite file location (`/data/chat.db` in Docker) |

## Notes

This is intentionally trust-based — anyone who can reach the port can pick any
name and post. That's fine for a LAN among family. Don't expose it directly to
the public internet without putting auth / a reverse proxy in front.
