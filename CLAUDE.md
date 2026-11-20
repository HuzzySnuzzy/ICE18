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

## Commands

- `pnpm install`, `pnpm build`, `pnpm test`, `pnpm typecheck`
- `pnpm dev`: API on :8080 and Vite on :5173 (needs a `.env` at the repo root, see `.env.example`)
- `pnpm db:generate`: create a migration after changing `apps/api/src/db/schema.ts`. Migrations run automatically on startup.

## Conventions

- Every API route needs a login unless marked `@Public()`. Admin routes use `@AdminOnly()`.
- State-changing requests must send the `x-ice18-csrf: 1` header (the web app's `api()` helper does this).
- Validate request bodies with zod via `parseBody()`.
- Record user actions that change something with `AuditService.record()`.
