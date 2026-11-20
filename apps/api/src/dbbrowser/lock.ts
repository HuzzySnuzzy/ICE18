/** Locked unless every server involved (owner + servers whose plugins use the database) is offline. */
export function isLocked(states: readonly string[]): boolean {
  return states.length === 0 || states.some((state) => state !== 'offline');
}
