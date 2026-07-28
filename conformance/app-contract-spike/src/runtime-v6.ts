import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import type { AppContractArm, PrototypeFixture } from './fixture-v6.ts';

export interface RuntimeArmEvidence {
  readonly assembledHandleCount: number;
  readonly crossAppError: string;
  readonly ownedFamilies: readonly string[];
  readonly ownerKey: string;
  readonly providerEvaluationCount: number;
}

export async function runtimeEvidence(
  fixture: PrototypeFixture,
  arm: AppContractArm,
): Promise<RuntimeArmEvidence> {
  const providerRuntimeFile = join(fixture.app, 'src/provider.js');
  const providerRuntimeSource = (await readFile(join(fixture.app, 'src/provider.ts'), 'utf8')).replace(
    /\s+as const/gu,
    '',
  );
  await writeFile(providerRuntimeFile, providerRuntimeSource);
  const script = join(fixture.app, `runtime-evidence-${arm}.mjs`);
  const runtimeSpecifier = moduleRelative(fixture.app, fixture.runtimeEntries[arm]);
  const providerSpecifier = moduleRelative(fixture.app, fixture.providerFile);
  await writeFile(
    script,
    [
      'globalThis.__d1ProviderEvaluations = 0;',
      `const declarations = await import(${JSON.stringify(runtimeSpecifier)});`,
      `const { app } = await import(${JSON.stringify(providerSpecifier)});`,
      "const { defineKovo, inspectD1Ownership } = await import('@kovojs/server');",
      'const handles = {',
      '  endpoint: declarations.endpointHandle,',
      '  layout: declarations.layoutHandle,',
      '  mutation: declarations.mutationHandle,',
      '  query: declarations.queryHandle,',
      '  route: declarations.routeHandle,',
      '  task: declarations.taskHandle,',
      '};',
      'const assembled = app.assemble({',
      '  endpoints: [handles.endpoint],',
      '  layouts: [handles.layout],',
      '  mutations: [handles.mutation],',
      '  queries: [handles.query],',
      '  routes: [handles.route],',
      '  tasks: [handles.task],',
      '});',
      'const other = defineKovo({',
      "  appId: '00000000-0000-4000-8000-000000000002',",
      "  providerKey: 'other-provider',",
      '});',
      "let crossAppError = '';",
      'try { other.assemble({ queries: [handles.query] }); }',
      'catch (error) { crossAppError = error instanceof Error ? error.message : String(error); }',
      'const ownedFamilies = Object.entries(handles)',
      '  .filter(([, handle]) => inspectD1Ownership(handle)?.ownerKey === assembled.ownerKey)',
      '  .map(([family]) => family)',
      '  .sort();',
      'process.stdout.write(JSON.stringify({',
      '  assembledHandleCount: assembled.handleCount,',
      '  crossAppError,',
      '  ownedFamilies,',
      '  ownerKey: assembled.ownerKey,',
      '  providerEvaluationCount: globalThis.__d1ProviderEvaluations,',
      '}));',
      '',
    ].join('\n'),
  );
  const result = spawnSync(process.execPath, ['--experimental-strip-types', script], {
    cwd: fixture.app,
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  if (result.status !== 0) {
    throw new Error(`D1 v6 ${arm} runtime failed:\n${result.stdout}${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout) as RuntimeArmEvidence;
  if (
    typeof parsed.assembledHandleCount !== 'number' ||
    !Array.isArray(parsed.ownedFamilies) ||
    typeof parsed.ownerKey !== 'string' ||
    typeof parsed.providerEvaluationCount !== 'number'
  ) {
    throw new Error(`D1 v6 ${arm} runtime evidence was malformed.`);
  }
  return parsed;
}

function moduleRelative(from: string, to: string): string {
  const path = relative(from, to).replaceAll('\\', '/');
  return path.startsWith('.') ? path : `./${path}`;
}
