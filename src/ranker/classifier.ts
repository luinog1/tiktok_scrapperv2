import { CONFIG } from '../config.js';
import type { AppConfig } from '../config.js';
import type { TrendTier } from '../types.js';
import { classifyTier as classify } from '../pipeline/rank.js';

/** Compatibility wrapper; pass config explicitly in the new BFF. */
export function classifyTier(playCount: number, engagementRate: number, config: AppConfig = CONFIG): TrendTier {
  return classify(playCount, engagementRate, config);
}
