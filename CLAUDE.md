# ICE18

Game server panel that runs on top of an existing Pterodactyl panel (through its API) and can itself run as a Pterodactyl server via `egg/egg-ice18-panel.json`.

## The one rule that must never be broken

**ICE18 must never wipe a Pterodactyl server.** No deleting servers, reinstalling, deleting files, restoring backups, deleting backups/databases, or changing a server's egg/startup.

This is enforced in code, not by convention:

- Every Pterodactyl HTTP call goes through `PterodactylHttp` (`apps/api/src/pterodactyl/pterodactyl.http.ts`), which calls `assertPterodactylRequestAllowed()` before sending anything.
- `apps/api/src/pterodactyl/safety.ts` has `FORBIDDEN_RULES` (always win) and `ALLOWED_RULES` (default-deny allowlist).
- `safety.spec.ts` and `pterodactyl.http.spec.ts` prove the forbidden calls are refused and never reach the network.

When adding a feature that needs a new Pterodactyl endpoint: add that exact endpoint to `ALLOWED_RULES` and a test for it. Never remove or loosen a `FORBIDDEN_RULES` entry, never call `fetch` against Pterodactyl directly, and never add a `DELETE` to the allowlist.

## Layout

- `apps/api`: NestJS backend (TypeScript, CommonJS). Drizzle ORM + MySQL. Serves the built web app on the same port.
- `apps/web`: React + Vite + Tailwind v4 frontend.
- `packages/shared`: types shared by both (build it before the API: `pnpm --filter @ice18/shared build`).
- `egg/`: Pterodactyl egg and its install script.
- `scripts/start.sh`: the egg's startup command. Runs `scripts/update.sh` before starting the panel and restarts it when it exits with code 75 (an update was requested by `apps/api/src/updates/update.service.ts`). `update.sh` rolls back to the previous commit if install/build fails. Both wrap their body in `main()` so bash has read the whole file before `git reset` replaces it; keep it that way.

## Plugin databases

`apps/api/src/plugins/`: `recipes.ts` describes where known plugins keep their MySQL settings; `applyRecipe()` only changes keys that already exist and re-reads the result before anything is written. `plugins.service.ts` writes a `*.ice18-backup-YYYYMMDD-HHMMSS` copy before every change. The safety rules only allow writing `/plugins/<plugin>/<file>.yml` and those backups (`SAFE_CONFIG_WRITE`). To support a new plugin, add a recipe plus a test with a real copy of its config in `fixtures.ts`.

## Database browser

`apps/api/src/dbbrowser/`: connects to a server's database with that database's own Pterodactyl credentials (so it can only reach that one database). Rules: writes call `assertUnlocked()` (server must be `offline`, checked fresh via Pterodactyl every time); rows are only changed through their full primary key (`validateRowKey`), one row per statement with `LIMIT 1`; deletes run in a transaction and roll back if any row is missing; table and column names are checked against `information_schema` and escaped with `??`, values always go through `?`. No raw SQL, no DDL (DROP/TRUNCATE/ALTER). Keep it that way.

## Commands

- `pnpm install`, `pnpm build`, `pnpm test`, `pnpm typecheck`
- `pnpm dev`: API on :8080 and Vite on :5173 (needs a `.env` at the repo root, see `.env.example`)
- `pnpm db:generate`: create a migration after changing `apps/api/src/db/schema.ts`. Migrations run automatically on startup.

## Conventions

- Every API route needs a login unless marked `@Public()`. Admin routes use `@AdminOnly()`.
- State-changing requests must send the `x-ice18-csrf: 1` header (the web app's `api()` helper does this).
- Validate request bodies with zod via `parseBody()`.
- Record user actions that change something with `AuditService.record()`.
