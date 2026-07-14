import { describe, expect, it } from 'vitest';

import { secret } from '../packages/core/src/secret.js';
import { emitToWire } from '../packages/server/src/response-posture.js';

const secretNeedle = 'sk_tcb_emit_to_wire';

const frameworkBodyModel: readonly {
  readonly body: ArrayBuffer | ReadableStream<Uint8Array> | Uint8Array | string | null;
  readonly name: string;
  readonly expectedText?: string;
}[] = [
  { body: null, expectedText: '', name: 'null body' },
  { body: '', expectedText: '', name: 'empty text' },
  { body: 'hello', expectedText: 'hello', name: 'text' },
  { body: new Uint8Array([104, 105]), expectedText: 'hi', name: 'Uint8Array' },
  { body: new TextEncoder().encode('ab').buffer, expectedText: 'ab', name: 'ArrayBuffer' },
  {
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('stream'));
        controller.close();
      },
    }),
    expectedText: 'stream',
    name: 'ReadableStream',
  },
];

const secretHeaderModel: readonly {
  readonly headers: Record<string, string | string[]>;
  readonly name: string;
}[] = [
  { headers: { 'x-token': secret(secretNeedle) as unknown as string }, name: 'single header' },
  {
    headers: { 'x-token': ['public', secret(secretNeedle) as unknown as string] },
    name: 'multi header',
  },
  {
    headers: { location: secret(secretNeedle) as unknown as string },
    name: 'redirect Location header',
  },
];

describe('TCB proof: emitToWire finite egress model (DEC-K/A10)', () => {
  it('accepts every modeled framework body carrier', async () => {
    expect(frameworkBodyModel.map((entry) => entry.name)).toMatchInlineSnapshot(`
      [
        "null body",
        "empty text",
        "text",
        "Uint8Array",
        "ArrayBuffer",
        "ReadableStream",
      ]
    `);

    for (const entry of frameworkBodyModel) {
      const response = emitToWire(
        { body: entry.body, headers: { 'content-type': 'text/plain' }, status: 200 },
        'framework-response',
        { method: 'GET', status: 200 },
      );
      await expect(response.text(), entry.name).resolves.toBe(entry.expectedText);
    }

    const preSuppressed = emitToWire(
      { body: null, headers: {}, status: 304 },
      'framework-response',
      { method: 'GET', status: 304 },
    );
    await expect(preSuppressed.text()).resolves.toBe('');
  });

  it('refuses Secret boxes in every modeled framework response header shape', () => {
    for (const entry of secretHeaderModel) {
      expect(
        () =>
          emitToWire(
            {
              body: 'ok',
              headers: entry.headers,
              status: entry.name.includes('redirect') ? 303 : 200,
            },
            'framework-response',
            {
              blessedRedirect: true,
              method: 'GET',
              status: entry.name.includes('redirect') ? 303 : 200,
            },
          ),
        entry.name,
      ).toThrow(/KV435/);

      try {
        emitToWire(
          {
            body: 'ok',
            headers: entry.headers,
            status: entry.name.includes('redirect') ? 303 : 200,
          },
          'framework-response',
          {
            blessedRedirect: true,
            method: 'GET',
            status: entry.name.includes('redirect') ? 303 : 200,
          },
        );
      } catch (error) {
        expect(String(error), entry.name).not.toContain(secretNeedle);
      }
    }
  });

  it('keeps multi-value Secret inspection pinned after late Array.isArray poisoning', () => {
    const originalIsArray = Array.isArray;
    let error: unknown;
    try {
      Array.isArray = function poisonedArrayIsArray(_value: unknown): _value is unknown[] {
        return false;
      };
      try {
        emitToWire(
          {
            body: 'ok',
            headers: { 'x-token': ['public', secret(secretNeedle) as unknown as string] },
            status: 200,
          },
          'framework-response',
          { method: 'GET', status: 200 },
        );
      } catch (caught) {
        error = caught;
      }
    } finally {
      Array.isArray = originalIsArray;
    }

    expect(String(error)).toContain('KV435');
    expect(String(error)).not.toContain(secretNeedle);
  });

  it('refuses channel/value mismatches before constructing a Web Response', () => {
    expect(() =>
      emitToWire({ body: 'ok', headers: {}, status: 200 }, 'raw-endpoint-response', {
        method: 'GET',
        status: 200,
      }),
    ).toThrow(/requires a Web Response/);

    expect(() =>
      emitToWire(new Response('ok'), 'framework-response', { method: 'GET', status: 200 }),
    ).toThrow(/requires a structured response/);
  });

  it('preserves raw endpoint response bodies while enforcing HEAD/304 suppression', async () => {
    const passthrough = new Response('raw', {
      headers: { 'content-type': 'text/plain', 'x-endpoint': 'preserved' },
      status: 201,
      statusText: 'Created',
    });
    const finalized = emitToWire(passthrough, 'raw-endpoint-response', {
      method: 'GET',
      status: 201,
    });
    // SPEC §9.1/§9.5: the framework-owned final carrier is reconstructed after
    // endpoint headers are inspected; preserve semantics, not app object identity.
    expect(finalized).not.toBe(passthrough);
    expect(finalized.status).toBe(201);
    expect(finalized.statusText).toBe('Created');
    expect(finalized.headers.get('content-type')).toContain('text/plain');
    expect(finalized.headers.get('x-endpoint')).toBe('preserved');
    await expect(finalized.text()).resolves.toBe('raw');

    const head = emitToWire(new Response('hidden'), 'raw-endpoint-response', {
      method: 'HEAD',
      status: 200,
    });
    await expect(head.text()).resolves.toBe('');

    const notModified = emitToWire(new Response(null, { status: 304 }), 'raw-endpoint-response', {
      method: 'GET',
      status: 304,
    });
    await expect(notModified.text()).resolves.toBe('');
  });
});
