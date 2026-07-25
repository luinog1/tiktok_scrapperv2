import { NextResponse } from 'next/server';

const DEFAULT_BFF_URL = 'http://localhost:3000';

export function bffUrl(path: string): string {
  const base = (process.env.BFF_URL || DEFAULT_BFF_URL).replace(/\/+$/u, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export function bffHeaders(request?: Request): Headers {
  const headers = new Headers();
  headers.set('accept', 'application/json');
  const apiKey = process.env.BFF_API_KEY?.trim();
  if (apiKey) headers.set('x-api-key', apiKey);
  const requestId = request?.headers.get('x-request-id');
  if (requestId) headers.set('x-request-id', requestId.slice(0, 100));
  const provider = request?.headers.get('x-scrape-provider')?.trim().toLowerCase();
  if (process.env.ALLOW_PROVIDER_OVERRIDE === 'true' && provider && ['self', 'scrapedo', 'apify'].includes(provider)) {
    headers.set('x-scrape-provider', provider);
  }
  return headers;
}

export async function bffUnavailable(error: unknown): Promise<NextResponse> {
  console.error('[pulseboard] BFF request failed', error);
  return NextResponse.json(
    { ok: false, error: 'bff_unreachable', retryable: true },
    { status: 502, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function forwardResponse(upstream: Response, options: { stream?: boolean } = {}): Promise<NextResponse> {
  const headers = new Headers();
  const passthrough = ['content-type', 'content-disposition', 'content-length', 'content-range', 'accept-ranges', 'x-request-id'];
  passthrough.forEach((name) => {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  });
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  if (options.stream) {
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  }

  // Buffer JSON responses before handing them to Next. The upstream response
  // may have been compressed by Render; forwarding its content-length while
  // reusing the decoded fetch body can make the browser receive a truncated
  // or otherwise invalid JSON document.
  const body = await upstream.text();
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new NextResponse(body, { status: upstream.status, headers });
}
