import { describe, expect, it } from 'vitest';

import { AppError } from '../src/errors.js';
import { parseAgentPayload } from '../src/gumloop/response.js';

describe('parseAgentPayload', () => {
  it('remove fences markdown', () => {
    expect(parseAgentPayload('```json\n{"ok":true,"top":[]}\n```')).toEqual({ ok: true, top: [] });
  });

  it('localiza JSON dentro de texto do agente', () => {
    expect(parseAgentPayload('Resultado: {"ok":false,"error":"timeout"} fim')).toEqual({ ok: false, error: 'timeout' });
  });

  it('rejeita texto sem JSON', () => {
    expect(() => parseAgentPayload('sem payload')).toThrowError(AppError);
  });
});
