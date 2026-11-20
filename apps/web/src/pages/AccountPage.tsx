import { useState, type FormEvent } from 'react';
import type { PublicUser } from '@ice18/shared';
import { Alert, Badge, Button, Card, Input, PageHeader } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';

function PterodactylLink() {
  const { user, setUser } = useAuth();
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (!user) return null;

  async function link(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      setUser(await api<PublicUser>('/account/link-pterodactyl', { body: { apiKey } }));
      setApiKey('');
      setDone('Linked. Your Pterodactyl servers now show up under Servers.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    if (!window.confirm('Unlink your Pterodactyl account? Your servers will disappear from ICE18 until you link again. Nothing on Pterodactyl changes.')) return;
    setBusy(true);
    setError(null);
    try {
      setUser(await api<PublicUser>('/account/unlink-pterodactyl', { method: 'POST' }));
      setDone(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Pterodactyl account"
      actions={user.pteroUserId !== null ? <Badge tone="green">Linked</Badge> : <Badge>Not linked</Badge>}
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        {done && <Alert tone="ice">{done}</Alert>}
        {user.pteroUserId !== null ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-300">
              Linked to Pterodactyl user <span className="font-mono text-ink-100">#{user.pteroUserId}</span>. You see the
              servers you own or are a subuser on.
            </p>
            <Button variant="ghost" onClick={() => void unlink()} busy={busy}>
              Unlink
            </Button>
          </div>
        ) : (
          <form onSubmit={link} className="space-y-4">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-300">
              <li>On your Pterodactyl panel, open <b>Account → API Credentials</b>.</li>
              <li>Create a key (any description, e.g. “ICE18 link”).</li>
              <li>Paste it below. ICE18 uses it once to confirm which account is yours, then forgets it. You can delete the key afterwards.</li>
            </ol>
            <Input
              label="Client API key"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="ptlc_…"
              autoComplete="off"
              spellCheck={false}
              required
              className="font-mono"
            />
            <Button type="submit" variant="primary" busy={busy}>
              Link account
            </Button>
          </form>
        )}
      </div>
    </Card>
  );
}

function ChangePassword() {
  const { setUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      setUser(
        await api<PublicUser>('/auth/change-password', {
          body: { currentPassword: form.get('currentPassword'), newPassword: form.get('newPassword') },
        }),
      );
      formElement.reset();
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Password">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        {done && <Alert tone="ice">Password changed. Other devices have been signed out.</Alert>}
        <Input label="Current password" name="currentPassword" type="password" autoComplete="current-password" required />
        <Input label="New password" name="newPassword" type="password" autoComplete="new-password" minLength={10} required hint="At least 10 characters." />
        <Button type="submit" busy={busy}>
          Change password
        </Button>
      </form>
    </Card>
  );
}

export function AccountPage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <>
      <PageHeader title="Account" />
      <div className="grid max-w-3xl gap-5">
        <Card title="Profile">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[140px_1fr]">
            <dt className="text-ink-400">Username</dt>
            <dd className="text-ink-100">{user.username}</dd>
            <dt className="text-ink-400">Email</dt>
            <dd className="text-ink-100">{user.email}</dd>
            <dt className="text-ink-400">Role</dt>
            <dd>{user.isAdmin ? <Badge tone="ice">Admin</Badge> : <Badge>User</Badge>}</dd>
          </dl>
        </Card>
        <PterodactylLink />
        <ChangePassword />
      </div>
    </>
  );
}
