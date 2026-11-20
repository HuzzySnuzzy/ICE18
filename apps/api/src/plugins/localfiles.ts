import type { LocalDatabaseStatus } from '@ice18/shared';
import type { RecipeState } from './recipes';

/** Subfolders of a plugin folder that commonly hold database files. */
export const DATA_SUBFOLDERS = new Set(['data', 'database', 'databases', 'db', 'storage', 'sqlite', 'h2']);

/** What kind of local database a file name looks like, if any. */
export function localDatabaseKind(name: string): 'sqlite' | 'h2' | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.mv.db') || lower.endsWith('.h2.db')) return 'h2';
  if (/\.(db|sqlite|sqlite3|db3)$/.test(lower)) return 'sqlite';
  return null;
}

/** URL-safe id for a file path. */
export function fileKey(path: string): string {
  return Buffer.from(path, 'utf8').toString('base64url');
}

export function pathFromKey(key: string): string {
  return Buffer.from(key, 'base64url').toString('utf8');
}

/**
 * Decides whether a local database file is still used:
 * - a known plugin storing data in files: in use,
 * - a known plugin that now uses MySQL: leftover,
 * - otherwise: in use if the plugin's config.yml names the file, else unreferenced ("loose").
 */
export function classifyLocalFile(
  fileName: string,
  plugin: string,
  recipe: { name: string; state: RecipeState | null } | null,
  configText: string | null,
  configName = 'config.yml',
): { status: LocalDatabaseStatus; note: string } {
  if (recipe?.state?.storage === 'mysql') {
    return {
      status: 'leftover',
      note: `${recipe.name} now uses MySQL (${recipe.state.database ?? 'a database'}), so this file is from before the switch and isn't used anymore.`,
    };
  }
  if (recipe?.state?.storage === 'local') {
    const storage = /\((.*)\)/.exec(recipe.state.summary)?.[1];
    const detail = storage && storage !== 'files' ? ` (${storage})` : '';
    return { status: 'in-use', note: `${recipe.name} stores its data in local files${detail}.` };
  }
  if (configText && configText.toLowerCase().includes(fileName.toLowerCase())) {
    return { status: 'in-use', note: `${plugin}'s ${configName} mentions this file.` };
  }
  return {
    status: 'unreferenced',
    note: configText
      ? `${plugin}'s ${configName} doesn't mention this file. The plugin probably uses it by default, or it's left over.`
      : `${plugin} has no config file that mentions it. The plugin probably uses it by default, or it's left over.`,
  };
}
