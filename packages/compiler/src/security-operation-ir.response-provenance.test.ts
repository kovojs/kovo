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
  async handler(input, request, ctx) {
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
    [
      'an immutable zero-authority helper alias',
      'function makeResponse() { return new Response("raw"); } const alias = makeResponse;',
      'return alias();',
    ],
    [
      'an immutable zero-authority helper container',
      'function makeResponse() { return new Response("raw"); } const helpers = { makeResponse };',
      'return helpers.makeResponse();',
    ],
    [
      'an ambient constructor identity wrapper',
      'const RawResponse = Object.freeze(Response);',
      'return new RawResponse("raw");',
    ],
    [
      'a destructuring-reassigned helper',
      'function makeResponse() { return { ok: true }; } ({ makeResponse } = { makeResponse: () => new Response("raw") });',
      'return makeResponse();',
    ],
    [
      'an intervening loop binding',
      'function makeResponse() { return { ok: true }; } const raw = () => new Response("raw");',
      'for (const makeResponse of [raw]) return makeResponse();',
    ],
    ['qualified ambient access', '', 'return globalThis.Response.json({ ok: true });'],
  ])('fails closed when a mutation launders raw Response through %s', (_label, prefix, body) => {
    expect(kv449(prefix, body)).not.toEqual([]);
  });

  it('fails closed when a handler-local helper container launders raw Response', () => {
    expect(
      kv449(
        '',
        `
function makeResponse() { return new Response('raw'); }
const helpers = { makeResponse };
return helpers.makeResponse();
`,
      ),
    ).not.toEqual([]);
  });

  it('fails closed when a helper-container method is replaced before invocation', () => {
    expect(
      kv449(
        `
function safeResponse() { return { ok: true }; }
function rawResponse() { return new Response('raw'); }
`,
        `
const helpers = { make: safeResponse };
helpers.make = rawResponse;
return helpers.make();
`,
      ),
    ).not.toEqual([]);
  });

  it.each([
    ['an unreviewed zero-authority constructor', 'return new RawOutcome();'],
    ['Function.call on a helper container', 'return helpers.make.call(null);'],
    ['Function.apply on a helper container', 'return helpers.make.apply(null, []);'],
    ['Function.bind on a helper container', 'return helpers.make.bind(null)();'],
    ['tag invocation on a local helper', 'return RawOutcome`raw`;'],
  ])('fails closed for %s', (_label, body) => {
    expect(
      kv449(
        `
function RawOutcome() { return new Response('raw'); }
const helpers = { make: RawOutcome };
`,
        body,
      ),
    ).not.toEqual([]);
  });

  it.each([
    ['an imported opaque outcome', "import { raw } from './raw-helper.js';", 'return raw;'],
    [
      'an imported namespace member outcome',
      "import * as helper from './raw-helper.js';",
      'return helper.raw;',
    ],
    [
      'an imported thenable awaited as an outcome',
      "import { thenable } from './raw-helper.js';",
      'return await thenable;',
    ],
  ])('fails closed for %s', (_label, prefix, body) => {
    expect(kv449(prefix, body)).not.toEqual([]);
  });

  it.each([
    [
      'an inline callback that invokes a raw helper',
      'function makeRaw() { return new Response("raw"); }',
      'const values = Array.from([0], () => makeRaw()); return values[0];',
    ],
    [
      'an imported Array.from callback',
      "import { makeRaw } from './raw-helper.js';",
      'const values = Array.from([0], makeRaw); return values[0];',
    ],
    [
      'a same-file Array.map callback reference',
      'function makeRaw() { return new Response("raw"); }',
      'return [0].map(makeRaw)[0];',
    ],
    [
      'a same-file Promise executor reference',
      'function executor(resolve) { resolve(new Response("raw")); }',
      'return await new Promise(executor);',
    ],
  ])('fails closed for %s', (_label, prefix, body) => {
    expect(kv449(prefix, body)).not.toEqual([]);
  });

  it.each([
    ['for-of iteration', 'for (const value of values) return value; return null;'],
    ['array destructuring', 'const [value] = values; return value;'],
    ['array spread', 'return [...values][0];'],
    ['instanceof dispatch', 'return input instanceof Trap ? null : null;'],
    ['in-operator dispatch', "return 'raw' in trap ? null : null;"],
  ])('fails closed for imported protocol execution through %s', (_label, body) => {
    expect(kv449("import { Trap, trap, values } from './raw-helper.js';", body)).not.toEqual([]);
  });

  it.each([
    ['for-in enumeration', 'for (const key in box) { void key; break; } return null;'],
    ['property deletion', 'delete box.value; return null;'],
    ['property update', 'box.value++; return null;'],
  ])('fails closed for imported proxy execution through %s', (_label, body) => {
    expect(kv449("import { box } from './raw-helper.js';", body)).not.toEqual([]);
  });

  it.each([
    [
      'a direct parameter initializer',
      'function choose(value = new Response("raw")) { return value; }',
    ],
    [
      'a destructuring parameter initializer',
      'function choose({ value = new Response("raw") } = {}) { return value; }',
    ],
  ])('fails closed when %s constructs a raw outcome', (_label, helper) => {
    expect(kv449(helper, 'return choose();')).not.toEqual([]);
  });

  it.each([
    ['Array.from iterator dispatch', 'return Array.from(values)[0];'],
    ['Object.values property dispatch', 'return Object.values(value)[0];'],
    ['Object.assign property dispatch', 'return Object.assign({}, value).raw;'],
    ['Promise.resolve thenable dispatch', 'return await Promise.resolve(value);'],
    ['Promise.all iterator dispatch', 'return (await Promise.all(values))[0];'],
    ['Set iterator dispatch', 'const set = new Set(values); return set.values().next().value;'],
    ['Map iterator dispatch', 'const map = new Map(values); return map.values().next().value;'],
    ['String coercion dispatch', 'String(value); return null;'],
  ])('fails closed for imported operands at %s', (_label, body) => {
    expect(kv449("import { value, values } from './raw-helper.js';", body)).not.toEqual([]);
  });

  it.each([
    ['a mutable local alias', 'let value; value = raw; return value;'],
    ['a local array slot', 'const values = []; values[0] = raw; return values[0];'],
    ['a conditional expression', 'return input.ok ? raw : null;'],
    ['a logical expression', 'return input.ok && raw;'],
    ['a nullish expression', 'return raw ?? null;'],
    ['a comma expression', 'return (0, raw);'],
  ])('fails closed when imported authority moves through %s', (_label, body) => {
    expect(kv449("import { raw } from './raw-helper.js';", body)).not.toEqual([]);
  });

  it.each([
    ['Array.concat', 'const values = []; return values.concat(raw)[0];'],
    ['Array.reduce initial state', 'return [0].reduce((acc) => acc, raw);'],
    ['Array.reduceRight initial state', 'return [0].reduceRight((acc) => acc, raw);'],
    ['Array.map thisArg', 'return [0].map(function () { return this.raw; }, raw)[0];'],
    ['Promise.then rejection callback', "return await Promise.reject('x').then(undefined, raw);"],
    ['String.replace callback', "return 'x'.replace('x', raw);"],
    ['String.match protocol', "return 'x'.match(raw);"],
    ['Map.set', "const values = new Map(); values.set('raw', raw); return values.get('raw');"],
    ['Set.add', 'const values = new Set(); values.add(raw); return values.values().next().value;'],
    [
      'a handler-local object method',
      'const box = { value: null, set(value) { this.value = value; return this; } }; return box.set(raw).value;',
    ],
  ])(
    'fails closed when a generic local operation receives imported authority at %s',
    (_label, body) => {
      expect(kv449("import { raw } from './raw-helper.js';", body)).not.toEqual([]);
    },
  );

  it.each([
    [
      'a nested helper default inside an immediate callback',
      'return [0].map(() => { function choose(value = raw) { return value; } return choose(); })[0];',
    ],
    ['a direct getter', 'const box = { get value() { return raw; } }; return box.value;'],
    [
      'an iterator method',
      'const box = { *[Symbol.iterator]() { yield raw; } }; for (const value of box) return value; return null;',
    ],
    ['a thenable method', 'const box = { then(resolve) { resolve(raw); } }; return await box;'],
  ])('fails closed for %s', (_label, body) => {
    expect(kv449("import { raw } from './raw-helper.js';", body)).not.toEqual([]);
  });

  it.each([
    ['using disposal', 'using value = resource; void value; return null;'],
    ['binary coercion', "void (key + ''); return null;"],
    ['computed-key coercion', 'const value = {}; void value[key]; return null;'],
  ])('fails closed for imported protocol execution through %s', (_label, body) => {
    expect(kv449("import { key, resource } from './raw-helper.js';", body)).not.toEqual([]);
  });

  it.each([
    ['an object binding default', 'const { value = raw } = {}; return value;'],
    ['an array binding default', 'const [value = raw] = []; return value;'],
    ['a destructuring assignment default', 'let value; ({ value = raw } = {}); return value;'],
    ['a for-of binding default', 'for (const [value = raw] of [[]]) return value; return null;'],
    ['a catch binding default', 'try { throw {}; } catch ({ value = raw }) { return value; }'],
  ])('fails closed for %s', (_label, body) => {
    expect(kv449("import { raw } from './raw-helper.js';", body)).not.toEqual([]);
  });

  it.each([
    ['implicit arguments authority', 'return arguments[2];'],
    ['implicit arguments database authority', 'return arguments[2].db.select();'],
    [
      'implicit arguments egress authority',
      "await arguments[2].fetch('https://example.test'); return null;",
    ],
  ])('fails closed for %s', (_label, body) => {
    expect(kv449('', body)).not.toEqual([]);
  });

  it('fails closed for a sole rest-parameter handler', () => {
    const result = compileComponentModule({
      fileName: 'src/rest-handler.tsx',
      source: `
import { mutation } from '@kovojs/server';
export const report = mutation({
  handler(...args) { return args[2]; },
});
`,
    });
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).not.toEqual([]);
  });

  it('fails closed for implicit this-bound definition authority', () => {
    const result = compileComponentModule({
      fileName: 'src/this-handler.tsx',
      source: `
import { mutation } from '@kovojs/server';
import { raw } from './raw-helper.js';
export const report = mutation({
  raw,
  handler() { return this.raw; },
});
`,
    });
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).not.toEqual([]);
  });

  it.each([
    ['a static class field', 'class Box { static value = raw; } return Box.value;'],
    ['a static class getter', 'class Box { static get value() { return raw; } } return Box.value;'],
    ['an enum initializer', 'enum Outcome { Raw = raw } return Outcome.Raw;'],
  ])('fails closed for %s', (_label, body) => {
    expect(kv449("import { raw } from './raw-helper.js';", body)).not.toEqual([]);
  });
});
