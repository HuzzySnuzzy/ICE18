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
- **Plugin databases** (server page → *Plugins & databases*): finds plugins that can use MySQL and connects them to a server database in one click. Supported: LuckPerms, CoreProtect, LiteBans, Plan, mcMMO and QuickShop. Other plugins with database settings are flagged, with copyable connection details to set them up by hand. ICE18 only changes the database settings in the plugin's `config.yml`, saves a backup next to it first, and refuses if the config doesn't look as expected.

- **Databases page** (left menu): an MS Access-style explorer for every database across your servers, laid out like a file explorer: each server expands to the databases it owns, the shared databases its plugins use, its local database files and external databases, and each database expands to its tables. Searchable by server, database, plugin or table. Click a database to see where it lives (owner server, host, user) and **which servers and plugins use it**: ICE18 scans plugin configs on every server, so a database shared by several servers (e.g. LuckPerms on a network) shows all of them. Admins also see databases plugins use that Pterodactyl doesn't manage. Tables open in Datasheet and Design views. Data is read-only while the owner server **or any server using the database** is online; when they're all offline you can edit cells, add records and delete records. Only tables with a primary key can be changed, every change targets one record by that key, and all servers' states are re-checked before every write.
- **Local database files**: the Databases page also lists SQLite and H2 files inside plugin folders on every server, marked *In use*, *Leftover* (the plugin has since moved to MySQL) or *Not in config* (a loose file the plugin's config doesn't mention). SQLite files open read-only in the same datasheet: ICE18 downloads a snapshot (including recent writes in the WAL journal) and never writes back. H2 files (Java-only) are listed but can't be opened. Previews are limited to 256 MB (`SQLITE_PREVIEW_MAX_MB`) and stored temporarily in `.ice18-cache/` inside ICE18's own folder.

- **Server management tabs** on each server page, following Pterodactyl's permissions:
  - **Files**: browse, edit text files (Ctrl+S saves), upload, download, new file/folder, rename/move, copy, archive/unarchive, and delete (with a confirmation, at most 50 items at a time).
  - **Users**: add, edit and remove subusers and their permissions. Subusers can only hand out permissions they have themselves.
  - **Startup**: view the startup command, edit the variables the egg allows, rename the server.
  - **Network**: see ports, copy addresses, add notes, add a port and choose the primary one.

- **Prefabs** (Admin page): server templates (egg, docker image, variables, resources, location, monthly price). Admins can create a server from any prefab for any user, free.
- **Store** (left menu): customers order a server from the visible prefabs and pay in **credits**:
  - Admins top up or adjust credits per user (Admin → Users → Credits), with a reason. Every change is in the user's credit history.
  - The first month is paid when ordering; every 30 days the price is taken again. If the balance is too low the server is **suspended** (never deleted) and comes back automatically once the balance covers it.
  - Customers can cancel; the server keeps running until the paid period ends, then it's suspended.
  - If the customer has no Pterodactyl account yet, ICE18 creates one with their email and links it (Pterodactyl emails them to set a password). An existing Pterodactyl account with the same email is never linked automatically; they link it themselves on the Account page first.
  - If Pterodactyl can't create the server, the credits are refunded automatically.

Deleting servers is still never done by ICE18; remove servers you no longer want in Pterodactyl.

## Run it inside Pterodactyl

1. **Import the egg.** In Pterodactyl: *Admin → Nests →* pick or create a nest *→ Import Egg* and upload `egg/egg-ice18-panel.json`.
2. **Create the server** with the *ICE18 Panel* egg. 512 MB RAM and 2 GB disk are plenty. Its port is the port ICE18 will listen on. You can leave the database fields and *App secret* empty for now.
3. **Create its database.** On the new server's *Databases* tab, create a database with *Connections from* set to `%`.
4. **Fill in the database fields** (*Admin → Servers →* the server *→ Startup*): host, name, username and password, copied from the *Databases* tab. Paste the password as-is.
   If the host shows as `127.0.0.1` or `localhost`, use `172.18.0.1` instead (the Pterodactyl network gateway): inside a server, `127.0.0.1` is the container itself. MySQL must also listen on that address (`bind-address = 0.0.0.0` or `172.18.0.1`).
5. **Connect Pterodactyl.** Create two API keys and fill in *Pterodactyl URL* and both keys on the same Startup page:
   - *Admin → Application API*: a key with **read** access to Nodes, Locations, Nests and Eggs, and **read & write** access to Servers and Users. Write is only used by prefabs and the store, to create users and servers and to suspend/unsuspend servers; ICE18 never deletes or edits them. (Read-only works too if you don't use prefabs or the store.)
   - *Account → API Credentials* on a **root admin** account: used for power actions and consoles.
6. **Start the server**, open `http://NODE-IP:PORT` and create your admin account.

If something's missing or wrong, the server's console says what to fix. ICE18 waits instead of crashing, so you can fix the setting and restart.

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
