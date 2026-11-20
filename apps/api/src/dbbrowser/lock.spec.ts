import { describe, expect, it } from 'vitest';
import { isLocked } from './lock';

describe('isLocked', () => {
  it('only unlocks when every server using the database is offline', () => {
    expect(isLocked(['offline'])).toBe(false);
    expect(isLocked(['offline', 'offline', 'offline'])).toBe(false);
    expect(isLocked(['offline', 'running'])).toBe(true);
    expect(isLocked(['offline', 'starting'])).toBe(true);
    expect(isLocked(['offline', 'stopping'])).toBe(true);
    expect(isLocked(['offline', 'unknown'])).toBe(true);
    expect(isLocked(['suspended'])).toBe(true);
    expect(isLocked([])).toBe(true);
  });
});
