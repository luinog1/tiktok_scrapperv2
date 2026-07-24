import type { AppConfig } from '../config.js';
import { AppError } from '../errors.js';
import { DoukClient } from './doukClient.js';
import type { MediaDownload } from './doukClient.js';
import type { MediaProvider, ProviderHealth } from '../providers/types.js';

export class DoukMediaProvider implements MediaProvider {
  readonly name = 'douk' as const;
  constructor(private readonly client: DoukClient) {}

  download(webUrl: string, filename?: string): Promise<MediaDownload> {
    return this.client.download(webUrl, filename);
  }

  async health(): Promise<ProviderHealth> {
    return this.client.health();
  }
}

export class OffMediaProvider implements MediaProvider {
  readonly name = 'off' as const;

  async download(webUrl: string): Promise<MediaDownload> {
    throw new AppError('media_disabled', 'O download de mídia está desativado.', 503, { details: { fallbackUrl: webUrl } });
  }

  async health(): Promise<ProviderHealth> {
    return { ok: true, detail: 'disabled' };
  }
}

export function getMediaProvider(config: AppConfig, client = new DoukClient(config)): MediaProvider {
  if (config.mediaProvider === 'off') return new OffMediaProvider();
  if (config.mediaProvider === 'douk') return new DoukMediaProvider(client);
  throw new AppError('invalid_media_provider', `MEDIA_PROVIDER inválido ou não implementado: ${config.mediaProvider}.`, 500);
}

export const createMediaProvider = getMediaProvider;
