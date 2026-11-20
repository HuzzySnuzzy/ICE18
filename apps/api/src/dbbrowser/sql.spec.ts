import { describe, expect, it } from 'vitest';
import { clampPage, isBinaryType, toCell, validateRowKey } from './sql';

describe('toCell', () => {
  it('converts values for the datasheet', () => {
    expect(toCell(null)).toBeNull();
    expect(toCell(42)).toBe('42');
    expect(toCell('text')).toBe('text');
    expect(toCell(Buffer.from([0xde, 0xad]))).toEqual({ binary: 2, hex: 'dead' });
    expect(toCell(Buffer.alloc(1000))).toEqual({ binary: 1000 });
    expect(toCell({ a: 1 })).toBe('{"a":1}');
  });
});

describe('isBinaryType', () => {
  it('flags byte columns', () => {
    expect(isBinaryType('BINARY')).toBe(true);
    expect(isBinaryType('longblob')).toBe(true);
    expect(isBinaryType('varchar')).toBe(false);
    expect(isBinaryType('text')).toBe(false);
  });
});

describe('clampPage', () => {
  it('keeps paging within limits', () => {
    expect(clampPage(undefined, undefined)).toEqual({ offset: 0, limit: 100 });
    expect(clampPage('200', '50')).toEqual({ offset: 200, limit: 50 });
    expect(clampPage('-5', '100000')).toEqual({ offset: 0, limit: 500 });
    expect(clampPage('abc', '0')).toEqual({ offset: 0, limit: 100 });
  });
});

describe('validateRowKey', () => {
  it('requires exactly the primary key', () => {
    expect(validateRowKey(['id'], { id: '5' })).toBeNull();
    expect(validateRowKey(['a', 'b'], { b: '1', a: '2' })).toBeNull();
    expect(validateRowKey([], { id: '5' })).toMatch(/no primary key/);
    expect(validateRowKey(['id'], {})).toMatch(/primary key/);
    expect(validateRowKey(['id'], { id: '5', name: 'x' })).toMatch(/primary key/);
    expect(validateRowKey(['id'], { name: 'x' })).toMatch(/primary key/);
    expect(validateRowKey(['id'], { id: 5 })).toMatch(/text/);
  });
});
