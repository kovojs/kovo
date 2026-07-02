import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  generateParanoidGeneratorAcceptanceCases,
  type ParanoidGeneratorAcceptanceCase,
} from '../../../scripts/security-test-build-gate.mjs';
import { writeKovoProject } from './index.js';
import { buildParanoidProductionArtifact } from './index.build.test-support.js';
import {
  collectOutput,
  fetchTextWhenReady,
  linkStarterBuildDependencies,
  reservePort,
  stopProcess,
  withRepoBinOnPath,
} from './index.test-support.js';

describe('create-kovo starter (build integration: paranoid runtime chokes)', () => {
  // @kovo-security-certifies KV435 round-8-paranoid-generator-acceptance
  it('runs generated paranoid acceptance cases with static classifiers advisory', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-paranoid-runtime-'));
    const port = await reservePort();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      const paranoidCases = generateParanoidGeneratorAcceptanceCases();
      writeKovoProject(root, { name: 'Paranoid Runtime Proof' });
      addParanoidRuntimeProofRoutes(root, paranoidCases);
      linkStarterBuildDependencies(root);

      buildParanoidProductionArtifact(root);

      server = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: {
          ...withRepoBinOnPath(),
          HOST: '127.0.0.1',
          KOVO_PARANOID: '1',
          NODE_ENV: 'production',
          PORT: String(port),
        },
      });
      const output = collectOutput(server);
      const origin = `http://127.0.0.1:${port}`;

      const healthBody = await fetchTextWhenReady(`${origin}/api/health`, output);
      expect(healthBody).toContain('"ok":true');

      for (const testCase of paranoidCases) {
        await expectParanoidRuntimeCase(origin, testCase);
      }
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 180_000);
});

function addParanoidRuntimeProofRoutes(
  root: string,
  cases: readonly ParanoidGeneratorAcceptanceCase[],
): void {
  const routeLines = cases.flatMap((testCase) => {
    if (testCase.kind !== 'runtime-route') return [];
    if (testCase.route === '/paranoid-runtime-safe.txt') {
      return [
        "    route('/paranoid-runtime-safe.txt', {",
        "      access: publicAccess('public paranoid runtime safe route'),",
        '      page() {',
        "        return respond.file('paranoid runtime safe\\n', {",
        "          contentType: 'text/plain; charset=utf-8',",
        "          headers: { 'X-Kovo-Paranoid-Proof': 'safe' },",
        '        });',
        '      },',
        '    }),',
      ];
    }
    if (testCase.route === '/paranoid-runtime-unsafe-header.txt') {
      return [
        "    route('/paranoid-runtime-unsafe-header.txt', {",
        "      access: publicAccess('public paranoid runtime header choke proof'),",
        '      page() {',
        "        return respond.file('paranoid runtime unsafe header\\n', {",
        "          contentType: 'text/plain; charset=utf-8',",
        "          headers: { 'X-Kovo-Paranoid-Proof': 'unsafe\\r\\nSet-Cookie: paranoid=owned' },",
        '        });',
        '      },',
        '    }),',
      ];
    }
    if (testCase.route === '/paranoid-runtime-unsafe-helper.txt') {
      return [
        "    route('/paranoid-runtime-unsafe-helper.txt', {",
        "      access: publicAccess('public paranoid runtime helper header choke proof'),",
        '      page() {',
        "        return paranoidUnsafeFile('helper');",
        '      },',
        '    }),',
      ];
    }
    throw new Error(`Unhandled paranoid generator acceptance route ${testCase.route}.`);
  });
  if (routeLines.length === 0) {
    throw new Error('Expected generated paranoid runtime route cases.');
  }

  const appPath = join(root, 'src/app.tsx');
  const app = readFileSync(appPath, 'utf8');
  const withRespondImport = replaceRequired(
    app,
    '  redirect,\n  route,',
    '  redirect,\n  respond,\n  route,',
    'paranoid runtime proof response imports',
  );
  const withRoutes = replaceRequired(
    withRespondImport,
    "  routes: [\n    route('/', {",
    ['  routes: [', ...routeLines, "    route('/', {"].join('\n'),
    'paranoid runtime proof routes',
  );
  const withHelper = replaceRequired(
    withRoutes,
    '\nconst app = createApp({',
    [
      '',
      'function paranoidUnsafeFile(label: string) {',
      '  return respond.file(`paranoid runtime unsafe ${label}\\n`, {',
      "    contentType: 'text/plain; charset=utf-8',",
      "    headers: { 'X-Kovo-Paranoid-Proof': `unsafe-${label}\\r\\nSet-Cookie: paranoid=owned` },",
      '  });',
      '}',
      '',
      'const app = createApp({',
    ].join('\n'),
    'paranoid runtime helper wrapper',
  );
  writeFileSync(appPath, withHelper, 'utf8');
}

async function expectParanoidRuntimeCase(
  origin: string,
  testCase: ParanoidGeneratorAcceptanceCase,
): Promise<void> {
  if (testCase.kind === 'build-env') return;
  if (testCase.route === undefined) throw new Error(`Generated case ${testCase.id} has no route.`);

  const response = await fetch(`${origin}${testCase.route}`);
  const body = await response.text();
  if (testCase.expectation === 'legitimate-build-green') {
    expect(response.status, body).toBe(200);
    expect(body).toContain('paranoid runtime safe');
    expect(response.headers.get('x-kovo-paranoid-proof')).toBe('safe');
    return;
  }

  expect(testCase.expectation).toBe('unsafe-runtime-choke');
  expect(response.status, body).toBe(500);
  expect(response.headers.get('x-kovo-paranoid-proof')).toBeNull();
  expect(response.headers.getSetCookie()).toEqual([]);
  expect(body).toContain('Server Error');
  expect(body).not.toContain('Set-Cookie: paranoid=owned');
}

function replaceRequired(
  source: string,
  search: string,
  replacement: string,
  label: string,
): string {
  if (!source.includes(search)) throw new Error(`Expected scaffold anchor for ${label}.`);
  return source.replace(search, replacement);
}
