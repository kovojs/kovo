#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const currentBinPath = fileURLToPath(import.meta.url);

if (currentBinPath.endsWith('.ts') && process.env.KOVO_CLI_TRANSFORM_TYPES !== '1') {
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  if (nodeMajor >= 22 && !process.execArgv.includes('--experimental-transform-types')) {
    const result = spawnSync(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        '--experimental-transform-types',
        ...process.execArgv,
        currentBinPath,
        ...process.argv.slice(2),
      ],
      {
        env: { ...process.env, KOVO_CLI_TRANSFORM_TYPES: '1' },
        stdio: 'inherit',
      },
    );
    process.exit(result.status ?? 1);
  }
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const tsUrl = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
      if (existsSync(tsUrl)) return nextResolve(tsUrl.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { kovoInvocationEnvironmentValue, snapshotKovoInvocationEnvironment } =
  await import('./invocation-environment.js');

// SPEC §6.6 rule 6: operator posture and invocation cwd are command authority. Capture them before
// the dispatcher can evaluate authored config/app/plugin modules; later process.env/process.chdir
// writes cannot change the security disposition or redirect framework-owned relative paths.
const invocationEnv = snapshotKovoInvocationEnvironment(process.env);
const paranoidValue = kovoInvocationEnvironmentValue(invocationEnv, 'KOVO_PARANOID');
const commandSecurityDisposition = Object.freeze({
  invocationCwd: process.cwd(),
  invocationEnv,
  paranoidStaticAdvisory: paranoidValue === '1' || paranoidValue === 'true',
});

const commandArgs = process.argv.slice(2);
const { resolveKovoBinInvocationPosture } = await import('./commands-manifest.js');
const invocationPosture = resolveKovoBinInvocationPosture(commandArgs);

// Source check/build are heavy one-shot proof pipelines. Route them before importing the complete
// dispatcher so a thin parent can run each authenticated phase in a fresh process and let the
// previous compiler/Vite heap exit. Every worker performs its own compiler lockdown before any
// authored evaluation.
const { runKovoIsolatedOneShotInvocation } =
  await import('./commands/build-one-shot-orchestrator.js');
const isolatedExitCode = runKovoIsolatedOneShotInvocation(
  commandArgs,
  currentBinPath,
  commandSecurityDisposition,
);
if (isolatedExitCode !== undefined) process.exit(isolatedExitCode);

// Import the complete trusted dispatcher graph before lockdown so framework modules that capture
// Web/Node controls from data descriptors see the host-native descriptors. No authored module is
// evaluated by this import; command dispatch below is the first authored-evaluation boundary.
const { mainAsync } = await import('./index.js');

// SPEC §5.2 / §6.6 rule 6: supported commands that evaluate authored modules lock the shared
// compiler realm at the last trusted boundary, before invoking the dispatcher. The lock also
// completes the verifier-owned one-shot transition from its fresh import-time parser census to the
// exact post-lock census; no authored module is evaluated between those states. Direct imports of
// `@kovojs/cli/internal` are tooling APIs, not the supported security runner. The semantic command
// schema owns this posture, including aliases, so dispatch and lockdown cannot drift.
if (invocationPosture.compilerRealm === 'locked-before-dispatch') {
  const { lockCompilerSecurityRealm } =
    await import('@kovojs/compiler/internal/security-bootstrap');
  lockCompilerSecurityRealm();
}

// Long-lived commands (currently the dev server and MCP stdio server) retain their event loop.
// Every one-shot command exits after `mainAsync` resolves the fully written command result,
// instead of waiting out a multi-second event-loop
// drain on handles the run can't reach (a loaded app module's top-level resources such
// as a PGlite client, plus vite-plus build servers). See plans/fast-kovo-check2.md #1:
// this collapsed a ~14.3s warm `kovo build` to ~3.6s with byte-identical diagnostics.
// NOTE: this file is also copied verbatim to a `.mjs` and run as plain JavaScript by the
// "does not respawn for a compiled JavaScript bin entrypoint" test, so it must stay free of
// TypeScript-only syntax (no type annotations / type arguments). Lean on contextual typing.
const isLongLivedCommand = invocationPosture.processLifecycle === 'long-lived';

void mainAsync(commandArgs, commandSecurityDisposition).then(async (exitCode) => {
  process.exitCode = exitCode;
  if (isLongLivedCommand) return;
  // Flush stdout/stderr (an empty write's callback fires after the buffer drains to the fd)
  // so the forced exit cannot truncate output, then exit promptly instead of waiting out the
  // post-result event-loop drain on handles the run can't reach.
  await Promise.all(
    [process.stdout, process.stderr].map(
      (stream) => new Promise((resolve) => stream.write('', () => resolve(undefined))),
    ),
  );
  process.exit(exitCode);
});
