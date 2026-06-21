import { describe, expect, it, vi } from 'vitest';
import { File } from 'node:buffer';
import type { StorageCapability } from '@kovojs/core';
import { createMemoryStorage, storageBodyToBytes } from '@kovojs/core/internal/storage';

import { runMutation } from './mutation.js';
import { entriesToRecord, parseSchemaAsync, s } from './schema.js';
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
    const imageFile = baseFile.mime(['image/png']).maxBytes(10);

    expect(baseFile.parse(file)).toBe(file);
    expect(() => imageFile.parse(file)).toThrow('Expected file <= 10 bytes');
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
        avatar: s.file({ maxBytes: 16, mime: ['image/png'] }),
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

  it('stores multipart file fields through storage-backed s.file()', async () => {
    const storage = createMemoryStorage({ now: () => new Date('2026-06-11T12:00:00.000Z') });
    const uploadAvatar = mutation('profile/avatar', {
      input: s.object({
        avatar: s.file({ maxBytes: 16, mime: ['image/png'] }).store({
          key: (file) => `avatars/${file.name}`,
          storage,
        }),
      }),
      handler(input) {
        return {
          contentType: input.avatar.storage.contentType,
          key: input.avatar.key,
          name: input.avatar.file.name,
          size: input.avatar.storage.size,
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
        contentType: 'image/png',
        key: 'avatars/avatar.png',
        name: 'avatar.png',
        size: 6,
      },
    });
    await expect(storage.get('avatars/avatar.png')).resolves.toMatchObject({
      contentType: 'image/png',
      key: 'avatars/avatar.png',
      metadata: { filename: 'avatar.png' },
      size: 6,
    });
    const stored = await storage.get('avatars/avatar.png');
    expect(new TextDecoder().decode(await storageBodyToBytes(stored?.body ?? ''))).toBe('avatar');
  });

  it('does not store invalid multipart file fields', async () => {
    const storage = createMemoryStorage();
    const uploadAvatar = mutation('profile/avatar', {
      input: s.object({
        avatar: s.file().maxBytes(4).store({
          key: 'avatars/avatar.png',
          storage,
        }),
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
    await expect(storage.get('avatars/avatar.png')).resolves.toBeUndefined();
  });

  it('returns validation failures with field paths for schema errors', async () => {
    const uploadAvatar = mutation('profile/avatar', {
      input: s.object({
        avatar: s.file().maxBytes(4).mime(['image/png']),
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

  // M1: `s.array(s.file().store())` MUST run the async storing path for every item.
  // Before the fix `s.array` had no `parseAsync`, so `parseSchemaAsync` fell back to the
  // sync `parse`, which fabricated a `StoredFileUpload` without ever calling `storage.put`
  // (data loss) and without `normalizeStorageKey` (traversal-key passthrough).
  it('stores every item of an s.array(s.file().store()) and rejects traversal keys', async () => {
    const memory = createMemoryStorage({ now: () => new Date('2026-06-11T12:00:00.000Z') });
    const put = vi.fn<StorageCapability['put']>((key, body, options) =>
      memory.put(key, body, options),
    );
    const storage: StorageCapability = { ...memory, put };

    const schema = s.object({
      photos: s.array(
        s.file().store({
          key: (file) => `gallery/${file.name}`,
          storage,
        }),
      ),
    });
    const form = new FormData();
    form.append('photos', formDataFile(['one'], 'one.png', 'image/png'));
    form.append('photos', formDataFile(['evil'], '../../etc/evil.png', 'image/png'));

    // The traversal key reaches `storage.put`, where `normalizeStorageKey` rejects it.
    await expect(parseSchemaAsync(schema, form)).rejects.toThrow(/parent path segments/u);

    // `storage.put` was attempted once per file (was 0 before the fix — sync path skipped it).
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[0]?.[0]).toBe('gallery/one.png');
    expect(put.mock.calls[1]?.[0]).toBe('gallery/../../etc/evil.png');

    // The valid file actually landed in storage; the traversal file did not.
    await expect(memory.get('gallery/one.png')).resolves.toMatchObject({ key: 'gallery/one.png' });
  });

  // M1: the sync `parse` of a storing file schema must refuse to fabricate a result.
  it('refuses to store a file through the synchronous parse path', () => {
    const storing = s.file().store({ key: 'gallery/photo.png', storage: createMemoryStorage() });

    expect(() => storing.parse(formDataFile(['x'], 'photo.png', 'image/png'))).toThrow(
      /storing requires async parsing/u,
    );
  });

  // L1: a non-validation error thrown inside a field schema (e.g. a storage failure) must
  // NOT be wrapped into a SchemaValidationError — otherwise its raw `.message` leaks to the
  // client through the 422. It must re-throw unchanged so the caller routes it to the 500 path.
  it('re-throws non-validation field errors instead of leaking them as a 422', async () => {
    const leaky: ReturnType<typeof s.string> = {
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
    expect(record.toString).toBe(undefined);
  });

  it('does not misclassify prototype-chain keys as repeated FormData fields', () => {
    const record = entriesToRecord([
      ['constructor', 'first'],
      ['toString', 'only'],
    ]);

    // Before the fix `record['constructor']` read the inherited function, so the first
    // append took the array branch and produced `[<fn>, 'first']`.
    expect(record.constructor).toBe('first');
    expect(record.toString).toBe('only');
  });
});

function formDataFile(bits: string[], name: string, type: string): Blob {
  return new File(bits, name, { type }) as unknown as Blob;
}
