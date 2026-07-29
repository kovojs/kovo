import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

import {
  APP_PUBLIC_ANY_EXCEPTIONS_SCHEMA,
  analyzeAppPublicAny,
  applyAnyExceptions,
} from './packed-public-any-gate.mjs';

const temporaryRoots = [];

function fixture(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'kovo-packed-any-'));
  temporaryRoots.push(root);
  for (const [relative, source] of Object.entries(files)) {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
  const publicFile = path.join(root, 'first-party', 'index.d.ts');
  const program = ts.createProgram([publicFile], {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  });
  return {
    program,
    entries: [
      {
        package: '@kovojs/fixture',
        specifier: '@kovojs/fixture',
        filePath: publicFile,
      },
    ],
    firstPartyRoots: [
      {
        package: '@kovojs/fixture',
        root: path.join(root, 'first-party'),
      },
    ],
  };
}

function exceptionConfig(exception) {
  return {
    schema: APP_PUBLIC_ANY_EXCEPTIONS_SCHEMA,
    exceptions: [
      {
        id: 'fixture-debt',
        package: '@kovojs/fixture',
        declarationPattern: '@kovojs/fixture/dist/index.d.ts',
        symbolPattern: '*',
        memberPattern: '*',
        maximumMatches: 1,
        owner: 'api-stewards',
        reason:
          'This synthetic reviewed debt exists only to exercise the descending exception protocol.',
        expires: '2026-12-31',
        ...exception,
      },
    ],
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('packed app-public any gate', () => {
  it('finds direct any and unwraps aliases through conditional wrappers', () => {
    const input = fixture({
      'first-party/hidden.d.ts': 'export type Hidden = { nested: any };',
      'first-party/index.d.ts': `
        import type { Hidden as PrivateAlias } from "./hidden.js";
        type Conditional<T> = T extends string ? PrivateAlias : never;
        export type Direct = { value: any };
        export type ThroughAlias = Conditional<string>;
      `,
    });
    const findings = analyzeAppPublicAny(input);
    expect(findings.map((finding) => finding.member)).toEqual(['nested', 'value']);
    expect(findings.find((finding) => finding.member === 'nested')?.aliasPath).toContain(
      'Conditional -> Hidden',
    );
  });

  it('does not treat comments containing the word any as syntax', () => {
    const input = fixture({
      'first-party/index.d.ts': `
        /** This comment says any but the declaration is concrete. */
        export type Safe = { value: string };
      `,
    });
    expect(analyzeAppPublicAny(input)).toEqual([]);
  });

  it('does not charge Kovo for any inside a third-party declaration', () => {
    const input = fixture({
      'external.d.ts': 'export interface External { loose: any }',
      'first-party/index.d.ts': `
        import type { External } from "../external.js";
        export type Public = External;
      `,
    });
    expect(analyzeAppPublicAny(input)).toEqual([]);
  });

  it('accepts only exact-count, owned, unexpired reviewed exceptions', () => {
    const anyFindings = [
      {
        package: '@kovojs/fixture',
        declaration: '@kovojs/fixture/dist/index.d.ts',
        line: 1,
        column: 1,
        symbol: 'Public',
        member: 'value',
        aliasPath: '@kovojs/fixture#Public',
      },
    ];
    expect(
      applyAnyExceptions(anyFindings, exceptionConfig(), { today: '2026-07-28' }).findings,
    ).toEqual([]);
  });

  it('fails on stale counts, expiry, and unapproved alias-hidden any', () => {
    const anyFindings = [
      {
        package: '@kovojs/fixture',
        declaration: '@kovojs/fixture/dist/hidden.d.ts',
        line: 2,
        column: 3,
        symbol: 'Hidden',
        member: 'value',
        aliasPath: '@kovojs/fixture#Public -> Hidden',
      },
    ];
    const result = applyAnyExceptions(
      anyFindings,
      exceptionConfig({ expires: '2026-07-27', maximumMatches: 2 }),
      { today: '2026-07-28' },
    );
    expect(result.findings).toContain('exceptions[0] expired on 2026-07-27');
    expect(result.findings).toContain(
      'exception fixture-debt match count is 0, expected exact descending maximum 2',
    );
    expect(
      result.findings.some(
        (finding) => finding.includes('exposes any via') && finding.includes('Hidden'),
      ),
    ).toBe(true);
  });
});
