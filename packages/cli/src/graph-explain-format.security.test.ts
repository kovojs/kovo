import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import type * as CoreGraph from '@kovojs/core/internal/graph';

import {
  hasStaticHandlerWriteSinkDiagnostic,
  resolvedHandlerWriteSinkMessage,
} from './graph-explain-format.js';
import { kovoCheck } from './graph-output.js';

describe('CLI graph security diagnostic authority', () => {
  it('keeps KV330 handler-write findings visible after late Set.has poisoning', () => {
    const originalHas = Set.prototype.has;
    let observed = false;

    try {
      Set.prototype.has = () => false;
      observed = hasStaticHandlerWriteSinkDiagnostic([
        {
          code: 'KV330',
          message: resolvedHandlerWriteSinkMessage('task'),
          severity: 'error',
          site: 'src/tasks/admin.ts:12',
        } as CoreGraph.StaticDiagnosticFact,
      ]);
    } finally {
      Set.prototype.has = originalHas;
    }

    expect(observed).toBe(true);
  });

  it('fails closed before late Array.filter poisoning can hide missing access', () => {
    const originalFilter = Array.prototype.filter;
    let result: ReturnType<typeof kovoCheck> | undefined;

    try {
      Array.prototype.filter = () => [];
      result = kovoCheck({
        access: [
          {
            decision: 'missing',
            detail: 'no access property',
            kind: 'query',
            name: 'cart',
            site: 'cart.query.ts:4',
            source: 'access',
          },
        ],
      });
    } finally {
      Array.prototype.filter = originalFilter;
    }

    expect(result?.exitCode).toBe(1);
    expect(result?.output).toContain('ERROR SECURITY Kovo verifier security boundary rejected');
    expect(result?.output).not.toContain('\nOK\n');
  });

  it('fails closed before iterator prototype poisoning can skip graph findings', () => {
    const iteratorPrototype = Object.getPrototypeOf([][Symbol.iterator]()) as {
      next: () => IteratorResult<unknown>;
    };
    const originalNext = iteratorPrototype.next;
    let result: ReturnType<typeof kovoCheck> | undefined;

    try {
      iteratorPrototype.next = () => ({ done: true, value: undefined });
      result = kovoCheck({
        access: [
          {
            decision: 'missing',
            detail: 'no access property',
            kind: 'query',
            name: 'cart',
            site: 'cart.query.ts:4',
            source: 'access',
          },
        ],
      });
    } finally {
      iteratorPrototype.next = originalNext;
    }

    expect(result?.exitCode).toBe(1);
    expect(result?.output).toContain('ERROR SECURITY Kovo verifier security boundary rejected');
    expect(result?.output).not.toContain('\nOK\n');
  });

  it('rejects accessor graph facts without invoking them', () => {
    let reads = 0;
    const input = {};
    Object.defineProperty(input, 'access', {
      enumerable: true,
      get() {
        reads += 1;
        return reads <= 2
          ? [
              {
                decision: 'missing',
                detail: 'no access property',
                kind: 'query',
                name: 'cart',
                site: 'cart.query.ts:4',
                source: 'access',
              },
            ]
          : [];
      },
    });

    const result = kovoCheck(input);

    expect(reads).toBe(0);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('ERROR SECURITY Kovo verifier security boundary rejected');
  });

  it('accepts the supported runner lockdown while preserving KV436', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-cli-graph-security-'));
    try {
      const graphPath = join(root, 'graph.json');
      writeFileSync(
        graphPath,
        JSON.stringify({
          access: [
            {
              decision: 'missing',
              detail: 'no access property',
              kind: 'query',
              name: 'cart',
              site: 'cart.query.ts:4',
              source: 'access',
            },
          ],
        }),
      );
      const result = spawnSync(
        process.execPath,
        [
          '--disable-warning=ExperimentalWarning',
          '--experimental-transform-types',
          fileURLToPath(new URL('./bin.ts', import.meta.url)),
          'check',
          graphPath,
        ],
        {
          encoding: 'utf8',
          env: { ...process.env, KOVO_CLI_TRANSFORM_TYPES: '1' },
        },
      );

      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toContain('ERROR KV436 QUERY cart');
      expect(result.stderr).not.toContain('ERROR SECURITY');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
