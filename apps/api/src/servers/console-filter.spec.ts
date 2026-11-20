import { describe, expect, it } from 'vitest';
import { SERVER_PERMISSIONS } from '@ice18/shared';
import { filterClientMessage } from './console-filter';

const all = [...SERVER_PERMISSIONS];
const viewOnly = ['websocket.connect'] as const;

const send = (message: unknown, permissions: readonly (typeof all)[number][] = all) =>
  filterClientMessage(JSON.stringify(message), permissions);

describe('filterClientMessage', () => {
  it('passes log and stats requests through', () => {
    expect(send({ event: 'send logs' }, viewOnly)).toEqual({ kind: 'forward', message: { event: 'send logs' } });
    expect(send({ event: 'send stats' }, viewOnly)).toEqual({ kind: 'forward', message: { event: 'send stats' } });
  });

  it('never forwards auth or unknown events from the browser', () => {
    expect(send({ event: 'auth', args: ['stolen-token'] })).toEqual({ kind: 'ignore' });
    expect(send({ event: 'something else' })).toEqual({ kind: 'ignore' });
    expect(filterClientMessage('not json', all)).toEqual({ kind: 'ignore' });
  });

  it('checks console permission for commands and strips line breaks', () => {
    expect(send({ event: 'send command', args: ['say hi'] }, viewOnly).kind).toBe('reject');
    expect(send({ event: 'send command', args: ['say hi\nop someone'] })).toMatchObject({
      kind: 'forward',
      message: { event: 'send command', args: ['say hi op someone'] },
    });
    expect(send({ event: 'send command', args: ['x'.repeat(5000)] }).kind).toBe('reject');
  });

  it('checks power permissions and only allows known signals', () => {
    expect(send({ event: 'set state', args: ['start'] }, viewOnly).kind).toBe('reject');
    expect(send({ event: 'set state', args: ['kill'] }, ['websocket.connect', 'control.stop'])).toMatchObject({
      kind: 'forward',
      message: { event: 'set state', args: ['kill'] },
    });
    expect(send({ event: 'set state', args: ['reinstall'] })).toEqual({ kind: 'ignore' });
  });
});
