import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { AuditEntry, PterodactylUserSummary, PublicUser } from '@ice18/shared';
import { Alert, Badge, Button, Card, Input, PageHeader, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/format';

function LinkEditor({ user, onDone }: { user: PublicUser; onDone: (updated: PublicUser | null) => void }) {
  const [email, setEmail] = useState(user.email);
  const [results, setResults] = useState<PterodactylUserSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResults(await api<PterodactylUserSummary[]>(`/admin/pterodactyl/users?email=${encodeURIComponent(email)}`));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function link(pteroUserId: number) {
    setBusy(true);
    setError(null);
    try {
      onDone(await api<PublicUser>(`/admin/users/${user.id}/pterodactyl`, { body: { pteroUserId } }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-ink-700 bg-ink-900 p-4">
      <form onSubmit={search} className="flex flex-wrap gap-2">
        <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Pterodactyl email" className="max-w-xs" />
        <Button type="submit" busy={busy}>
          Find Pterodactyl user
        </Button>
        <Button type="button" variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
      </form>
      {error && <Alert>{error}</Alert>}
      {results && results.length === 0 && <p className="text-sm text-ink-400">No Pterodactyl user with that email.</p>}
      {results?.map((result) => (
        <div key={result.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-ink-850 px-3 py-2 text-sm">
          <span>
            <span className="font-mono text-ink-400">#{result.id}</span> <span className="text-ink-100">{result.username}</span>{' '}
            <span className="text-ink-400">{result.email}</span> {result.rootAdmin && <Badge tone="ice">Root admin</Badge>}
          </span>
          <Button variant="primary" onClick={() => void link(result.id)} disabled={busy}>
            Link
          </Button>
        </div>
      ))}
    </div>
  );
}

function UsersCard() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<PublicUser[] | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<PublicUser[]>('/admin/users')
      .then(setUsers)
      .catch((err) => setError(errorMessage(err)));
  }, []);
  useEffect(load, [load]);

  const replace = (updated: PublicUser) => setUsers((list) => list?.map((entry) => (entry.id === updated.id ? updated : entry)) ?? null);

  async function run(action: () => Promise<PublicUser>) {
    setError(null);
    try {
      replace(await action());
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Card title="Users">
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}
      {!users ? (
        <Spinner className="size-4" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-ink-400 uppercase">
              <tr>
                <th className="py-2 pr-4 font-medium">User</th>
                <th className="py-2 pr-4 font-medium">Role</th>
                <th className="py-2 pr-4 font-medium">Pterodactyl</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-700">
              {users.map((user) => (
                <tr key={user.id} className="align-top">
                  <td className="py-3 pr-4">
                    <div className="text-ink-100">{user.username}</div>
                    <div className="text-xs text-ink-400">{user.email}</div>
                    {editing === user.id && (
                      <div className="mt-3">
                        <LinkEditor
                          user={user}
                          onDone={(updated) => {
                            if (updated) replace(updated);
                            setEditing(null);
                          }}
                        />
                      </div>
                    )}
                  </td>
                  <td className="py-3 pr-4">{user.isAdmin ? <Badge tone="ice">Admin</Badge> : <Badge>User</Badge>}</td>
                  <td className="py-3 pr-4">
                    {user.pteroUserId !== null ? (
                      <span className="font-mono text-ink-200">#{user.pteroUserId}</span>
                    ) : (
                      <span className="text-ink-400">Not linked</span>
                    )}
                  </td>
                  <td className="py-3 text-right whitespace-nowrap">
                    <div className="-my-1.5 flex justify-end gap-1">
                      <Button variant="ghost" onClick={() => setEditing(user.id)}>
                        {user.pteroUserId !== null ? 'Relink' : 'Link'}
                      </Button>
                      {user.pteroUserId !== null && (
                        <Button
                          variant="ghost"
                          onClick={() => void run(() => api(`/admin/users/${user.id}/pterodactyl`, { body: { pteroUserId: null } }))}
                        >
                          Unlink
                        </Button>
                      )}
                      {user.id !== me?.id && (
                        <Button
                          variant="ghost"
                          onClick={() => void run(() => api(`/admin/users/${user.id}/admin`, { body: { isAdmin: !user.isAdmin } }))}
                        >
                          {user.isAdmin ? 'Remove admin' : 'Make admin'}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function AuditCard() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<AuditEntry[]>('/admin/audit')
      .then(setEntries)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  return (
    <Card title="Activity log">
      {error && <Alert>{error}</Alert>}
      {!entries && !error && <Spinner className="size-4" />}
      {entries && entries.length === 0 && <p className="text-sm text-ink-400">Nothing yet.</p>}
      {entries && entries.length > 0 && (
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-ink-700">
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="py-2 pr-4 text-xs whitespace-nowrap text-ink-400">{formatDate(entry.createdAt)}</td>
                  <td className="py-2 pr-4 whitespace-nowrap text-ink-200">{entry.username ?? '—'}</td>
                  <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap text-ice-300">{entry.action}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-ink-300">{entry.target}</td>
                  <td className="max-w-md truncate py-2 font-mono text-xs text-ink-400" title={entry.detail ?? ''}>
                    {entry.detail}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function AdminPage() {
  return (
    <>
      <PageHeader title="Admin" subtitle="Manage ICE18 accounts and see what's been happening." />
      <div className="grid gap-5">
        <UsersCard />
        <AuditCard />
      </div>
    </>
  );
}
