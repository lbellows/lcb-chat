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

## Run with Docker (recommended for the server)

The server runs the **prebuilt image** from GitHub Container Registry — it does
not build from source. Pushing to `master` triggers a GitHub Actions workflow
(`.github/workflows/docker-publish.yml`) that builds a `linux/amd64`
image and publishes `ghcr.io/lbellows/lcb-chat:latest`.

Deploy by adding the service to your Compose stack (this repo's
`docker-compose.prod.yml` is a standalone example):

```yaml
chat:
  image: ghcr.io/lbellows/lcb-chat:latest
  container_name: lcb-chat
  restart: unless-stopped
  pull_policy: always
  ports:
    - "3000:3000"
  environment:
    DB_PATH: /data/chat.db
  volumes:
    - /srv/chat:/data   # host bind mount; the SQLite DB lives here
```

Open `http://<server-ip>:3000`.

The SQLite database lives on the host at `/srv/chat/chat.db` (bind mount),
so your message history survives image updates and container replacement. The
DB is never baked into the image.

### Updating

CI publishes a new `:latest` image on every push to `master`. On the server,
just pull and recreate — no build, no `git pull` needed:

```bash
docker compose pull chat
docker compose up -d chat
```

(`pull_policy: always` means a plain `docker compose up -d chat` also pulls.)
The container is replaced; the bind-mounted DB (and your history) stays.

### Backups

The whole chat is one SQLite file on the host — just copy it:

```bash
cp /srv/chat/chat.db ./chat-backup.db
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

## Remote access: open on the LAN, gated by Cloudflare Access

`docker-compose.prod.yml` runs two services that give you two doors to the same app:

- **LAN (open, no login):** the `chat` service publishes `3000` on the host, so
  family at home just open `http://<server>:3000`. This stays safe only because it
  isn't internet-routable — **do not port-forward `3000` on your router.**
- **Remote (Cloudflare Access login):** the `cloudflared` sidecar opens an
  **outbound-only** tunnel — no inbound ports — and Cloudflare serves
  `https://chat.example.com` with an auto-renewing cert. **Cloudflare Access**
  sits in front so only verified family logins (email one-time PIN, Google, etc.)
  reach the app. Since the app has no login of its own, **that Access policy is the
  wall** — never run the tunnel without it.

Both doors hit the same unauthenticated app; the only *public* door is the
Access-gated one. The WebSocket client upgrades to `wss://` automatically over
HTTPS, and Access proxies the `/ws` upgrade, so no code change is needed.
Cloudflare Tunnel is free, and Access is free for up to 50 users.

### Cloudflare setup

The tunnel `lcb-chat` and its public hostname (`chat.example.com → http://chat:3000`)
are created in Cloudflare. To bring it up:

1. The connector token is in `.env` (gitignored). Copy that `.env` to the server
   next to `docker-compose.prod.yml`.
2. Make sure a **Cloudflare Access** application protects `chat.example.com` with a
   policy allowing your family's emails (One-time PIN is the simplest start). This
   is the wall — do not start the tunnel until it exists.
3. `docker compose -f docker-compose.prod.yml up -d`.

Defense-in-depth note: Access is enforced at Cloudflare's edge, not re-checked by
the app, and TLS terminates at Cloudflare — fine for a family chat.

> Prefer a fully-private setup with no public hostname at all? **Tailscale/WireGuard**
> is the safest alternative: the chat never touches the internet and a device must be
> on the VPN to see `:3000`. Trade-off is each family member installs a VPN client.

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
