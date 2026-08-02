import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

import { DEVEX_GOLDEN_PHASE_CONTRACT } from '../devex-golden-contract.mjs';
import { measureProcessTreeCommand } from '../lib/process-tree-rss.mjs';
import { repoRoot } from '../release-packages.mjs';
import {
  discoverEnvSecrets,
  preserveRedactedFailureArtifact,
  redactSecrets,
} from './artifacts.mjs';
import { packageSetIdentity } from './packed-package-auth.mjs';

export { packageSetIdentity };

export const packedAppsScenario = 'packed-apps';
export const PACKED_APPS_REPORT_SCHEMA = 'kovo.golden-journey/packed-apps/v1';
export const PACKED_APPS_VARIANT_SCHEMA = 'kovo.golden-journey/packed-app/v1';
export const PACKED_APPS_BUILD_POSTURE_SCHEMA = 'kovo.golden-journey/build-posture/v1';
export const PACKED_APPS_CHECK_PHASE_CENSUS_SCHEMA = 'kovo-check-phase-census/v1';
export const AXE_WCAG_22_AA_TAGS = Object.freeze([
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
]);

export function selectPublicStyledButtonBackground(buttons) {
  if (!Array.isArray(buttons)) return '';
  return (
    buttons.find(
      (button) =>
        typeof button?.background === 'string' &&
        typeof button?.styleSource === 'string' &&
        button.styleSource.split(';').some((source) => source.trim() === 'button.tsx#primary') &&
        !isTransparentStyledBackground(button.background),
    )?.background ?? ''
  );
}

const DIALECTS = Object.freeze(['postgres', 'sqlite']);
const READY_TIMEOUT_MS = 90_000;
const FIRST_200_TIMEOUT_MS = 90_000;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024;
const PACKED_APPS_CHECK_SOURCE = 'src/app.tsx';
const PACKED_APPS_CHECK_PHASES = Object.freeze([
  'lifecycle-policy',
  'config-trust',
  'typescript',
  'project-quality',
  'sound-subset',
  'session-authority',
  'app-source-trust',
  'stylesheet',
  'app-evaluation',
  'build-check-graph',
  'graph-diagnostics',
]);
const STARTER_PUBLIC_STYLE_IMPORTS = Object.freeze([
  '@kovojs/style',
  '@kovojs/ui/badge',
  '@kovojs/ui/button',
  '@kovojs/ui/card',
]);
const STARTER_PUBLIC_STYLE_BINDINGS = Object.freeze([
  '@kovojs/server#stylesheet',
  '@kovojs/style#*',
  '@kovojs/ui/badge#Badge',
  '@kovojs/ui/button#Button',
  '@kovojs/ui/card#Card',
]);
export const PACKED_JOURNEY_PACKAGE_NAMES = Object.freeze([
  '@kovojs/better-auth',
  '@kovojs/browser',
  '@kovojs/cli',
  '@kovojs/compiler',
  '@kovojs/core',
  '@kovojs/drizzle',
  '@kovojs/headless-ui',
  '@kovojs/icons',
  '@kovojs/server',
  '@kovojs/style',
  '@kovojs/ui',
  '@kovojs/verify',
  'create-kovo',
]);

export async function runPackedAppJourneys({
  artifactRoot,
  commandRunner = runMeasuredCommand,
  dialects = DIALECTS,
  packedPackages,
  samples = 1,
  temporaryParent = tmpdir(),
} = {}) {
  if (!(packedPackages instanceof Map)) {
    throw new TypeError('packed app journey requires an authenticated package Map');
  }
  requirePackedPackages(packedPackages);
  const normalizedDialects = normalizeDialects(dialects);
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > 20) {
    throw new TypeError('packed app journey samples must be an integer from 1 through 20');
  }
  const resolvedArtifactRoot = path.resolve(artifactRoot ?? '.release/devex/golden-journey');
  mkdirSync(resolvedArtifactRoot, { recursive: true });

  const variants = [];
  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
    for (const dialect of normalizedDialects) {
      variants.push(
        await runPackedAppVariant({
          artifactRoot: resolvedArtifactRoot,
          commandRunner,
          dialect,
          packedPackages,
          sampleIndex,
          temporaryParent,
        }),
      );
    }
  }
  const report = {
    schema: PACKED_APPS_REPORT_SCHEMA,
    scenario: packedAppsScenario,
    sampleCount: samples,
    dialects: normalizedDialects,
    packageSet: packageSetIdentity(packedPackages),
    variants,
    pass: variants.every((variant) => variant.pass),
  };
  const findings = validatePackedAppsReport(report);
  if (findings.length > 0) {
    throw new Error(`packed app journey produced an invalid report:\n- ${findings.join('\n- ')}`);
  }
  return Object.freeze(report);
}

export async function runPackedAppVariant({
  artifactRoot,
  commandRunner,
  dialect,
  packedPackages,
  sampleIndex,
  temporaryParent,
}) {
  const temporaryRoot = mkdtempSync(path.join(temporaryParent, `kovo-golden-${dialect}-`));
  const creatorRoot = path.join(temporaryRoot, 'creator');
  const appRoot = path.join(temporaryRoot, 'app');
  const storeRoot = path.join(temporaryRoot, 'pnpm-store');
  const transcripts = [];
  const phases = [];
  let devServer;
  let devTranscriptPhase = 'dev';
  let secretInventory = Object.freeze({ keys: Object.freeze([]), values: Object.freeze([]) });
  let screenshot = null;
  let accessibility = null;
  let concepts = null;
  let install = null;
  let buildPosture = null;

  try {
    mkdirSync(path.join(creatorRoot, 'node_modules', '@kovojs'), { recursive: true });
    materializePackedPackage(
      packedPackages.get('create-kovo'),
      path.join(creatorRoot, 'node_modules/create-kovo'),
    );
    materializePackedPackage(
      packedPackages.get('@kovojs/core'),
      path.join(creatorRoot, 'node_modules/@kovojs/core'),
    );
    const creator = path.join(creatorRoot, 'node_modules/create-kovo/dist/index.mjs');
    if (!existsSync(creator)) throw new Error('authenticated create-kovo tarball has no dist bin');
    const createArgs = [
      creator,
      appRoot,
      '--name',
      `kovo-golden-${dialect}-${String(sampleIndex + 1)}`,
      '--disable-git',
      dialect === 'sqlite' ? '--sqlite' : '--postgres',
      ...(dialect === 'sqlite' ? ['--experimental-sqlite'] : []),
    ];
    const create = commandRunner([process.execPath, ...createArgs], {
      cwd: temporaryRoot,
      phase: 'create',
    });
    transcripts.push(transcript('create', create));
    phases.push(requirePackedPhaseSuccess('create', create));
    requirePackedCreatorHandoff(create, {
      appRoot,
      dialect,
      name: `kovo-golden-${dialect}-${String(sampleIndex + 1)}`,
    });

    secretInventory = discoverEnvSecrets(appRoot);
    const scaffoldSnapshot = snapshotPreCrudState(appRoot, {
      creatorArgs: createArgs.slice(1),
      creatorOutput: `${create.stdout}\n${create.stderr}`,
    });
    rewriteScaffoldDependenciesToPackedTarballs(appRoot, packedPackages);

    const installObservation = commandRunner(
      ['pnpm', 'install', '--ignore-workspace', '--no-frozen-lockfile', '--store-dir', storeRoot],
      {
        cwd: appRoot,
        phase: 'install',
        timeoutMs: COMMAND_TIMEOUT_MS,
      },
    );
    transcripts.push(transcript('install', installObservation));
    phases.push(requirePackedPhaseSuccess('install', installObservation));
    install = collectInstalledDependencyMetrics(appRoot, commandRunner);
    install.durationMs = installObservation.durationMs;
    install.peakProcessTreeRssBytes = installObservation.peakRssBytes;

    const port = await reserveLoopbackPort();
    devServer = startDevServer({
      appRoot,
      port,
      secretValues: secretInventory.values,
    });
    devTranscriptPhase = 'dev';
    concepts = conceptCensus(appRoot, {
      ...scaffoldSnapshot,
      beforeCrudEnvDigest: digestFile(path.join(appRoot, '.env')),
    });
    const readyPromise = devServer.waitForReady(READY_TIMEOUT_MS);
    const first200Promise = waitForFirst200(devServer, FIRST_200_TIMEOUT_MS).then(
      (value) => ({ error: null, value }),
      (error) => ({ error, value: null }),
    );
    const ready = await readyPromise;
    phases.push({
      durationMs: ready.durationMs,
      name: 'ready',
      status: 0,
    });
    const first200Outcome = await first200Promise;
    if (first200Outcome.error !== null) throw first200Outcome.error;
    const first200 = first200Outcome.value;
    phases.push({
      durationMs: first200.durationMs,
      name: 'first-200',
      status: 0,
    });

    const browser = await runBrowserJourney({
      appRoot,
      artifactRoot,
      dialect,
      recordPhase(phase) {
        phases.push(phase);
      },
      origin: devServer.origin,
      sampleIndex,
    });
    screenshot = browser.screenshot;
    accessibility = browser.accessibility;
    await devServer.stop();
    const devObservation = {
      phase: 'dev',
      signal: devServer.exit()?.signal ?? null,
      status: devServer.exit()?.status ?? 0,
      stderr: devServer.transcript().stderr,
      stdout: devServer.transcript().stdout,
    };
    transcripts.push(devObservation);
    requirePackedSqliteOwnerWarnings(dialect, 'dev', devObservation);
    devServer = undefined;

    devServer = startDevServer({
      appRoot,
      port,
      secretValues: secretInventory.values,
    });
    devTranscriptPhase = 'dev-warm';
    const warmReady = await devServer.waitForReady(READY_TIMEOUT_MS);
    phases.push({
      durationMs: warmReady.durationMs,
      name: 'ready-warm',
      status: 0,
    });
    await devServer.stop();
    transcripts.push({
      phase: 'dev-warm',
      signal: devServer.exit()?.signal ?? null,
      status: devServer.exit()?.status ?? 0,
      stderr: devServer.transcript().stderr,
      stdout: devServer.transcript().stdout,
    });
    devServer = undefined;

    const check = commandRunner(['pnpm', 'run', 'check'], {
      cwd: appRoot,
      env: { KOVO_DEVEX_CHECK_PHASE_CENSUS_SOURCE: PACKED_APPS_CHECK_SOURCE },
      phase: 'check',
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
    transcripts.push(transcript('check', check));
    phases.push(requirePackedSourceCheckSuccess(check));
    requirePackedSqliteOwnerWarnings(dialect, 'check', check);
    buildPosture = declareJourneyProductionRetention(appRoot);
    const build = commandRunner(['pnpm', 'run', 'build:prod'], {
      cwd: appRoot,
      phase: 'build',
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
    transcripts.push(transcript('build', build));
    phases.push(requirePackedPhaseSuccess('build', build));
    requirePackedSqliteOwnerWarnings(dialect, 'build', build);
    const test = commandRunner(['pnpm', 'run', 'test'], {
      cwd: appRoot,
      phase: 'test',
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
    transcripts.push(transcript('test', test));
    phases.push(requirePackedPhaseSuccess('test', test));

    return Object.freeze({
      schema: PACKED_APPS_VARIANT_SCHEMA,
      dialect,
      sampleIndex,
      pass: true,
      phases,
      install,
      concepts,
      buildPosture,
      styledUi: screenshot,
      accessibility,
      failure: null,
    });
  } catch (error) {
    if (error instanceof JourneyPhaseError && error.evidence !== null) {
      phases.push(error.evidence);
    }
    if (devServer !== undefined) {
      await devServer.stop();
      transcripts.push({
        phase: devTranscriptPhase,
        signal: devServer.exit()?.signal ?? null,
        status: devServer.exit()?.status ?? null,
        stderr: devServer.transcript().stderr,
        stdout: devServer.transcript().stdout,
      });
    }
    const redactedMessage = redactSecrets(
      error instanceof Error ? error.message : String(error),
      secretInventory.values,
    );
    const label = `${dialect}-${String(sampleIndex + 1)}`;
    const artifact = existsSync(appRoot)
      ? preserveRedactedFailureArtifact({
          appRoot,
          artifactRoot,
          label,
          transcripts,
        })
      : null;
    return Object.freeze({
      schema: PACKED_APPS_VARIANT_SCHEMA,
      dialect,
      sampleIndex,
      pass: false,
      phases,
      install,
      concepts,
      buildPosture,
      styledUi: screenshot,
      accessibility,
      failure: {
        artifact:
          artifact === null
            ? null
            : {
                directory: path
                  .relative(artifactRoot, artifact.directory)
                  .split(path.sep)
                  .join('/'),
                manifest: path.relative(artifactRoot, artifact.manifest).split(path.sep).join('/'),
                sha256: artifact.sha256,
              },
        message: boundedText(redactedMessage, 4_096),
        phase: error instanceof JourneyPhaseError ? error.phase : 'infrastructure',
      },
    });
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

export function rewriteScaffoldDependenciesToPackedTarballs(appRoot, packedPackages) {
  const packageJsonPath = path.join(appRoot, 'package.json');
  const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const overrides = { ...manifest.pnpm?.overrides };
  for (const [name, pkg] of [...packedPackages].sort(([left], [right]) =>
    compareUtf8(left, right),
  )) {
    const specifier = pathToFileURL(pkg.tarballPath).href;
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      if (manifest[field] && Object.hasOwn(manifest[field], name)) {
        manifest[field][name] = specifier;
      }
    }
    if (name.startsWith('@kovojs/')) overrides[name] = specifier;
  }
  manifest.pnpm = { ...manifest.pnpm, overrides };
  writeFileSync(packageJsonPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

/**
 * Configure the controlled production-artifact fixture, not the generated starter contract.
 *
 * `kovo check` above must pass without deployment authority. The subsequent build runs against a
 * test-only serving layer that retains its one output directory for the fixture's lifetime, so it
 * declares the exact SPEC §14 posture instead of weakening KV417 or pretending `node()` proves a
 * real host's cross-redeploy retention.
 */
export function declareJourneyProductionRetention(appRoot) {
  const configPath = path.join(appRoot, 'kovo.config.ts');
  const source = readFileSync(configPath, 'utf8');
  const defaultPreset = '  preset: node(),';
  if (!source.includes(defaultPreset)) {
    throw new JourneyPhaseError(
      'build-posture',
      'packed starter no longer exposes the reviewed node() deployment-posture anchor',
    );
  }
  const retention = {
    hours: 24,
    immutableClientModules: 'retained',
    priorTokenQueryReads: 'retained',
  };
  writeFileSync(
    configPath,
    source.replace(
      defaultPreset,
      [
        '  preset: node({',
        '    retention: {',
        `      hours: ${String(retention.hours)},`,
        `      immutableClientModules: '${retention.immutableClientModules}',`,
        `      priorTokenQueryReads: '${retention.priorTokenQueryReads}',`,
        '    },',
        '  }),',
      ].join('\n'),
    ),
    'utf8',
  );
  return Object.freeze({
    schema: PACKED_APPS_BUILD_POSTURE_SCHEMA,
    configPath: 'kovo.config.ts',
    kind: 'controlled-retained-local-fixture',
    retention: Object.freeze(retention),
  });
}

export function conceptCensus(appRoot, snapshot) {
  const imports = new Set();
  const importedBindings = new Set();
  for (const relative of authoredSourceFiles(appRoot)) {
    const source = readFileSync(path.join(appRoot, ...relative.split('/')), 'utf8');
    const sourceFile = ts.createSourceFile(
      relative,
      source,
      ts.ScriptTarget.Latest,
      true,
      relative.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
        continue;
      }
      const specifier = statement.moduleSpecifier.text;
      if (!specifier.startsWith('@kovojs/')) continue;
      imports.add(specifier);
      const clause = statement.importClause;
      if (clause?.name) importedBindings.add(`${specifier}#${clause.name.text}`);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          importedBindings.add(`${specifier}#${element.name.text}`);
        }
      } else if (bindings && ts.isNamespaceImport(bindings)) {
        importedBindings.add(`${specifier}#*`);
      }
    }
  }
  const configKeys = configObjectPaths(path.join(appRoot, 'kovo.config.ts'));
  const beforeCrudEnvDigest = snapshot.beforeCrudEnvDigest;
  const envEdits =
    beforeCrudEnvDigest === snapshot.scaffoldEnvDigest
      ? []
      : [{ kind: 'content-changed', path: '.env' }];
  return Object.freeze({
    schema: 'kovo.golden-journey/concept-census/v1',
    frameworkImports: Object.freeze([...imports].sort(compareUtf8)),
    frameworkBindings: Object.freeze([...importedBindings].sort(compareUtf8)),
    configKeys: Object.freeze(configKeys),
    creatorInputs: Object.freeze([...snapshot.creatorInputs]),
    interactivePrompts: Object.freeze([...snapshot.interactivePrompts]),
    environmentEdits: Object.freeze(envEdits),
    counts: Object.freeze({
      frameworkImports: imports.size,
      frameworkBindings: importedBindings.size,
      configKeys: configKeys.length,
      creatorInputs: snapshot.creatorInputs.length,
      interactivePrompts: snapshot.interactivePrompts.length,
      environmentEdits: envEdits.length,
    }),
  });
}

export function validatePackedAppsReport(report) {
  const findings = [];
  if (report?.schema !== PACKED_APPS_REPORT_SCHEMA) {
    findings.push(`schema must be ${PACKED_APPS_REPORT_SCHEMA}`);
  }
  if (report?.scenario !== packedAppsScenario) findings.push('scenario must be packed-apps');
  if (!Number.isSafeInteger(report?.sampleCount) || report.sampleCount < 1) {
    findings.push('sampleCount must be positive');
  }
  const reportDialects = [];
  if (!Array.isArray(report?.dialects) || report.dialects.length === 0) {
    findings.push('dialects must be a non-empty array');
  } else {
    for (const [index, dialect] of report.dialects.entries()) {
      if (!DIALECTS.includes(dialect)) {
        findings.push(`dialects[${String(index)}] is invalid`);
      } else if (reportDialects.includes(dialect)) {
        findings.push(`dialects duplicates ${dialect}`);
      } else {
        reportDialects.push(dialect);
      }
    }
  }
  const packageNames = new Set();
  if (!Array.isArray(report?.packageSet)) {
    findings.push('packageSet must be an authenticated package identity array');
  } else {
    for (const [index, pkg] of report.packageSet.entries()) {
      if (
        typeof pkg?.name !== 'string' ||
        typeof pkg?.version !== 'string' ||
        !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(pkg?.sha512 ?? '')
      ) {
        findings.push(`packageSet[${String(index)}] has invalid identity evidence`);
        continue;
      }
      if (packageNames.has(pkg.name)) findings.push(`packageSet duplicates ${pkg.name}`);
      packageNames.add(pkg.name);
    }
    for (const packageName of PACKED_JOURNEY_PACKAGE_NAMES) {
      if (!packageNames.has(packageName)) findings.push(`packageSet omits ${packageName}`);
    }
  }
  if (!Array.isArray(report?.variants)) {
    findings.push('variants must be an array');
    return findings;
  }
  const variantKeys = new Set();
  for (const [index, variant] of report.variants.entries()) {
    const label = `variants[${index}]`;
    if (variant?.schema !== PACKED_APPS_VARIANT_SCHEMA) {
      findings.push(`${label}.schema is invalid`);
    }
    if (!DIALECTS.includes(variant?.dialect)) findings.push(`${label}.dialect is invalid`);
    if (!Number.isSafeInteger(variant?.sampleIndex) || variant.sampleIndex < 0) {
      findings.push(`${label}.sampleIndex is invalid`);
    }
    if (typeof variant?.pass !== 'boolean') findings.push(`${label}.pass must be boolean`);
    if (!Array.isArray(variant?.phases)) {
      findings.push(`${label}.phases must be an array`);
    } else {
      const phaseNames = new Set();
      for (const [phaseIndex, phase] of variant.phases.entries()) {
        if (
          typeof phase?.name !== 'string' ||
          !Number.isFinite(phase?.durationMs) ||
          phase.durationMs < 0 ||
          (phase.status !== null && !Number.isInteger(phase.status)) ||
          (phase.peakProcessTreeRssBytes !== undefined &&
            (!Number.isFinite(phase.peakProcessTreeRssBytes) || phase.peakProcessTreeRssBytes < 0))
        ) {
          findings.push(`${label}.phases[${String(phaseIndex)}] has invalid evidence`);
        }
        if (phaseNames.has(phase?.name)) {
          findings.push(`${label}.phases duplicates ${String(phase?.name)}`);
        }
        phaseNames.add(phase?.name);
      }
    }
    const variantKey = `${String(variant?.sampleIndex)}:${String(variant?.dialect)}`;
    if (variantKeys.has(variantKey)) findings.push(`${label} duplicates ${variantKey}`);
    variantKeys.add(variantKey);
    if (variant?.pass === true) {
      if (
        variant.phases.length !== DEVEX_GOLDEN_PHASE_CONTRACT.app.length ||
        variant.phases.some(
          (phase, phaseIndex) => phase?.name !== DEVEX_GOLDEN_PHASE_CONTRACT.app[phaseIndex],
        )
      ) {
        findings.push(`${label} does not retain the exact successful phase order`);
      }
      for (const required of DEVEX_GOLDEN_PHASE_CONTRACT.app) {
        if (!variant.phases.some((phase) => phase.name === required && phase.status === 0)) {
          findings.push(`${label} is missing successful phase ${required}`);
        }
      }
      const checkPhase = variant.phases.find((phase) => phase?.name === 'check');
      findings.push(
        ...packedSourceCheckPhaseCensusFindings(
          checkPhase?.sourceCheckPhaseCensus,
          `${label}.check.sourceCheckPhaseCensus`,
        ),
      );
      if (variant.failure !== null) findings.push(`${label}.failure must be null on success`);
      if (variant.accessibility?.violations !== 0) {
        findings.push(`${label} did not prove an axe-clean styled UI`);
      }
      if (
        variant.accessibility?.schema !== 'kovo.golden-journey/accessibility/v1' ||
        !Array.isArray(variant.accessibility?.states) ||
        !['login', 'authenticated-crud'].every((state) =>
          variant.accessibility.states.some(
            (entry) => entry?.name === state && Array.isArray(entry?.violations),
          ),
        )
      ) {
        findings.push(`${label} did not retain both accessibility terminal states`);
      }
      if (
        !Number.isSafeInteger(variant.styledUi?.bytes) ||
        variant.styledUi.bytes < 1 ||
        !/^evidence\/(?:postgres|sqlite)-\d+\/styled-ui\.png$/u.test(
          variant.styledUi?.path ?? '',
        ) ||
        !/^sha256:[0-9a-f]{64}$/u.test(variant.styledUi?.sha256 ?? '') ||
        !Number.isSafeInteger(variant.styledUi?.styled?.styleSheets) ||
        variant.styledUi.styled.styleSheets < 1 ||
        !Number.isSafeInteger(variant.styledUi?.styled?.styledSourceElements) ||
        variant.styledUi.styled.styledSourceElements < 1 ||
        typeof variant.styledUi?.styled?.buttonBackground !== 'string' ||
        variant.styledUi.styled.buttonBackground.trim().length === 0 ||
        isTransparentStyledBackground(variant.styledUi.styled.buttonBackground) ||
        typeof variant.styledUi?.styled?.fontFamily !== 'string' ||
        variant.styledUi.styled.fontFamily.trim().length === 0
      ) {
        findings.push(`${label} did not retain an authenticated styled-UI screenshot`);
      }
      if (
        !Number.isFinite(variant.install?.durationMs) ||
        variant.install.durationMs < 0 ||
        !Number.isSafeInteger(variant.install?.installedBytes) ||
        variant.install.installedBytes < 1 ||
        !Number.isSafeInteger(variant.install?.installedFiles) ||
        variant.install.installedFiles < 1 ||
        !Number.isSafeInteger(variant.install?.directProductionDependencies) ||
        variant.install.directProductionDependencies < 1 ||
        !Number.isSafeInteger(variant.install?.transitiveProductionDependencies) ||
        variant.install.transitiveProductionDependencies < 0
      ) {
        findings.push(`${label} did not retain bounded install and dependency evidence`);
      }
      if (variant.concepts?.counts?.environmentEdits !== 0) {
        findings.push(`${label} required an undocumented environment edit`);
      }
      const frameworkImports = variant.concepts?.frameworkImports;
      const frameworkBindings = variant.concepts?.frameworkBindings;
      if (!Array.isArray(frameworkImports) || !Array.isArray(frameworkBindings)) {
        findings.push(`${label} omitted its public style/component API census`);
      } else {
        for (const specifier of STARTER_PUBLIC_STYLE_IMPORTS) {
          if (!frameworkImports.includes(specifier)) {
            findings.push(`${label} did not author its styled UI through ${specifier}`);
          }
        }
        for (const binding of STARTER_PUBLIC_STYLE_BINDINGS) {
          if (!frameworkBindings.includes(binding)) {
            findings.push(`${label} did not author its styled UI through ${binding}`);
          }
        }
        if (
          frameworkImports.some(
            (specifier) =>
              typeof specifier !== 'string' ||
              /(?:^|\/)(?:generated|internal)(?:\/|$)/u.test(specifier),
          )
        ) {
          findings.push(`${label} styled starter imported an internal/generated Kovo API`);
        }
      }
      if (
        variant.buildPosture?.schema !== PACKED_APPS_BUILD_POSTURE_SCHEMA ||
        variant.buildPosture?.kind !== 'controlled-retained-local-fixture' ||
        variant.buildPosture?.retention?.hours < 24 ||
        variant.buildPosture?.retention?.immutableClientModules !== 'retained' ||
        variant.buildPosture?.retention?.priorTokenQueryReads !== 'retained'
      ) {
        findings.push(`${label} did not record the controlled SPEC §14 build posture`);
      }
    } else if (
      typeof variant?.failure?.phase !== 'string' ||
      typeof variant?.failure?.message !== 'string'
    ) {
      findings.push(`${label}.failure is invalid`);
    }
  }
  if (Number.isSafeInteger(report.sampleCount) && report.sampleCount > 0) {
    for (let sampleIndex = 0; sampleIndex < report.sampleCount; sampleIndex += 1) {
      for (const dialect of reportDialects) {
        if (!variantKeys.has(`${String(sampleIndex)}:${dialect}`)) {
          findings.push(`variants omit sample ${String(sampleIndex)} ${dialect}`);
        }
      }
    }
    if (report.variants.length !== report.sampleCount * reportDialects.length) {
      findings.push('variants do not contain exactly the declared dialects for every sample');
    }
  }
  const expectedPass = report.variants.every((variant) => variant.pass);
  if (report?.pass !== expectedPass) findings.push('pass does not match variant outcomes');
  return findings;
}

export function collectInstalledDependencyMetrics(appRoot, commandRunner = runMeasuredCommand) {
  const manifest = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
  const directNames = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
  const list = commandRunner(['pnpm', 'list', '--prod', '--depth', 'Infinity', '--json'], {
    cwd: appRoot,
    phase: 'dependency-census',
    timeoutMs: 120_000,
  });
  if (list.exitCode !== 0 || list.signal || list.error) {
    throw new JourneyPhaseError(
      'dependency-census',
      commandFailureMessage('dependency-census', list),
    );
  }
  let roots;
  try {
    roots = JSON.parse(list.stdout);
  } catch {
    throw new JourneyPhaseError('dependency-census', 'pnpm list did not return JSON');
  }
  const transitiveIdentities = new Set();
  const visit = (name, node, depth) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    if (depth > 0 && typeof node.version === 'string') {
      transitiveIdentities.add(`${name}@${node.version}`);
    }
    for (const field of ['dependencies', 'optionalDependencies']) {
      for (const [dependencyName, dependency] of Object.entries(node[field] ?? {})) {
        visit(dependencyName, dependency, depth + 1);
      }
    }
  };
  for (const root of Array.isArray(roots) ? roots : [roots]) {
    for (const [dependencyName, dependency] of Object.entries(root?.dependencies ?? {})) {
      visit(dependencyName, dependency, 0);
    }
  }
  const installTree = directoryPhysicalBytes(path.join(appRoot, 'node_modules'));
  return {
    directProductionDependencies: directNames.size,
    transitiveProductionDependencies: transitiveIdentities.size,
    installedBytes: installTree.bytes,
    installedFiles: installTree.files,
  };
}

function snapshotPreCrudState(appRoot, { creatorArgs, creatorOutput }) {
  return {
    creatorInputs: creatorArgs.filter((arg) => arg.startsWith('--')),
    interactivePrompts: extractInteractivePrompts(creatorOutput),
    scaffoldEnvDigest: digestFile(path.join(appRoot, '.env')),
  };
}

function extractInteractivePrompts(output) {
  return String(output)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /\?\s*$/u.test(line))
    .map((line) => boundedText(line, 160));
}

function configObjectPaths(configPath) {
  const source = readFileSync(configPath, 'utf8');
  const sourceFile = ts.createSourceFile(
    configPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const paths = new Set();
  const propertyName = (node) => {
    if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
      return node.text;
    }
    return null;
  };
  const walkObject = (object, prefix = '') => {
    for (const property of object.properties) {
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
        continue;
      }
      const name = propertyName(property.name);
      if (name === null) continue;
      const next = prefix ? `${prefix}.${name}` : name;
      paths.add(next);
      if (ts.isPropertyAssignment(property) && ts.isObjectLiteralExpression(property.initializer)) {
        walkObject(property.initializer, next);
      }
    }
  };
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'defineConfig' &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      walkObject(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...paths].sort(compareUtf8);
}

function authoredSourceFiles(appRoot) {
  const files = [];
  const walk = (relativeRoot) => {
    const directory = path.join(appRoot, ...relativeRoot.split('/').filter(Boolean));
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      compareUtf8(left.name, right.name),
    )) {
      if (entry.isSymbolicLink()) continue;
      const relative = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(relative);
      else if (entry.isFile() && /\.(?:[cm]?[jt]sx?)$/u.test(entry.name)) files.push(relative);
    }
  };
  walk('src');
  if (existsSync(path.join(appRoot, 'kovo.config.ts'))) files.push('kovo.config.ts');
  return files;
}

async function runBrowserJourney({
  appRoot,
  artifactRoot,
  dialect,
  origin,
  recordPhase,
  sampleIndex,
}) {
  const { chromium } = await import('playwright');
  const requireFromIntegration = createRequire(
    path.join(repoRoot, 'tests/integration/package.json'),
  );
  const axeSource = readFileSync(requireFromIntegration.resolve('axe-core/axe.min.js'), 'utf8');
  const env = readEnvFile(path.join(appRoot, '.env'));
  const password = env.KOVO_DEMO_PASSWORD;
  if (typeof password !== 'string' || password.length < 12) {
    throw new JourneyPhaseError('login', 'generated app did not contain a strong demo password');
  }
  const evidenceDirectory = path.join(artifactRoot, 'evidence', `${dialect}-${sampleIndex + 1}`);
  mkdirSync(evidenceDirectory, { recursive: true });
  const screenshotPath = path.join(evidenceDirectory, 'styled-ui.png');
  const accessibilityPath = path.join(evidenceDirectory, 'accessibility.json');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const browserEvents = [];
    const recordBrowserEvent = (kind, detail) => {
      if (browserEvents.length >= 128) return;
      browserEvents.push({
        kind,
        detail: boundedText(String(detail), 1_024),
      });
    };
    page.on('console', (message) => recordBrowserEvent('console', message.text()));
    page.on('pageerror', (error) => recordBrowserEvent('pageerror', error.message));
    page.on('requestfailed', (request) =>
      recordBrowserEvent(
        'requestfailed',
        `${request.method()} ${request.url()} ${request.failure()?.errorText ?? '<unknown>'}`,
      ),
    );
    // Install through the browser's new-document hook before Kovo's Trusted Types policy exists.
    // A DOM <script>.text assignment is correctly rejected by the starter's CSP.
    await page.addInitScript({ content: axeSource });
    await page.addInitScript(captureMutationFetchResponses);
    await page.goto(`${origin}/login`, { waitUntil: 'networkidle', timeout: READY_TIMEOUT_MS });
    const initialA11y = await axePage(page);

    const loginStarted = performance.now();
    await page.locator('input[name="email"]').fill('demo@example.com');
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole('button', { name: /sign in/iu }).click();
    await page.getByText('New contact', { exact: true }).waitFor({
      state: 'visible',
      timeout: READY_TIMEOUT_MS,
    });
    const loginDurationMs = performance.now() - loginStarted;
    recordPhase({ durationMs: loginDurationMs, name: 'login', status: 0 });

    const email = `journey-${dialect}-${String(sampleIndex + 1)}@example.test`;
    const crudStarted = performance.now();
    await page.locator('input[name="name"]').fill('Golden Journey');
    await page.locator('input[name="email"]').fill(email);
    const company = page.locator('input[name="company"]');
    if ((await company.count()) === 1) await company.fill('Kovo');
    const preSubmit = await preSubmitTargetSnapshot(page);
    const [mutationResponse] = await Promise.all([
      page.waitForResponse(
        (response) => {
          try {
            return new URL(response.url()).pathname === '/_m/mutations/add-contact';
          } catch {
            return false;
          }
        },
        { timeout: READY_TIMEOUT_MS },
      ),
      page.getByRole('button', { name: /add contact/iu }).click(),
    ]);
    const streamedResponse = await capturedMutationResponse(page, mutationResponse.url(), 15_000);
    if (!mutationResponse.ok()) {
      const diagnostics = await mutationFailureDiagnostics({
        browserEvents,
        email,
        origin,
        page,
        preSubmit,
        response: mutationResponse,
        streamedResponse,
      });
      const diagnosticPath = writeCrudDiagnostic({
        diagnostics,
        evidenceDirectory,
        exactSecrets: Object.values(env),
      });
      throw new JourneyPhaseError(
        'crud',
        `add-contact mutation failed; diagnostic=${path.relative(artifactRoot, diagnosticPath).split(path.sep).join('/')}\n${JSON.stringify(crudDiagnosticSummary(diagnostics))}`,
        {
          durationMs: performance.now() - crudStarted,
          name: 'crud',
          status: null,
        },
      );
    }
    try {
      await page.getByText(email, { exact: true }).waitFor({
        state: 'visible',
        timeout: 15_000,
      });
    } catch (error) {
      const diagnostics = await mutationFailureDiagnostics({
        browserEvents,
        email,
        origin,
        page,
        preSubmit,
        response: mutationResponse,
        streamedResponse,
      });
      const diagnosticPath = writeCrudDiagnostic({
        diagnostics,
        evidenceDirectory,
        exactSecrets: Object.values(env),
      });
      throw new JourneyPhaseError(
        'crud',
        [
          `add-contact returned ${String(mutationResponse.status())} but did not render the created contact`,
          `diagnostic=${path.relative(artifactRoot, diagnosticPath).split(path.sep).join('/')}`,
          JSON.stringify(crudDiagnosticSummary(diagnostics)),
          error instanceof Error ? error.message : String(error),
        ].join('\n'),
        {
          durationMs: performance.now() - crudStarted,
          name: 'crud',
          status: null,
        },
      );
    }
    const crudDurationMs = performance.now() - crudStarted;
    recordPhase({ durationMs: crudDurationMs, name: 'crud', status: 0 });

    const styledSnapshot = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      return {
        buttons: [...document.querySelectorAll('button')].map((button) => ({
          background: getComputedStyle(button).backgroundColor,
          styleSource: button.getAttribute('data-style-src') ?? '',
        })),
        fontFamily: body.fontFamily,
        styleSheets: document.styleSheets.length,
        styledSourceElements: document.querySelectorAll('[data-style-src]').length,
      };
    });
    const styled = {
      buttonBackground: selectPublicStyledButtonBackground(styledSnapshot.buttons),
      fontFamily: styledSnapshot.fontFamily,
      styleSheets: styledSnapshot.styleSheets,
      styledSourceElements: styledSnapshot.styledSourceElements,
    };
    if (
      styled.styleSheets < 1 ||
      styled.styledSourceElements < 1 ||
      styled.fontFamily.trim().length === 0 ||
      isTransparentStyledBackground(styled.buttonBackground)
    ) {
      throw new JourneyPhaseError('styled-ui', 'starter did not render its public styled UI');
    }
    const terminalA11y = await axePage(page);
    const violations = initialA11y.violations.length + terminalA11y.violations.length;
    if (violations !== 0) {
      throw new JourneyPhaseError(
        'accessibility',
        `styled starter has ${String(violations)} axe violations`,
      );
    }
    await page.screenshot({ fullPage: true, path: screenshotPath });
    const accessibility = {
      schema: 'kovo.golden-journey/accessibility/v1',
      engine: initialA11y.testEngine,
      states: [
        { name: 'login', violations: summarizeAxeViolations(initialA11y.violations) },
        { name: 'authenticated-crud', violations: summarizeAxeViolations(terminalA11y.violations) },
      ],
      violations,
    };
    writeFileSync(accessibilityPath, `${JSON.stringify(accessibility, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    return {
      accessibility,
      crudDurationMs,
      loginDurationMs,
      screenshot: {
        bytes: statSync(screenshotPath).size,
        path: path.relative(artifactRoot, screenshotPath).split(path.sep).join('/'),
        sha256: digestFile(screenshotPath),
        styled,
      },
    };
  } finally {
    await browser.close();
  }
}

function isTransparentStyledBackground(background) {
  if (typeof background !== 'string') return true;
  const normalized = background.trim().toLowerCase().replaceAll(' ', '');
  return (
    normalized.length === 0 ||
    normalized === 'transparent' ||
    normalized === 'rgba(0,0,0,0)' ||
    normalized === 'rgb(0 0 0/0)'
  );
}

function captureMutationFetchResponses() {
  const records = [];
  Object.defineProperty(globalThis, '__kovoGoldenMutationResponses', {
    configurable: false,
    enumerable: false,
    value: records,
    writable: false,
  });
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (...args) => {
    const response = await originalFetch(...args);
    let pathname = '';
    try {
      pathname = new URL(response.url).pathname;
    } catch {
      // A malformed URL cannot be the framework mutation endpoint under test.
    }
    if (pathname !== '/_m/mutations/add-contact') return response;
    const record = {
      chunks: [],
      complete: false,
      error: null,
      headers: Object.fromEntries(response.headers.entries()),
      status: response.status,
      url: response.url,
    };
    records.push(record);
    void (async () => {
      try {
        const reader = response.clone().body?.getReader();
        if (!reader) {
          record.complete = true;
          return;
        }
        const decoder = new TextDecoder();
        let bytes = 0;
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          bytes += next.value.byteLength;
          if (record.chunks.length < 128 && bytes <= 64 * 1024) {
            record.chunks.push(decoder.decode(next.value, { stream: true }).slice(0, 8 * 1024));
          }
        }
        const tail = decoder.decode();
        if (tail && record.chunks.length < 128 && bytes <= 64 * 1024) {
          record.chunks.push(tail.slice(0, 8 * 1024));
        }
        record.complete = true;
      } catch (error) {
        record.error = error instanceof Error ? error.message.slice(0, 1_024) : String(error);
      }
    })();
    return response;
  };
}

async function capturedMutationResponse(page, responseUrl, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  let latest = null;
  while (performance.now() < deadline) {
    try {
      latest = await page.evaluate((url) => {
        const records = globalThis.__kovoGoldenMutationResponses;
        if (!Array.isArray(records)) return null;
        return structuredClone([...records].reverse().find((record) => record.url === url) ?? null);
      }, responseUrl);
    } catch (error) {
      return {
        chunks: [],
        complete: false,
        error: error instanceof Error ? error.message : String(error),
        headers: {},
        status: null,
        url: responseUrl,
      };
    }
    if (latest?.complete || latest?.error) return sanitizeCapturedMutationResponse(latest);
    await delay(50);
  }
  return sanitizeCapturedMutationResponse(
    latest ?? {
      chunks: [],
      complete: false,
      error: 'fetch-clone capture was unavailable',
      headers: {},
      status: null,
      url: responseUrl,
    },
  );
}

async function mutationFailureDiagnostics({
  browserEvents,
  email,
  origin,
  page,
  preSubmit,
  response,
  streamedResponse,
}) {
  const beforeReload = await browserPageSnapshot(page, email);
  let rawRequestHeaders;
  let requestHeaders;
  try {
    rawRequestHeaders = await response.request().allHeaders();
    requestHeaders = sanitizeDiagnosticRequestHeaders(rawRequestHeaders);
  } catch (error) {
    requestHeaders = {
      error: error instanceof Error ? error.message : String(error),
    };
  }
  let hmrProbe;
  try {
    const oldBuild = rawRequestHeaders?.['kovo-build'];
    const liveTargets = rawRequestHeaders?.['kovo-live-targets'];
    const currentUrl = rawRequestHeaders?.['kovo-current-url'];
    if (!oldBuild || !liveTargets || !currentUrl) {
      throw new Error('mutation request did not expose the build, source URL, and live target');
    }
    const hmrResponse = await page
      .context()
      .request.post(
        `${origin}/@kovo/hmr/refresh/live-targets?oldBuild=${encodeURIComponent(oldBuild)}`,
        {
          headers: {
            Accept: 'text/vnd.kovo.fragment+html',
            'Kovo-Build': oldBuild,
            'Kovo-Current-Url': currentUrl,
            'Kovo-Fragment': 'true',
            'Kovo-Live-Targets': liveTargets,
          },
          timeout: 15_000,
        },
      );
    hmrProbe = {
      body: sanitizeMarkupPreview(await hmrResponse.text(), 8 * 1024),
      headers: sanitizeDiagnosticResponseHeaders(hmrResponse.headers()),
      status: hmrResponse.status(),
    };
  } catch (error) {
    hmrProbe = {
      error: error instanceof Error ? error.message : String(error),
    };
  }
  let independentGet;
  try {
    const result = await page.context().request.get(`${origin}/`, { timeout: 15_000 });
    const rawBody = await result.text();
    const bodyStart = rawBody.indexOf('<body');
    const body = sanitizeMarkupPreview(
      bodyStart < 0 ? rawBody : rawBody.slice(bodyStart),
      8 * 1024,
    );
    independentGet = {
      body,
      containsEmail: rawBody.includes(email),
      headers: sanitizeDiagnosticResponseHeaders(result.headers()),
      status: result.status(),
    };
  } catch (error) {
    independentGet = {
      error: error instanceof Error ? error.message : String(error),
    };
  }
  let afterReload;
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 });
    afterReload = await browserPageSnapshot(page, email);
  } catch (error) {
    afterReload = {
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return {
    schema: 'kovo.golden-journey/crud-diagnostic/v1',
    hmrProbe,
    preSubmit,
    request: {
      headers: requestHeaders,
      method: response.request().method(),
      url: response.request().url(),
    },
    response: {
      headers: sanitizeDiagnosticResponseHeaders(response.headers()),
      status: response.status(),
      streamed: streamedResponse,
      url: response.url(),
    },
    beforeReload,
    independentGet,
    afterReload,
    browserEvents,
  };
}

async function browserPageSnapshot(page, email) {
  try {
    const snapshot = await page.evaluate((expectedEmail) => {
      return {
        containsEmail: document.body?.textContent?.includes(expectedEmail) ?? false,
        outerHTML: document.body?.outerHTML ?? '',
        title: document.title.slice(0, 512),
        url: location.href,
      };
    }, email);
    return {
      ...snapshot,
      outerHTML: sanitizeMarkupPreview(snapshot.outerHTML, 8 * 1024),
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function preSubmitTargetSnapshot(page) {
  try {
    const raw = await page.getByRole('button', { name: /add contact/iu }).evaluate((button) => {
      const form = button.closest('form');
      let componentRoot = form;
      for (let current = form; current instanceof Element; current = current.parentElement) {
        const carriesKovoIdentity = [...current.attributes].some(
          (attribute) =>
            attribute.name.startsWith('kovo-') || attribute.name.startsWith('data-kovo-'),
        );
        if (carriesKovoIdentity) {
          componentRoot = current;
          break;
        }
      }
      return {
        componentRoot: componentRoot?.outerHTML ?? null,
        form: form?.outerHTML ?? null,
      };
    });
    return {
      componentRoot:
        raw.componentRoot === null
          ? null
          : sanitizeTargetMarkupPreview(raw.componentRoot, 8 * 1024),
      form: raw.form === null ? null : sanitizeTargetMarkupPreview(raw.form, 8 * 1024),
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function writeCrudDiagnostic({ diagnostics, evidenceDirectory, exactSecrets }) {
  const diagnosticPath = path.join(evidenceDirectory, 'crud-diagnostic.json');
  const serialized = redactSecrets(JSON.stringify(diagnostics, null, 2), exactSecrets);
  writeFileSync(diagnosticPath, `${serialized}\n`, { encoding: 'utf8', flag: 'wx' });
  return diagnosticPath;
}

function crudDiagnosticSummary(diagnostics) {
  return {
    preSubmit: diagnostics.preSubmit,
    request: diagnostics.request,
    response: diagnostics.response,
  };
}

function sanitizeDiagnosticRequestHeaders(headers) {
  const admitted = new Set([
    'accept',
    'content-type',
    'kovo-build',
    'kovo-current-url',
    'kovo-fragment',
    'kovo-idem',
    'kovo-live-targets',
    'kovo-targets',
  ]);
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([name]) => admitted.has(name.toLowerCase()))
      .map(([name, value]) => [name.toLowerCase(), sanitizeDiagnosticValue(value)]),
  );
}

export function sanitizeDiagnosticResponseHeaders(headers) {
  const admitted = new Set([
    'cache-control',
    'content-length',
    'content-type',
    'kovo-build',
    'kovo-changes',
    'kovo-hmr-fallback',
    'kovo-hmr-refresh',
    'kovo-previous-build',
    'location',
    'vary',
  ]);
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([name]) => admitted.has(name.toLowerCase()))
      .map(([name, value]) => [name.toLowerCase(), sanitizeDiagnosticValue(value)]),
  );
}

function sanitizeDiagnosticValue(value) {
  return String(value)
    .replace(/(@)[^:;,\s]+(?=:)/gu, '$1[REDACTED:ATTESTATION]')
    .replace(/\b[A-Za-z0-9_+/=-]{32,}\b/gu, '[REDACTED:TOKEN]');
}

export function sanitizeCapturedMutationResponse(response) {
  const chunks = Array.isArray(response?.chunks) ? response.chunks.map(String) : [];
  return {
    ...response,
    bodyPreview: sanitizeMarkupPreview(chunks.join(''), 16 * 1024),
    chunks: chunks.map((chunk, index) => ({
      bytes: Buffer.byteLength(chunk),
      index,
    })),
  };
}

export function sanitizeMarkupPreview(value, maxBytes) {
  const redacted = String(value)
    .replace(/(\s+[A-Za-z_:][-A-Za-z0-9_:.]*\s*=\s*)(["'])[\s\S]*?\2/gu, '$1$2[REDACTED]$2')
    .replace(/\b[A-Za-z0-9_+/=-]{32,}\b/gu, '[REDACTED:TOKEN]');
  return boundedText(redacted, maxBytes);
}

export function sanitizeTargetMarkupPreview(value, maxBytes) {
  const redacted = String(value).replace(
    /(\s+)([A-Za-z_:][-A-Za-z0-9_:.]*)(\s*=\s*)(["'])([\s\S]*?)\4/gu,
    (attribute, whitespace, name, separator, quote, rawValue) => {
      const normalizedName = name.toLowerCase();
      const structural =
        ['action', 'class', 'id', 'method', 'name', 'role', 'type'].includes(normalizedName) ||
        normalizedName.startsWith('aria-') ||
        normalizedName.startsWith('kovo-') ||
        normalizedName.startsWith('data-kovo-');
      const safeValue = structural ? sanitizeDiagnosticValue(rawValue) : '[REDACTED]';
      return `${whitespace}${name}${separator}${quote}${safeValue}${quote}`;
    },
  );
  return boundedText(redacted, maxBytes);
}

async function axePage(page) {
  return await page.evaluate(async (wcagTags) => {
    if (!globalThis.axe) throw new Error('axe-core failed to install');
    return await globalThis.axe.run(document, {
      resultTypes: ['violations'],
      runOnly: { type: 'tag', values: wcagTags },
    });
  }, AXE_WCAG_22_AA_TAGS);
}

function summarizeAxeViolations(violations) {
  return violations.map((violation) => ({
    help: violation.help,
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.length,
  }));
}

function startDevServer({ appRoot, port, secretValues }) {
  const started = performance.now();
  const child = spawn(
    'pnpm',
    [
      'exec',
      'kovo',
      'dev',
      './src/app.tsx',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strict-port',
    ],
    {
      cwd: appRoot,
      detached: process.platform !== 'win32',
      env: { ...process.env, CI: '1', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  let exit = null;
  const append = (current, chunk) =>
    boundedText(`${current}${chunk.toString('utf8')}`, MAX_TRANSCRIPT_BYTES);
  child.stdout.on('data', (chunk) => {
    stdout = append(stdout, chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr = append(stderr, chunk);
  });
  const exited = new Promise((resolve) => {
    child.once('error', (error) => {
      if (exit === null) exit = { error: error.message, signal: null, status: null };
      resolve(exit);
    });
    child.once('exit', (status, signal) => {
      if (exit === null) exit = { error: null, signal, status };
      resolve(exit);
    });
  });
  const origin = `http://127.0.0.1:${String(port)}`;
  return {
    assertRunning(phase) {
      if (exit === null) return;
      throw new JourneyPhaseError(
        phase,
        redactSecrets(
          `dev exited status=${String(exit.status)} signal=${String(exit.signal)} ${
            exit.error ?? stderr ?? stdout
          }`,
          secretValues,
        ),
      );
    },
    exit: () => exit,
    origin,
    transcript: () => ({ stderr, stdout }),
    async waitForReady(timeoutMs) {
      const deadline = performance.now() + timeoutMs;
      for (;;) {
        this.assertRunning('ready');
        const match = /Kovo dev ready in (\d+)ms/u.exec(stdout);
        if (match) {
          for (const expected of [
            `Local URL    ${origin}/`,
            'Mode         development',
            'App          src/app.tsx',
            `Devtool      ${origin}/__kovo`,
          ]) {
            if (!stdout.includes(expected)) {
              throw new JourneyPhaseError('ready', `ready report omitted ${expected}`);
            }
          }
          return { durationMs: performance.now() - started, frameworkDurationMs: Number(match[1]) };
        }
        if (performance.now() >= deadline) {
          throw new JourneyPhaseError(
            'ready',
            redactSecrets(`ready line timed out\n${stdout}\n${stderr}`, secretValues),
          );
        }
        await delay(25);
      }
    },
    async stop() {
      if (exit !== null) return;
      terminateProcessGroup(child.pid, 'SIGTERM');
      const stopped = await Promise.race([exited.then(() => true), delay(5_000).then(() => false)]);
      if (!stopped && exit === null) {
        terminateProcessGroup(child.pid, 'SIGKILL');
        await exited;
      }
    },
  };
}

async function waitForFirst200(server, timeoutMs) {
  const started = performance.now();
  const deadline = started + timeoutMs;
  let last = 'connection unavailable';
  for (;;) {
    server.assertRunning('first-200');
    try {
      const response = await fetch(`${server.origin}/api/health`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(2_000),
      });
      const body = await response.text();
      if (response.status === 200 && body.includes('"ok":true')) {
        return { durationMs: performance.now() - started };
      }
      if (response.status >= 500 && /\bKV\d{3}\b/u.test(body)) {
        throw new JourneyPhaseError(
          'first-200',
          `first response failed with a stable Kovo diagnostic: status=${String(response.status)} body=${boundedText(body, 4_096)}`,
        );
      }
      last = `status=${String(response.status)} body=${boundedText(body, 512)}`;
    } catch (error) {
      if (error instanceof JourneyPhaseError) throw error;
      last = error instanceof Error ? error.message : String(error);
    }
    if (performance.now() >= deadline) {
      throw new JourneyPhaseError('first-200', `first 200 timed out: ${last}`);
    }
    await delay(25);
  }
}

function runMeasuredCommand(command, options) {
  const observation = measureProcessTreeCommand(command, {
    cwd: options.cwd,
    env: {
      CI: '1',
      NO_COLOR: '1',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      ...options.env,
    },
    maxBuffer: 128 * 1024 * 1024,
    timeoutMs: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
  });
  return observation;
}

export function requirePackedPhaseSuccess(name, observation) {
  const evidence = {
    durationMs: observation.durationMs,
    name,
    peakProcessTreeRssBytes: observation.peakRssBytes,
    status: observation.exitCode,
  };
  if (observation.exitCode !== 0 || observation.signal !== null || observation.error !== null) {
    throw new JourneyPhaseError(name, commandFailureMessage(name, observation), evidence);
  }
  return evidence;
}

export function requirePackedCreatorHandoff(observation, { appRoot, dialect, name }) {
  const output = String(observation.stdout ?? '');
  const findings = [];
  const expectedSummary = [
    'Kovo app created',
    '',
    `  Directory   ${appRoot}`,
    `  Name        ${name}`,
    `  Dialect     ${dialect}`,
    '  Deploy      node',
    '  Retention   unconfigured',
    '  Install     skipped',
    '  Git         not initialized',
  ].join('\n');
  if (!output.startsWith(expectedSummary)) {
    findings.push('creator summary did not exactly match the selected non-interactive scaffold');
  }
  if (!/\n  Files       [1-9]\d*\n/u.test(output) || !output.includes('\nNext steps\n')) {
    findings.push('creator summary omitted its exact positive file count or Next steps boundary');
  }
  const expectedNextSteps = [
    'Next steps',
    `  cd ${shellQuoteForEvidence(appRoot)}`,
    '  pnpm install --ignore-scripts',
    '  pnpm exec kovo check lifecycle',
    '  pnpm rebuild',
    '  pnpm run dev',
    '  pnpm run check',
    '',
  ].join('\n');
  if (!output.endsWith(expectedNextSteps)) {
    findings.push('creator handoff did not exactly include install, dev, and check in order');
  }
  const sqlitePosture = [
    '  WARNING SQLite is experimental and single-principal/local-dev only.',
    '  It does not provide Kovo authorization or confidentiality guarantees.',
    '  KV447: owner annotations are audit metadata, not engine-enforced access control.',
  ];
  for (const line of sqlitePosture) {
    if (dialect === 'sqlite' && !output.includes(line)) {
      findings.push(`SQLite creator handoff omitted ${line}`);
    }
    if (dialect !== 'sqlite' && output.includes(line)) {
      findings.push(`Postgres creator handoff unexpectedly included ${line}`);
    }
  }
  if (String(observation.stderr ?? '').trim().length > 0) {
    findings.push('successful creator handoff wrote unexpected stderr');
  }
  if (findings.length > 0) {
    throw new JourneyPhaseError('create', findings.join('; '));
  }
}

export function requirePackedSqliteOwnerWarnings(dialect, phase, observation) {
  const output = `${String(observation.stdout ?? '')}\n${String(observation.stderr ?? '')}`;
  if (dialect !== 'sqlite') {
    if (output.includes('KV447')) {
      throw new JourneyPhaseError(phase, `${phase} emitted SQLite-only KV447 for Postgres`);
    }
    return;
  }
  const missing = ['session', 'account'].filter(
    (table) =>
      !new RegExp(`WARN KV447 [^\\n]*Table ${table} declares owner scoping`, 'u').test(output),
  );
  if (missing.length > 0) {
    throw new JourneyPhaseError(
      phase,
      `${phase} omitted per-table KV447 warnings for ${missing.join(', ')}`,
    );
  }
}

export function requirePackedSourceCheckSuccess(observation) {
  const evidence = requirePackedPhaseSuccess('check', observation);
  try {
    return {
      ...evidence,
      sourceCheckPhaseCensus: parsePackedSourceCheckPhaseCensus(observation.stdout),
    };
  } catch (error) {
    throw new JourneyPhaseError(
      'check',
      `check did not return the complete authenticated phase census: ${
        error instanceof Error ? error.message : String(error)
      }`,
      evidence,
    );
  }
}

function shellQuoteForEvidence(value) {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/u.test(value)) return value;
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function parsePackedSourceCheckPhaseCensus(output) {
  const line = String(output ?? '')
    .split(/\r?\n/u)
    .find((candidate) => candidate.startsWith(`${PACKED_APPS_CHECK_PHASE_CENSUS_SCHEMA} `));
  if (line === undefined) {
    throw new TypeError(
      `${PACKED_APPS_CHECK_PHASE_CENSUS_SCHEMA} evidence is missing from kovo check`,
    );
  }
  let census;
  try {
    census = JSON.parse(line.slice(PACKED_APPS_CHECK_PHASE_CENSUS_SCHEMA.length + 1));
  } catch {
    throw new TypeError(`${PACKED_APPS_CHECK_PHASE_CENSUS_SCHEMA} evidence is not valid JSON`);
  }
  const findings = packedSourceCheckPhaseCensusFindings(
    census,
    PACKED_APPS_CHECK_PHASE_CENSUS_SCHEMA,
  );
  if (findings.length > 0) throw new TypeError(findings.join('; '));
  return census;
}

export function packedSourceCheckPhaseCensusFindings(
  census,
  label = PACKED_APPS_CHECK_PHASE_CENSUS_SCHEMA,
) {
  const findings = [];
  if (census?.schema !== PACKED_APPS_CHECK_PHASE_CENSUS_SCHEMA) {
    findings.push(`${label}.schema must be ${PACKED_APPS_CHECK_PHASE_CENSUS_SCHEMA}`);
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(census?.checkGraphDigest ?? '')) {
    findings.push(`${label}.checkGraphDigest must be an exact SHA-256 digest`);
  }
  if (
    census?.source?.path !== PACKED_APPS_CHECK_SOURCE ||
    census?.source?.encoding !== 'utf16le' ||
    !Number.isSafeInteger(census?.source?.codeUnitLength) ||
    census.source.codeUnitLength < 1 ||
    !/^sha256:[0-9a-f]{64}$/u.test(census?.source?.contentHash ?? '')
  ) {
    findings.push(`${label}.source must bind ${PACKED_APPS_CHECK_SOURCE} UTF-16 source bytes`);
  }
  if (!Array.isArray(census?.phases) || census.phases.length !== PACKED_APPS_CHECK_PHASES.length) {
    findings.push(
      `${label}.phases must contain all ${String(PACKED_APPS_CHECK_PHASES.length)} check phases`,
    );
    return findings;
  }
  for (let index = 0; index < PACKED_APPS_CHECK_PHASES.length; index += 1) {
    const phase = census.phases[index];
    const expectedName = PACKED_APPS_CHECK_PHASES[index];
    if (
      phase?.name !== expectedName ||
      phase?.status !== 'executed' ||
      !Number.isFinite(phase?.durationMs) ||
      phase.durationMs < 0
    ) {
      findings.push(
        `${label}.phases[${String(index)}] must prove executed ${expectedName} with a finite duration`,
      );
    }
  }
  return findings;
}

function commandFailureMessage(name, observation) {
  return boundedText(
    [
      `${name} failed: exit=${String(observation.exitCode)} signal=${String(observation.signal)}`,
      observation.error ?? '',
      observation.stderr ?? '',
      observation.stdout ?? '',
    ]
      .filter(Boolean)
      .join('\n'),
    16 * 1024,
  );
}

function transcript(phase, observation) {
  return {
    phase,
    signal: observation.signal,
    status: observation.exitCode,
    stderr: boundedText(observation.stderr ?? '', MAX_TRANSCRIPT_BYTES),
    stdout: boundedText(observation.stdout ?? '', MAX_TRANSCRIPT_BYTES),
  };
}

export function materializePackedPackage(pkg, destination) {
  if (!pkg || !Array.isArray(pkg.entries)) {
    throw new TypeError('authenticated packed package record is missing tar entries');
  }
  for (const entry of pkg.entries) {
    if (!entry.name.startsWith('package/')) {
      throw new TypeError(`${pkg.name} tarball entry is outside package/`);
    }
    const relative = entry.name.slice('package/'.length);
    if (!relative || relative.split('/').some((segment) => segment === '..' || segment === '')) {
      throw new TypeError(`${pkg.name} tarball contains an unsafe path`);
    }
    const target = path.join(destination, ...relative.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, entry.data, {
      flag: 'wx',
      mode: entry.executable ? 0o755 : 0o644,
    });
  }
}

function directoryPhysicalBytes(root) {
  const resolved = realpathSync(root);
  const seen = new Set();
  let bytes = 0;
  let files = 0;
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const stat = lstatSync(file, { bigint: true });
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        walk(file);
      } else if (stat.isFile()) {
        const identity = `${String(stat.dev)}:${String(stat.ino)}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        bytes += Number(stat.size);
        files += 1;
      }
    }
  };
  walk(resolved);
  return { bytes, files };
}

function readEnvFile(file) {
  const env = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/u)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/u.exec(line);
    if (!match) continue;
    env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/u, '$2');
  }
  return env;
}

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (address === null || typeof address === 'string') {
    throw new Error('could not reserve a loopback port');
  }
  return address.port;
}

function terminateProcessGroup(pid, signal) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function normalizeDialects(dialects) {
  if (!Array.isArray(dialects) || dialects.length === 0) {
    throw new TypeError('packed app journey requires at least one dialect');
  }
  const normalized = [...new Set(dialects)];
  for (const dialect of normalized) {
    if (!DIALECTS.includes(dialect)) throw new TypeError(`unsupported journey dialect ${dialect}`);
  }
  return normalized;
}

function requirePackedPackages(packages) {
  for (const name of PACKED_JOURNEY_PACKAGE_NAMES) {
    const pkg = packages.get(name);
    if (
      pkg?.name !== name ||
      typeof pkg.version !== 'string' ||
      typeof pkg.sha512 !== 'string' ||
      typeof pkg.tarballPath !== 'string' ||
      !Array.isArray(pkg.entries)
    ) {
      throw new TypeError(`packed app journey is missing authenticated ${name}`);
    }
  }
}

function digestFile(file) {
  return `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`;
}

function boundedText(value, maxBytes) {
  const text = String(value);
  if (Buffer.byteLength(text) <= maxBytes) return text;
  const marker = '\n[TRUNCATED]';
  const contentBytes = Math.max(0, maxBytes - Buffer.byteLength(marker));
  let truncated = Buffer.from(text).subarray(0, contentBytes).toString('utf8');
  while (Buffer.byteLength(truncated) > contentBytes) truncated = truncated.slice(0, -1);
  return `${truncated}${marker}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

class JourneyPhaseError extends Error {
  constructor(phase, message, evidence = null) {
    super(message);
    this.name = 'JourneyPhaseError';
    this.phase = phase;
    this.evidence = evidence;
  }
}
