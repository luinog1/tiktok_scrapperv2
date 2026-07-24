import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { normalizeMediaDownload } from '../src/app.js';

describe('normalização de streams de mídia', () => {
  it('converte stream Node dentro de metadata detalhada para Web stream', async () => {
    const result = normalizeMediaDownload({
      body: Readable.from([Buffer.from('video')]),
      contentType: 'video/mp4',
      filename: 'trend.mp4',
      status: 200,
    });
    expect(result.filename).toBe('trend.mp4');
    expect(typeof (result.body as ReadableStream<Uint8Array>).getReader).toBe('function');
    const reader = (result.body as ReadableStream<Uint8Array>).getReader();
    const chunk = await reader.read();
    expect(Buffer.from(chunk.value ?? []).toString()).toBe('video');
  });

  it('aceita Web stream simples sem metadata', async () => {
    const result = normalizeMediaDownload(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('ok'));
        controller.close();
      },
    }), 'fallback');
    expect(result.filename).toBe('fallback.mp4');
    const reader = (result.body as ReadableStream<Uint8Array>).getReader();
    const chunk = await reader.read();
    expect(new TextDecoder().decode(chunk.value)).toBe('ok');
  });
});
