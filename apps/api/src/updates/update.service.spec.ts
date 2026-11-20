import { describe, expect, it } from 'vitest';
import type { UpdateStatus } from '@ice18/shared';
import { shouldAutoApply } from './update.service';

const base: UpdateStatus = {
  supported: true,
  branch: 'main',
  currentCommit: 'aaa',
  latestCommit: 'bbb',
  updateAvailable: true,
  localChanges: false,
  autoUpdate: true,
  canRestart: true,
  checking: false,
  lastCheckedAt: null,
  lastError: null,
};

describe('shouldAutoApply', () => {
  it('applies a new version when everything allows it', () => {
    expect(shouldAutoApply(base)).toBe(true);
  });

  it.each([
    ['no update', { updateAvailable: false }],
    ['auto-update off', { autoUpdate: false }],
    ['not started via start.sh', { canRestart: false }],
    ['hand-edited files', { localChanges: true }],
    ['not a git checkout', { supported: false }],
  ])('does nothing when %s', (_label, override) => {
    expect(shouldAutoApply({ ...base, ...override })).toBe(false);
  });

  it('skips a version that already failed to install', () => {
    expect(shouldAutoApply(base, 'bbb')).toBe(false);
    expect(shouldAutoApply(base, 'older-failure')).toBe(true);
  });
});
