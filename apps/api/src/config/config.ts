import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

export const CONFIG = Symbol('ICE18_CONFIG');

const flag = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())));

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_URL: z.string().regex(/^mysql:\/\//, 'DATABASE_URL must start with mysql://'),
  APP_SECRET: z.string().min(32, 'APP_SECRET must be at least 32 characters long'),
  PUBLIC_URL: z.url().optional(),
  PTERODACTYL_URL: z.url().optional(),
  PTERODACTYL_APP_KEY: z.string().optional(),
  PTERODACTYL_CLIENT_KEY: z.string().optional(),
  REGISTRATION_ENABLED: flag(false),
  COOKIE_SECURE: flag(false),
  TRUST_PROXY: flag(false),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // .env in the working directory (the server folder in Pterodactyl), or the repo root.
  loadDotenv({ path: [path.resolve(process.cwd(), '.env'), path.resolve(__dirname, '../../../../.env')] });

  // Pterodactyl egg variables arrive as empty strings when left blank.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ''));
  cleaned.PORT = env.SERVER_PORT || env.PORT;

  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`ICE18 configuration is invalid:\n${problems}\nSee .env.example for every setting.`);
  }
  return result.data;
}

export function isPterodactylConfigured(config: AppConfig): boolean {
  return Boolean(config.PTERODACTYL_URL && config.PTERODACTYL_APP_KEY && config.PTERODACTYL_CLIENT_KEY);
}
