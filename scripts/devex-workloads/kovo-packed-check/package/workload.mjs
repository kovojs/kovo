import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const SOURCE_PATH = 'src/components/counter-island.tsx';
export const SOURCE_VARIANTS = Object.freeze([
  `/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { publicAccess, query, s } from '@kovojs/server';

export const benchmarkRevision = 0;
export const benchmarkQuery = query({
  access: publicAccess('DevEx packed reference query'),
  load: () => ({ label: 'ready' }),
  output: s.object({ label: s.string() }),
});

export const CounterIsland = component({
  queries: { benchmark: benchmarkQuery },
  state: () => ({ count: 0 }),
  render: ({ benchmark }, state) => (
    <button
      aria-label="increment benchmark counter"
      data-revision="zero"
      type="button"
      onClick={() => {
        state.count += 1;
      }}
    >
      {benchmark.label}: {state.count}
    </button>
  ),
});
`,
  `/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { publicAccess, query, s } from '@kovojs/server';

export const benchmarkRevision = 1;
export const benchmarkQuery = query({
  access: publicAccess('DevEx packed reference query'),
  load: () => ({ label: 'ready' }),
  output: s.object({ label: s.string() }),
});

export const CounterIsland = component({
  queries: { benchmark: benchmarkQuery },
  state: () => ({ count: 0 }),
  render: ({ benchmark }, state) => (
    <button
      aria-label="increment benchmark counter"
      data-revision="one"
      type="button"
      onClick={() => {
        state.count += 1;
      }}
    >
      {benchmark.label}: {state.count}
    </button>
  ),
});
`,
]);

export const SOURCE_DIAGNOSTIC_VARIANT = `/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { publicAccess, query, s } from '@kovojs/server';

export const benchmarkRevision = -1;
export const benchmarkQuery = query({
  access: publicAccess('DevEx packed reference query'),
  load: () => ({ label: 'ready' }),
  output: s.object({ label: s.string() }),
});

export const CounterIsland = component({
  queries: { benchmark: benchmarkQuery },
  state: () => ({ count: 0 }),
  render: ({ benchmark }, state) =>
    \`<button data-revision="diagnostic">\${benchmark.label}: \${state.count}</button>\`,
});
`;

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function timeInvocation(command) {
  if (process.platform === 'darwin') return ['/usr/bin/time', ['-l', ...command]];
  if (process.platform === 'linux') return ['/usr/bin/time', ['-v', ...command]];
  return null;
}

function peakRssBytes(stderr) {
  if (process.platform === 'darwin') {
    const match = /^\s*(\d+)\s+maximum resident set size\s*$/mu.exec(stderr);
    return match ? Number(match[1]) : null;
  }
  if (process.platform === 'linux') {
    const match = /^\s*Maximum resident set size \(kbytes\):\s*(\d+)\s*$/mu.exec(stderr);
    return match ? Number(match[1]) * 1024 : null;
  }
  return null;
}

function sourceAnalysisDigest(source) {
  return sha256(Buffer.from(source, 'utf16le'));
}

function failBuild(result) {
  if (result.status === 0 && !result.signal && !result.error) return;
  throw new Error(
    result.error?.message ??
      result.signal ??
      result.stderr?.trim() ??
      result.stdout?.trim() ??
      `kovo build exited ${String(result.status)}`,
  );
}

function materializeAuthenticatedLockfile() {
  const expected = readFileSync('benchmark-lock.yaml');
  let observed;
  try {
    observed = readFileSync('pnpm-lock.yaml');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    writeFileSync('pnpm-lock.yaml', expected, { flag: 'wx' });
    observed = readFileSync('pnpm-lock.yaml');
  }
  if (!observed.equals(expected)) {
    throw new Error('packed Kovo app lockfile does not match its authenticated source bytes');
  }
}

export function runVerifiedBuild() {
  materializeAuthenticatedLockfile();
  const cli = path.resolve('node_modules/@kovojs/cli/dist/bin.mjs');
  const command = [process.execPath, cli, 'build', './src/app.tsx', '--out', './dist'];
  const invocation = timeInvocation(command);
  const executable = invocation?.[0] ?? command[0];
  const args = invocation?.[1] ?? command.slice(1);
  const started = process.hrtime.bigint();
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
  failBuild(result);
  if (!/^kovo-build\/v1\r?\n/mu.test(result.stdout ?? '')) {
    throw new Error('packed Kovo app build returned an unrecognized result');
  }

  const source = readFileSync(SOURCE_PATH, 'utf8');
  const analysisDigest = sourceAnalysisDigest(source);
  const graph = JSON.parse(readFileSync('dist/.kovo/graph.json', 'utf8'));
  const analysisInput = graph.analysisInputs?.sources?.find(
    (entry) => entry.path === SOURCE_PATH && entry.role === 'app',
  );
  if (
    analysisInput?.encoding !== 'utf16le' ||
    analysisInput?.codeUnitLength !== source.length ||
    analysisInput?.contentHash !== analysisDigest
  ) {
    throw new Error(
      'packed Kovo app build did not bind the edited component into compiler/security analysis',
    );
  }

  const manifest = JSON.parse(readFileSync('dist/.kovo/manifest.json', 'utf8'));
  const clientModule = manifest.clientModules?.find((entry) =>
    entry.path.endsWith('/src/components/counter-island.client.js'),
  );
  if (
    typeof clientModule?.file !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(clientModule?.digest ?? '') ||
    !clientModule.file.startsWith(`c/__v/${clientModule.digest}/`)
  ) {
    throw new Error('packed Kovo app build did not emit the compiler-owned island client module');
  }
  const clientSource = readFileSync(path.join('dist/.kovo/client', clientModule.file), 'utf8');
  if (!clientSource.includes('CounterIsland$queryUpdatePlans')) {
    throw new Error('packed Kovo client module bytes do not match compiler manifest provenance');
  }

  return {
    analysisDigest,
    clientDigest: clientModule.digest,
    clientFile: clientModule.file,
    durationMs,
    peakRssBytes: invocation === null ? null : peakRssBytes(result.stderr ?? ''),
  };
}
