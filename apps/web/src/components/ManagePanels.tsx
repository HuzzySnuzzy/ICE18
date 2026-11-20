import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Allocation, PermissionCatalogue, ServerPermission, ServerSummary, StartupInfo, Subuser } from '@ice18/shared';
import { api, errorMessage } from '../lib/api';
import { Alert, Badge, Button, Card, Dialog, Input, Spinner, cx } from './ui';

const serverBase = (server: ServerSummary) => `/servers/${encodeURIComponent(server.identifier)}`;
const canOn = (server: ServerSummary) => (permission: ServerPermission) => server.permissions.includes(permission);

function Loading({ text = 'Loading…' }: { text?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-ink-400">
      <Spinner className="size-4" /> {text}
    </div>
  );
}

function useNotice() {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const banner =
    error || notice ? (
      <Alert tone={error ? 'red' : 'ice'}>
        <div className="flex justify-between gap-3">
          <span>{error ?? notice}</span>
          <button type="button" className="text-xs" onClick={() => (error ? setError(null) : setNotice(null))}>
            Dismiss
          </button>
        </div>
      </Alert>
    ) : null;
  return { setError, setNotice, banner };
}

// ===================== Users =====================

function PermissionPicker({
  catalogue,
  value,
  onChange,
  grantable,
}: {
  catalogue: PermissionCatalogue;
  value: string[];
  onChange: (next: string[]) => void;
  grantable: string[] | '*';
}) {
  const allowed = (permission: string) => grantable === '*' || grantable.includes(permission);
  const set = new Set(value);
  const toggle = (permission: string) => {
    const next = new Set(set);
    if (next.has(permission)) next.delete(permission);
    else next.add(permission);
    onChange([...next]);
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {Object.entries(catalogue).map(([group, entry]) => {
        const keys = Object.keys(entry.keys).map((key) => `${group}.${key}`);
        const usable = keys.filter(allowed);
        const allOn = usable.length > 0 && usable.every((key) => set.has(key));
        return (
          <fieldset key={group} className="rounded-lg border border-ink-700 bg-ink-900/60 p-3">
            <legend className="flex w-full items-center justify-between gap-2 px-1 text-sm font-medium text-ink-100">
              <span className="capitalize">{group}</span>
            </legend>
            <div className="mb-2 flex items-start justify-between gap-2">
              <p className="text-xs text-ink-400">{entry.description}</p>
              {usable.length > 0 && (
                <button
                  type="button"
                  className="shrink-0 text-xs text-ice-400 hover:text-ice-300"
                  onClick={() => onChange(allOn ? value.filter((key) => !usable.includes(key)) : [...new Set([...value, ...usable])])}
                >
                  {allOn ? 'None' : 'All'}
                </button>
              )}
            </div>
            <div className="space-y-1.5">
              {Object.entries(entry.keys).map(([key, description]) => {
                const permission = `${group}.${key}`;
                const disabled = !allowed(permission);
                return (
                  <label key={key} className={cx('flex items-start gap-2 text-sm', disabled ? 'opacity-40' : 'cursor-pointer')} title={disabled ? "You don't have this permission yourself" : description}>
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 accent-[var(--color-ice-400)]"
                      checked={set.has(permission)}
                      disabled={disabled}
                      onChange={() => toggle(permission)}
                    />
                    <span>
                      <span className="text-ink-100">{key}</span>
                      <span className="block text-xs text-ink-500">{description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

export function UsersPanel({ server }: { server: ServerSummary }) {
  const base = serverBase(server);
  const can = canOn(server);
  const [users, setUsers] = useState<Subuser[] | null>(null);
  const [grantable, setGrantable] = useState<string[] | '*'>([]);
  const [catalogue, setCatalogue] = useState<PermissionCatalogue | null>(null);
  const [editing, setEditing] = useState<{ user: Subuser | null; email: string; permissions: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const { setError, setNotice, banner } = useNotice();

  const load = useCallback(async () => {
    try {
      const [list, perms] = await Promise.all([
        api<{ users: Subuser[]; grantable: string[] | '*' }>(`${base}/users`),
        api<PermissionCatalogue>(`${base}/users/permissions`),
      ]);
      setUsers(list.users);
      setGrantable(list.grantable);
      setCatalogue(perms);
    } catch (err) {
      setError(errorMessage(err));
      setUsers([]);
    }
  }, [base, setError]);

  useEffect(() => {
    if (can('user.read')) void load();
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!can('user.read')) return <Alert tone="yellow">You don't have permission to manage this server's users.</Alert>;
  if (!users) return <Loading />;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      if (editing.user) {
        await api(`${base}/users/${editing.user.uuid}`, { method: 'PUT', body: { permissions: editing.permissions } });
        setNotice(`Updated ${editing.user.email}.`);
      } else {
        await api(`${base}/users`, { body: { email: editing.email, permissions: editing.permissions } });
        setNotice(`Added ${editing.email}. If they had no Pterodactyl account yet, they'll get an email to set a password.`);
      }
      setEditing(null);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(user: Subuser) {
    if (!window.confirm(`Remove ${user.email} from ${server.name}? They lose all access to this server. Their account isn't deleted.`)) return;
    setError(null);
    try {
      await api(`${base}/users/${user.uuid}`, { method: 'DELETE' });
      setNotice(`Removed ${user.email}.`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      {banner}
      <Card
        title="People with access"
        actions={
          can('user.create') && (
            <Button variant="primary" onClick={() => setEditing({ user: null, email: '', permissions: ['websocket.connect', 'control.console'] })}>
              Add user
            </Button>
          )
        }
      >
        <p className="mb-4 text-sm text-ink-400">
          The owner always has full access. Users added here are Pterodactyl subusers, so the same access applies in Pterodactyl.
        </p>
        {users.length === 0 ? (
          <p className="text-sm text-ink-400">No one else has access yet.</p>
        ) : (
          <ul className="divide-y divide-ink-700">
            {users.map((user) => (
              <li key={user.uuid} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-ink-100">{user.email}</span>
                    {user.twoFactor && <Badge tone="green">2FA</Badge>}
                  </div>
                  <div className="text-xs text-ink-400">
                    {user.username} · {user.permissions.length} permission{user.permissions.length === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="flex gap-1">
                  {can('user.update') && (
                    <Button variant="ghost" onClick={() => setEditing({ user, email: user.email, permissions: user.permissions })}>
                      Edit
                    </Button>
                  )}
                  {can('user.delete') && (
                    <Button variant="ghost" className="text-red-300" onClick={() => void remove(user)}>
                      Remove
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing && catalogue && (
        <Dialog wide title={editing.user ? `Permissions for ${editing.user.email}` : 'Add a user'} onClose={() => setEditing(null)}>
          <form onSubmit={save} className="space-y-4">
            {!editing.user && (
              <Input
                label="Email"
                type="email"
                required
                value={editing.email}
                onChange={(event) => setEditing({ ...editing, email: event.target.value })}
                hint="Their Pterodactyl account email. A new account is created if they don't have one."
              />
            )}
            {grantable !== '*' && <Alert tone="yellow">You can only give permissions you have yourself.</Alert>}
            <PermissionPicker catalogue={catalogue} value={editing.permissions} onChange={(permissions) => setEditing({ ...editing, permissions })} grantable={grantable} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" busy={busy}>
                {editing.user ? 'Save permissions' : 'Add user'}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}

// ===================== Startup =====================

export function StartupPanel({ server, onRenamed }: { server: ServerSummary; onRenamed: () => void }) {
  const base = serverBase(server);
  const can = canOn(server);
  const [info, setInfo] = useState<StartupInfo | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [name, setName] = useState(server.name);
  const [description, setDescription] = useState(server.description);
  const { setError, setNotice, banner } = useNotice();

  const load = useCallback(async () => {
    try {
      const next = await api<StartupInfo>(`${base}/startup`);
      setInfo(next);
      setValues(Object.fromEntries(next.variables.map((variable) => [variable.envVariable, variable.serverValue ?? variable.defaultValue ?? ''])));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [base, setError]);

  useEffect(() => {
    if (can('startup.read')) void load();
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveVariable(key: string) {
    setSaving(key);
    setError(null);
    try {
      await api(`${base}/startup/variables`, { method: 'PUT', body: { key, value: values[key] ?? '' } });
      setNotice('Saved. Restart the server for the change to take effect.');
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(null);
    }
  }

  async function rename(event: FormEvent) {
    event.preventDefault();
    setSaving('__rename');
    setError(null);
    try {
      await api(`${base}/rename`, { body: { name, description } });
      setNotice('Server details saved.');
      onRenamed();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-4">
      {banner}
      {can('settings.rename') && (
        <Card title="Server details">
          <form onSubmit={rename} className="grid gap-4">
            <Input label="Name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={191} />
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-ink-200">Description</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
                className="w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-base text-ink-100 focus:border-ice-500 focus:outline-none sm:text-sm"
              />
            </label>
            <div>
              <Button type="submit" busy={saving === '__rename'} disabled={name.trim() === server.name && description === server.description}>
                Save details
              </Button>
            </div>
          </form>
        </Card>
      )}

      {!can('startup.read') ? (
        <Alert tone="yellow">You don't have permission to see this server's startup settings.</Alert>
      ) : !info ? (
        <Loading />
      ) : (
        <>
          <Card title="Startup command">
            <code className="block rounded-lg bg-ink-950 p-3 font-mono text-xs break-all text-ink-200">{info.startupCommand}</code>
            <p className="mt-2 text-xs text-ink-500">Set by the server's egg. Changing the command or egg is done by an admin in Pterodactyl.</p>
          </Card>
          <Card title="Variables">
            {info.variables.length === 0 ? (
              <p className="text-sm text-ink-400">This egg has no variables.</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {info.variables.map((variable) => {
                  const current = variable.serverValue ?? variable.defaultValue ?? '';
                  const value = values[variable.envVariable] ?? '';
                  const editable = variable.isEditable && can('startup.update');
                  return (
                    <div key={variable.envVariable} className="rounded-lg border border-ink-700 bg-ink-900/60 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-ink-100">{variable.name}</span>
                        {!variable.isEditable && <Badge>Admin only</Badge>}
                      </div>
                      <p className="mt-0.5 text-xs text-ink-400">{variable.description}</p>
                      <div className="mt-2 flex gap-2">
                        <input
                          value={value}
                          onChange={(event) => setValues({ ...values, [variable.envVariable]: event.target.value })}
                          readOnly={!editable}
                          className="min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-950 px-3 py-2 font-mono text-base text-ink-100 read-only:opacity-60 focus:border-ice-500 focus:outline-none sm:text-sm"
                          aria-label={variable.name}
                        />
                        {editable && (
                          <Button busy={saving === variable.envVariable} disabled={value === current} onClick={() => void saveVariable(variable.envVariable)}>
                            Save
                          </Button>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-ink-500">
                        <span className="font-mono">{variable.envVariable}</span>
                        {variable.rules && <span className="font-mono">{variable.rules}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

// ===================== Network =====================

export function NetworkPanel({ server }: { server: ServerSummary }) {
  const base = serverBase(server);
  const can = canOn(server);
  const [allocations, setAllocations] = useState<Allocation[] | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const { setError, setNotice, banner } = useNotice();

  const load = useCallback(async () => {
    try {
      const list = await api<Allocation[]>(`${base}/allocations`);
      setAllocations(list);
      setNotes(Object.fromEntries(list.map((allocation) => [allocation.id, allocation.notes ?? ''])));
    } catch (err) {
      setError(errorMessage(err));
      setAllocations([]);
    }
  }, [base, setError]);

  useEffect(() => {
    if (can('allocation.read')) void load();
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const address = useMemo(() => (allocation: Allocation) => `${allocation.ipAlias || allocation.ip}:${allocation.port}`, []);

  if (!can('allocation.read')) return <Alert tone="yellow">You don't have permission to see this server's ports.</Alert>;
  if (!allocations) return <Loading />;

  async function act(key: string, action: () => Promise<unknown>, success: string) {
    setBusy(key);
    setError(null);
    try {
      await action();
      setNotice(success);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {banner}
      <Card
        title="Ports"
        actions={
          can('allocation.create') && (
            <Button busy={busy === 'add'} onClick={() => void act('add', () => api(`${base}/allocations`, { method: 'POST' }), 'Added a port.')}>
              Add port
            </Button>
          )
        }
      >
        <p className="mb-4 text-sm text-ink-400">
          Players connect to the primary port. Extra ports are for plugins like voice chat or Dynmap. Removing ports is done in Pterodactyl.
        </p>
        <ul className="divide-y divide-ink-700">
          {allocations.map((allocation) => (
            <li key={allocation.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="flex min-w-[12rem] items-center gap-2">
                <code className="font-mono text-sm text-ink-100">{address(allocation)}</code>
                <button
                  type="button"
                  className="text-xs text-ice-400 hover:text-ice-300"
                  onClick={() => void navigator.clipboard?.writeText(address(allocation)).then(() => setNotice(`Copied ${address(allocation)}.`))}
                >
                  Copy
                </button>
                {allocation.isDefault && <Badge tone="ice">Primary</Badge>}
              </div>
              <input
                value={notes[allocation.id] ?? ''}
                onChange={(event) => setNotes({ ...notes, [allocation.id]: event.target.value })}
                readOnly={!can('allocation.update')}
                placeholder="Notes (e.g. Dynmap)"
                maxLength={255}
                className="min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-950 px-3 py-1.5 text-base text-ink-100 placeholder:text-ink-500 focus:border-ice-500 focus:outline-none sm:text-sm"
                aria-label={`Notes for ${address(allocation)}`}
              />
              <div className="flex gap-1">
                {can('allocation.update') && (notes[allocation.id] ?? '') !== (allocation.notes ?? '') && (
                  <Button
                    busy={busy === `notes-${allocation.id}`}
                    onClick={() =>
                      void act(
                        `notes-${allocation.id}`,
                        () => api(`${base}/allocations/${allocation.id}`, { method: 'PUT', body: { notes: notes[allocation.id] || null } }),
                        'Notes saved.',
                      )
                    }
                  >
                    Save
                  </Button>
                )}
                {can('allocation.update') && !allocation.isDefault && (
                  <Button
                    variant="ghost"
                    busy={busy === `primary-${allocation.id}`}
                    onClick={() =>
                      void act(
                        `primary-${allocation.id}`,
                        () => api(`${base}/allocations/${allocation.id}/primary`, { method: 'POST' }),
                        `${address(allocation)} is now the primary port. Restart the server to use it.`,
                      )
                    }
                  >
                    Make primary
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
