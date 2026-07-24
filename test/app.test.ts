import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { MockExtractionProvider } from '../src/providers/extractionProvider.js';
import { testConfig } from './helpers.js';

describe('HTTP API', () => {
  it('registra os endpoints compatíveis sem abrir socket', () => {
    const config = testConfig();
    const app = createApp(config, { provider: new MockExtractionProvider(config) });
    const routes = (app.router.stack as Array<{ route?: { path?: string } }>)
      .map((layer) => layer.route?.path)
      .filter((path): path is string => Boolean(path));

    expect(routes).toEqual(expect.arrayContaining([
      '/health',
      '/run',
      '/download-media',
      '/api/download-media',
      '/download',
    ]));
  });
});
