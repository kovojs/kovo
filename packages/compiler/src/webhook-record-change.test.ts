import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

const kv402 = diagnosticDefinitions.KV402;
const kv406 = diagnosticDefinitions.KV406;

describe('compiler webhook recordChange diagnostics', () => {
  it('reports KV402 when recordChange targets a domain outside declared writes', () => {
    const result = compileComponentModule({
      fileName: 'webhooks.ts',
      source: `
import { domain, webhook } from '@kovojs/server';

const contact = domain('model/contact');
const billing = domain('billing');

export const paymentWebhook = webhook('/webhooks/payment', {
  handler(input, context) {
    context.recordChange(contact, { keys: [input.id] });
    (context as unknown as { recordChange(domain: typeof billing): unknown }).recordChange(billing);
    return Response.json({ ok: true });
  },
  writes: [contact],
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV402',
        fileName: 'webhooks.ts',
        message:
          'Write touched an undeclared domain. webhook /webhooks/payment recordChange("billing") is outside declared writes (model/contact).',
        severity: kv402.severity,
        start: { column: 92, line: 10 },
      },
    ]);
  });

  it('reports KV402 for destructured recordChange aliases outside declared writes', () => {
    const result = compileComponentModule({
      fileName: 'webhooks.ts',
      source: `
import { domain, webhook } from '@kovojs/server';

const contact = domain('model/contact');
const billing = domain('billing');

export const paymentWebhook = webhook('/webhooks/payment', {
  handler(input, { recordChange, recordChange: markChanged }) {
    recordChange(contact, { keys: [input.id] });
    markChanged(billing);
    return Response.json({ ok: true });
  },
  writes: [contact],
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV402',
        fileName: 'webhooks.ts',
        message:
          'Write touched an undeclared domain. webhook /webhooks/payment recordChange("billing") is outside declared writes (model/contact).',
        severity: kv402.severity,
        start: { column: 17, line: 10 },
      },
    ]);
  });

  it('reports KV406 when recordChange target resolution is unprovable', () => {
    const result = compileComponentModule({
      fileName: 'webhooks.ts',
      source: `
import { domain, webhook } from '@kovojs/server';

const contact = domain('model/contact');

export const paymentWebhook = webhook('/webhooks/payment', {
  handler(input, context) {
    context.recordChange(domainFor(input.kind), { keys: [input.id] });
    return Response.json({ ok: true });
  },
  writes: [contact],
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV406',
        fileName: 'webhooks.ts',
        message:
          'Unresolved webhook recordChange domain; declare a statically named domain in writes[].',
        severity: kv406.severity,
        start: { column: 26, line: 8 },
      },
    ]);
  });

  it('accepts recordChange calls covered by webhook writes', () => {
    const result = compileComponentModule({
      fileName: 'webhooks.ts',
      source: `
import { domain, webhook } from '@kovojs/server';

const contact = domain('model/contact');

export const paymentWebhook = webhook('/webhooks/payment', {
  handler(input, context) {
    context.recordChange(contact, { keys: [input.id] });
    return Response.json({ ok: true });
  },
  writes: [contact],
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV402')).toEqual([]);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV406')).toEqual([]);
  });
});
