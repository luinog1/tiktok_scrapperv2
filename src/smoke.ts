import { CONFIG } from './config.js';
import { errorResponse } from './errors.js';
import { createExtractionProvider } from './providers/extractionProvider.js';
import { parseRunRequest } from './schemas.js';

const parsed = parseRunRequest({
  keyword: process.env.SMOKE_KEYWORD || 'receita fitness',
  max: Number(process.env.SMOKE_MAX || 5),
  onlyBrazil: process.env.SMOKE_ONLY_BRAZIL === '1',
  includeMediaLinks: false,
});

if (!parsed.success) {
  console.error(JSON.stringify({ ok: false, error: 'invalid_smoke_input', details: parsed.error.issues }, null, 2));
  process.exitCode = 1;
} else {
  try {
    const startedAt = Date.now();
    const response = await createExtractionProvider(CONFIG).run(parsed.data);
    console.log(JSON.stringify({ ...response, smokeLatencyMs: Date.now() - startedAt }, null, 2));
    if (!response.ok) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify(errorResponse(error), null, 2));
    process.exitCode = 1;
  }
}
