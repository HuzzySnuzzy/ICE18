import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { ServerSummary } from '@ice18/shared';
import { Alert, Badge, Input, PageHeader, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatLimitMiB } from '../lib/format';

function statusBadge(server: ServerSummary) {
  if (server.suspended) return <Badge tone="red">Suspended</Badge>;
  if (server.status === 'installing') return <Badge tone="yellow">Installing</Badge>;
  if (server.status === 'install_failed') return <Badge tone="red">Install failed</Badge>;
  if (server.status === 'restoring_backup') return <Badge tone="yellow">Restoring backup</Badge>;
  return null;
}

function ServerCard({ server }: { server: ServerSummary }) {
  return (
    <Link
      to={`/servers/${server.identifier}`}
      className="group flex flex-col rounded-xl border border-ink-700 bg-ink-850 p-5 transition-colors hover:border-ice-500/50 hover:bg-ink-800"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-ink-100 group-hover:text-ice-200">{server.name}</h3>
          <p className="mt-0.5 truncate text-xs text-ink-400">
            {[server.egg, server.node].filter(Boolean).join(' · ') || server.identifier}
          </p>
        </div>
        <Badge tone="ice">Pterodactyl</Badge>
      </div>
      {server.description && <p className="mt-3 line-clamp-2 text-sm text-ink-300">{server.description}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-4 text-xs text-ink-400">
        <span>{formatLimitMiB(server.limits.memory)} RAM</span>
        <span>{formatLimitMiB(server.limits.disk)} disk</span>
        <span>{server.limits.cpu === 0 ? 'Unlimited' : `${server.limits.cpu}%`} CPU</span>
        <span className="ml-auto">{statusBadge(server)}</span>
      </div>
    </Link>
  );
}

export function ServersPage() {
  const { user, meta } = useAuth();
  const [servers, setServers] = useState<ServerSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    api<ServerSummary[]>('/servers')
      .then(setServers)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!servers || !needle) return servers;
    return servers.filter((server) =>
      [server.name, server.description, server.identifier, server.egg, server.node].some((field) =>
        field?.toLowerCase().includes(needle),
      ),
    );
  }, [servers, query]);

  const notLinked = user && !user.isAdmin && user.pteroUserId === null;

  return (
    <>
      <PageHeader
        title="Servers"
        subtitle={user?.isAdmin ? 'Every server on your Pterodactyl panel.' : 'Servers you own or have access to.'}
        actions={
          servers && servers.length > 0 ? (
            <Input placeholder="Search servers…" value={query} onChange={(event) => setQuery(event.target.value)} className="w-64" />
          ) : null
        }
      />

      {error && <Alert>{error}</Alert>}

      {!error && servers === null && (
        <div className="flex items-center gap-3 text-sm text-ink-400">
          <Spinner className="size-4" /> Loading servers…
        </div>
      )}

      {servers && servers.length === 0 && (
        <div className="rounded-xl border border-dashed border-ink-600 px-6 py-14 text-center">
          {notLinked ? (
            <>
              <h2 className="font-semibold text-ink-100">Link your Pterodactyl account</h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-ink-400">
                Your servers live on Pterodactyl. Link your account once and they'll show up here.
              </p>
              <Link
                to="/account"
                className="mt-5 inline-flex rounded-lg bg-ice-400 px-3.5 py-2 text-sm font-medium text-ink-950 hover:bg-ice-300"
              >
                Link account
              </Link>
            </>
          ) : meta && !meta.pterodactylConfigured ? (
            <p className="text-sm text-ink-400">Pterodactyl isn't connected yet, so there are no servers to show.</p>
          ) : (
            <p className="text-sm text-ink-400">No servers yet.</p>
          )}
        </div>
      )}

      {filtered && filtered.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((server) => (
            <ServerCard key={server.uuid} server={server} />
          ))}
        </div>
      )}
      {servers && servers.length > 0 && filtered?.length === 0 && (
        <p className="text-sm text-ink-400">No servers match “{query}”.</p>
      )}
    </>
  );
}
