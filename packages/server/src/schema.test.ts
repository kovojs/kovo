import { describe, expect, it, vi } from 'vitest';
import { File } from 'node:buffer';
import type { JsonValue, Secret, StorageCapability } from '@kovojs/core';
import { createMemoryStorage, storageBodyToBytes } from '@kovojs/core/internal/storage';

import { runMutation } from './mutation.js';
import { type Schema, entriesToRecord, parseSchemaAsync, s } from './schema.js';
import { unsafeRegex } from './redos.js';
import { testMutation as mutation } from './test-fixtures.js';

describe('server schemas', () => {
  it('keeps chained schema constraints immutable', () => {
    const baseNumber = s.number();
    const positiveInteger = baseNumber.int().min(1);

    expect(baseNumber.parse(0.5)).toBe(0.5);
    expect(() => positiveInteger.parse(0.5)).toThrow('Expected integer');
    expect(() => positiveInteger.parse(0)).toThrow('Expected number >= 1');

    const file = {
      arrayBuffer: async () => new ArrayBuffer(0),
      name: 'cart.txt',
      size: 12,
      type: 'text/plain',
    };
    const baseFile = s.file();
    const imageFile = baseFile.accept(['image/png']).maxBytes(10);

    expect(baseFile.parse(file)).toBe(file);
    expect(() => imageFile.parse(file)).toThrow('Expected file <= 10 bytes');
  });

  it('wraps schemas as Secret values outside JsonValue client payloads', () => {
    const schema = s.object({ passwordHash: s.secret(s.string()) });
    const parsed = schema.parse({ passwordHash: 'hash-1' });
    const assertSecretBoundary = () => {
      const _secret: Secret<string> = parsed.passwordHash;
      // @ts-expect-error SPEC §6.2/§9.2/§10.2: Secret<T> is not JsonValue.
      const _json: JsonValue = parsed.passwordHash;
    };

    expect(parsed.passwordHash).toBe('hash-1');
    expect(assertSecretBoundary).toBeTypeOf('function');
  });

  it('coerces FormData once through the declared schema', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1).default(1),
      }),
      handler(input) {
        return input;
      },
    });
    const form = new FormData();
    form.set('productId', 'p1');
    form.set('quantity', '2');

    await expect(runMutation(addToCart, form, {})).resolves.toEqual({
      changes: [],
      ok: true,
      rerunQueries: [],
      value: { productId: 'p1', quantity: 2 },
    });
  });

  it('coerces checkbox booleans and repeated FormData fields through declared schemas', async () => {
    const updatePreferences = mutation('preferences/update', {
      input: s.object({
        emailOptIn: s.boolean(),
        tags: s.array(s.string()),
      }),
      handler(input) {
        return input;
      },
    });
    const form = new FormData();
    form.set('emailOptIn', 'on');
    form.append('tags', 'cart');
    form.append('tags', 'deals');

    await expect(runMutation(updatePreferences, form, {})).resolves.toEqual({
      changes: [],
      ok: true,
      rerunQueries: [],
      value: {
        emailOptIn: true,
        tags: ['cart', 'deals'],
      },
    });

    await expect(runMutation(updatePreferences, new FormData(), {})).resolves.toEqual({
      changes: [],
      ok: true,
      rerunQueries: [],
      value: {
        emailOptIn: false,
        tags: [],
      },
    });
  });

  it('treats single submitted values as one-item arrays', async () => {
    const filterProducts = mutation('products/filter', {
      input: s.object({
        categories: s.array(s.string()),
      }),
      handler(input) {
        return input;
      },
    });
    const form = new FormData();
    form.set('categories', 'books');

    await expect(runMutation(filterProducts, form, {})).resolves.toMatchObject({
      ok: true,
      value: {
        categories: ['books'],
      },
    });
  });

  it('returns indexed validation paths for array schema errors', async () => {
    const bulkAdd = mutation('cart/bulk-add', {
      input: s.object({
        quantities: s.array(s.number().int().min(1)),
      }),
      handler(input) {
        return input;
      },
    });
    const form = new FormData();
    form.append('quantities', '1');
    form.append('quantities', '0');

    await expect(runMutation(bulkAdd, form, {})).resolves.toEqual({
      error: {
        code: 'VALIDATION',
        payload: { issues: [{ message: 'Expected number >= 1', path: ['quantities', '1'] }] },
      },
      ok: false,
      status: 422,
    });
  });

  it('coerces multipart file fields through s.file()', async () => {
    const uploadAvatar = mutation('profile/avatar', {
      input: s.object({
        avatar: s.file({ maxBytes: 16, accept: ['image/png'] }),
      }),
      handler(input) {
        return {
          name: input.avatar.name,
          size: input.avatar.size,
          type: input.avatar.type,
        };
      },
    });
    const form = new FormData();
    form.set('avatar', formDataFile(['avatar'], 'avatar.png', 'image/png'));

    await expect(runMutation(uploadAvatar, form, {})).resolves.toEqual({
      changes: [],
      ok: true,
      rerunQueries: [],
      value: {
        name: 'avatar.png',
        size: 6,
        type: 'image/png',
      },
    });
  });

  // KV428 (SPEC §6.6/§9.1): the storage key is SERVER-GENERATED and opaque (random UUID under the
  // `keyPrefix` namespace); the served contentType is SNIFFED from the bytes (server truth), NOT the
  // client `file.type`; the client filename is sanitized download metadata only.
  it('stores multipart file fields under a server-minted key with a sniffed content type', async () => {
    const storage = createMemoryStorage({ now: () => new Date('2026-06-11T12:00:00.000Z') });
    const uploadAvatar = mutation('profile/avatar', {
      input: s.object({
        // Client lies "image/jpeg" but the bytes are a real PNG — the sniffer overrides the lie.
        avatar: s.file({ maxBytes: 64 }).store({ keyPrefix: 'avatars', storage }),
      }),
      handler(input) {
        return {
          contentType: input.avatar.storage.contentType,
          key: input.avatar.key,
          name: input.avatar.file.name,
        };
      },
    });
    const form = new FormData();
    form.set('avatar', pngFile('../../etc/passwd.png', 'image/jpeg'));

    const result = await runMutation(uploadAvatar, form, {});
    expect(result).toMatchObject({ ok: true });
    const value = (result as { value: { contentType: string; key: string } }).value;
    // Server truth: sniffed PNG, not the client "image/jpeg" lie.
    expect(value.contentType).toBe('image/png');
    // Opaque server key under the namespace — the traversal filename never became the key.
    expect(value.key).toMatch(/^avatars\/[0-9a-f-]{36}$/u);
    expect(value.key).not.toContain('..');

    const stored = await storage.get(value.key);
    expect(stored?.contentType).toBe('image/png');
    // The client filename survives only as sanitized download metadata (no path segments).
    expect(stored?.metadata?.filename).toBe('passwd.png');
  });

  it('does not store invalid multipart file fields', async () => {
    const storage = createMemoryStorage();
    const put = vi.fn<StorageCapability['put']>((key, body, options) =>
      storage.put(key, body, options),
    );
    const uploadAvatar = mutation('profile/avatar', {
      input: s.object({
        avatar: s.file().maxBytes(4).store({ keyPrefix: 'avatars', storage: { ...storage, put } }),
      }),
      handler(input) {
        return input.avatar.key;
      },
    });
    const form = new FormData();
    form.set('avatar', formDataFile(['large'], 'avatar.png', 'image/png'));

    await expect(runMutation(uploadAvatar, form, {})).resolves.toEqual({
      error: {
        code: 'VALIDATION',
        payload: { issues: [{ message: 'Expected file <= 4 bytes', path: ['avatar'] }] },
      },
      ok: false,
      status: 422,
    });
    expect(put).not.toHaveBeenCalled();
  });

  it('returns validation failures with field paths for schema errors', async () => {
    const uploadAvatar = mutation('profile/avatar', {
      input: s.object({
        avatar: s.file().maxBytes(4).accept(['image/png']),
      }),
      handler(input) {
        return input.avatar.name;
      },
    });
    const oversized = new FormData();
    oversized.set('avatar', formDataFile(['large'], 'avatar.png', 'image/png'));
    const wrongType = new FormData();
    wrongType.set('avatar', formDataFile(['ok'], 'avatar.txt', 'text/plain'));

    await expect(runMutation(uploadAvatar, new FormData(), {})).resolves.toEqual({
      error: {
        code: 'VALIDATION',
        payload: { issues: [{ message: 'Expected file', path: ['avatar'] }] },
      },
      ok: false,
      status: 422,
    });
    await expect(runMutation(uploadAvatar, oversized, {})).resolves.toEqual({
      error: {
        code: 'VALIDATION',
        payload: { issues: [{ message: 'Expected file <= 4 bytes', path: ['avatar'] }] },
      },
      ok: false,
      status: 422,
    });
    await expect(runMutation(uploadAvatar, wrongType, {})).resolves.toEqual({
      error: {
        code: 'VALIDATION',
        payload: { issues: [{ message: 'Expected file type image/png', path: ['avatar'] }] },
      },
      ok: false,
      status: 422,
    });
  });

  // KV434 (SPEC §6.6/§9.5): blessed formats + linear-safe pattern + unsafeRegex on s.string().
  it('validates blessed string formats by-construction', () => {
    expect(s.string().email().parse('user@example.com')).toBe('user@example.com');
    expect(() => s.string().email().parse('nope')).toThrow('Expected email');
    expect(s.string().uuid().parse('c8428f29-323d-4533-a60c-a0e6a5dea76a')).toBe(
      'c8428f29-323d-4533-a60c-a0e6a5dea76a',
    );
    expect(() => s.string().uuid().parse('bad')).toThrow('Expected uuid');
    expect(s.string().slug().parse('my-post')).toBe('my-post');
  });

  it('rejects a catastrophic-backtracking pattern literal and accepts a safe one (KV434)', () => {
    expect(() => s.string().pattern('(a+)+$')).toThrow(/KV434/u);
    const safe = s.string().pattern('^[a-z0-9]+$');
    expect(safe.parse('abc123')).toBe('abc123');
    expect(() => safe.parse('Bad!')).toThrow('Expected string matching pattern');
  });

  it('caps pattern() input length under the runtime step-budget (KV434)', () => {
    const schema = s.string().pattern('^a+$');
    expect(() => schema.parse('a'.repeat(5000))).toThrow(/match budget/u);
  });

  it('takes the audited unsafeRegex escape (KV434)', () => {
    const schema = s.string().matches(unsafeRegex(/^(x+)+$/u, 'capped upstream'));
    expect(schema.parse('xxx')).toBe('xxx');
    expect(() => schema.parse('y')).toThrow('Expected string matching pattern');
  });

  // M1: `s.array(s.file().store())` MUST run the async storing path for every item.
  // Before the fix `s.array` had no `parseAsync`, so `parseSchemaAsync` fell back to the
  // sync `parse`, which fabricated a `StoredFileUpload` without ever calling `storage.put`
  // (data loss) and without `normalizeStorageKey` (traversal-key passthrough).
  it('stores every item of an s.array(s.file().store()) under distinct server-minted keys', async () => {
    const memory = createMemoryStorage({ now: () => new Date('2026-06-11T12:00:00.000Z') });
    const put = vi.fn<StorageCapability['put']>((key, body, options) =>
      memory.put(key, body, options),
    );
    const storage: StorageCapability = { ...memory, put };

    const schema = s.object({
      photos: s.array(s.file().store({ keyPrefix: 'gallery', storage })),
    });
    const form = new FormData();
    form.append('photos', pngFile('one.png', 'image/png'));
    // KV428: a traversal filename can no longer become the storage key — the key is server-minted.
    form.append('photos', pngFile('../../etc/evil.png', 'image/png'));

    const parsed = (await parseSchemaAsync(schema, form)) as {
      photos: Array<{ key: string }>;
    };

    // `storage.put` was attempted once per file with an opaque server key (was 0 before the M1 fix).
    expect(put).toHaveBeenCalledTimes(2);
    for (const call of put.mock.calls) {
      expect(call[0]).toMatch(/^gallery\/[0-9a-f-]{36}$/u);
      expect(call[0]).not.toContain('..');
    }
    // Distinct opaque keys; both files landed (no overwrite via a colliding traversal name).
    expect(parsed.photos[0]?.key).not.toBe(parsed.photos[1]?.key);
    await expect(memory.get(parsed.photos[0]?.key ?? '')).resolves.toMatchObject({
      key: parsed.photos[0]?.key,
    });
  });

  // M1: the sync `parse` of a storing file schema must refuse to fabricate a result.
  it('refuses to store a file through the synchronous parse path', () => {
    const storing = s.file().store({ keyPrefix: 'gallery', storage: createMemoryStorage() });

    expect(() => storing.parse(formDataFile(['x'], 'photo.png', 'image/png'))).toThrow(
      /storing requires async parsing/u,
    );
  });

  // L1: a non-validation error thrown inside a field schema (e.g. a storage failure) must
  // NOT be wrapped into a SchemaValidationError — otherwise its raw `.message` leaks to the
  // client through the 422. It must re-throw unchanged so the caller routes it to the 500 path.
  it('re-throws non-validation field errors instead of leaking them as a 422', async () => {
    const leaky: Schema<string> = {
      parse() {
        throw new Error('SECRET endpoint https://internal.example/keys leaked');
      },
    };
    const schema = s.object({ token: leaky });

    await expect(parseSchemaAsync(schema, { token: 'valid' })).rejects.toThrow(
      'SECRET endpoint https://internal.example/keys leaked',
    );
    await expect(parseSchemaAsync(schema, { token: 'valid' })).rejects.not.toMatchObject({
      name: 'SchemaValidationError',
    });

    // End-to-end: runMutation routes the leaked error to the 500 path, not a 422 payload.
    const reveal = mutation('secrets/reveal', {
      input: schema,
      handler: (input) => input,
    });
    await expect(runMutation(reveal, { token: 'valid' }, {})).rejects.toThrow(
      'SECRET endpoint https://internal.example/keys leaked',
    );
  });

  // SCHEMA-1 / SCHEMA-2: the FormData→record map must not read/write through the prototype.
  // `__proto__` keys must not rebind the record's prototype, and keys like `constructor` must
  // not be misclassified as repeats (becoming `[<fn>, value]` arrays). Normal fields still parse.
  it('builds the FormData record with a null prototype and own-key gating', () => {
    const record = entriesToRecord([
      ['__proto__', 'attacker-a'],
      ['__proto__', 'attacker-b'],
      ['title', 'hello'],
    ]);

    expect(Object.getPrototypeOf(record)).toBeNull();
    expect(record.title).toBe('hello');
    // The repeated __proto__ entries are stored as an own-property array, never the
    // prototype-rebinding setter, and never the attacker array contaminating other keys.
    expect(Object.hasOwn(record, '__proto__')).toBe(true);
    expect(record['__proto__']).toEqual(['attacker-a', 'attacker-b']);
    expect(record.constructor).toBe(undefined);
    expect(record['toString']).toBe(undefined);
  });

  it('does not misclassify prototype-chain keys as repeated FormData fields', () => {
    const record = entriesToRecord([
      ['constructor', 'first'],
      ['toString', 'only'],
    ]);

    // Before the fix `record['constructor']` read the inherited function, so the first
    // append took the array branch and produced `[<fn>, 'first']`.
    expect(record.constructor).toBe('first');
    expect(record['toString']).toBe('only');
  });
});

function formDataFile(bits: string[], name: string, type: string): Blob {
  return new File(bits, name, { type }) as unknown as Blob;
}

/** A File whose bytes are a real (minimal) PNG, with an arbitrary client-declared `type`. */
function pngFile(name: string, type: string): Blob {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02]);
  return new File([png], name, { type }) as unknown as Blob;
}
