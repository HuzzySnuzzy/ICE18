import { describe, expect, it } from 'vitest';
import { PERIOD_MS, decideRenewal, nextPaidUntil, pterodactylUsername } from './billing';

const now = new Date('2026-12-01T12:00:00Z');
const past = new Date('2026-11-30T12:00:00Z');
const future = new Date('2026-12-15T12:00:00Z');
const sub = (overrides: Partial<Parameters<typeof decideRenewal>[0]> = {}) => ({
  status: 'active' as const,
  cancelAtPeriodEnd: false,
  paidUntil: past,
  price: 100,
  ...overrides,
});

describe('decideRenewal', () => {
  it('does nothing while the period is paid', () => {
    expect(decideRenewal(sub({ paidUntil: future }), 0, now)).toBe('none');
  });
  it('renews when due and affordable', () => {
    expect(decideRenewal(sub(), 100, now)).toBe('renew');
  });
  it('suspends (never deletes) when due and not affordable', () => {
    expect(decideRenewal(sub(), 99, now)).toBe('suspend');
  });
  it('resumes a suspended server once the balance covers it', () => {
    expect(decideRenewal(sub({ status: 'suspended' }), 99, now)).toBe('none');
    expect(decideRenewal(sub({ status: 'suspended' }), 150, now)).toBe('resume');
  });
  it('ends cancelled subscriptions only after the paid period', () => {
    expect(decideRenewal(sub({ cancelAtPeriodEnd: true, paidUntil: future }), 1000, now)).toBe('none');
    expect(decideRenewal(sub({ cancelAtPeriodEnd: true }), 1000, now)).toBe('end');
    expect(decideRenewal(sub({ status: 'cancelled' }), 1000, now)).toBe('none');
    expect(decideRenewal(sub({ status: 'suspended', cancelAtPeriodEnd: true }), 1000, now)).toBe('none');
  });
  it('treats free servers as always affordable', () => {
    expect(decideRenewal(sub({ price: 0 }), 0, now)).toBe('renew');
  });
});

describe('nextPaidUntil', () => {
  it('extends from the later of now and the current end', () => {
    expect(nextPaidUntil(past, now).getTime()).toBe(now.getTime() + PERIOD_MS);
    expect(nextPaidUntil(future, now).getTime()).toBe(future.getTime() + PERIOD_MS);
  });
});

describe('pterodactylUsername', () => {
  it('follows Pterodactyl username rules', () => {
    expect(pterodactylUsername('Steve')).toBe('steve');
    expect(pterodactylUsername('_Cool.Guy-')).toBe('cool.guy');
    expect(pterodactylUsername('a')).toBe('usera');
    expect(pterodactylUsername('steve', '42')).toBe('steve42');
    expect(pterodactylUsername('Ünïcode Name')).toMatch(/^[a-z0-9][a-z0-9_.-]*[a-z0-9]$/);
  });
});
