import { AppError } from '../errors.js';
import type { AgentStatusResponse } from '../types.js';

function stripFences(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function candidateJson(value: string): string | undefined {
  const cleaned = stripFences(value);
  if (!cleaned) return undefined;
  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    // Agent messages occasionally contain one sentence around the JSON.
    const objectStart = cleaned.indexOf('{');
    const objectEnd = cleaned.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) return cleaned.slice(objectStart, objectEnd + 1);
    const arrayStart = cleaned.indexOf('[');
    const arrayEnd = cleaned.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) return cleaned.slice(arrayStart, arrayEnd + 1);
  }
  return undefined;
}

function parseString(value: string): unknown {
  const candidate = candidateJson(value);
  if (!candidate) {
    throw new AppError('invalid_agent_response', 'A resposta do agente não contém JSON válido.', 502, {
      details: { rawPreview: value.slice(0, 500) },
    });
  }
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    throw new AppError('invalid_agent_response', 'Falha ao interpretar o JSON devolvido pelo agente.', 502, {
      details: { rawPreview: value.slice(0, 500) },
    });
  }
}

function isUsablePayload(value: unknown): boolean {
  if (Array.isArray(value)) return true;
  if (!value || typeof value !== 'object') return false;
  const object = value as Record<string, unknown>;
  if (object.ok === false) return true;
  return object.ok === true && ['top', 'items', 'posts', 'videos', 'results', 'data'].some((key) => Array.isArray(object[key]));
}

function textFromMessage(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const parts = value.map(textFromMessage).filter((part): part is string => Boolean(part));
    return parts.length ? parts.join('\n') : undefined;
  }
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    for (const key of ['text', 'content', 'message', 'value']) {
      const result = textFromMessage(object[key]);
      if (result) return result;
    }
  }
  return undefined;
}

/** Parse a final `response` string/object while tolerating Markdown fences. */
export function parseAgentPayload(value: unknown): unknown {
  if (typeof value === 'string') return parseString(value);
  if (isUsablePayload(value)) return value;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    for (const key of ['response', 'output', 'result', 'content']) {
      if (object[key] !== undefined) {
        try {
          return parseAgentPayload(object[key]);
        } catch {
          // Continue looking for a usable assistant message.
        }
      }
    }
    const messages = object.messages;
    if (Array.isArray(messages)) {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        const content =
          typeof message === 'string'
            ? message
            : message && typeof message === 'object'
                ? textFromMessage(message)
                : undefined;
        if (typeof content === 'string') {
          try {
            return parseAgentPayload(content);
          } catch {
            // Try the next message.
          }
        }
      }
    }
  }
  throw new AppError('invalid_agent_response', 'Resposta do agente sem o schema RunResponse.', 502);
}

export function payloadFromStatus(status: AgentStatusResponse): unknown {
  for (const key of ['response', 'output', 'result']) {
    if (status[key] !== undefined && status[key] !== null) return parseAgentPayload(status[key]);
  }
  if (status.messages !== undefined) return parseAgentPayload({ messages: status.messages });
  throw new AppError('invalid_agent_response', 'O agente terminou sem devolver response.', 502);
}
