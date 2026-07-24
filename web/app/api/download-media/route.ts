import { NextResponse } from 'next/server';

import { bffHeaders, bffUnavailable, bffUrl, forwardResponse } from '../_bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.text();
    const headers = bffHeaders(request);
    headers.set('content-type', request.headers.get('content-type') || 'application/json');
    const upstream = await fetch(bffUrl('/download-media'), {
      method: 'POST',
      headers,
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(290_000),
    });
    return forwardResponse(upstream, { stream: true });
  } catch (error) {
    return bffUnavailable(error);
  }
}
