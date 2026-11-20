import { PterodactylError } from '../pterodactyl/pterodactyl.http';
import type { PterodactylService } from '../pterodactyl/pterodactyl.service';

export const MAX_CONFIG_BYTES = 512 * 1024;

export type ConfigRead = { text: string } | { missing: true } | { error: string };

/**
 * Reads a plugin's config file without ever throwing on Pterodactyl/Wings errors. Lists
 * the folder first and only reads the file if it's there: some Wings versions answer a
 * missing file with a 500 instead of a 404.
 */
export async function readPluginConfig(
  ptero: PterodactylService,
  identifier: string,
  folder: string,
  fileName: string,
): Promise<ConfigRead> {
  try {
    const files = await ptero.listFiles(identifier, `/plugins/${folder}`);
    const entry = files.find((file) => file.is_file && file.name === fileName);
    if (!entry) return { missing: true };
    if (entry.size > MAX_CONFIG_BYTES) return { error: `${fileName} is too large to scan.` };
    return { text: await ptero.readFile(identifier, `/plugins/${folder}/${fileName}`) };
  } catch (error) {
    if (error instanceof PterodactylError) {
      if (error.status === 404) return { missing: true };
      return { error: `Couldn't read ${fileName} (Pterodactyl/Wings error ${error.status}). Try Rescan.` };
    }
    throw error;
  }
}

/** Runs `fn` over `items`, at most `limit` at a time. */
export async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
