import { NextResponse } from 'next/server';

import { bffHeaders, bffUnavailable, bffUrl, forwardResponse } from '../_bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const upstream = await fetch(bffUrl('/health'), {
      method: 'GET',
      headers: bffHeaders(request),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    return forwardResponse(upstream);
  } catch (error) {
    return bffUnavailable(error);
  }
}
