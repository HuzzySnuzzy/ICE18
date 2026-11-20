import type { DbCell } from '@ice18/shared';

/** Column types whose values are raw bytes: shown as hex, never edited. */
const BINARY_TYPES = new Set([
  'binary',
  'varbinary',
  'tinyblob',
  'blob',
  'mediumblob',
  'longblob',
  'bit',
  'geometry',
  'point',
  'linestring',
  'polygon',
  'multipoint',
  'multilinestring',
  'multipolygon',
  'geometrycollection',
]);

export function isBinaryType(dataType: string): boolean {
  return BINARY_TYPES.has(dataType.toLowerCase());
}

const HEX_LIMIT = 64;

/** Turns a value from mysql2 into something JSON can carry. */
export function toCell(value: unknown): DbCell {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) {
    return value.length <= HEX_LIMIT ? { binary: value.length, hex: value.toString('hex') } : { binary: value.length };
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export const MAX_PAGE_SIZE = 500;

export function clampPage(offset: unknown, limit: unknown): { offset: number; limit: number } {
  const parsedLimit = Math.trunc(Number(limit));
  const parsedOffset = Math.trunc(Number(offset));
  return {
    limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, MAX_PAGE_SIZE) : 100,
    offset: Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0,
  };
}

/**
 * Checks a row key against a table's primary key: same columns, no extras, no missing ones.
 * Every edit and delete targets exactly one row through it.
 */
export function validateRowKey(primaryKey: readonly string[], key: Record<string, unknown>): string | null {
  const given = Object.keys(key);
  if (primaryKey.length === 0) return 'This table has no primary key, so its rows cannot be changed safely.';
  if (given.length !== primaryKey.length || !primaryKey.every((column) => given.includes(column))) {
    return `Rows must be identified by the primary key (${primaryKey.join(', ')}).`;
  }
  if (primaryKey.some((column) => typeof key[column] !== 'string')) return 'Primary key values must be text.';
  return null;
}
