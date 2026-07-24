import { z } from 'zod';

import type { OutputFormat, RunRequest, SortField } from './types.js';

const asTrimmedString = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim() : value),
  z.string().min(1),
);

const asBoolean = (fallback: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    return value;
  }, z.boolean());

const asNonNegativeNumber = (fallback: number) =>
  z.preprocess(
    (value) => (value === undefined || value === null || value === '' ? fallback : value),
    z.coerce.number().finite().min(0),
  );

const asPositiveInteger = (fallback: number) =>
  z.preprocess(
    (value) => (value === undefined || value === null || value === '' ? fallback : value),
    z.coerce.number().finite().int().min(1).max(500),
  );

const tagsSchema = z
  .preprocess((value) => {
    if (value === undefined || value === null) return [];
    if (typeof value === 'string') return value.split(',');
    return value;
  }, z.array(z.string().max(100)).max(100))
  .transform((tags) => [...new Set(tags.map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean))]);

export const runRequestSchema = z
  .object({
    keyword: z.preprocess(
      (value) => (typeof value === 'string' ? value.trim() : value),
      z.string().min(1).max(300).optional(),
    ),
    hashtags: tagsSchema,
    max: asPositiveInteger(50),
    sort: z.enum(['playCount', 'diggCount', 'shareCount', 'commentCount', 'createTime']).default('playCount'),
    minViews: asNonNegativeNumber(0),
    format: z.enum(['json', 'csv', 'both']).default('json'),
    onlyBrazil: asBoolean(false),
    brUseSearch: asBoolean(true),
    includeMediaLinks: asBoolean(true),
    // Legacy UI fields are accepted for a non-breaking migration. They do
    // not trigger an Apify path and are intentionally not exposed downstream.
    downloadVideos: z.unknown().optional(),
    output: z.unknown().optional(),
    proxyCountry: z.unknown().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.keyword && value.hashtags.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['keyword'],
        message: 'Informe keyword ou hashtags.',
      });
    }
  })
  .transform((value) => {
    const legacyDownload = value.downloadVideos;
    const includeMediaLinks =
      value.includeMediaLinks &&
      !(typeof legacyDownload === 'boolean' && legacyDownload === false);
    return {
      keyword: value.keyword,
      hashtags: value.hashtags,
      max: Math.min(50, value.max),
      sort: value.sort,
      minViews: value.minViews,
      format: value.format,
      onlyBrazil: value.onlyBrazil,
      brUseSearch: value.brUseSearch,
      includeMediaLinks,
    } satisfies RunRequest;
  });

export type ParsedRunRequest = z.infer<typeof runRequestSchema>;

export function parseRunRequest(
  input: unknown,
  defaults: { max?: number; sort?: SortField } = {},
):
  | { success: true; data: RunRequest }
  | { success: false; error: z.ZodError } {
  const value = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const result = runRequestSchema.safeParse({
    ...(defaults.max === undefined ? {} : { max: defaults.max }),
    ...(defaults.sort === undefined ? {} : { sort: defaults.sort }),
    ...value,
  });
  return result.success
    ? { success: true, data: result.data as RunRequest }
    : { success: false, error: result.error };
}

export const mediaRequestSchema = z.object({
  url: asTrimmedString,
  filename: z
    .preprocess((value) => (typeof value === 'string' ? value.trim() : value), z.string().min(1).max(180).optional()),
});

export type ParsedMediaRequest = z.infer<typeof mediaRequestSchema>;

export function sourceForRequest(request: Pick<RunRequest, 'keyword' | 'hashtags' | 'onlyBrazil' | 'brUseSearch'>): {
  source: 'search' | 'hashtag';
  terms: string[];
} {
  if (request.keyword) return { source: 'search', terms: [request.keyword] };
  const terms = (request.hashtags ?? []).map((tag) => tag.replace(/^#/, ''));
  if (request.onlyBrazil && request.brUseSearch) return { source: 'search', terms };
  return { source: 'hashtag', terms };
}

export function fetchLimitForRequest(request: Pick<RunRequest, 'max' | 'onlyBrazil'>): number {
  return request.onlyBrazil ? Math.min(Math.max(request.max * 3, 30), 150) : request.max;
}

export function isSortField(value: string): value is SortField {
  return ['playCount', 'diggCount', 'shareCount', 'commentCount', 'createTime'].includes(value);
}

export type OutputFormatValue = OutputFormat;
