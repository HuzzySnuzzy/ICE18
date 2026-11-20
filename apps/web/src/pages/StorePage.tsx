import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { StoreItem, StoreOverview, Subscription, Wallet } from '@ice18/shared';
import { Alert, Badge, Button, Card, Dialog, Input, PageHeader, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatLimitMiB } from '../lib/format';

export const credits = (amount: number) => `${amount.toLocaleString()} credit${amount === 1 ? '' : 's'}`;

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-ink-400">{label}</span>
      <span className="text-ink-100 tabular-nums">{value}</span>
    </div>
  );
}

function ProductCard({ item, onOrder }: { item: StoreItem; onOrder: () => void }) {
  return (
    <div className="flex flex-col rounded-xl border border-ink-700 bg-ink-850 p-5">
      <h3 className="text-lg font-semibold text-ink-100">{item.name}</h3>
      {item.description && <p className="mt-1 text-sm whitespace-pre-line text-ink-400">{item.description}</p>}
      <div className="mt-4 space-y-1.5">
        <Spec label="Memory" value={formatLimitMiB(item.memory)} />
        <Spec label="Disk" value={formatLimitMiB(item.disk)} />
        <Spec label="CPU" value={item.cpu === 0 ? 'Unlimited' : `${item.cpu}%`} />
        {item.databases > 0 && <Spec label="Databases" value={String(item.databases)} />}
        {item.allocations > 1 && <Spec label="Extra ports" value={String(item.allocations - 1)} />}
        {item.backups > 0 && <Spec label="Backups" value={String(item.backups)} />}
      </div>
      <div className="mt-auto flex items-end justify-between gap-3 pt-5">
        <div>
          <span className="text-2xl font-semibold text-ice-300 tabular-nums">{item.price.toLocaleString()}</span>
          <span className="text-sm text-ink-400"> credits / month</span>
        </div>
        <Button variant="primary" onClick={onOrder}>
          Order
        </Button>
      </div>
    </div>
  );
}

const statusTone = { active: 'green', suspended: 'red', cancelled: 'neutral' } as const;

function SubscriptionRow({ subscription, onChanged, setError }: { subscription: Subscription; onChanged: () => void; setError: (message: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  async function act(action: 'cancel' | 'resume') {
    if (action === 'cancel' && !window.confirm(`Stop renewing "${subscription.name}"? It keeps running until ${formatDate(subscription.paidUntil)}, then it's suspended (not deleted).`)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/store/subscriptions/${subscription.id}/${action}`, { method: 'POST' });
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const status = subscription.cancelAtPeriodEnd && subscription.status === 'active' ? 'Ends' : null;
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/servers/${subscription.serverIdentifier}`} className="truncate font-medium text-ice-400 hover:text-ice-300">
            {subscription.name}
          </Link>
          <Badge tone={statusTone[subscription.status]}>{subscription.status === 'active' ? 'Active' : subscription.status === 'suspended' ? 'Suspended: unpaid' : 'Ended'}</Badge>
          {status && <Badge tone="yellow">Cancelled</Badge>}
        </div>
        <div className="text-xs text-ink-400">
          {subscription.prefabName ?? 'Custom'} · {credits(subscription.price)}/month ·{' '}
          {subscription.status === 'active'
            ? `${subscription.cancelAtPeriodEnd ? 'ends' : 'renews'} ${formatDate(subscription.paidUntil)}`
            : subscription.status === 'suspended'
              ? 'reactivates automatically once your balance covers it'
              : `ended ${formatDate(subscription.paidUntil)}`}
        </div>
      </div>
      {subscription.status === 'active' && !subscription.cancelAtPeriodEnd && (
        <Button variant="ghost" busy={busy} onClick={() => void act('cancel')}>
          Cancel
        </Button>
      )}
      {(subscription.cancelAtPeriodEnd || subscription.status !== 'active') && (
        <Button busy={busy} onClick={() => void act('resume')}>
          {subscription.status === 'active' ? 'Keep it' : 'Reactivate'}
        </Button>
      )}
    </li>
  );
}

export function StorePage() {
  const { refresh } = useAuth();
  const [overview, setOverview] = useState<StoreOverview | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [ordering, setOrdering] = useState<StoreItem | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Subscription | null>(null);

  const load = useCallback(async () => {
    try {
      const [next, nextWallet] = await Promise.all([api<StoreOverview>('/store'), api<Wallet>('/store/wallet')]);
      setOverview(next);
      setWallet(nextWallet);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function order(event: FormEvent) {
    event.preventDefault();
    if (!ordering) return;
    setBusy(true);
    setError(null);
    try {
      const subscription = await api<Subscription>('/store/order', { body: { prefabId: ordering.id, name } });
      setDone(subscription);
      setOrdering(null);
      setName('');
      await load();
      void refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!overview) {
    return error ? (
      <Alert>{error}</Alert>
    ) : (
      <div className="flex items-center gap-3 text-sm text-ink-400">
        <Spinner className="size-4" /> Loading store…
      </div>
    );
  }

  const balanceAfter = ordering ? overview.credits - ordering.price : 0;

  return (
    <>
      <PageHeader
        title="Store"
        subtitle="Order a server. It's paid monthly from your credits."
        actions={
          <div className="rounded-xl border border-ink-700 bg-ink-850 px-4 py-2 text-right">
            <div className="text-[11px] tracking-wide text-ink-400 uppercase">Balance</div>
            <div className="text-lg font-semibold text-ice-300 tabular-nums">{credits(overview.credits)}</div>
          </div>
        }
      />
      <div className="space-y-6">
        {error && !ordering && <Alert>{error}</Alert>}
        {done && (
          <Alert tone="ice">
            <b>{done.name}</b> is being set up. It can take a minute to install.{' '}
            <Link to={`/servers/${done.serverIdentifier}`} className="font-medium underline">
              Open it
            </Link>
          </Alert>
        )}

        {overview.items.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-400">Nothing is for sale yet.</p>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {overview.items.map((item) => (
              <ProductCard
                key={item.id}
                item={item}
                onOrder={() => {
                  setOrdering(item);
                  setError(null);
                  setDone(null);
                }}
              />
            ))}
          </div>
        )}

        {overview.subscriptions.length > 0 && (
          <Card title="Your orders">
            <ul className="divide-y divide-ink-700">
              {overview.subscriptions.map((subscription) => (
                <SubscriptionRow key={subscription.id} subscription={subscription} onChanged={() => void load()} setError={setError} />
              ))}
            </ul>
          </Card>
        )}

        {wallet && wallet.transactions.length > 0 && (
          <Card title="Credit history">
            <ul className="divide-y divide-ink-700 text-sm">
              {wallet.transactions.map((transaction) => (
                <li key={transaction.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                  <span className="w-40 shrink-0 text-xs text-ink-500">{formatDate(transaction.createdAt)}</span>
                  <span className="min-w-0 flex-1 text-ink-200">{transaction.reason}</span>
                  <span className={transaction.amount >= 0 ? 'text-emerald-300 tabular-nums' : 'text-ink-300 tabular-nums'}>
                    {transaction.amount > 0 ? '+' : ''}
                    {transaction.amount.toLocaleString()}
                  </span>
                  <span className="w-24 text-right text-xs text-ink-500 tabular-nums">= {transaction.balanceAfter.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      {ordering && (
        <Dialog title={`Order ${ordering.name}`} onClose={() => setOrdering(null)}>
          <form onSubmit={order} className="space-y-4">
            {error && <Alert>{error}</Alert>}
            <Input label="Server name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} autoFocus placeholder="My server" />
            <div className="space-y-1.5 rounded-lg border border-ink-700 bg-ink-900/60 p-3">
              <Spec label="Price" value={`${credits(ordering.price)} / month`} />
              <Spec label="Your balance" value={credits(overview.credits)} />
              <Spec label="After this order" value={credits(balanceAfter)} />
            </div>
            <p className="text-xs text-ink-400">
              You pay the first month now. Every 30 days the price is taken from your credits again; if your balance is too low the server is
              suspended until you top up. You can cancel any time.
            </p>
            {balanceAfter < 0 && <Alert tone="yellow">You don't have enough credits for this. Ask an admin to top up your balance.</Alert>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOrdering(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" busy={busy} disabled={balanceAfter < 0 || !name.trim()}>
                Pay {credits(ordering.price)} and create
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
