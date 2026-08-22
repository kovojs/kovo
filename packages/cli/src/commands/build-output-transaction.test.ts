import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { snapshotKovoInvocationEnvironment } from '../invocation-environment.js';
import {
  abortKovoBuildOutputTransaction,
  createKovoBuildOutputTransaction,
  promoteKovoBuildOutputTransaction,
  sealKovoBuildOutputTransaction,
  writeKovoBuildDebugEvidence,
} from './build-export.js';

describe('transactional build output (SPEC §5.2.4)', () => {
  it('promotes one complete staging tree and removes the previous output', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-build-transaction-'));
    const outDir = join(root, 'dist');
    mkdirSync(outDir);
    writeFileSync(join(outDir, 'marker'), 'last-good');
    const transaction = createKovoBuildOutputTransaction(outDir);
    writeFileSync(join(transaction.stagedOutDir, 'marker'), 'next-complete');

    try {
      sealKovoBuildOutputTransaction(transaction);
      promoteKovoBuildOutputTransaction(transaction);
      expect(readFileSync(join(outDir, 'marker'), 'utf8')).toBe('next-complete');
      expect(existsSync(transaction.stagedOutDir)).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('restores the last good output when promotion cannot consume staging', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-build-rollback-'));
    const outDir = join(root, 'dist');
    mkdirSync(outDir);
    writeFileSync(join(outDir, 'marker'), 'last-good');
    const transaction = createKovoBuildOutputTransaction(outDir);
    sealKovoBuildOutputTransaction(transaction);
    rmSync(transaction.stagedOutDir, { force: true, recursive: true });

    try {
      expect(() => promoteKovoBuildOutputTransaction(transaction)).toThrow();
      expect(readFileSync(join(outDir, 'marker'), 'utf8')).toBe('last-good');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('keeps client/server crash staging non-promotable until the final process seals it', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-build-unsealed-crash-'));
    const outDir = join(root, 'dist');
    mkdirSync(outDir);
    writeFileSync(join(outDir, 'marker'), 'last-good');
    const clientCrash = createKovoBuildOutputTransaction(outDir);
    mkdirSync(join(clientCrash.stagedOutDir, '.kovo', 'server'), { recursive: true });
    writeFileSync(
      join(clientCrash.stagedOutDir, '.kovo', 'server', 'handler.mjs'),
      "throw new Error('Kovo build server handler was not finalized.');\n",
    );

    try {
      expect(() => promoteKovoBuildOutputTransaction(clientCrash)).toThrow(
        'not sealed for promotion',
      );
      expect(readFileSync(join(outDir, 'marker'), 'utf8')).toBe('last-good');
      expect(existsSync(clientCrash.stagedOutDir)).toBe(true);

      // A server crash after replacing only some bytes is still just an unsealed sibling stage.
      writeFileSync(
        join(clientCrash.stagedOutDir, '.kovo', 'server', 'handler.mjs'),
        'export const partiallyWritten = true;\n',
      );
      expect(() => promoteKovoBuildOutputTransaction({ ...clientCrash })).toThrow(
        'not sealed for promotion',
      );
      expect(readFileSync(join(outDir, 'marker'), 'utf8')).toBe('last-good');

      abortKovoBuildOutputTransaction(clientCrash);
      expect(existsSync(clientCrash.stagedOutDir)).toBe(false);
      expect(readFileSync(join(outDir, 'marker'), 'utf8')).toBe('last-good');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('does not accept a copied sealed boolean as promotion authority', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-build-copied-seal-'));
    const outDir = join(root, 'dist');
    const transaction = createKovoBuildOutputTransaction(outDir);
    writeFileSync(join(transaction.stagedOutDir, 'marker'), 'complete');

    try {
      sealKovoBuildOutputTransaction(transaction);
      expect(() => promoteKovoBuildOutputTransaction({ ...transaction })).toThrow(
        'not sealed for promotion',
      );
      expect(existsSync(outDir)).toBe(false);
      promoteKovoBuildOutputTransaction(transaction);
      expect(readFileSync(join(outDir, 'marker'), 'utf8')).toBe('complete');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('aborts validate-only and failed staging without touching output', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-build-abort-'));
    const outDir = join(root, 'dist');
    mkdirSync(outDir);
    writeFileSync(join(outDir, 'marker'), 'last-good');
    const transaction = createKovoBuildOutputTransaction(outDir);
    writeFileSync(join(transaction.stagedOutDir, 'partial'), 'not-deployable');

    try {
      abortKovoBuildOutputTransaction(transaction);
      expect(readFileSync(join(outDir, 'marker'), 'utf8')).toBe('last-good');
      expect(existsSync(transaction.stagedOutDir)).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('keeps opt-in failure evidence bounded, secret-free, and outside deploy output', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-build-debug-'));
    const outDir = join(root, 'dist');
    mkdirSync(outDir);
    writeFileSync(join(outDir, 'marker'), 'last-good');
    const transaction = createKovoBuildOutputTransaction(outDir);
    const secret = 'operator-secret-that-must-not-cross-the-debug-boundary';

    try {
      writeKovoBuildDebugEvidence(
        transaction,
        new Error(`${root} ${transaction.stagedOutDir} ${secret}`),
        {
          invocationCwd: root,
          invocationEnv: snapshotKovoInvocationEnvironment({
            KOVO_BUILD_DEBUG: '1',
            KOVO_SECRET: secret,
          }),
          paranoidStaticAdvisory: false,
        },
      );

      const debugPath = join(root, '.kovo', 'debug', transaction.buildId, 'build.json');
      const debugText = readFileSync(debugPath, 'utf8');
      expect(JSON.parse(debugText)).toEqual({
        buildId: transaction.buildId,
        errorClass: 'finding',
        message:
          'Kovo build failed before output promotion; rerun the same command for the producer-owned diagnostic.',
        schema: 'kovo.build-debug/v1',
        status: 'failed',
      });
      expect(debugText).not.toContain(root);
      expect(debugText).not.toContain(transaction.stagedOutDir);
      expect(debugText).not.toContain(secret);
      expect(existsSync(join(outDir, '.kovo'))).toBe(false);
      expect(readFileSync(join(outDir, 'marker'), 'utf8')).toBe('last-good');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
