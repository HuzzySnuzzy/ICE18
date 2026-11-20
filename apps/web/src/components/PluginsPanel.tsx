import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import type {
  PluginInfo,
  PluginScan,
  PluginSetupResult,
  ServerDatabase,
  ServerDatabaseCredentials,
  ServerPermission,
  ServerSummary,
} from '@ice18/shared';
import { api, errorMessage } from '../lib/api';
import { formatDate } from '../lib/format';
import { Alert, Badge, Button, Card, Input, Spinner, cx } from './ui';

const NEW = '__new__';

function CopyField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-24 shrink-0 text-xs text-ink-400">{label}</span>
      <code className={cx('min-w-0 flex-1 truncate rounded bg-ink-900 px-2 py-1 font-mono text-xs text-ink-100', secret && 'select-all')}>
        {value || <span className="text-ink-500">(empty)</span>}
      </code>
      <button
        type="button"
        className="text-xs font-medium text-ice-400 hover:text-ice-300"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function Credentials({ credentials }: { credentials: ServerDatabaseCredentials }) {
  return (
    <div className="mt-3 rounded-lg border border-ink-700 bg-ink-900/60 p-3">
      <CopyField label="Host" value={credentials.pluginHost} />
      <CopyField label="Port" value={String(credentials.port)} />
      <CopyField label="Database" value={credentials.name} />
      <CopyField label="Username" value={credentials.username} />
      <CopyField label="Password" value={credentials.password} secret />
      <CopyField label="JDBC URL" value={`jdbc:mysql://${credentials.pluginHost}:${credentials.port}/${credentials.name}`} />
    </div>
  );
}

function DatabasesCard({
  identifier,
  databases,
  can,
  onChanged,
}: {
  identifier: string;
  databases: ServerDatabase[];
  can: (permission: ServerPermission) => boolean;
  onChanged: () => void;
}) {
  const [shown, setShown] = useState<Record<string, ServerDatabaseCredentials>>({});
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reveal(id: string) {
    if (shown[id]) {
      setShown(({ [id]: _removed, ...rest }) => rest);
      return;
    }
    setBusy(id);
    setError(null);
    try {
      const credentials = await api<ServerDatabaseCredentials>(
        `/servers/${encodeURIComponent(identifier)}/databases/${encodeURIComponent(id)}/credentials`,
      );
      setShown((current) => ({ ...current, [id]: credentials }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy('create');
    setError(null);
    try {
      const created = await api<ServerDatabaseCredentials>(`/servers/${encodeURIComponent(identifier)}/databases`, {
        body: { name },
      });
      setShown((current) => ({ ...current, [created.id]: created }));
      setCreating(false);
      setName('');
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card
      title="Databases"
      actions={
        can('database.create') && !creating ? (
          <Button variant="ghost" onClick={() => setCreating(true)}>
            New database
          </Button>
        ) : null
      }
    >
      {error && (
        <div className="mb-3">
          <Alert>{error}</Alert>
        </div>
      )}
      {creating && (
        <form onSubmit={create} className="mb-4 flex flex-wrap items-end gap-2">
          <Input
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. plugins"
            pattern="[A-Za-z0-9_]{1,48}"
            required
            className="w-56"
          />
          <Button type="submit" variant="primary" busy={busy === 'create'}>
            Create
          </Button>
          <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
            Cancel
          </Button>
        </form>
      )}
      {databases.length === 0 ? (
        <p className="text-sm text-ink-400">No databases yet. ICE18 can create one when you set up a plugin.</p>
      ) : (
        <ul className="divide-y divide-ink-700">
          {databases.map((database) => (
            <li key={database.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-sm text-ink-100">{database.name}</div>
                  <div className="text-xs text-ink-400">
                    {database.pluginHost}:{database.port} · {database.username}
                    {database.pluginHost !== database.host && (
                      <span title={`Pterodactyl lists ${database.host}, which inside a server is the container itself.`}>
                        {' '}
                        (Pterodactyl shows {database.host})
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1">
                  {can('database.view_password') && (
                    <Link
                      to={`/databases?db=${encodeURIComponent(`${identifier}/${database.id}`)}`}
                      className="rounded-lg px-3.5 py-2 text-sm font-medium text-ink-300 hover:bg-ink-800 hover:text-ink-100"
                    >
                      Browse
                    </Link>
                  )}
                  {can('database.view_password') && (
                    <Button variant="ghost" onClick={() => void reveal(database.id)} busy={busy === database.id}>
                      {shown[database.id] ? 'Hide details' : 'Connection details'}
                    </Button>
                  )}
                </div>
              </div>
              {shown[database.id] && <Credentials credentials={shown[database.id]!} />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function storageBadge(plugin: PluginInfo) {
  if (plugin.storage === 'mysql') return <Badge tone="green">MySQL</Badge>;
  if (plugin.storage === 'local') return <Badge tone="yellow">Local files</Badge>;
  if (plugin.storage === 'not-generated') return <Badge>Not started yet</Badge>;
  return <Badge tone="red">Config problem</Badge>;
}

function SetupForm({
  identifier,
  plugin,
  databases,
  canCreate,
  canRestart,
  onDone,
  onCancel,
}: {
  identifier: string;
  plugin: PluginInfo;
  databases: ServerDatabase[];
  canCreate: boolean;
  canRestart: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const suggested = (plugin.recipeId ?? plugin.name).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);
  const [choice, setChoice] = useState<string>(canCreate ? NEW : (databases[0]?.id ?? ''));
  const [newName, setNewName] = useState(suggested);
  const selected = databases.find((database) => database.id === choice);
  const [host, setHost] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PluginSetupResult | null>(null);
  const [restarted, setRestarted] = useState<'idle' | 'busy' | 'done'>('idle');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = choice === NEW ? { newDatabaseName: newName, host: host || undefined } : { databaseId: choice, host: host || undefined };
      setResult(
        await api<PluginSetupResult>(
          `/servers/${encodeURIComponent(identifier)}/plugins/${encodeURIComponent(plugin.folder!)}/database`,
          { body },
        ),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function restart() {
    setRestarted('busy');
    try {
      await api(`/servers/${encodeURIComponent(identifier)}/power`, { body: { signal: 'restart' } });
      setRestarted('done');
    } catch (err) {
      setError(errorMessage(err));
      setRestarted('idle');
    }
  }

  if (result) {
    return (
      <div className="mt-3 space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">
        <p>
          <b>{result.plugin}</b> now uses <span className="font-mono">{result.database.name}</span> on{' '}
          <span className="font-mono">
            {result.database.pluginHost}:{result.database.port}
          </span>
          . The old config was saved as <span className="font-mono break-all">{result.backupFile}</span>.
        </p>
        <p>Restart the server so the plugin picks up the change.</p>
        {error && <Alert>{error}</Alert>}
        <div className="flex flex-wrap gap-2">
          {canRestart && (
            <Button variant="primary" onClick={() => void restart()} busy={restarted === 'busy'} disabled={restarted === 'done'}>
              {restarted === 'done' ? 'Restarting…' : 'Restart server now'}
            </Button>
          )}
          <Button variant="ghost" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-4 rounded-lg border border-ink-700 bg-ink-900/60 p-4">
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-ink-200">Database</span>
          <select
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
            className="w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-ink-100 focus:border-ice-500 focus:outline-none"
          >
            {canCreate && <option value={NEW}>Create a new database</option>}
            {databases.map((database) => (
              <option key={database.id} value={database.id}>
                Use {database.name}
              </option>
            ))}
          </select>
          <span className="block text-xs text-ink-400">Plugins use their own table prefixes, so several can share one database.</span>
        </label>
        {choice === NEW ? (
          <Input
            label="New database name"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            pattern="[A-Za-z0-9_]{1,48}"
            required
            hint="Pterodactyl adds the server prefix, e.g. s12_"
          />
        ) : (
          <div />
        )}
      </div>
      <Input
        label="Host plugins connect to (optional)"
        value={host}
        onChange={(event) => setHost(event.target.value)}
        placeholder={selected?.pluginHost ?? 'Use the database host'}
        hint="Leave empty to use the database's address. ICE18 already swaps 127.0.0.1 for the Docker gateway."
      />
      <p className="text-xs text-ink-400">
        ICE18 saves a backup of <span className="font-mono">{plugin.configFile}</span> before changing it, and only changes the
        database settings.
      </p>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" busy={busy} disabled={!choice}>
          Connect {plugin.name} to MySQL
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function PluginRow({ plugin, children, action }: { plugin: PluginInfo; children?: ReactNode; action?: ReactNode }) {
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink-100">{plugin.name}</span>
            {plugin.support === 'supported' && storageBadge(plugin)}
            {plugin.database && <Badge tone="ice">{plugin.database}</Badge>}
          </div>
          <div className="mt-0.5 text-xs text-ink-400">{plugin.summary}</div>
        </div>
        {action}
      </div>
      {children}
    </li>
  );
}

export function PluginsPanel({ server }: { server: ServerSummary }) {
  const identifier = server.identifier;
  const can = (permission: ServerPermission) => server.permissions.includes(permission);
  const [scan, setScan] = useState<PluginScan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(
    async (refresh: boolean) => {
      setLoading(true);
      setError(null);
      try {
        setScan(await api<PluginScan>(`/servers/${encodeURIComponent(identifier)}/plugins${refresh ? '?refresh=1' : ''}`));
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [identifier],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  if (!can('file.read')) {
    return <Alert tone="yellow">You need file access on this server to see its plugins.</Alert>;
  }
  if (!scan) {
    return error ? (
      <Alert>{error}</Alert>
    ) : (
      <div className="flex items-center gap-3 text-sm text-ink-400">
        <Spinner className="size-4" /> Scanning plugins…
      </div>
    );
  }

  const supported = scan.plugins.filter((plugin) => plugin.support === 'supported');
  const possible = scan.plugins.filter((plugin) => plugin.support === 'possible');
  const other = scan.plugins.filter((plugin) => plugin.support === 'none');
  const canSetup = can('file.update') && can('database.read') && can('database.view_password');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-400">
          {scan.hasPluginsFolder
            ? `${scan.plugins.length} plugins found · scanned ${formatDate(scan.scannedAt)}`
            : 'No plugins folder on this server.'}
        </p>
        <Button variant="ghost" onClick={() => void load(true)} busy={loading}>
          Rescan
        </Button>
      </div>
      {error && <Alert>{error}</Alert>}

      {!scan.hasPluginsFolder && (
        <Alert tone="ice">
          Plugin database setup works on Paper, Spigot and Bukkit servers. This server has no <span className="font-mono">plugins</span>{' '}
          folder; if it should, start it once so it creates one.
        </Alert>
      )}

      {scan.hasPluginsFolder && (
        <Card title="Plugins that can use MySQL">
          {supported.length === 0 ? (
            <p className="text-sm text-ink-400">
              None of the plugins ICE18 can set up automatically are installed (LuckPerms, CoreProtect, LiteBans, Plan, mcMMO,
              QuickShop).
            </p>
          ) : (
            <ul className="divide-y divide-ink-700">
              {supported.map((plugin) => (
                <PluginRow
                  key={plugin.name}
                  plugin={plugin}
                  action={
                    canSetup && plugin.folder && plugin.storage !== 'not-generated' && open !== plugin.name ? (
                      <Button variant={plugin.storage === 'mysql' ? 'ghost' : 'primary'} onClick={() => setOpen(plugin.name)}>
                        {plugin.storage === 'mysql' ? 'Change database' : 'Set up MySQL'}
                      </Button>
                    ) : null
                  }
                >
                  {open === plugin.name && (
                    <SetupForm
                      identifier={identifier}
                      plugin={plugin}
                      databases={scan.databases}
                      canCreate={can('database.create')}
                      canRestart={can('control.restart')}
                      onCancel={() => setOpen(null)}
                      onDone={() => {
                        setOpen(null);
                        void load(true);
                      }}
                    />
                  )}
                </PluginRow>
              ))}
            </ul>
          )}
          {!canSetup && supported.length > 0 && (
            <p className="mt-4 text-xs text-ink-400">You need file editing and database permissions on this server to set these up.</p>
          )}
        </Card>
      )}

      {possible.length > 0 && (
        <Card title="Plugins that might use MySQL">
          <p className="mb-4 text-sm text-ink-400">
            These have database settings, but ICE18 doesn't know their exact layout. Create a database below, open{' '}
            <b>Connection details</b>, and copy them into the plugin's config yourself.
          </p>
          <ul className="divide-y divide-ink-700">
            {possible.map((plugin) => (
              <PluginRow key={plugin.name} plugin={plugin} />
            ))}
          </ul>
        </Card>
      )}

      {can('database.read') && (
        <DatabasesCard identifier={identifier} databases={scan.databases} can={can} onChanged={() => void load(true)} />
      )}

      {other.length > 0 && (
        <details className="rounded-xl border border-ink-700 bg-ink-850 px-5 py-3.5">
          <summary className="cursor-pointer text-sm font-semibold text-ink-100">Other plugins ({other.length})</summary>
          <ul className="mt-3 grid gap-x-6 gap-y-1 text-sm text-ink-300 sm:grid-cols-2 lg:grid-cols-3">
            {other.map((plugin) => (
              <li key={plugin.name} className="truncate" title={plugin.summary}>
                {plugin.name}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
