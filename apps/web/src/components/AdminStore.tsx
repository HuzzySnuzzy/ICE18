import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { EggDetails, EggSummary, LocationSummary, Prefab, PrefabInput, PublicUser, Subscription, Wallet } from '@ice18/shared';
import { api, errorMessage } from '../lib/api';
import { formatDate, formatLimitMiB } from '../lib/format';
import { Alert, Badge, Button, Card, Dialog, Input, Spinner, cx } from './ui';

const credits = (amount: number) => `${amount.toLocaleString()} credit${amount === 1 ? '' : 's'}`;

const EMPTY: PrefabInput = {
  name: '',
  description: '',
  nestId: 0,
  eggId: 0,
  dockerImage: '',
  startup: '',
  environment: {},
  memory: 4096,
  swap: 0,
  disk: 20480,
  io: 500,
  cpu: 200,
  databases: 1,
  allocations: 1,
  backups: 1,
  locationIds: [],
  price: 0,
  storeVisible: false,
  sortOrder: 0,
};

function NumberField({ label, value, onChange, hint, min = 0 }: { label: string; value: number; onChange: (value: number) => void; hint?: string; min?: number }) {
  return (
    <Input
      label={label}
      type="number"
      inputMode="numeric"
      min={min}
      value={Number.isFinite(value) ? value : 0}
      onChange={(event) => onChange(Math.trunc(Number(event.target.value)))}
      hint={hint}
    />
  );
}

function PrefabEditor({ prefab, onClose, onSaved }: { prefab: Prefab | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<PrefabInput>(() => (prefab ? { ...prefab } : { ...EMPTY }));
  const [eggs, setEggs] = useState<EggSummary[] | null>(null);
  const [egg, setEgg] = useState<EggDetails | null>(null);
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof PrefabInput>(key: K, value: PrefabInput[K]) => setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    Promise.all([api<EggSummary[]>('/admin/catalogue/eggs'), api<LocationSummary[]>('/admin/catalogue/locations')])
      .then(([nextEggs, nextLocations]) => {
        setEggs(nextEggs);
        setLocations(nextLocations);
        if (!prefab && nextLocations.length === 1) set('locationIds', [nextLocations[0]!.id]);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [prefab]);

  useEffect(() => {
    if (!form.eggId || !form.nestId) return setEgg(null);
    api<EggDetails>(`/admin/catalogue/eggs/${form.nestId}/${form.eggId}`)
      .then(setEgg)
      .catch((err) => setError(errorMessage(err)));
  }, [form.nestId, form.eggId]);

  function chooseEgg(value: string) {
    const chosen = eggs?.find((entry) => `${entry.nestId}:${entry.id}` === value);
    if (!chosen) return;
    setForm((current) => ({
      ...current,
      nestId: chosen.nestId,
      eggId: chosen.id,
      dockerImage: Object.values(chosen.dockerImages)[0] ?? '',
      startup: chosen.startup,
      environment: {},
    }));
  }

  const nests = useMemo(() => {
    const groups = new Map<string, EggSummary[]>();
    for (const entry of eggs ?? []) groups.set(entry.nestName, [...(groups.get(entry.nestName) ?? []), entry]);
    return [...groups.entries()];
  }, [eggs]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const environment = Object.fromEntries(Object.entries(form.environment).filter(([, value]) => value !== ''));
      await api(prefab ? `/admin/prefabs/${prefab.id}` : '/admin/prefabs', { method: prefab ? 'PUT' : 'POST', body: { ...form, environment } });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog wide title={prefab ? `Edit ${prefab.name}` : 'New prefab'} onClose={onClose}>
      <form onSubmit={save} className="space-y-5">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Name" required value={form.name} onChange={(event) => set('name', event.target.value)} placeholder="Minecraft 4 GB" />
          <NumberField label="Price (credits per month)" value={form.price} onChange={(value) => set('price', value)} hint="0 makes it free." />
          <label className="block space-y-1.5 sm:col-span-2">
            <span className="text-sm font-medium text-ink-200">Description</span>
            <textarea
              value={form.description}
              onChange={(event) => set('description', event.target.value)}
              rows={2}
              className="w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-base text-ink-100 focus:border-ice-500 focus:outline-none sm:text-sm"
              placeholder="Shown in the store."
            />
          </label>
        </div>

        <fieldset className="space-y-3 rounded-lg border border-ink-700 p-4">
          <legend className="px-1 text-sm font-medium text-ink-100">Software</legend>
          {!eggs ? (
            <Spinner className="size-4" />
          ) : (
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-ink-200">Egg</span>
              <select
                required
                value={form.eggId ? `${form.nestId}:${form.eggId}` : ''}
                onChange={(event) => chooseEgg(event.target.value)}
                className="w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-base text-ink-100 focus:border-ice-500 focus:outline-none sm:text-sm"
              >
                <option value="" disabled>
                  Choose an egg…
                </option>
                {nests.map(([nest, list]) => (
                  <optgroup key={nest} label={nest}>
                    {list.map((entry) => (
                      <option key={entry.id} value={`${entry.nestId}:${entry.id}`}>
                        {entry.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          )}
          {egg && (
            <>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-ink-200">Docker image</span>
                <select
                  value={form.dockerImage}
                  onChange={(event) => set('dockerImage', event.target.value)}
                  className="w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-base text-ink-100 focus:border-ice-500 focus:outline-none sm:text-sm"
                >
                  {Object.entries(egg.dockerImages).map(([label, image]) => (
                    <option key={image} value={image}>
                      {label === image ? image : `${label} (${image})`}
                    </option>
                  ))}
                </select>
              </label>
              <Input label="Startup command" value={form.startup} onChange={(event) => set('startup', event.target.value)} className="font-mono" />
              {egg.variables.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {egg.variables.map((variable) => (
                    <Input
                      key={variable.envVariable}
                      label={variable.name}
                      value={form.environment[variable.envVariable] ?? ''}
                      placeholder={variable.defaultValue || '(empty)'}
                      onChange={(event) => set('environment', { ...form.environment, [variable.envVariable]: event.target.value })}
                      hint={<span className="font-mono">{variable.envVariable}</span>}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </fieldset>

        <fieldset className="grid gap-4 rounded-lg border border-ink-700 p-4 sm:grid-cols-3">
          <legend className="px-1 text-sm font-medium text-ink-100">Resources</legend>
          <NumberField label="Memory (MiB)" value={form.memory} onChange={(value) => set('memory', value)} hint={formatLimitMiB(form.memory)} />
          <NumberField label="Disk (MiB)" value={form.disk} onChange={(value) => set('disk', value)} hint={formatLimitMiB(form.disk)} />
          <NumberField label="CPU (%)" value={form.cpu} onChange={(value) => set('cpu', value)} hint="100 = one core, 0 = unlimited" />
          <NumberField label="Swap (MiB)" value={form.swap} min={-1} onChange={(value) => set('swap', value)} />
          <NumberField label="Block IO weight" value={form.io} min={10} onChange={(value) => set('io', value)} hint="10-1000" />
          <NumberField label="Databases" value={form.databases} onChange={(value) => set('databases', value)} />
          <NumberField label="Ports" value={form.allocations} onChange={(value) => set('allocations', value)} />
          <NumberField label="Backups" value={form.backups} onChange={(value) => set('backups', value)} />
          <NumberField label="Sort order" value={form.sortOrder} min={-1000} onChange={(value) => set('sortOrder', value)} hint="Lower shows first" />
        </fieldset>

        <fieldset className="rounded-lg border border-ink-700 p-4">
          <legend className="px-1 text-sm font-medium text-ink-100">Deploy to</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {locations.map((location) => (
              <label key={location.id} className="flex items-center gap-2 text-sm text-ink-200">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--color-ice-400)]"
                  checked={form.locationIds.includes(location.id)}
                  onChange={() =>
                    set(
                      'locationIds',
                      form.locationIds.includes(location.id) ? form.locationIds.filter((id) => id !== location.id) : [...form.locationIds, location.id],
                    )
                  }
                />
                {location.short}
                {location.long && <span className="text-ink-500">({location.long})</span>}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-500">Pterodactyl picks a node with free resources and a free port in these locations.</p>
        </fieldset>

        <label className="flex items-center gap-2 text-sm text-ink-200">
          <input type="checkbox" className="size-4 accent-[var(--color-ice-400)]" checked={form.storeVisible} onChange={(event) => set('storeVisible', event.target.checked)} />
          Show in the store
        </label>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!form.eggId || form.locationIds.length === 0}>
            {prefab ? 'Save' : 'Create prefab'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function CreateServerDialog({ prefab, onClose }: { prefab: Prefab; onClose: () => void }) {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [ownerId, setOwnerId] = useState<number>(0);
  useEffect(() => {
    api<PublicUser[]>('/admin/users')
      .then((list) => {
        setUsers(list);
        setOwnerId(list[0]?.id ?? 0);
      })
      .catch(() => undefined);
  }, []);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ identifier: string }>(`/admin/prefabs/${prefab.id}/create-server`, { body: { ownerId, name } });
      setCreated(result.identifier);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={`Create a server from ${prefab.name}`} onClose={onClose}>
      {created ? (
        <div className="space-y-4">
          <Alert tone="ice">The server is being created. It can take a minute to install.</Alert>
          <div className="flex justify-end gap-2">
            <Link to={`/servers/${created}`} className="rounded-lg bg-ice-400 px-3.5 py-2 text-sm font-medium text-ink-950 hover:bg-ice-300">
              Open server
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink-200">Owner</span>
            <select
              value={ownerId}
              onChange={(event) => setOwnerId(Number(event.target.value))}
              className="w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-base text-ink-100 focus:border-ice-500 focus:outline-none sm:text-sm"
            >
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.username} ({user.email}){user.pteroUserId === null ? ' · Pterodactyl account will be created' : ''}
                </option>
              ))}
            </select>
          </label>
          <Input label="Server name" required value={name} onChange={(event) => setName(event.target.value)} maxLength={100} />
          <p className="text-xs text-ink-400">Admin-created servers are free: no credits are taken and they don't renew.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" busy={busy} disabled={!ownerId || !name.trim()}>
              Create server
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function PrefabsCard() {
  const [prefabs, setPrefabs] = useState<Prefab[] | null>(null);
  const [editing, setEditing] = useState<Prefab | 'new' | null>(null);
  const [creating, setCreating] = useState<Prefab | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Prefab[]>('/admin/prefabs')
      .then(setPrefabs)
      .catch((err) => setError(errorMessage(err)));
  }, []);
  useEffect(load, [load]);

  async function remove(prefab: Prefab) {
    if (!window.confirm(`Delete the prefab "${prefab.name}"? Servers already made from it keep running and keep renewing.`)) return;
    try {
      await api(`/admin/prefabs/${prefab.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Card
      title="Prefabs"
      actions={
        <Button variant="primary" onClick={() => setEditing('new')}>
          New prefab
        </Button>
      }
    >
      <p className="mb-4 text-sm text-ink-400">Server templates. Visible ones are sold in the store; admins can create servers from any of them for free.</p>
      {error && (
        <div className="mb-3">
          <Alert>{error}</Alert>
        </div>
      )}
      {!prefabs ? (
        <Spinner className="size-4" />
      ) : prefabs.length === 0 ? (
        <p className="text-sm text-ink-400">No prefabs yet.</p>
      ) : (
        <ul className="divide-y divide-ink-700">
          {prefabs.map((prefab) => (
            <li key={prefab.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink-100">{prefab.name}</span>
                  {prefab.storeVisible ? <Badge tone="green">In store</Badge> : <Badge>Hidden</Badge>}
                </div>
                <div className="text-xs text-ink-400">
                  {formatLimitMiB(prefab.memory)} RAM · {formatLimitMiB(prefab.disk)} disk · {prefab.cpu ? `${prefab.cpu}%` : 'unlimited'} CPU ·{' '}
                  {credits(prefab.price)}/month
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button variant="ghost" onClick={() => setCreating(prefab)}>
                  Create server
                </Button>
                <Button variant="ghost" onClick={() => setEditing(prefab)}>
                  Edit
                </Button>
                <Button variant="ghost" className="text-red-300" onClick={() => void remove(prefab)}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <PrefabEditor
          prefab={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {creating && <CreateServerDialog prefab={creating} onClose={() => setCreating(null)} />}
    </Card>
  );
}

export function CreditsDialog({ user, onClose, onChanged }: { user: PublicUser; onClose: () => void; onChanged: (credits: number) => void }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Wallet>(`/admin/users/${user.id}/credits`)
      .then(setWallet)
      .catch((err) => setError(errorMessage(err)));
  }, [user.id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const next = await api<Wallet>(`/admin/users/${user.id}/credits`, { body: { amount: Number(amount), reason } });
      setWallet(next);
      onChanged(next.credits);
      setAmount('');
      setReason('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const value = Number(amount);
  return (
    <Dialog title={`Credits for ${user.username}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="text-sm text-ink-300">
          Balance: <span className="text-lg font-semibold text-ice-300 tabular-nums">{wallet ? credits(wallet.credits) : '…'}</span>
        </div>
        {error && <Alert>{error}</Alert>}
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
          <Input label="Amount" type="number" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="+500 or -100" required />
          <Input label="Reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Paid via PayPal" required maxLength={200} />
          <Button type="submit" variant="primary" busy={busy} disabled={!Number.isInteger(value) || value === 0 || !reason.trim()}>
            {value < 0 ? 'Take' : 'Add'}
          </Button>
        </form>
        {wallet && wallet.transactions.length > 0 && (
          <ul className="max-h-64 divide-y divide-ink-700 overflow-auto rounded-lg border border-ink-700 px-3 text-sm">
            {wallet.transactions.map((transaction) => (
              <li key={transaction.id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink-200">{transaction.reason}</span>
                  <span className="text-xs text-ink-500">{formatDate(transaction.createdAt)}</span>
                </span>
                <span className={cx('tabular-nums', transaction.amount >= 0 ? 'text-emerald-300' : 'text-ink-300')}>
                  {transaction.amount > 0 ? '+' : ''}
                  {transaction.amount.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

export function SubscriptionsCard() {
  const [list, setList] = useState<Subscription[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Subscription[]>('/admin/subscriptions')
      .then(setList)
      .catch((err) => setError(errorMessage(err)));
  }, []);
  return (
    <Card title="Store orders">
      {error && <Alert>{error}</Alert>}
      {!list && !error && <Spinner className="size-4" />}
      {list && list.length === 0 && <p className="text-sm text-ink-400">No orders yet.</p>}
      {list && list.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-ink-400 uppercase">
              <tr>
                <th className="py-2 pr-4 font-medium">Server</th>
                <th className="py-2 pr-4 font-medium">Customer</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Paid until</th>
                <th className="py-2 font-medium">Price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-700">
              {list.map((subscription) => (
                <tr key={subscription.id}>
                  <td className="py-2 pr-4">
                    <Link to={`/servers/${subscription.serverIdentifier}`} className="text-ice-400 hover:text-ice-300">
                      {subscription.name}
                    </Link>
                    <div className="text-xs text-ink-500">{subscription.prefabName ?? 'Custom'}</div>
                  </td>
                  <td className="py-2 pr-4 text-ink-200">{subscription.username}</td>
                  <td className="py-2 pr-4">
                    <Badge tone={subscription.status === 'active' ? 'green' : subscription.status === 'suspended' ? 'red' : 'neutral'}>{subscription.status}</Badge>
                    {subscription.cancelAtPeriodEnd && subscription.status === 'active' && <span className="ml-1 text-xs text-amber-300">cancelled</span>}
                  </td>
                  <td className="py-2 pr-4 text-xs text-ink-400">{formatDate(subscription.paidUntil)}</td>
                  <td className="py-2 text-ink-300 tabular-nums">{subscription.price.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
