import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { AuditEntry, PterodactylUserSummary, PublicUser, UpdateStatus } from '@ice18/shared';
import { Alert, Badge, Button, Card, Input, PageHeader, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/format';
import { CreditsDialog, PrefabsCard, SubscriptionsCard } from '../components/AdminStore';

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
  const [creditsFor, setCreditsFor] = useState<PublicUser | null>(null);
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
                <th className="py-2 pr-4 font-medium">Credits</th>
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
                  <td className="py-3 pr-4">
                    <button type="button" onClick={() => setCreditsFor(user)} className="text-ink-100 tabular-nums hover:text-ice-300" title="Adjust credits">
                      {user.credits.toLocaleString()}
                    </button>
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
                      <Button variant="ghost" onClick={() => setCreditsFor(user)}>
                        Credits
                      </Button>
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
      {creditsFor && (
        <CreditsDialog
          user={creditsFor}
          onClose={() => setCreditsFor(null)}
          onChanged={(balance) => replace({ ...creditsFor, credits: balance })}
        />
      )}
    </Card>
  );
}

const short = (commit: string | null) => (commit ? commit.slice(0, 7) : '—');

/** Waits for the panel to come back after a restart, then reloads the page. */
async function waitForRestart(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 3000));
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const response = await fetch('/api/health', { cache: 'no-store' });
      if (response.ok) {
        window.location.reload();
        return;
      }
    } catch {
      /* still restarting */
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

function UpdatesCard() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState<'check' | 'apply' | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<UpdateStatus>('/admin/updates')
      .then(setStatus)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  async function check() {
    setBusy('check');
    setError(null);
    try {
      const result = await api<UpdateStatus>('/admin/updates/check', { method: 'POST' });
      setStatus(result);
      // With auto-update on, a check that finds a new version restarts the panel by itself.
      if (result.updateAvailable && result.autoUpdate && result.canRestart && !result.localChanges) {
        setRestarting(true);
        void waitForRestart();
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (!window.confirm('Update ICE18 and restart it now? Open consoles reconnect by themselves. Pterodactyl servers are not affected.')) return;
    setBusy('apply');
    setError(null);
    try {
      await api('/admin/updates/apply', { method: 'POST' });
      setRestarting(true);
      void waitForRestart();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  let badge = <Badge>Not checked yet</Badge>;
  if (status && !status.supported) badge = <Badge>Manual updates</Badge>;
  else if (status?.updateAvailable) badge = <Badge tone="yellow">Update available</Badge>;
  else if (status?.lastCheckedAt) badge = <Badge tone="green">Up to date</Badge>;

  return (
    <Card title="Updates" actions={badge}>
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}
      {restarting ? (
        <div className="flex items-center gap-3 text-sm text-ink-300">
          <Spinner className="size-4" /> Updating and restarting ICE18. This page reloads when it's back, usually within a minute or two.
        </div>
      ) : !status ? (
        <Spinner className="size-4" />
      ) : !status.supported ? (
        <p className="text-sm text-ink-400">
          ICE18 isn't running from a git checkout, so it can't update itself. Reinstall it from Pterodactyl to update.
        </p>
      ) : (
        <div className="space-y-4">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[160px_1fr]">
            <dt className="text-ink-400">Running version</dt>
            <dd className="font-mono text-ink-100">{short(status.currentCommit)}</dd>
            <dt className="text-ink-400">Latest on {status.branch}</dt>
            <dd className="font-mono text-ink-100">{short(status.latestCommit)}</dd>
            <dt className="text-ink-400">Automatic updates</dt>
            <dd className="text-ink-100">
              {status.autoUpdate && status.canRestart
                ? 'On: new versions install by themselves'
                : status.autoUpdate
                  ? 'Off: ICE18 was not started with scripts/start.sh'
                  : 'Off (AUTO_UPDATE=false)'}
            </dd>
            <dt className="text-ink-400">Last checked</dt>
            <dd className="text-ink-100">{status.lastCheckedAt ? formatDate(status.lastCheckedAt) : 'Not yet'}</dd>
          </dl>
          {status.lastError && <Alert tone="yellow">{status.lastError}</Alert>}
          {status.localChanges && (
            <Alert tone="yellow">ICE18's files were edited by hand, so updates won't overwrite them until those edits are removed.</Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void check()} busy={busy === 'check'} disabled={busy !== null || status.checking}>
              Check now
            </Button>
            {status.updateAvailable && (
              <Button
                variant="primary"
                onClick={() => void apply()}
                busy={busy === 'apply'}
                disabled={busy !== null || !status.canRestart || status.localChanges}
              >
                Update &amp; restart
              </Button>
            )}
          </div>
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
        <PrefabsCard />
        <SubscriptionsCard />
        <UpdatesCard />
        <AuditCard />
      </div>
    </>
  );
}
