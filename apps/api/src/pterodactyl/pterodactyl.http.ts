import { assertPterodactylRequestAllowed, type HttpMethod } from './safety';

export class PterodactylError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** e.g. "GET /api/client/servers/abcd1234/files/list", for logs. */
    readonly request?: string,
  ) {
    super(message);
    this.name = 'PterodactylError';
  }

  /** Pterodactyl's "error while communicating with the machine running this server": Wings failed. */
  get fromWings(): boolean {
    return /machine running this server/i.test(this.message);
  }
}

const MAX_RATE_LIMIT_RETRIES = 4;

export interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  /** Sent as JSON. */
  body?: unknown;
  /** Sent as plain text (file contents). */
  textBody?: string;
  /** Return the response body as text instead of parsing JSON (file contents). */
  responseType?: 'json' | 'text';
}

/**
 * The ONLY way ICE18 talks to Pterodactyl's HTTP API. Every request is checked
 * against the safety rules in ./safety.ts before it is sent.
 */
export class PterodactylHttp {
  private readonly origin: string;
  /** Sub-path the panel is served under, without a trailing slash ("" for most panels). */
  private readonly basePath: string;

  constructor(
    baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const parsed = new URL(baseUrl);
    this.origin = parsed.origin;
    this.basePath = parsed.pathname.replace(/\/+$/, '');
  }

  async request<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
    assertPterodactylRequestAllowed(method, path, options.query);

    const expectedPath = `${this.basePath}${path}`;
    const url = new URL(expectedPath, this.origin);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    // Defence in depth: the URL must not have been normalised into a different path.
    if (url.pathname !== expectedPath || url.origin !== this.origin) {
      throw new PterodactylError(`Refusing to send request to unexpected URL ${url.toString()}`, 0);
    }

    let response: Response | undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        response = await this.fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'application/json',
            ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...(options.textBody !== undefined ? { 'Content-Type': 'text/plain' } : {}),
          },
          body: options.textBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
          redirect: 'error',
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new PterodactylError(
          `Could not reach Pterodactyl at ${this.origin} (${reason}). Check PTERODACTYL_URL, including http vs https.`,
          0,
        );
      }
      // Rate limited (e.g. while scanning many plugin folders): wait as told and try again.
      // A 429 means Pterodactyl did nothing, so retrying is safe for every method.
      if (response.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) break;
      const retryAfter = Number(response.headers.get('retry-after'));
      const seconds = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : 2 ** attempt;
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, Math.min(seconds, 30) * 1000));
    }
    if (!response) throw new PterodactylError('No response from Pterodactyl.', 0);

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    if (response.ok && options.responseType === 'text') return text as T;
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : undefined;
    } catch {
      payload = undefined;
    }

    if (!response.ok) {
      const detail =
        (payload as { errors?: Array<{ detail?: string }> } | undefined)?.errors?.[0]?.detail ?? response.statusText;
      throw new PterodactylError(`Pterodactyl responded ${response.status}: ${detail}`, response.status, `${method} ${path}`);
    }
    if (payload === undefined) {
      throw new PterodactylError('Pterodactyl returned a response that is not JSON. Is PTERODACTYL_URL correct?', response.status);
    }
    return payload as T;
  }
}

/**
 * Downloads a file from a signed Wings URL (as returned by Pterodactyl's files/download)
 * into `destination`. GET only, no redirects, and aborts past `maxBytes`. Only used for
 * files the safety rules allowed Pterodactyl to sign (SQLite files in plugin folders).
 */
export async function downloadSignedFile(
  signedUrl: string,
  destination: string,
  maxBytes: number,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const url = new URL(signedUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new PterodactylError(`Refusing to download from ${url.protocol} URL.`, 0);
  }
  const { createWriteStream } = await import('node:fs');
  const { rm } = await import('node:fs/promises');

  let response: Response;
  try {
    response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10 * 60_000) });
  } catch (error) {
    throw new PterodactylError(`Could not reach the server's node (Wings) at ${url.host}: ${(error as Error).message}`, 0);
  }
  if (!response.ok || !response.body) {
    throw new PterodactylError(`The server's node (Wings) refused the download (${response.status}).`, response.status);
  }
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maxBytes) {
    await response.body.cancel();
    throw new PterodactylError(`The file is ${Math.round(declared / 1048576)} MB, more than the ${Math.round(maxBytes / 1048576)} MB preview limit.`, 413);
  }

  const out = createWriteStream(destination, { mode: 0o600 });
  let written = 0;
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      written += value.byteLength;
      if (written > maxBytes) {
        await reader.cancel();
        throw new PterodactylError(`The file is larger than the ${Math.round(maxBytes / 1048576)} MB preview limit.`, 413);
      }
      if (!out.write(value)) await new Promise<void>((resolve) => out.once('drain', () => resolve()));
    }
    await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())));
    return written;
  } catch (error) {
    out.destroy();
    await rm(destination, { force: true });
    throw error;
  }
}
