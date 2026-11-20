/**
 * Permissions a viewer asks to give a subuser but doesn't have themselves. ICE18 calls
 * Pterodactyl with the admin key, so Pterodactyl can't enforce this for us.
 */
export function ungrantable(requested: readonly string[], grantable: readonly string[] | '*'): string[] {
  if (grantable === '*') return [];
  return requested.filter((permission) => !grantable.includes(permission));
}

/** Keeps only permission names Pterodactyl knows ("group.key"), without duplicates. */
export function knownPermissions(
  requested: readonly string[],
  catalogue: Record<string, { keys: Record<string, string> }>,
): { known: string[]; unknown: string[] } {
  const all = new Set(Object.entries(catalogue).flatMap(([group, entry]) => Object.keys(entry.keys).map((key) => `${group}.${key}`)));
  const unique = [...new Set(requested)];
  return { known: unique.filter((permission) => all.has(permission)), unknown: unique.filter((permission) => !all.has(permission)) };
}

/** A single file or folder name: no slashes, not "." or "..". */
export function isPlainName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name.length <= 255 && !/[/\\\x00-\x1f]/.test(name) && name !== '.' && name !== '..';
}
