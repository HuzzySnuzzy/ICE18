import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConsoleMessage } from '@ice18/shared';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed';

export interface LiveStats {
  state: string;
  memoryBytes: number;
  memoryLimitBytes: number;
  cpuPercent: number;
  diskBytes: number;
  networkRxBytes: number;
  networkTxBytes: number;
  uptimeMs: number;
}

const ANSI = {
  reset: '\u001b[0m',
  cyan: '\u001b[36m',
  yellow: '\u001b[33m',
  red: '\u001b[31m',
  dim: '\u001b[2m',
};

const RETRY_DELAYS = [1000, 2000, 5000, 10000];

/**
 * Connects to ICE18's console relay for one server and turns Wings events into
 * terminal output, live stats and the server state.
 */
export function useConsole(identifier: string, write: (text: string) => void) {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [serverState, setServerState] = useState<string | null>(null);
  const [stats, setStats] = useState<LiveStats | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const writeRef = useRef(write);
  writeRef.current = write;

  useEffect(() => {
    let disposed = false;
    let attempt = 0;
    let retryTimer: number | undefined;
    const line = (text: string) => writeRef.current(`${text}\r\n`);

    const connect = () => {
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = new WebSocket(`${scheme}://${window.location.host}/api/servers/${encodeURIComponent(identifier)}/console`);
      socketRef.current = socket;

      socket.onmessage = (event) => {
        let message: ConsoleMessage;
        try {
          message = JSON.parse(String(event.data)) as ConsoleMessage;
        } catch {
          return;
        }
        const [first, second] = message.args ?? [];
        switch (message.event) {
          case 'auth success':
            attempt = 0;
            setStatus('connected');
            setError(null);
            socket.send(JSON.stringify({ event: 'send logs' }));
            break;
          case 'console output':
          case 'install output':
            if (typeof first === 'string') line(first);
            break;
          case 'status':
            if (typeof first === 'string') {
              setServerState(first);
              line(`${ANSI.cyan}[ICE18]${ANSI.reset} Server marked as ${first}.`);
            }
            break;
          case 'stats':
            if (typeof first === 'string') {
              try {
                const raw = JSON.parse(first) as Record<string, unknown> & { network?: Record<string, number> };
                setServerState(String(raw.state ?? ''));
                setStats({
                  state: String(raw.state ?? ''),
                  memoryBytes: Number(raw.memory_bytes ?? 0),
                  memoryLimitBytes: Number(raw.memory_limit_bytes ?? 0),
                  cpuPercent: Number(raw.cpu_absolute ?? 0),
                  diskBytes: Number(raw.disk_bytes ?? 0),
                  networkRxBytes: Number(raw.network?.rx_bytes ?? 0),
                  networkTxBytes: Number(raw.network?.tx_bytes ?? 0),
                  uptimeMs: Number(raw.uptime ?? 0),
                });
              } catch {
                /* ignore malformed stats */
              }
            }
            break;
          case 'daemon message':
            if (typeof first === 'string') line(`${ANSI.yellow}[Daemon]${ANSI.reset} ${first}`);
            break;
          case 'daemon error':
          case 'jwt error':
            if (typeof first === 'string') line(`${ANSI.red}[Daemon error]${ANSI.reset} ${first}`);
            break;
          case 'install started':
            line(`${ANSI.yellow}[ICE18]${ANSI.reset} Installation started.`);
            break;
          case 'install completed':
            line(`${ANSI.yellow}[ICE18]${ANSI.reset} Installation completed.`);
            break;
          case 'ice18 notice': {
            const color = first === 'error' ? ANSI.red : first === 'warning' ? ANSI.yellow : ANSI.cyan;
            if (typeof second === 'string') line(`${color}[ICE18]${ANSI.reset} ${second}`);
            break;
          }
        }
      };

      socket.onclose = (event) => {
        if (socketRef.current === socket) socketRef.current = null;
        if (disposed) return;
        // 44xx: permanent (not logged in, no access, not found). Don't retry.
        if (event.code >= 4400 && event.code < 4500) {
          setStatus('closed');
          setError(event.reason || 'The console is not available.');
          return;
        }
        setStatus('reconnecting');
        const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]!;
        attempt += 1;
        retryTimer = window.setTimeout(connect, delay);
      };
    };

    setStatus('connecting');
    setError(null);
    connect();

    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      socketRef.current?.close(1000);
      socketRef.current = null;
    };
  }, [identifier]);

  const sendCommand = useCallback((command: string) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ event: 'send command', args: [command] }));
    return true;
  }, []);

  return { status, error, serverState, stats, sendCommand, ansi: ANSI };
}
