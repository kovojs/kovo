// @kovo-security-classifier-corpus finite-security-operation-ir
import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

function kv449(prefix: string, handlerBody: string) {
  const result = compileComponentModule({
    fileName: 'src/response-provenance.tsx',
    source: `
import { mutation } from '@kovojs/server';
${prefix}
export const report = mutation({
  handler(input, request, ctx) {
    ${handlerBody}
  },
});
`,
  });
  return result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449');
}

describe('SPEC §6.6 raw Response provenance', () => {
  it.each([
    [
      'a module-scope immutable alias',
      'const RawResponse = Response;',
      'return RawResponse.json({ ok: true });',
    ],
    [
      'a same-file helper without an authority argument',
      'function makeResponse(value) { return Response.json(value); }',
      'return makeResponse({ ok: true });',
    ],
    ['qualified ambient access', '', 'return globalThis.Response.json({ ok: true });'],
  ])('fails closed when a mutation launders raw Response through %s', (_label, prefix, body) => {
    expect(kv449(prefix, body)).not.toEqual([]);
  });
});
