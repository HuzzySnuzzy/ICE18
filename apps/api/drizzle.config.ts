import { defineConfig } from 'drizzle-kit';

// Only used to generate migration files (`pnpm db:generate`); no database connection needed.
// Migrations are applied automatically when the panel starts.
export default defineConfig({
  dialect: 'mysql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
