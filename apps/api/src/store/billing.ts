/** Length of one paid period. */
export const PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export type RenewalAction =
  /** Nothing to do yet. */
  | 'none'
  /** Due and affordable: charge and extend. */
  | 'renew'
  /** Due but not affordable: suspend the server (never delete it). */
  | 'suspend'
  /** Suspended for non-payment and now affordable: charge, extend and unsuspend. */
  | 'resume'
  /** Cancelled and the paid period is over: suspend for good (status "cancelled"). */
  | 'end';

export interface BillingState {
  status: 'active' | 'suspended' | 'cancelled';
  cancelAtPeriodEnd: boolean;
  paidUntil: Date;
  price: number;
}

/** What the renewal job should do with one subscription right now. */
export function decideRenewal(subscription: BillingState, credits: number, now: Date): RenewalAction {
  if (subscription.status === 'cancelled') return 'none';
  if (subscription.status === 'active') {
    if (subscription.paidUntil.getTime() > now.getTime()) return 'none';
    if (subscription.cancelAtPeriodEnd) return 'end';
    return credits >= subscription.price ? 'renew' : 'suspend';
  }
  // Suspended for non-payment.
  if (subscription.cancelAtPeriodEnd) return 'none';
  return credits >= subscription.price ? 'resume' : 'none';
}

/** The new paid-until date after a payment: one period after now, or after the current end if that's later. */
export function nextPaidUntil(paidUntil: Date, now: Date): Date {
  return new Date(Math.max(paidUntil.getTime(), now.getTime()) + PERIOD_MS);
}

/**
 * A Pterodactyl username from an ICE18 username: lowercase, only [a-z0-9_.-], starting and
 * ending with a letter or digit (Pterodactyl's rule), with an optional suffix to avoid clashes.
 */
export function pterodactylUsername(username: string, suffix = ''): string {
  let base = username.toLowerCase().replace(/[^a-z0-9_.-]/g, '_').replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  if (base.length < 2) base = `user${base}`;
  return `${base.slice(0, 40)}${suffix}`;
}
