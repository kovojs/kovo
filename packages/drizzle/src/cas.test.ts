/**
 * KV429 runtime — compareAndSet unit tests.
 *
 * SPEC §10.3/§11.1 (KV429): the CAS helper folds check+act into one UPDATE…WHERE;
 * 0 rowsAffected → CasConflict; ≥1 rowsAffected → CasSuccess.
 */

import { describe, expect, it } from 'vitest';
import { compareAndSet } from './cas.js';

describe('compareAndSet (KV429)', () => {
  describe('CasSuccess: ≥1 row updated', () => {
    it('returns ok:true when rowCount is 1 (pg-style)', async () => {
      const result = await compareAndSet(Promise.resolve({ rowCount: 1 }));
      expect(result).toEqual({ ok: true });
    });

    it('returns ok:true when rowsAffected is 1 (generic style)', async () => {
      const result = await compareAndSet(Promise.resolve({ rowsAffected: 1 }));
      expect(result).toEqual({ ok: true });
    });

    it('returns ok:true when affectedRows is 1 (PGlite style)', async () => {
      const result = await compareAndSet(Promise.resolve({ affectedRows: 1 }));
      expect(result).toEqual({ ok: true });
    });

    it('returns ok:true when changes is 1 (sqlite-style)', async () => {
      const result = await compareAndSet(Promise.resolve({ changes: 1 }));
      expect(result).toEqual({ ok: true });
    });

    it('returns ok:true when multiple rows are affected', async () => {
      const result = await compareAndSet(Promise.resolve({ rowCount: 3 }));
      expect(result).toEqual({ ok: true });
    });

    it('accepts a non-Promise result directly', async () => {
      const result = await compareAndSet({ rowCount: 1 });
      expect(result).toEqual({ ok: true });
    });
  });

  describe('CasConflict: 0 rows updated — stale-version / lost-update race', () => {
    it('returns ok:false + conflict:true when rowCount is 0 (pg-style)', async () => {
      const result = await compareAndSet(Promise.resolve({ rowCount: 0 }));
      expect(result).toEqual({ ok: false, conflict: true });
    });

    it('returns ok:false + conflict:true when rowsAffected is 0 (generic style)', async () => {
      const result = await compareAndSet(Promise.resolve({ rowsAffected: 0 }));
      expect(result).toEqual({ ok: false, conflict: true });
    });

    it('returns ok:false + conflict:true when affectedRows is 0 (PGlite style)', async () => {
      const result = await compareAndSet(Promise.resolve({ affectedRows: 0 }));
      expect(result).toEqual({ ok: false, conflict: true });
    });

    it('returns ok:false + conflict:true when changes is 0 (sqlite-style)', async () => {
      const result = await compareAndSet(Promise.resolve({ changes: 0 }));
      expect(result).toEqual({ ok: false, conflict: true });
    });

    it('returns ok:false + conflict:true when all count fields are null/missing', async () => {
      const result = await compareAndSet(Promise.resolve({}));
      expect(result).toEqual({ ok: false, conflict: true });
    });

    it('returns ok:false + conflict:true when rowCount is null', async () => {
      const result = await compareAndSet(Promise.resolve({ rowCount: null }));
      expect(result).toEqual({ ok: false, conflict: true });
    });
  });

  describe('type narrowing', () => {
    it('ok:true result does not have a conflict property', async () => {
      const result = await compareAndSet(Promise.resolve({ rowCount: 1 }));
      if (result.ok) {
        // TypeScript: result is CasSuccess — no `conflict` key expected
        expect('conflict' in result).toBe(false);
      }
    });

    it('ok:false result has conflict:true', async () => {
      const result = await compareAndSet(Promise.resolve({ rowCount: 0 }));
      if (!result.ok) {
        expect(result.conflict).toBe(true);
      }
    });
  });
});
