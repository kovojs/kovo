// @kovo-security-classifier-corpus finite-security-operation-ir
import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

function bodyDiagnostics(handlerBody: string) {
  return compileComponentModule({
    fileName: 'src/response-body-provenance.tsx',
    source: `
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  method: 'POST',
  response: {
    appOwnedSafety: true,
    body: ['json', 'text'],
    cache: 'no-store',
  },
  async handler(request) {
    ${handlerBody}
  },
});
`,
  }).diagnostics.filter((diagnostic) => diagnostic.code === 'KV449');
}

describe('SPEC §9.2 response-body provenance', () => {
  // C13 hostile red oracle: these are distinct laundering shapes for attacker-controlled or
  // internal error text. The finite Layer-3 scanner must close all of them before a raw wire body.
  it.each([
    [
      'a catch-bound Error.message',
      `try {
        throw new Error('database password leaked');
      } catch (error) {
        return new Response(error.message, { status: 500 });
      }`,
    ],
    [
      'a catch-bound Error.stack through an immutable alias',
      `try {
        throw new Error('internal');
      } catch (error) {
        const leaked = error.stack;
        return Response.json({ detail: leaked });
      }`,
    ],
    ['the raw request URL', `return new Response(request.url);`],
    [
      'a request-derived header through a template expression',
      "return new Response(`token=${request.headers.get('x-token')}`);",
    ],
    [
      'a request-derived JSON field',
      `const payload = await request.json();
       return Response.json({ reflected: payload.secret });`,
    ],
  ])('rejects %s before it reaches an unaudited response body', (_label, handlerBody) => {
    expect(bodyDiagnostics(handlerBody)).not.toEqual([]);
  });

  it('keeps a fixed endpoint response body representable', () => {
    expect(bodyDiagnostics(`return Response.json({ code: 'ACCEPTED' }, { status: 202 });`)).toEqual(
      [],
    );
  });
});
