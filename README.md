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
name and post. That's fine for a LAN among family. **Do not expose it directly to
the public internet** without putting auth / a gate in front (see below).

## Public / remote access (future)

The app has no login of its own, so the safe way to reach it from outside the LAN
is to make sure only trusted devices/people can get to it in the first place.
Two good options, in order of safety:

- **Tailscale (or WireGuard) — safest.** The chat stays entirely private; nothing
  is exposed to the internet. A device must be on the VPN to even see `:3000`.
  Each family member installs the client once and signs in (Tailscale uses
  Google/Microsoft identity, no port forwarding, MagicDNS gives you `http://<server>:3000`).
  Because only enrolled devices can reach it, the app's missing auth stops mattering.
- **Cloudflare Tunnel + Cloudflare Access — good, browser-only.** Run `cloudflared`
  on the server pointing at `localhost:3000` to get `https://chat.<domain>` with a
  valid auto-renewing cert and no port forwarding. Put **Cloudflare Access** in front
  so only verified family logins (email code, Google, etc.) reach the app — the edge
  is the wall. Nothing to install for family; note TLS terminates at Cloudflare, so
  they're a trusted party in the path. **Never use a bare tunnel without Access** — that
  puts an unauthenticated app on the open internet.

The WebSocket client already upgrades to `wss://` automatically when the page is
served over HTTPS, so either option works with no code change.

## If you ever outgrow the single box (managed hosting)

If you'd rather not run/secure your own server, this app's shape maps cleanly onto
serverless platforms where public access is gated for you:

- **Cloudflare (elegant fit).** A Worker serves the app and API, a **Durable Object**
  holds each room's state and the live WebSocket connections (exactly what DOs are
  built for — realtime chat with strong consistency), and **D1** (their SQLite)
  persists history so it's there on login, with **R2** for any media. Comfortably in
  cheap/free tiers at family scale. Put **Cloudflare Access (Zero Trust)** in front and
  only your family's verified logins reach the app before any request hits your code —
  no hand-rolled public auth.
- **Azure (if you'd rather stay in your home cloud).** **Functions** for the API,
  **Azure SignalR Service** in serverless mode for the realtime push (so you don't run
  your own socket server), **Table Storage** or **Cosmos** serverless for persistence,
  fronted by **Entra ID / App Service Easy Auth** as the identity gate. Same shape, also
  cheap at this scale, also gated so public exposure is handled for you.
