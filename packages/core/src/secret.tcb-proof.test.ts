import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';

import { secret, untrusted } from './secret.js';

type BoxKind = 'secret' | 'untrusted';

interface BoxCase {
  readonly code: 'KV426' | 'KV435';
  readonly kind: BoxKind;
  readonly marker: '[secret]' | '[untrusted]';
  readonly rawNeedle: string;
  readonly value: unknown;
  readonly wrap: (value: unknown) => unknown;
}

const payloads: readonly unknown[] = [
  'raw-string-needle',
  0,
  42,
  true,
  null,
  { nested: 'raw-object-needle' },
  ['raw-array-needle'],
  new Uint8Array([1, 2, 3]),
];

const boxes: readonly BoxCase[] = payloads.flatMap((value, index) => [
  {
    code: 'KV435',
    kind: 'secret',
    marker: '[secret]',
    rawNeedle: rawNeedle(value, index),
    value,
    wrap: secret,
  },
  {
    code: 'KV426',
    kind: 'untrusted',
    marker: '[untrusted]',
    rawNeedle: rawNeedle(value, index),
    value,
    wrap: untrusted,
  },
]);

const coercionOperations: readonly {
  readonly name: string;
  readonly run: (box: unknown) => unknown;
}[] = [
  { name: 'String(value)', run: (box) => String(box) },
  { name: 'template literal', run: (box) => `${box}` },
  { name: 'left concatenation', run: (box) => '' + box },
  { name: 'right concatenation', run: (box) => box + '' },
  { name: 'Number(value)', run: (box) => Number(box) },
  { name: 'unary plus', run: (box) => +(box as number) },
  { name: 'loose equality', run: (box) => box == 'raw-string-needle' },
  { name: 'array join', run: (box) => [box].join(',') },
  { name: 'property key coercion', run: (box) => ({ [box as PropertyKey]: true }) },
  {
    name: 'URLSearchParams record coercion',
    run: (box) => new URLSearchParams({ value: box as string }),
  },
  { name: 'direct toString()', run: (box) => (box as { toString(): string }).toString() },
  { name: 'direct valueOf()', run: (box) => (box as { valueOf(): string }).valueOf() },
  {
    name: 'Symbol.toPrimitive string hint',
    run: (box) =>
      (box as { [Symbol.toPrimitive](hint: string): string })[Symbol.toPrimitive]('string'),
  },
  {
    name: 'Symbol.toPrimitive number hint',
    run: (box) =>
      (box as { [Symbol.toPrimitive](hint: string): string })[Symbol.toPrimitive]('number'),
  },
  {
    name: 'Symbol.toPrimitive default hint',
    run: (box) =>
      (box as { [Symbol.toPrimitive](hint: string): string })[Symbol.toPrimitive]('default'),
  },
  { name: 'JSON.stringify(value)', run: (box) => JSON.stringify(box) },
  { name: 'JSON.stringify object property', run: (box) => JSON.stringify({ value: box }) },
  { name: 'JSON.stringify array entry', run: (box) => JSON.stringify([box]) },
];

const safeObservationOperations: readonly {
  readonly name: string;
  readonly run: (box: unknown) => string;
}[] = [
  { name: 'util.inspect(value)', run: (box) => inspect(box) },
  { name: 'util.inspect object property', run: (box) => inspect({ value: box }) },
  { name: 'Object.prototype.toString', run: (box) => Object.prototype.toString.call(box) },
  { name: 'Object.keys', run: (box) => JSON.stringify(Object.keys(box as object)) },
  { name: 'object spread', run: (box) => JSON.stringify({ ...(box as object) }) },
];

describe('TCB proof: Secret/Untrusted finite coercion model (DEC-K/A10)', () => {
  it('refuses every modeled JS coercion path without exposing the payload', () => {
    expect(coercionOperations.map((operation) => operation.name)).toMatchInlineSnapshot(`
      [
        "String(value)",
        "template literal",
        "left concatenation",
        "right concatenation",
        "Number(value)",
        "unary plus",
        "loose equality",
        "array join",
        "property key coercion",
        "URLSearchParams record coercion",
        "direct toString()",
        "direct valueOf()",
        "Symbol.toPrimitive string hint",
        "Symbol.toPrimitive number hint",
        "Symbol.toPrimitive default hint",
        "JSON.stringify(value)",
        "JSON.stringify object property",
        "JSON.stringify array entry",
      ]
    `);

    for (const boxCase of boxes) {
      const box = boxCase.wrap(boxCase.value);
      for (const operation of coercionOperations) {
        expect(() => operation.run(box), `${boxCase.kind} ${operation.name} should throw`).toThrow(
          boxCase.code,
        );
        try {
          operation.run(box);
        } catch (error) {
          expect(String(error), `${boxCase.kind} ${operation.name} error`).not.toContain(
            boxCase.rawNeedle,
          );
        }
      }
    }
  });

  it('permits only fixed redacted observations and empty structural reflection', () => {
    for (const boxCase of boxes) {
      const box = boxCase.wrap(boxCase.value);
      for (const operation of safeObservationOperations) {
        const observed = operation.run(box);
        expect(observed, `${boxCase.kind} ${operation.name}`).not.toContain(boxCase.rawNeedle);
        if (operation.name.startsWith('util.inspect')) {
          expect(observed, `${boxCase.kind} ${operation.name}`).toContain(boxCase.marker);
        }
      }
    }
  });
});

function rawNeedle(value: unknown, index: number): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return String(value[0]);
  if (value !== null && typeof value === 'object' && 'nested' in value) {
    return String((value as { nested: unknown }).nested);
  }
  return `raw-never-present-${index}`;
}
