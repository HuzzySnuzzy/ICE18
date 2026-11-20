import { POWER_SIGNALS, type ConsoleMessage, type PowerSignal, type ServerPermission } from '@ice18/shared';
import { permissionForSignal } from './access';

export const MAX_COMMAND_LENGTH = 2000;

export type FilterResult =
  | { kind: 'forward'; message: ConsoleMessage; audit?: { action: string; detail: string } }
  | { kind: 'reject'; reason: string }
  | { kind: 'ignore' };

/**
 * Decides which browser messages are passed on to Wings. Only these events are allowed;
 * everything else (including "auth", which the relay handles itself) is dropped.
 */
export function filterClientMessage(raw: string, permissions: readonly ServerPermission[]): FilterResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'ignore' };
  }
  if (!parsed || typeof parsed !== 'object') return { kind: 'ignore' };
  const { event, args } = parsed as { event?: unknown; args?: unknown };
  const firstArg = Array.isArray(args) ? args[0] : undefined;

  switch (event) {
    case 'send logs':
    case 'send stats':
      return { kind: 'forward', message: { event } };

    case 'send command': {
      if (!permissions.includes('control.console')) {
        return { kind: 'reject', reason: "You don't have permission to send console commands." };
      }
      if (typeof firstArg !== 'string') return { kind: 'ignore' };
      // One command per message: strip line breaks so nothing extra gets smuggled in.
      const command = firstArg.replace(/[\r\n]+/g, ' ').trim();
      if (!command) return { kind: 'ignore' };
      if (command.length > MAX_COMMAND_LENGTH) {
        return { kind: 'reject', reason: `Commands can be at most ${MAX_COMMAND_LENGTH} characters.` };
      }
      return {
        kind: 'forward',
        message: { event: 'send command', args: [command] },
        audit: { action: 'server.console.command', detail: command },
      };
    }

    case 'set state': {
      if (typeof firstArg !== 'string' || !(POWER_SIGNALS as readonly string[]).includes(firstArg)) {
        return { kind: 'ignore' };
      }
      const signal = firstArg as PowerSignal;
      if (!permissions.includes(permissionForSignal(signal))) {
        return { kind: 'reject', reason: `You don't have permission to ${signal} this server.` };
      }
      return {
        kind: 'forward',
        message: { event: 'set state', args: [signal] },
        audit: { action: `server.power.${signal}`, detail: 'via console' },
      };
    }

    default:
      return { kind: 'ignore' };
  }
}
