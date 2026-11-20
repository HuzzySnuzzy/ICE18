import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import type { PublicUser } from '@ice18/shared';
import { Alert, Button, Input, Logo } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';

export function LoginPage() {
  const { user, meta, setUser, refresh } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/servers" replace />;

  const setup = meta?.needsSetup ?? false;
  const registering = setup || mode === 'register';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const result = registering
        ? await api<PublicUser>('/auth/register', {
            body: { email: form.get('email'), username: form.get('username'), password: form.get('password') },
          })
        : await api<PublicUser>('/auth/login', { body: { login: form.get('login'), password: form.get('password') } });
      setUser(result);
      void refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="size-12" />
          <h1 className="mt-4 text-xl font-semibold text-ink-100">
            {setup ? 'Set up ICE18' : registering ? 'Create an account' : 'Log in to ICE18'}
          </h1>
          {setup && (
            <p className="mt-2 text-sm text-ink-400">
              No accounts exist yet. The account you create now becomes the panel admin.
            </p>
          )}
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-xl border border-ink-700 bg-ink-850 p-6">
          {error && <Alert>{error}</Alert>}
          {registering ? (
            <>
              <Input label="Email" name="email" type="email" autoComplete="email" required />
              <Input
                label="Username"
                name="username"
                autoComplete="username"
                required
                minLength={3}
                maxLength={32}
                pattern="[A-Za-z0-9_.\-]{3,32}"
                hint="3–32 characters: letters, numbers, _ . -"
              />
              <Input label="Password" name="password" type="password" autoComplete="new-password" required minLength={10} hint="At least 10 characters." />
            </>
          ) : (
            <>
              <Input label="Email or username" name="login" autoComplete="username" required />
              <Input label="Password" name="password" type="password" autoComplete="current-password" required />
            </>
          )}
          <Button type="submit" variant="primary" className="w-full" busy={busy}>
            {setup ? 'Create admin account' : registering ? 'Create account' : 'Log in'}
          </Button>
        </form>

        {!setup && meta?.registrationOpen && (
          <p className="mt-4 text-center text-sm text-ink-400">
            {registering ? 'Already have an account?' : 'New here?'}{' '}
            <button
              type="button"
              className="font-medium text-ice-400 hover:text-ice-300"
              onClick={() => {
                setMode(registering ? 'login' : 'register');
                setError(null);
              }}
            >
              {registering ? 'Log in' : 'Create an account'}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
