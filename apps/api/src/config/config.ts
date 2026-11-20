import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

export const CONFIG = Symbol('ICE18_CONFIG');

/** Repository root (this file is at apps/api/{src,dist}/config/). */
const REPO_ROOT = path.resolve(__dirname, '../../../..');

/** Where an auto-generated APP_SECRET is kept (gitignored, survives updates). */
export const DEFAULT_SECRET_FILE = path.join(REPO_ROOT, '.ice18-secret');

const flag = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())));

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),

  // Database: either separate fields (what Pterodactyl's Databases tab shows) or one URL.
  DB_HOST: z.string().optional(),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  DB_DATABASE: z.string().optional(),
  DB_USERNAME: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  DATABASE_URL: z.string().regex(/^mysql:\/\//, 'DATABASE_URL must start with mysql://').optional(),

  /**
   * Plugins run inside Docker, where 127.0.0.1 is the container itself. When a Pterodactyl
   * database host is 127.0.0.1/localhost, plugin configs get this address instead.
   */
  PLUGIN_DB_LOOPBACK_HOST: z.string().default('172.18.0.1'),

  /** Optional: generated and saved to .ice18-secret when not set. */
  APP_SECRET: z.string().min(32, 'APP_SECRET must be at least 32 characters long').optional(),
  PUBLIC_URL: z.url().optional(),
  PTERODACTYL_URL: z.url().optional(),
  PTERODACTYL_APP_KEY: z.string().optional(),
  PTERODACTYL_CLIENT_KEY: z.string().optional(),
  REGISTRATION_ENABLED: flag(false),
  COOKIE_SECURE: flag(false),
  TRUST_PROXY: flag(false),
  /** Pull and apply updates from git automatically (only when started via scripts/start.sh). */
  AUTO_UPDATE: flag(true),
  UPDATE_CHECK_MINUTES: z.coerce.number().int().min(1).max(10_080).default(30),
  GIT_BRANCH: z
    .string()
    .regex(/^[A-Za-z0-9._/-]+$/, 'GIT_BRANCH may only contain letters, numbers and . _ / -')
    .default('main'),
  /** Set by scripts/start.sh: the panel may exit with code 75 to get restarted with an update. */
  ICE18_SUPERVISED: flag(false),
});

/** Connection settings passed straight to mysql2. Separate fields need no URL-escaping. */
export type DatabaseConnection =
  | { uri: string }
  | { host: string; port: number; database: string; user: string; password: string };

export type AppConfig = Omit<z.infer<typeof schema>, 'APP_SECRET'> & {
  APP_SECRET: string;
  /** Null until the database settings are filled in. */
  database: DatabaseConnection | null;
};

export interface LoadConfigOptions {
  secretFile?: string;
  loadEnvFiles?: boolean;
}

/** Uses APP_SECRET when set; otherwise reads or creates a random one in `secretFile`. */
export function resolveAppSecret(value: string | undefined, secretFile: string): { secret: string; generated: boolean } {
  if (value) return { secret: value, generated: false };
  try {
    const stored = fs.readFileSync(secretFile, 'utf8').trim();
    if (stored.length >= 32) return { secret: stored, generated: false };
  } catch {
    /* not created yet */
  }
  const secret = randomBytes(32).toString('hex');
  fs.writeFileSync(secretFile, `${secret}\n`, { mode: 0o600 });
  return { secret, generated: true };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, options: LoadConfigOptions = {}): AppConfig {
  if (options.loadEnvFiles ?? true) {
    // .env in the working directory (the server folder in Pterodactyl), or the repo root.
    loadDotenv({ path: [path.resolve(process.cwd(), '.env'), path.join(REPO_ROOT, '.env')] });
  }

  // Pterodactyl egg variables arrive as empty strings when left blank.
  const cleaned: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );
  cleaned.PORT = env.SERVER_PORT || env.PORT || undefined;

  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`ICE18 configuration is invalid:\n${problems}\nSee .env.example for every setting.`);
  }
  const raw = result.data;

  let database: DatabaseConnection | null = null;
  if (raw.DB_HOST && raw.DB_DATABASE && raw.DB_USERNAME) {
    database = {
      host: raw.DB_HOST.trim(),
      port: raw.DB_PORT,
      database: raw.DB_DATABASE.trim(),
      user: raw.DB_USERNAME.trim(),
      password: raw.DB_PASSWORD ?? '',
    };
  } else if (raw.DATABASE_URL) {
    database = { uri: raw.DATABASE_URL };
  }

  const { secret } = resolveAppSecret(raw.APP_SECRET, options.secretFile ?? DEFAULT_SECRET_FILE);
  return { ...raw, APP_SECRET: secret, database };
}

export function isPterodactylConfigured(config: AppConfig): boolean {
  return Boolean(config.PTERODACTYL_URL && config.PTERODACTYL_APP_KEY && config.PTERODACTYL_CLIENT_KEY);
}
