# ICE18

A game server panel that sits **on top of your existing Pterodactyl panel**. Nothing on Pterodactyl has to move: ICE18 reads your servers through Pterodactyl's API, gives your users their own logins, and adds features Pterodactyl doesn't have. It can also run **as a server inside Pterodactyl** using the included egg.

> **Safety guarantee:** ICE18 never deletes, reinstalls or wipes Pterodactyl servers, files, backups or databases. Every request to Pterodactyl passes through an allowlist with hard-blocked destructive endpoints (`apps/api/src/pterodactyl/safety.ts`), backed by tests.

## What works now (milestone 1)

- ICE18 accounts: sign-up, login, password change. The first account becomes the admin.
- Lists every server on your Pterodactyl panel (admins) or the servers a user owns or is a subuser on.
- Live console with command history, power controls (start, restart, stop, kill) and live CPU, memory, disk and network stats.
- Permissions follow Pterodactyl's: subusers only get the console and power rights they have on Pterodactyl.
- Users link their Pterodactyl account by pasting a client API key once (used to prove ownership, never stored). Admins can also link accounts.
- Activity log of logins, power actions, console commands and account changes.
- Automatic updates from git, with rollback if a new version fails to install.

Coming next: plugin-aware database setup (detect SQL-capable plugins and wire them to a database in one click), an SSMS-style database browser, and server ordering with billing.

## Run it inside Pterodactyl

1. **Import the egg.** In Pterodactyl: *Admin → Nests →* pick or create a nest *→ Import Egg* and upload `egg/egg-ice18-panel.json`.
2. **Create the server** with the *ICE18 Panel* egg. 512 MB RAM is plenty. Its port is the port ICE18 will listen on.
3. **Create its database.** On the new server's *Databases* tab, create a database and build the URL:
   `mysql://USERNAME:PASSWORD@HOST:3306/DATABASE`
   If your database host only listens on `127.0.0.1` on the node, containers can't reach it. Use the Pterodactyl network gateway instead (default `172.18.0.1`) and make sure MySQL listens on that address.
4. **Create two Pterodactyl API keys:**
   - *Admin → Application API*: a key with **read** access to Servers, Users, Nodes, Locations, Nests and Eggs. ICE18 only ever reads with it.
   - *Account → API Credentials* on a **root admin** account: used for power actions and consoles.
5. **Fill in the server's startup variables** (*Admin → Servers →* the server *→ Startup*): database URL, app secret (`openssl rand -hex 32`), Pterodactyl URL and both keys.
6. **Start the server**, open `http://NODE-IP:PORT` and create your admin account.

### Updates

ICE18 keeps itself up to date (turn this off with the *Automatic updates* variable):

- On every start, it pulls the latest version of its branch, reinstalls and rebuilds.
- While running, it checks every 30 minutes (*Update check interval*). When it finds a new version it restarts itself to install it. Open consoles reconnect by themselves.
- If a new version fails to install, ICE18 rolls back to the version that was working and skips the broken one until a newer version is pushed.
- Admins can see the running version, check now, or update now under *Admin → Updates*.

Updates only touch the ICE18 server's own folder, never other Pterodactyl servers. Your `.env` file is kept. If you edit ICE18's files by hand, automatic updates pause so your edits aren't overwritten.

Already imported the egg before automatic updates existed? Re-import `egg/egg-ice18-panel.json` (*Update Egg* on the egg's page) and set the ICE18 server's startup command to `bash scripts/start.sh`.

For a proper domain with HTTPS, put Nginx, Caddy or a Cloudflare Tunnel in front of the port, then set `PUBLIC_URL`, `COOKIE_SECURE=true` and `TRUST_PROXY=true`.

## Run it locally

Needs Node.js 22+, pnpm (`corepack enable`) and a MySQL or MariaDB database.

```bash
pnpm install
cp .env.example .env   # then edit it
pnpm dev               # API on :8080, web app on http://localhost:5173
```

Production build: `pnpm build && pnpm start` (serves the web app and API on `PORT`).

Tests: `pnpm test`.

## How it's built

| Part | Tech |
|---|---|
| `apps/api` | NestJS, Drizzle ORM, MySQL, `ws` for the console relay |
| `apps/web` | React, Vite, Tailwind CSS, xterm.js |
| `packages/shared` | Types shared by both |
| `egg/` | Pterodactyl egg and install script |
| `scripts/` | `start.sh` (startup command, applies updates) and `update.sh` |

The browser never talks to Pterodactyl or Wings directly. For the console, ICE18 checks the user's permissions, gets a Wings token from Pterodactyl, connects to Wings itself, renews the token before it expires, and only passes on safe messages (logs, stats, commands and power signals the user is allowed to send).
