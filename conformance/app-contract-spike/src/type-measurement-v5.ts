import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { cpus, arch, platform, release } from 'node:os';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';

import ts from 'typescript';

import type { PrototypeFixture } from './fixture-v5.ts';

type MeasuredVariant = 'arm-a' | 'arm-b' | 'baseline';

const require = createRequire(import.meta.url);
const tscPath = require.resolve('typescript/bin/tsc');
const warmCompletionBatchSize = 31;
const measuredVariants = ['baseline', 'arm-a', 'arm-b'] as const;
const balancedVariantOrders = [
  ['baseline', 'arm-a', 'arm-b'],
  ['baseline', 'arm-b', 'arm-a'],
  ['arm-a', 'baseline', 'arm-b'],
  ['arm-a', 'arm-b', 'baseline'],
  ['arm-b', 'baseline', 'arm-a'],
  ['arm-b', 'arm-a', 'baseline'],
] as const satisfies readonly (readonly MeasuredVariant[])[];

export interface PerformanceCriteria {
  readonly diagnosticThresholds: {
    readonly misspelledProperty: string;
  };
  readonly performanceThresholds: {
    readonly coldCompletionRepeats: number;
    readonly coldTscRepeats: number;
    readonly warmCompletionRepeats: number;
    readonly warmTscRepeats: number;
  };
  readonly workload: {
    readonly declarationFilesPerVariant: number;
    readonly declarationsPerFile: number;
  };
}

export interface SuccessfulTypeMeasurement {
  readonly coldCompletionMs: readonly number[];
  readonly coldCompletionP50Ms: number;
  readonly coldTscMs: readonly number[];
  readonly coldTscP50Ms: number;
  readonly completionCandidateCount: number;
  readonly completionCandidateDigest: string;
  readonly completionCandidateNames: readonly string[];
  readonly declarationBytes: number;
  readonly typecheckDiagnosticCodes: readonly number[];
  readonly warmCompletionMs: readonly number[];
  readonly warmCompletionP95Ms: number;
  readonly warmTscMs: readonly number[];
  readonly warmTscP50Ms: number;
}

export interface TypeDiagnosticEvidence {
  readonly code: number;
  readonly expectedStart: number;
  readonly fileName: string;
  readonly length: number;
  readonly message: string;
  readonly start: number;
}

export interface TypeMeasurementEvidence {
  readonly diagnostics: Readonly<Record<MeasuredVariant, TypeDiagnosticEvidence>>;
  readonly measurements: Readonly<Record<MeasuredVariant, SuccessfulTypeMeasurement>>;
  readonly runner: {
    readonly architecture: string;
    readonly cpuModel: string;
    readonly nodeVersion: string;
    readonly operatingSystem: string;
    readonly schema: 'kovo.app-contract-d1-runner/v1';
    readonly typescriptVersion: string;
  };
  readonly schedules: {
    readonly coldCompletion: readonly (readonly MeasuredVariant[])[];
    readonly tsc: readonly (readonly MeasuredVariant[])[];
    readonly warmCompletion: readonly (readonly MeasuredVariant[])[];
  };
}

interface TypeMeasurementSamples {
  readonly coldCompletionMs: number[];
  readonly coldTscMs: number[];
  completionCandidateNames: readonly string[];
  declarationBytes: number;
  readonly warmCompletionMs: number[];
  readonly warmTscMs: number[];
}

interface WarmCompletionSession {
  readonly fileName: string;
  readonly position: number;
  readonly service: ts.LanguageService;
}

export async function measureTypeContracts(
  fixture: PrototypeFixture,
  criteria: PerformanceCriteria,
): Promise<TypeMeasurementEvidence> {
  const variants = {} as Record<MeasuredVariant, string>;
  for (const variant of measuredVariants) {
    const directory = join(fixture.app, 'd1-measure', variant);
    variants[variant] = directory;
    await writeMeasurementFixture(directory, variant, criteria);
  }
  const measured = await measureSuccessfulVariants(variants, criteria);
  const diagnostics = {} as Record<MeasuredVariant, TypeDiagnosticEvidence>;
  for (const variant of measuredVariants) {
    diagnostics[variant] = await diagnosticEvidence(variants[variant], criteria);
  }
  return {
    diagnostics,
    measurements: measured.measurements,
    runner: {
      architecture: arch(),
      cpuModel: cpus()[0]?.model ?? 'unknown',
      nodeVersion: process.version,
      operatingSystem: `${platform()} ${release()}`,
      schema: 'kovo.app-contract-d1-runner/v1',
      typescriptVersion: ts.version,
    },
    schedules: measured.schedules,
  };
}

async function writeMeasurementFixture(
  directory: string,
  variant: MeasuredVariant,
  criteria: PerformanceCriteria,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  for (
    let fileIndex = 0;
    fileIndex < criteria.workload.declarationFilesPerVariant;
    fileIndex += 1
  ) {
    await writeSource(
      join(directory, `declarations-${fileIndex}.ts`),
      measurementDeclarationSource(variant, fileIndex, criteria),
    );
  }
  await writeSource(join(directory, 'completion.ts'), completionSource(variant));
  await writeSource(
    join(directory, 'diagnostic.ts'),
    diagnosticSource(variant, criteria.diagnosticThresholds.misspelledProperty),
  );
  await writeJson(join(directory, 'tsconfig.json'), {
    compilerOptions: {
      declaration: true,
      declarationMap: false,
      exactOptionalPropertyTypes: true,
      incremental: true,
      lib: ['ES2024', 'DOM', 'DOM.Iterable'],
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      noEmit: true,
      rootDir: '../..',
      skipLibCheck: true,
      strict: true,
      target: 'ES2024',
      tsBuildInfoFile: './.tsbuildinfo',
    },
    exclude: ['completion.ts', 'diagnostic.ts'],
    include: ['declarations-*.ts'],
  });
}

function measurementDeclarationSource(
  variant: MeasuredVariant,
  fileIndex: number,
  criteria: PerformanceCriteria,
): string {
  const { factory, imports } = variantSyntax(variant);
  const declarations = Array.from(
    { length: criteria.workload.declarationsPerFile },
    (_, declarationIndex) => {
      const identity = fileIndex * criteria.workload.declarationsPerFile + declarationIndex;
      return [
        `export const query${identity} = ${factory}({`,
        "  access: publicAccess('D1 v5 actual-contract measurement'),",
        '  load() {',
        `    return { id: ${identity}, status: 'ok' } as const;`,
        '  },',
        '});',
      ].join('\n');
    },
  );
  return `${imports}\n\n${declarations.join('\n\n')}\n`;
}

function completionSource(variant: MeasuredVariant): string {
  const { factory, imports } = variantSyntax(variant);
  return [
    imports,
    `${factory}({`,
    "  access: publicAccess('D1 v5 completion'),",
    '  /*cursor*/',
    '});',
    '',
  ].join('\n');
}

function diagnosticSource(variant: MeasuredVariant, misspelledProperty: string): string {
  const { factory, imports } = variantSyntax(variant);
  return [
    imports,
    'type ExpectedDefinition = {',
    '  readonly access: ReturnType<typeof publicAccess>;',
    '  load(): { readonly ok: boolean };',
    '};',
    'const definition: ExpectedDefinition = {',
    "  access: publicAccess('D1 v5 diagnostic'),",
    `  ${misspelledProperty}() { return { ok: true }; },`,
    '};',
    `${factory}(definition);`,
    '',
  ].join('\n');
}

function variantSyntax(variant: MeasuredVariant): {
  readonly factory: string;
  readonly imports: string;
} {
  if (variant === 'baseline') {
    return {
      factory: 'query',
      imports: "import { publicAccess, query } from '@kovojs/server';",
    };
  }
  if (variant === 'arm-b') {
    return {
      factory: 'query',
      imports: "import { publicAccess, query } from '#kovo';",
    };
  }
  return {
    factory: 'app.query',
    imports: [
      "import { publicAccess } from '@kovojs/server';",
      "import { app } from '../../src/kovo.js';",
    ].join('\n'),
  };
}

async function measureSuccessfulVariants(
  directories: Readonly<Record<MeasuredVariant, string>>,
  criteria: PerformanceCriteria,
): Promise<{
  readonly measurements: Readonly<Record<MeasuredVariant, SuccessfulTypeMeasurement>>;
  readonly schedules: TypeMeasurementEvidence['schedules'];
}> {
  if (
    criteria.performanceThresholds.warmTscRepeats !== criteria.performanceThresholds.coldTscRepeats
  ) {
    throw new Error('D1 v5 requires equal cold and warm tsc repeat counts.');
  }
  const samples = Object.fromEntries(
    measuredVariants.map((variant) => [
      variant,
      {
        coldCompletionMs: [],
        coldTscMs: [],
        completionCandidateNames: [],
        declarationBytes: 0,
        warmCompletionMs: [],
        warmTscMs: [],
      } satisfies TypeMeasurementSamples,
    ]),
  ) as unknown as Record<MeasuredVariant, TypeMeasurementSamples>;
  const tscSchedule: (readonly MeasuredVariant[])[] = [];
  for (let index = 0; index < criteria.performanceThresholds.coldTscRepeats; index += 1) {
    const order = measurementOrder(index);
    tscSchedule.push(order);
    for (const variant of order) {
      const directory = directories[variant];
      await rm(join(directory, '.tsbuildinfo'), { force: true });
      const cold = typecheck(directory);
      if (!cold.ok) throw new Error(`D1 v5 type fixture failed: ${cold.output}`);
      samples[variant].coldTscMs.push(cold.elapsedMs);
      const warm = typecheck(directory);
      if (!warm.ok) throw new Error(`D1 v5 warm type fixture failed: ${warm.output}`);
      samples[variant].warmTscMs.push(warm.elapsedMs);
    }
  }
  for (const variant of measuredVariants) {
    samples[variant].declarationBytes = await emitDeclarationBytes(directories[variant]);
  }

  const coldCompletionSchedule: (readonly MeasuredVariant[])[] = [];
  for (let index = 0; index < criteria.performanceThresholds.coldCompletionRepeats; index += 1) {
    const order = measurementOrder(index);
    coldCompletionSchedule.push(order);
    for (const variant of order) {
      const completion = await completionMeasurement(directories[variant]);
      samples[variant].coldCompletionMs.push(completion.elapsedMs);
      samples[variant].completionCandidateNames = completion.names;
    }
  }

  const warmCompletionSchedule: (readonly MeasuredVariant[])[] = [];
  const sessions = {} as Record<MeasuredVariant, WarmCompletionSession>;
  try {
    for (const variant of measuredVariants) {
      sessions[variant] = await warmCompletionSession(directories[variant]);
    }
    for (const variant of measurementOrder(0)) {
      sessions[variant].service.getCompletionsAtPosition(
        sessions[variant].fileName,
        sessions[variant].position,
        {},
      );
    }
    for (let index = 0; index < criteria.performanceThresholds.warmCompletionRepeats; index += 1) {
      const order = measurementOrder(index);
      warmCompletionSchedule.push(order);
      for (const variant of order) {
        const completion = warmCompletionMeasurement(sessions[variant]);
        samples[variant].warmCompletionMs.push(completion.elapsedMs);
        samples[variant].completionCandidateNames = completion.names;
      }
    }
  } finally {
    for (const variant of measuredVariants) sessions[variant]?.service.dispose();
  }

  const measurements = {} as Record<MeasuredVariant, SuccessfulTypeMeasurement>;
  for (const variant of measuredVariants) {
    const variantSamples = samples[variant];
    if (variantSamples.completionCandidateNames.length === 0) {
      throw new Error(`D1 v5 completion fixture produced no candidates for ${variant}.`);
    }
    measurements[variant] = {
      coldCompletionMs: rounded(variantSamples.coldCompletionMs),
      coldCompletionP50Ms: round(percentile(variantSamples.coldCompletionMs, 0.5)),
      coldTscMs: rounded(variantSamples.coldTscMs),
      coldTscP50Ms: round(percentile(variantSamples.coldTscMs, 0.5)),
      completionCandidateCount: variantSamples.completionCandidateNames.length,
      completionCandidateDigest: createHash('sha256')
        .update(variantSamples.completionCandidateNames.join('\n'))
        .digest('hex'),
      completionCandidateNames: variantSamples.completionCandidateNames,
      declarationBytes: variantSamples.declarationBytes,
      typecheckDiagnosticCodes: [],
      warmCompletionMs: rounded(variantSamples.warmCompletionMs),
      warmCompletionP95Ms: round(percentile(variantSamples.warmCompletionMs, 0.95)),
      warmTscMs: rounded(variantSamples.warmTscMs),
      warmTscP50Ms: round(percentile(variantSamples.warmTscMs, 0.5)),
    };
  }
  return {
    measurements,
    schedules: {
      coldCompletion: coldCompletionSchedule,
      tsc: tscSchedule,
      warmCompletion: warmCompletionSchedule,
    },
  };
}

async function emitDeclarationBytes(directory: string): Promise<number> {
  const declarationDirectory = join(directory, 'declarations');
  await rm(declarationDirectory, { force: true, recursive: true });
  const emitted = spawnSync(
    process.execPath,
    [
      tscPath,
      '-p',
      join(directory, 'tsconfig.json'),
      '--incremental',
      'false',
      '--noEmit',
      'false',
      '--emitDeclarationOnly',
      '--declaration',
      '--declarationMap',
      'false',
      '--outDir',
      declarationDirectory,
    ],
    { cwd: directory, encoding: 'utf8' },
  );
  if (emitted.status !== 0) {
    throw new Error(`D1 v5 declaration emit failed:\n${emitted.stdout}${emitted.stderr}`);
  }
  return directoryBytes(declarationDirectory);
}

async function warmCompletionSession(directory: string): Promise<WarmCompletionSession> {
  const fileName = join(directory, 'completion.ts');
  const source = await readFile(fileName, 'utf8');
  return {
    fileName,
    position: source.indexOf('/*cursor*/'),
    service: await languageService(directory),
  };
}

function warmCompletionMeasurement(session: WarmCompletionSession): {
  readonly elapsedMs: number;
  readonly names: readonly string[];
} {
  let completion: ts.CompletionInfo | undefined;
  const batchElapsedMs: number[] = [];
  for (let index = 0; index < warmCompletionBatchSize; index += 1) {
    const started = performance.now();
    completion = session.service.getCompletionsAtPosition(session.fileName, session.position, {});
    batchElapsedMs.push(performance.now() - started);
  }
  return {
    elapsedMs: percentile(batchElapsedMs, 0.5),
    names: unique(completion?.entries.map((entry) => entry.name) ?? []),
  };
}

async function diagnosticEvidence(
  directory: string,
  criteria: PerformanceCriteria,
): Promise<TypeDiagnosticEvidence> {
  const fileName = join(directory, 'diagnostic.ts');
  const source = await readFile(fileName, 'utf8');
  const program = ts.createProgram({ options: compilerOptions(), rootNames: [fileName] });
  const expectedStart = source.indexOf(criteria.diagnosticThresholds.misspelledProperty);
  const diagnostic = ts
    .getPreEmitDiagnostics(program)
    .find(
      (entry) =>
        entry.file?.fileName === fileName &&
        entry.start !== undefined &&
        entry.start <= expectedStart &&
        (entry.start + (entry.length ?? 0) > expectedStart ||
          ts
            .flattenDiagnosticMessageText(entry.messageText, '\n')
            .includes(criteria.diagnosticThresholds.misspelledProperty)),
    );
  if (!diagnostic || diagnostic.start === undefined) {
    throw new Error('D1 v5 diagnostic fixture did not localize the misspelled property.');
  }
  return {
    code: diagnostic.code,
    expectedStart,
    fileName: `<fixture>/app/d1-measure/${directory.split('/').at(-1)}/diagnostic.ts`,
    length: diagnostic.length ?? 0,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    start: diagnostic.start,
  };
}

function typecheck(directory: string): {
  readonly elapsedMs: number;
  readonly ok: boolean;
  readonly output: string;
} {
  const started = performance.now();
  const result = spawnSync(
    process.execPath,
    [
      tscPath,
      '-p',
      join(directory, 'tsconfig.json'),
      '--incremental',
      '--tsBuildInfoFile',
      join(directory, '.tsbuildinfo'),
    ],
    { cwd: directory, encoding: 'utf8' },
  );
  return {
    elapsedMs: performance.now() - started,
    ok: result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

async function completionMeasurement(
  directory: string,
): Promise<{ readonly elapsedMs: number; readonly names: readonly string[] }> {
  const service = await languageService(directory);
  try {
    const fileName = join(directory, 'completion.ts');
    const source = await readFile(fileName, 'utf8');
    const position = source.indexOf('/*cursor*/');
    const started = performance.now();
    const completion = service.getCompletionsAtPosition(fileName, position, {});
    return {
      elapsedMs: performance.now() - started,
      names: unique(completion?.entries.map((entry) => entry.name) ?? []),
    };
  } finally {
    service.dispose();
  }
}

async function languageService(directory: string): Promise<ts.LanguageService> {
  const files = [join(directory, 'completion.ts')];
  for (const entry of await readdir(directory)) {
    if (entry.startsWith('declarations-') && entry.endsWith('.ts')) {
      files.push(join(directory, entry));
    }
  }
  const options = compilerOptions();
  const host: ts.LanguageServiceHost = {
    fileExists: ts.sys.fileExists,
    getCompilationSettings: () => options,
    getCurrentDirectory: () => directory,
    getDefaultLibFileName: (settings) => ts.getDefaultLibFilePath(settings),
    getScriptFileNames: () => files,
    getScriptSnapshot: (fileName) => {
      const source = ts.sys.readFile(fileName);
      return source === undefined ? undefined : ts.ScriptSnapshot.fromString(source);
    },
    getScriptVersion: () => '0',
    readDirectory: ts.sys.readDirectory,
    readFile: ts.sys.readFile,
  };
  return ts.createLanguageService(host);
}

function compilerOptions(): ts.CompilerOptions {
  return {
    exactOptionalPropertyTypes: true,
    lib: ['lib.es2024.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2024,
  };
}

async function directoryBytes(directory: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fileName = join(directory, entry.name);
    total += entry.isDirectory() ? await directoryBytes(fileName) : (await stat(fileName)).size;
  }
  return total;
}

function measurementOrder(index: number): readonly MeasuredVariant[] {
  return balancedVariantOrders[index % balancedVariantOrders.length]!;
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function rounded(values: readonly number[]): readonly number[] {
  return values.map(round);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

async function writeJson(fileName: string, value: unknown): Promise<void> {
  await writeSource(fileName, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeSource(fileName: string, source: string): Promise<void> {
  await mkdir(dirname(fileName), { recursive: true });
  await writeFile(fileName, source);
}
