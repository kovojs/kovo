// @kovo-security-classifier-corpus postgres-identity-posture
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  checkPostgresRlsEmissionDoor,
  loadPostgresRlsEmissionDoorInput,
} from './check-postgres-rls-emission-door.mjs';

describe('Postgres RLS emission-door census', () => {
  it('accepts the exact production census at the checked-out revision', () => {
    const result = checkPostgresRlsEmissionDoor();
    expect(result.findings).toEqual([]);
    expect(result).toMatchObject({
      ok: true,
      rawRendererCount: 3,
      runtimeCallCount: 5,
      siteCount: 5,
    });
  });

  it('rejects a sixth raw CREATE POLICY emitter in any production package', () => {
    const files = cleanFixture();
    files.set(
      'packages/core/src/rogue-policy.ts',
      `export const policy = \`CREATE POLICY rogue ON secrets USING (true)\`;`,
    );

    expect(checkPostgresRlsEmissionDoor({ files }).findings).toContain(
      'packages/core/src/rogue-policy.ts:1: raw CREATE POLICY SQL is outside the sole reviewed renderer packages/server/src/postgres-authorization-correspondence.ts',
    );
  });

  it('treats shipped starter source as production for the emission census', () => {
    const files = cleanFixture();
    files.set(
      'packages/create-kovo/templates/src/rogue-policy.ts',
      `export const policy = \`CREATE POLICY starter_rogue ON secrets USING (true)\`;`,
    );

    expect(checkPostgresRlsEmissionDoor({ files }).findings).toContain(
      'packages/create-kovo/templates/src/rogue-policy.ts:1: raw CREATE POLICY SQL is outside the sole reviewed renderer packages/server/src/postgres-authorization-correspondence.ts',
    );
  });

  it('kills the split-literal raw-emitter mutant', () => {
    const files = cleanFixture();
    files.set(
      'packages/better-auth/src/rogue-policy.ts',
      `export const policy = 'CREATE ' + 'POLICY rogue ON secrets USING (true)';`,
    );

    expect(checkPostgresRlsEmissionDoor({ files }).findings).toContain(
      'packages/better-auth/src/rogue-policy.ts:1: statically concatenated CREATE POLICY SQL is outside the sole reviewed renderer',
    );
  });

  it('kills PostgreSQL comment-separated CREATE POLICY spellings', () => {
    const files = cleanFixture();
    files.set(
      'packages/core/src/rogue-policy.ts',
      `export const policy = \`CREATE/**/POLICY rogue ON secrets USING (true)\`;`,
    );

    expect(checkPostgresRlsEmissionDoor({ files })).toMatchObject({ ok: false });
  });

  it.each([
    `export const policy = \`CREATE-- separator\nPOLICY rogue ON secrets USING (true)\`;`,
    `export const policy = \`CREATE/* outer /* nested */ comment */POLICY rogue ON secrets USING (true)\`;`,
  ])('kills adjacent PostgreSQL trivia spellings', (source) => {
    const files = cleanFixture();
    files.set('packages/core/src/rogue-policy.ts', source);

    expect(checkPostgresRlsEmissionDoor({ files })).toMatchObject({ ok: false });
  });

  it('kills statically joined CREATE POLICY spellings', () => {
    const files = cleanFixture();
    files.set(
      'packages/core/src/rogue-policy.ts',
      `export const policy = ['CREATE', 'POLICY rogue ON secrets USING (true)'].join(' ');`,
    );

    expect(checkPostgresRlsEmissionDoor({ files })).toMatchObject({ ok: false });
  });

  it('kills const-bound arrays and concat spellings', () => {
    const files = cleanFixture();
    files.set(
      'packages/core/src/rogue-policy.ts',
      `const words = ['CREATE', 'POLICY']; export const policy = words.join(' ').concat(' rogue ON secrets');`,
    );

    expect(checkPostgresRlsEmissionDoor({ files })).toMatchObject({ ok: false });
  });

  it('kills const-bound CREATE POLICY template spellings', () => {
    const files = cleanFixture();
    files.set(
      'packages/core/src/rogue-policy.ts',
      `const keyword = 'POLICY'; export const policy = \`CREATE \${keyword} rogue ON secrets USING (true)\`;`,
    );

    expect(checkPostgresRlsEmissionDoor({ files })).toMatchObject({ ok: false });
  });

  it.each([
    `export const policy = \`ALTER POLICY kovo_owner_scope ON secrets USING (true)\`;`,
    `export const policy = ['DROP', 'POLICY kovo_owner_scope ON secrets'].join(' ');`,
  ])('kills statically visible policy mutations outside the reviewed emitter', (source) => {
    const files = cleanFixture();
    files.set('packages/core/src/rogue-policy.ts', source);

    expect(checkPostgresRlsEmissionDoor({ files })).toMatchObject({ ok: false });
  });

  it('kills computed namespace access to the reviewed emitter', () => {
    const files = cleanFixture();
    files.set(
      'packages/server/src/rogue-policy.ts',
      `
import * as rls from './postgres-authorization-correspondence.js';
export function rogue(input) { return rls['emitPostgresRlsPolicySql']({ ...input, site: 'owner' }); }
`,
    );

    expect(checkPostgresRlsEmissionDoor({ files })).toMatchObject({ ok: false });
  });

  it('kills barrel re-exports and aliases of the reviewed emitter', () => {
    const files = cleanFixture();
    files.set(
      'packages/server/src/rls-barrel.ts',
      `export * from './postgres-authorization-correspondence.js';`,
    );
    files.set(
      'packages/server/src/rogue-policy.ts',
      `import { emitPostgresRlsPolicySql as emit } from './rls-barrel.js'; export const rogue = emit;`,
    );

    expect(checkPostgresRlsEmissionDoor({ files })).toMatchObject({ ok: false });
  });

  it.each([
    `export const load = () => import('./postgres-authorization-correspondence.js');`,
    `export const load = () => require('./postgres-authorization-correspondence.js');`,
    `const moduleName = './postgres-' + 'authorization-correspondence.js'; export const load = () => import(moduleName);`,
    `const moduleName = new URL('./postgres-authorization-correspondence.js', import.meta.url); export const load = () => import(moduleName.href);`,
  ])('kills dynamic access to the correspondence module', (source) => {
    const files = cleanFixture();
    files.set('packages/server/src/rogue-policy.ts', source);

    expect(checkPostgresRlsEmissionDoor({ files })).toMatchObject({ ok: false });
  });

  it('uses symbol identity rather than rejecting an unrelated same-spelled local', () => {
    const files = cleanFixture();
    files.set(
      'packages/core/src/unrelated.ts',
      `function emitPostgresRlsPolicySql() { return 'not SQL'; } export const value = emitPostgresRlsPolicySql();`,
    );

    expect(checkPostgresRlsEmissionDoor({ files }).findings).toEqual([]);
  });

  it('kills a live sixth policy installed through an alias of the private renderer', () => {
    const files = cleanFixture();
    files.set(
      emitterFile,
      `${files.get(emitterFile)}
const emitSixthPolicySql = primaryPolicySql;
export { emitSixthPolicySql };
`,
    );
    files.set(
      runtimeFile,
      files
        .get(runtimeFile)
        .replace(
          'import { emitPostgresRlsPolicySql }',
          'import { emitPostgresRlsPolicySql, emitSixthPolicySql }',
        )
        .replace(
          "  emitPostgresRlsPolicySql({ site: 'admin' });",
          "  emitPostgresRlsPolicySql({ site: 'admin' });\n  client.exec(emitSixthPolicySql('secrets', 'kovo_rogue_scope', 'true', 'reader', 'writer'));",
        ),
    );

    expect(checkPostgresRlsEmissionDoor({ files })).toMatchObject({ ok: false });
  });

  it('treats shipped root config and script templates as part of the census', () => {
    const files = cleanFixture();
    files.set(
      'packages/create-kovo/templates/kovo.config.ts',
      `export const policy = \`CREATE POLICY starter_rogue ON secrets USING (true)\`;`,
    );

    expect(checkPostgresRlsEmissionDoor({ files })).toMatchObject({ ok: false });
  });

  it('kills a sixth reviewed-emitter call even when it reuses a known site', () => {
    const files = cleanFixture();
    files.set(
      'packages/server/src/rogue-policy.ts',
      `
import { emitPostgresRlsPolicySql as emit } from './postgres-authorization-correspondence.js';
export function rogue(input) { return emit({ ...input, site: 'owner' }); }
`,
    );

    expect(checkPostgresRlsEmissionDoor({ files }).findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'emitPostgresRlsPolicySql may be imported only by packages/server/src/postgres-runtime.ts',
        ),
        expect.stringContaining(
          'emitPostgresRlsPolicySql() may be called only by packages/server/src/postgres-runtime.ts',
        ),
        expect.stringContaining(
          'RLS emission must use the direct reviewed emitPostgresRlsPolicySql() binding',
        ),
      ]),
    );
  });

  it('kills a runtime-local alias that could hide a sixth constructor call', () => {
    const files = cleanFixture();
    files.set(
      runtimeFile,
      files
        .get(runtimeFile)
        .replace(
          'export function apply() {',
          'const hiddenEmitter = emitPostgresRlsPolicySql;\nexport function apply() {',
        )
        .replace(
          "  emitPostgresRlsPolicySql({ site: 'admin' });",
          "  emitPostgresRlsPolicySql({ site: 'admin' });\n  hiddenEmitter({ site: 'admin' });",
        ),
    );

    expect(checkPostgresRlsEmissionDoor({ files }).findings).toContain(
      'packages/server/src/postgres-runtime.ts:3: emitPostgresRlsPolicySql may not escape its direct reviewed call position',
    );
  });

  it('kills inventory and runtime-call cardinality mutants', () => {
    const files = cleanFixture();
    files.set(
      emitterFile,
      files
        .get(emitterFile)
        .replace("  'admin',", "  'admin',\n  'auditor',")
        .replace(
          "    case 'admin':",
          "    case 'auditor': return primaryPolicySql();\n    case 'admin':",
        ),
    );
    files.set(
      runtimeFile,
      files
        .get(runtimeFile)
        .replace(
          "  emitPostgresRlsPolicySql({ site: 'admin' });",
          "  emitPostgresRlsPolicySql({ site: 'owner' });\n  emitPostgresRlsPolicySql({ site: 'admin' });",
        ),
    );

    expect(checkPostgresRlsEmissionDoor({ files }).findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'emission inventory must be exactly [owner, ownerVia, authzPolicy, system, admin]',
        ),
        expect.stringContaining(
          'emitPostgresRlsPolicySql() cases must be exactly [owner, ownerVia, authzPolicy, system, admin]',
        ),
        expect.stringContaining('expected exactly five RLS constructor calls'),
      ]),
    );
  });

  it('does not mistake test fixtures for production emitters', () => {
    const files = cleanFixture();
    files.set(
      'packages/server/src/rogue-policy.test.ts',
      `expect('CREATE POLICY test_only ON fixture USING (true)').toBeTruthy();`,
    );
    expect(checkPostgresRlsEmissionDoor({ files }).findings).toEqual([]);
  });

  it('keeps the dedicated gate wired into pnpm check', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    );
    expect(packageJson.scripts['check:rls-emission-door']).toBe(
      'node scripts/check-postgres-rls-emission-door.mjs && vitest --run scripts/check-postgres-rls-emission-door.test.mjs --reporter=dot',
    );
    expect(packageJson.scripts.check).toContain('pnpm run check:rls-emission-door');
  });

  it('the loader census includes every current production package source', () => {
    const files = loadPostgresRlsEmissionDoorInput();
    expect(files.has(emitterFile)).toBe(true);
    expect(files.has(runtimeFile)).toBe(true);
    expect(files.has('packages/create-kovo/templates/src/app.tsx')).toBe(true);
    expect(files.has('packages/create-kovo/templates/kovo.config.ts')).toBe(true);
    expect(files.has('packages/create-kovo/templates/scripts/check-parallel.mjs')).toBe(true);
    expect([...files].some(([file]) => file.endsWith('.test.ts'))).toBe(false);
  });
});

const emitterFile = 'packages/server/src/postgres-authorization-correspondence.ts';
const runtimeFile = 'packages/server/src/postgres-runtime.ts';

function cleanFixture() {
  return new Map([
    [
      emitterFile,
      `
export const POSTGRES_RLS_SQL_EMISSION_SITES = Object.freeze([
  'owner',
  'ownerVia',
  'authzPolicy',
  'system',
  'admin',
] as const);
export function emitPostgresRlsPolicySql(input) {
  switch (input.site) {
    case 'owner': return primaryPolicySql();
    case 'ownerVia': return primaryPolicySql();
    case 'authzPolicy': return primaryPolicySql();
    case 'system': return \`CREATE POLICY kovo_system_scope ON \${input.table}\`;
    case 'admin': return \`CREATE POLICY kovo_admin_scope ON \${input.table}\`;
    default: throw new TypeError('unknown');
  }
}
function primaryPolicySql() { return \`CREATE POLICY \${name} ON \${table}\`; }
`,
    ],
    [
      runtimeFile,
      `
import { emitPostgresRlsPolicySql } from './postgres-authorization-correspondence.js';
export function apply() {
  emitPostgresRlsPolicySql({ site: 'owner' });
  emitPostgresRlsPolicySql({ site: 'ownerVia' });
  emitPostgresRlsPolicySql({ site: 'authzPolicy' });
  emitPostgresRlsPolicySql({ site: 'system' });
  emitPostgresRlsPolicySql({ site: 'admin' });
}
`,
    ],
  ]);
}
