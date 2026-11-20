import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import type { PowerSignal, ServerPermission, ServerResources, ServerSummary } from '@ice18/shared';
import { PluginsPanel } from '../components/PluginsPanel';
import { Terminal, type TerminalHandle } from '../components/Terminal';
import { Alert, Badge, Button, Spinner, StateBadge, cx } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { formatBytes, formatLimitMiB, formatUptime } from '../lib/format';
import { useConsole } from '../lib/useConsole';

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-850 px-4 py-3">
      <div className="text-xs font-medium tracking-wide text-ink-400 uppercase">{label}</div>
      <div className="mt-1 text-lg font-semibold text-ink-100 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-ink-400 tabular-nums">{sub}</div>}
    </div>
  );
}

export function ServerPage() {
  const { identifier = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'plugins' ? 'plugins' : 'console';
  const [server, setServer] = useState<ServerSummary | null>(null);
  const [initial, setInitial] = useState<ServerResources | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<PowerSignal | null>(null);
  const [command, setCommand] = useState('');
  const history = useRef<string[]>([]);
  const historyIndex = useRef(-1);
  const terminal = useRef<TerminalHandle>(null);

  const live = useConsole(identifier, (text) => terminal.current?.write(text));

  useEffect(() => {
    setServer(null);
    setLoadError(null);
    api<ServerSummary>(`/servers/${encodeURIComponent(identifier)}`)
      .then(setServer)
      .catch((error) => setLoadError(errorMessage(error)));
    api<ServerResources>(`/servers/${encodeURIComponent(identifier)}/resources`)
      .then(setInitial)
      .catch(() => undefined);
  }, [identifier]);

  if (loadError) {
    return (
      <div className="space-y-4">
        <Link to="/servers" className="text-sm text-ice-400 hover:text-ice-300">
          ← All servers
        </Link>
        <Alert>{loadError}</Alert>
      </div>
    );
  }
  if (!server) {
    return (
      <div className="flex items-center gap-3 text-sm text-ink-400">
        <Spinner className="size-4" /> Loading server…
      </div>
    );
  }

  const can = (permission: ServerPermission) => server.permissions.includes(permission);
  const state = live.serverState || live.stats?.state || initial?.state || null;
  const stats = live.stats;
  const memory = stats?.memoryBytes ?? initial?.memoryBytes ?? 0;
  const memoryLimit = stats?.memoryLimitBytes || server.limits.memory * 1024 * 1024;
  const cpu = stats?.cpuPercent ?? initial?.cpuPercent ?? 0;
  const disk = stats?.diskBytes ?? initial?.diskBytes ?? 0;
  const rx = stats?.networkRxBytes ?? initial?.networkRxBytes ?? 0;
  const tx = stats?.networkTxBytes ?? initial?.networkTxBytes ?? 0;
  const uptime = stats?.uptimeMs ?? initial?.uptimeMs ?? 0;
  const offline = !state || state === 'offline';

  async function power(signal: PowerSignal) {
    if (signal === 'kill' && !window.confirm('Kill the server process immediately? Unsaved data may be lost.')) return;
    setPending(signal);
    setActionError(null);
    try {
      await api(`/servers/${encodeURIComponent(identifier)}/power`, { body: { signal } });
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setPending(null);
    }
  }

  function submitCommand(event: FormEvent) {
    event.preventDefault();
    const value = command.trim();
    if (!value) return;
    if (live.sendCommand(value)) {
      history.current = [value, ...history.current.filter((entry) => entry !== value)].slice(0, 50);
      historyIndex.current = -1;
      setCommand('');
    }
  }

  function browseHistory(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const next = historyIndex.current + (event.key === 'ArrowUp' ? 1 : -1);
    if (next < -1 || next >= history.current.length) return;
    historyIndex.current = next;
    setCommand(next === -1 ? '' : (history.current[next] ?? ''));
  }

  return (
    <>
      <Link to="/servers" className="text-sm text-ice-400 hover:text-ice-300">
        ← All servers
      </Link>

      <div className="mt-3 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-ink-100">{server.name}</h1>
            <StateBadge state={state} />
            {server.suspended && <Badge tone="red">Suspended</Badge>}
          </div>
          <p className="mt-1 text-sm text-ink-400">
            {[server.egg, server.node, server.identifier].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() => void power('start')}
            busy={pending === 'start'}
            disabled={!can('control.start') || !offline || server.suspended}
          >
            Start
          </Button>
          <Button onClick={() => void power('restart')} busy={pending === 'restart'} disabled={!can('control.restart') || server.suspended}>
            Restart
          </Button>
          <Button onClick={() => void power('stop')} busy={pending === 'stop'} disabled={!can('control.stop') || offline}>
            Stop
          </Button>
          <Button variant="danger" onClick={() => void power('kill')} busy={pending === 'kill'} disabled={!can('control.stop') || offline}>
            Kill
          </Button>
        </div>
      </div>

      {actionError && (
        <div className="mb-4">
          <Alert>{actionError}</Alert>
        </div>
      )}

      <div className="mb-5 flex gap-1 border-b border-ink-700" role="tablist">
        {(
          [
            ['console', 'Console'],
            ['plugins', 'Plugins & databases'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setSearchParams(key === 'console' ? {} : { tab: key }, { replace: true })}
            className={cx(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === key ? 'border-ice-400 text-ink-100' : 'border-transparent text-ink-400 hover:text-ink-200',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Hidden, not unmounted, so the console stays connected while on another tab. */}
      <div hidden={tab !== 'console'}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
          <section className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-950">
            <div className="flex items-center justify-between border-b border-ink-800 px-4 py-2.5 text-xs">
              <span className="font-medium text-ink-300">Console</span>
              <span
                className={cx(
                  'flex items-center gap-1.5',
                  live.status === 'connected' ? 'text-emerald-300' : live.status === 'closed' ? 'text-red-300' : 'text-amber-300',
                )}
              >
                <span className="size-1.5 rounded-full bg-current" />
                {live.status === 'connected' ? 'Live' : live.status === 'closed' ? 'Disconnected' : 'Connecting…'}
              </span>
            </div>
            {live.error && (
              <div className="border-b border-ink-800 px-4 py-2 text-sm text-red-300">{live.error}</div>
            )}
            <div className="h-[460px] min-h-0">
              <Terminal ref={terminal} />
            </div>
            <form onSubmit={submitCommand} className="flex border-t border-ink-800">
              <span className="flex items-center pl-4 font-mono text-sm text-ice-400">›</span>
              <input
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                onKeyDown={browseHistory}
                disabled={!can('control.console') || live.status !== 'connected'}
                placeholder={
                  !can('control.console')
                    ? "You don't have permission to send commands"
                    : live.status === 'connected'
                      ? 'Type a command and press Enter'
                      : 'Waiting for the console…'
                }
                maxLength={2000}
                className="min-w-0 flex-1 bg-transparent px-3 py-3 font-mono text-sm text-ink-100 placeholder:text-ink-500 focus:outline-none disabled:cursor-not-allowed"
                aria-label="Console command"
              />
            </form>
          </section>

          <div className="grid grid-cols-2 gap-3 self-start sm:grid-cols-3 lg:grid-cols-1">
            <Stat label="CPU" value={`${cpu.toFixed(1)}%`} sub={server.limits.cpu ? `of ${server.limits.cpu}%` : 'no limit'} />
            <Stat label="Memory" value={formatBytes(memory)} sub={memoryLimit ? `of ${formatBytes(memoryLimit)}` : 'no limit'} />
            <Stat label="Disk" value={formatBytes(disk)} sub={`of ${formatLimitMiB(server.limits.disk)}`} />
            <Stat label="Network" value={`↓ ${formatBytes(rx)}`} sub={`↑ ${formatBytes(tx)}`} />
            <Stat label="Uptime" value={offline ? '—' : formatUptime(uptime)} />
          </div>
        </div>
      </div>
      {tab === 'plugins' && <PluginsPanel server={server} />}
    </>
  );
}
