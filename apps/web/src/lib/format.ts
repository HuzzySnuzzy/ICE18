export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : decimals)} ${units[exponent]}`;
}

/** Pterodactyl limits are in MiB; 0 means unlimited. */
export function formatLimitMiB(mib: number): string {
  return mib === 0 ? 'Unlimited' : formatBytes(mib * 1024 * 1024, mib % 1024 === 0 ? 0 : 1);
}

export function formatUptime(ms: number): string {
  if (!ms || ms < 0) return '—';
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds % 60}s`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}
