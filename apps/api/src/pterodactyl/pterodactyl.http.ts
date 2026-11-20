import { assertPterodactylRequestAllowed, type HttpMethod } from './safety';

export class PterodactylError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'PterodactylError';
  }
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
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
    assertPterodactylRequestAllowed(method, path);

    const expectedPath = `${this.basePath}${path}`;
    const url = new URL(expectedPath, this.origin);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    // Defence in depth: the URL must not have been normalised into a different path.
    if (url.pathname !== expectedPath || url.origin !== this.origin) {
      throw new PterodactylError(`Refusing to send request to unexpected URL ${url.toString()}`, 0);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
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

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : undefined;
    } catch {
      payload = undefined;
    }

    if (!response.ok) {
      const detail =
        (payload as { errors?: Array<{ detail?: string }> } | undefined)?.errors?.[0]?.detail ?? response.statusText;
      throw new PterodactylError(`Pterodactyl responded ${response.status}: ${detail}`, response.status);
    }
    if (payload === undefined) {
      throw new PterodactylError('Pterodactyl returned a response that is not JSON. Is PTERODACTYL_URL correct?', response.status);
    }
    return payload as T;
  }
}
