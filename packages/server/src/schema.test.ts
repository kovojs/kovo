import { describe, expect, it, vi } from 'vitest';
import { File } from 'node:buffer';
import { trustedReveal, type JsonValue, type Secret, type StorageCapability } from '@kovojs/core';
import { createMemoryStorage, storageBodyToBytes } from '@kovojs/core/internal/storage';

import { runMutation } from './mutation.js';
import {
  SchemaValidationError,
  entriesToRecord,
  parseSchemaAsync,
  s,
  unsafeRegex,
  withSchemaInputBudget,
} from './schema.js';
import { testMutation as mutation } from './test-fixtures.js';

describe('server schemas', () => {
  it('keeps chained schema constraints immutable', () => {
    const baseNumber = s.number();
    const positiveInteger = baseNumber.int().min(1);
    const baseString = s.string();
    const shortSlug = baseString.slug().max(8);
    const baseArray = s.array(s.string());
    const shortArray = baseArray.max(2);

    expect(baseNumber.parse(0.5)).toBe(0.5);
    expect(() => positiveInteger.parse(0.5)).toThrow('Expected integer');
    expect(() => positiveInteger.parse(0)).toThrow('Expected number >= 1');
    expect(baseString.parse('Not A Slug')).toBe('Not A Slug');
    expect(shortSlug.parse('cart-1')).toBe('cart-1');
    expect(() => shortSlug.parse('cart!')).toThrow('Expected slug');
    expect(() => shortSlug.parse('cart-item')).toThrow('Expected string length <= 8');
    expect(baseArray.parse(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(() => shortArray.parse(['a', 'b', 'c'])).toThrow('Expected array length <= 2');

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

  it('validates blessed string formats without app-provided regular expressions', () => {
    expect(s.string().email().parse('ada@example.test')).toBe('ada@example.test');
    expect(() => s.string().email().parse('ada@@example.test')).toThrow('Expected email');
    expect(() => s.string().email().parse('ada@-example.test')).toThrow('Expected email');

    expect(s.string().url().parse('https://example.test/cart?q=1')).toBe(
      'https://example.test/cart?q=1',
    );
    expect(() => s.string().url().parse('javascript:alert(1)')).toThrow('Expected url');

    expect(s.string().uuid().parse('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    );
    expect(() => s.string().uuid().parse('550e8400-e29b-41d4-a716-44665544000z')).toThrow(
      'Expected uuid',
    );

    expect(s.string().slug().parse('cart-item-1')).toBe('cart-item-1');
    expect(() => s.string().slug().parse('Cart Item')).toThrow('Expected slug');
    expect(() => s.string().slug().parse('cart--item')).toThrow('Expected slug');
  });

  it('validates safe literal string patterns as full-string matches', () => {
    const sku = s.string().pattern('[A-Z]{3}-\\d{4}');

    expect(sku.parse('ABC-1234')).toBe('ABC-1234');
    expect(() => sku.parse('xABC-1234')).toThrow('Expected pattern');
    expect(() => sku.parse('ABC-1234x')).toThrow('Expected pattern');
  });

  it('rejects non-linear string patterns unless explicitly escaped', () => {
    expect(() => s.string().pattern('(a+)+')).toThrow(
      'Unsafe string pattern: nested quantified groups can backtrack exponentially',
    );
    expect(() => s.string().pattern('a+a+')).toThrow(
      'Unsafe string pattern: adjacent or overlapping quantified atoms can backtrack exponentially',
    );

    const escaped = s
      .string()
      .pattern(unsafeRegex(/^(a+)+$/u, 'legacy import accepts a reviewed bounded token'));
    expect(escaped.parse('aaa')).toBe('aaa');
  });

  it('bounds pattern inputs before executing a regex backstop', () => {
    const schema = s.string().pattern('[a-z]+');

    expect(() => schema.parse('a'.repeat(4_097))).toThrow(
      'Pattern input exceeds maximum length 4096',
    );
  });

  it('wraps schemas as Secret values outside JsonValue client payloads', () => {
    const schema = s.object({ passwordHash: s.secret(s.string()) });
    const parsed = schema.parse({ passwordHash: 'hash-1' });
    const assertSecretBoundary = () => {
      const _secret: Secret<string> = parsed.passwordHash;
      // @ts-expect-error SPEC §6.2/§9.2/§10.2: Secret<T> is not JsonValue.
      const _json: JsonValue = parsed.passwordHash;
    };

    expect(() => String(parsed.passwordHash)).toThrow(
      'Secret values cannot be coerced to strings.',
    );
    expect(() => JSON.stringify(parsed)).toThrow('Secret values cannot be serialized to JSON.');
    expect(
      trustedReveal(parsed.passwordHash, { justification: 'one-way digest shown to admins' }),
    ).toBe('hash-1');
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
    form.set('avatar', formDataFile([pngBytes()], 'avatar.png', 'image/png'));

    await expect(runMutation(uploadAvatar, form, {})).resolves.toEqual({
      changes: [],
      ok: true,
      rerunQueries: [],
      value: {
        name: 'avatar.png',
        size: 8,
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
    form.set('avatar', formDataFile([pngBytes()], 'avatar.png', 'image/png'));

    await expect(runMutation(uploadAvatar, form, {})).resolves.toEqual({
      changes: [],
      ok: true,
      rerunQueries: [],
      value: {
        contentType: 'image/png',
        key: 'avatars/avatar.png',
        name: 'avatar.png',
        size: 8,
      },
    });
    await expect(storage.get('avatars/avatar.png')).resolves.toMatchObject({
      contentType: 'image/png',
      key: 'avatars/avatar.png',
      metadata: { filename: 'avatar.png' },
      size: 8,
    });
    const stored = await storage.get('avatars/avatar.png');
    await expect(storageBodyToBytes(stored?.body ?? '')).resolves.toEqual(pngBytes());
  });

  it('stores server-sniffed MIME instead of the client-declared file type', async () => {
    const storage = createMemoryStorage();
    const upload = s.file().store({
      key: 'uploads/report.pdf',
      storage,
    });
    const file = formDataFile(['%PDF-1.7\n'], 'report.pdf', 'image/png');

    await expect(parseSchemaAsync(upload, file)).resolves.toMatchObject({
      storage: { contentType: 'application/pdf' },
    });
    await expect(storage.get('uploads/report.pdf')).resolves.toMatchObject({
      contentType: 'application/pdf',
      metadata: { filename: 'report.pdf' },
    });
  });

  it('falls back to application/octet-stream for unsniffed upload bytes', async () => {
    const storage = createMemoryStorage();
    const upload = s.file().store({
      key: 'uploads/payload.bin',
      storage,
    });
    const file = formDataFile([new Uint8Array([0, 1, 2, 3])], 'payload.bin', 'image/png');

    await expect(parseSchemaAsync(upload, file)).resolves.toMatchObject({
      storage: { contentType: 'application/octet-stream' },
    });
    await expect(storage.get('uploads/payload.bin')).resolves.toMatchObject({
      contentType: 'application/octet-stream',
    });
  });

  it('does not trust SVG upload bytes as a safe inline image MIME', async () => {
    const svg = formDataFile(
      ['<svg><script>alert(1)</script></svg>'],
      'avatar.svg',
      'image/svg+xml',
    );

    await expect(parseSchemaAsync(s.file().mime(['image/svg+xml']), svg)).rejects.toThrow(
      'Expected file type image/svg+xml',
    );
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
    form.append('photos', formDataFile([pngBytes()], 'one.png', 'image/png'));
    form.append('photos', formDataFile([pngBytes()], '../../etc/evil.png', 'image/png'));

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

  // Phase 6 / SPEC §9.4, §10.2, §10.3: request-derived records used by schema
  // coercion are null-prototype and reject prototype-pollution keys before assignment.
  it('builds schema records and parsed objects with null prototypes', () => {
    const record = entriesToRecord([['title', 'hello']]);
    const parsed = s.object({ title: s.string() }).parse({ title: 'hello' });

    expect(Object.getPrototypeOf(record)).toBeNull();
    expect(record.title).toBe('hello');
    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(parsed.title).toBe('hello');
  });

  it('rejects prototype-pollution keys before assigning FormData fields', () => {
    expect(() =>
      entriesToRecord([
        ['__proto__', 'attacker-a'],
        ['title', 'hello'],
      ]),
    ).toThrow('Forbidden object key "__proto__"');
    expect(() => entriesToRecord([['constructor', 'attacker']])).toThrow(
      'Forbidden object key "constructor"',
    );
    expect(() => entriesToRecord([['prototype', 'attacker']])).toThrow(
      'Forbidden object key "prototype"',
    );
    expect(Object.prototype).not.toHaveProperty('attacker-a');
  });

  it('rejects prototype-pollution keys in JSON-shaped and nested object coercion', () => {
    const topLevel = s.object({ title: s.string() });
    const nested = s.object({ profile: s.object({ name: s.string() }) });
    const dangerousJson = JSON.parse('{"title":"hello","__proto__":"attacker"}') as unknown;

    expect(() => topLevel.parse(dangerousJson)).toThrow('Forbidden object key "__proto__"');
    let nestedError: unknown;
    try {
      nested.parse({
        profile: JSON.parse('{"name":"Ada","constructor":"attacker"}') as unknown,
      });
    } catch (error) {
      nestedError = error;
    }
    expect(nestedError).toMatchObject({
      issues: [{ message: 'Forbidden object key "constructor"', path: ['profile'] }],
    });
  });

  it('rejects JSON-shaped inputs that exceed the shared schema runtime budget', () => {
    const schema = s.object({ payload: s.object({}) });

    expect(() => schema.parse({ payload: nestedObject(33) })).toThrow(SchemaValidationError);
    expect(() => schema.parse({ payload: nestedObject(33) })).toThrow(
      'Input exceeds maximum depth 32',
    );
    expect(() => s.array(s.string()).parse(new Array(1_001).fill('tag'))).toThrow(
      'Input exceeds maximum breadth 1000',
    );
    expect(() =>
      withSchemaInputBudget({ maxNodes: 4 }, () =>
        s.object({ payload: s.array(s.string()) }).parse({ payload: ['a', 'b', 'c'] }),
      ),
    ).toThrow('Input exceeds maximum node count 4');
  });

  it('rejects FormData key expansion that exceeds the shared schema runtime budget', () => {
    const form = new FormData();
    for (let index = 0; index <= 1_000; index += 1) {
      form.append(`field-${index}`, 'value');
    }

    expect(() => s.object({ title: s.string() }).parse(form)).toThrow(
      'Input exceeds maximum breadth 1000',
    );
  });

  it('applies scoped schema runtime budget overrides to sync and async parsing', async () => {
    const payload = { tags: ['a', 'b', 'c'] };
    const schema = s.object({ tags: s.array(s.string()) });

    expect(() => withSchemaInputBudget({ maxBreadth: 2 }, () => schema.parse(payload))).toThrow(
      'Input exceeds maximum breadth 2',
    );
    expect(schema.parse(payload)).toEqual({ tags: ['a', 'b', 'c'] });
    await expect(
      withSchemaInputBudget({ maxBreadth: 2 }, () => parseSchemaAsync(schema, payload)),
    ).rejects.toThrow('Input exceeds maximum breadth 2');
    await expect(
      withSchemaInputBudget({ maxBreadth: 4 }, () => parseSchemaAsync(schema, payload)),
    ).resolves.toEqual({ tags: ['a', 'b', 'c'] });
  });

  it('rejects invalid schema runtime budget ceilings', () => {
    expect(() => withSchemaInputBudget({ maxBreadth: 0 }, () => undefined)).toThrow(
      'Schema input budget maxBreadth must be a positive integer',
    );
    expect(() => withSchemaInputBudget({ maxDepth: 1.5 }, () => undefined)).toThrow(
      'Schema input budget maxDepth must be a positive integer',
    );
    expect(() => withSchemaInputBudget({ maxNodes: -1 }, () => undefined)).toThrow(
      'Schema input budget maxNodes must be a positive integer',
    );
  });

  it('keeps safe inherited-name FormData fields as own null-prototype data', () => {
    const record = entriesToRecord([['toString', 'only']]);

    expect(Object.getPrototypeOf(record)).toBeNull();
    expect(record['toString']).toBe('only');
  });
});

function pngBytes(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function formDataFile(bits: BlobPart[], name: string, type: string): Blob {
  return new File(bits, name, { type }) as unknown as Blob;
}

function nestedObject(depth: number): Record<string, unknown> {
  let value: Record<string, unknown> = {};
  for (let index = 0; index < depth; index += 1) {
    value = { child: value };
  }
  return value;
}
