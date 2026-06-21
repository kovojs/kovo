import { describe, expect, it } from 'vitest';

import { parseJsonValue } from './json.js';

describe('parseJsonValue — wire codec reviver (bugs-part4 L3/L4/L5)', () => {
  it('L5: a tagged Date round-trips as a Date instance', () => {
    const wire = '{"at":{"$kovo":"date","value":"2020-01-02T03:04:05.678Z"}}';
    const parsed = parseJsonValue(wire);

    expect(parsed.ok).toBe(true);
    const value = (parsed as { ok: true; value: { at: unknown } }).value;
    expect(value.at).toBeInstanceOf(Date);
    expect((value.at as Date).getTime()).toBe(Date.parse('2020-01-02T03:04:05.678Z'));
    expect((value.at as Date).toISOString()).toBe('2020-01-02T03:04:05.678Z');
  });

  it('L5: a null tagged Date revives to an invalid Date', () => {
    const parsed = parseJsonValue('{"at":{"$kovo":"date","value":null}}');
    const value = (parsed as { ok: true; value: { at: unknown } }).value;
    expect(value.at).toBeInstanceOf(Date);
    expect(Number.isNaN((value.at as Date).getTime())).toBe(true);
  });

  it('L3/L4: a tagged bigint revives to a bigint', () => {
    const parsed = parseJsonValue('{"count":{"$kovo":"bigint","value":"10"}}');
    const value = (parsed as { ok: true; value: { count: unknown } }).value;
    expect(typeof value.count).toBe('bigint');
    expect(value.count).toBe(10n);
  });

  it('revives tagged values nested in arrays and objects', () => {
    const wire =
      '{"rows":[{"id":{"$kovo":"bigint","value":"1"},"at":{"$kovo":"date","value":"2021-06-01T00:00:00.000Z"}}]}';
    const parsed = parseJsonValue(wire);
    const value = (parsed as { ok: true; value: { rows: { id: unknown; at: unknown }[] } }).value;
    expect(value.rows[0]!.id).toBe(1n);
    expect(value.rows[0]!.at).toBeInstanceOf(Date);
  });

  it('does NOT revive ordinary app data that merely carries a $kovo key', () => {
    // Extra keys beyond the discriminator + value => left as a plain object.
    const parsed = parseJsonValue('{"$kovo":"date","value":"2020-01-01T00:00:00.000Z","extra":1}');
    const value = (parsed as { ok: true; value: Record<string, unknown> }).value;
    expect(value).toEqual({ $kovo: 'date', value: '2020-01-01T00:00:00.000Z', extra: 1 });
  });

  it('does NOT revive an unknown tag', () => {
    const parsed = parseJsonValue('{"$kovo":"thing","value":"x"}');
    const value = (parsed as { ok: true; value: unknown }).value;
    expect(value).toEqual({ $kovo: 'thing', value: 'x' });
  });

  it('leaves plain JSON values untouched', () => {
    const parsed = parseJsonValue('{"count":2,"items":[{"id":"p1"}]}');
    expect((parsed as { ok: true; value: unknown }).value).toEqual({
      count: 2,
      items: [{ id: 'p1' }],
    });
  });

  it('reports malformed JSON as an error result', () => {
    const parsed = parseJsonValue('{not json');
    expect(parsed.ok).toBe(false);
  });
});
