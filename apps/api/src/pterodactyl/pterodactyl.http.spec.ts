import { describe, expect, it, vi } from 'vitest';
import { PterodactylHttp } from './pterodactyl.http';
import { BlockedPterodactylRequestError } from './safety';

function fakeFetch(body: unknown = { object: 'list', data: [] }, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch & {
    mock: { calls: Array<[URL, RequestInit]> };
  };
}

describe('PterodactylHttp', () => {
  it('never sends a blocked request over the network', async () => {
    const fetchImpl = fakeFetch();
    const http = new PterodactylHttp('https://panel.example.com', 'ptla_test', fetchImpl);

    await expect(http.request('DELETE', '/api/application/servers/1')).rejects.toBeInstanceOf(
      BlockedPterodactylRequestError,
    );
    await expect(http.request('POST', '/api/client/servers/abcd1234/settings/reinstall')).rejects.toBeInstanceOf(
      BlockedPterodactylRequestError,
    );
    await expect(http.request('POST', '/api/client/servers/abcd1234/files/delete')).rejects.toBeInstanceOf(
      BlockedPterodactylRequestError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends allowed requests with the API key and query string', async () => {
    const fetchImpl = fakeFetch();
    const http = new PterodactylHttp('https://panel.example.com/', 'ptla_test', fetchImpl);

    await http.request('GET', '/api/application/servers', { query: { per_page: 100, page: 2, skip: undefined } });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url.toString()).toBe('https://panel.example.com/api/application/servers?per_page=100&page=2');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ptla_test');
    expect(init.redirect).toBe('error');
  });

  it('keeps a sub-path in the panel URL', async () => {
    const fetchImpl = fakeFetch({ object: 'user', attributes: {} });
    const http = new PterodactylHttp('https://example.com/panel', 'ptlc_test', fetchImpl);

    await http.request('GET', '/api/client/account');

    expect(fetchImpl.mock.calls[0]![0].toString()).toBe('https://example.com/panel/api/client/account');
  });

  it('turns Pterodactyl error responses into readable errors', async () => {
    const fetchImpl = fakeFetch({ errors: [{ detail: 'This action is unauthorized.' }] }, 403);
    const http = new PterodactylHttp('https://panel.example.com', 'bad', fetchImpl);

    await expect(http.request('GET', '/api/client/account')).rejects.toMatchObject({
      status: 403,
      message: 'Pterodactyl responded 403: This action is unauthorized.',
    });
  });

  it('checks the target file of a write before sending it', async () => {
    const fetchImpl = fakeFetch();
    const http = new PterodactylHttp('https://panel.example.com', 'ptlc_test', fetchImpl);

    await expect(
      http.request('POST', '/api/client/servers/abcd1234/files/write', { query: { file: '/server.properties' }, textBody: 'x' }),
    ).rejects.toBeInstanceOf(BlockedPterodactylRequestError);
    expect(fetchImpl).not.toHaveBeenCalled();

    await http.request('POST', '/api/client/servers/abcd1234/files/write', {
      query: { file: '/plugins/LuckPerms/config.yml' },
      textBody: 'storage-method: mysql\n',
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url.toString()).toBe(
      'https://panel.example.com/api/client/servers/abcd1234/files/write?file=%2Fplugins%2FLuckPerms%2Fconfig.yml',
    );
    expect(init.body).toBe('storage-method: mysql\n');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('text/plain');
  });

  it('returns file contents as text', async () => {
    const fetchImpl = vi.fn(async () => new Response('a: 1\n', { status: 200 })) as unknown as typeof fetch;
    const http = new PterodactylHttp('https://panel.example.com', 'ptlc_test', fetchImpl);
    await expect(
      http.request('GET', '/api/client/servers/abcd1234/files/contents', {
        query: { file: '/plugins/X/config.yml' },
        responseType: 'text',
      }),
    ).resolves.toBe('a: 1\n');
  });

  it('waits and retries when Pterodactyl rate-limits', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return calls < 3
        ? new Response('{"errors":[{"detail":"Too Many Attempts."}]}', { status: 429, headers: { 'Retry-After': '0' } })
        : new Response('{"object":"list","data":[]}', { status: 200 });
    }) as unknown as typeof fetch;
    const http = new PterodactylHttp('https://panel.example.com', 'ptlc_test', fetchImpl);
    await expect(http.request('GET', '/api/client')).resolves.toEqual({ object: 'list', data: [] });
    expect(calls).toBe(3);
  });

  it('gives up after a few rate-limited attempts', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('{"errors":[{"detail":"Too Many Attempts."}]}', { status: 429, headers: { 'Retry-After': '0' } }),
    ) as unknown as typeof fetch;
    const http = new PterodactylHttp('https://panel.example.com', 'ptlc_test', fetchImpl);
    await expect(http.request('GET', '/api/client')).rejects.toMatchObject({ status: 429 });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });
});
