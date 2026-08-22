/* oxlint-disable typescript/no-unsafe-type-assertion -- TypeScript is resolved from the app package. */
import { hash as builtinHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { findNearestFile } from '../tooling.js';
import {
  createKovoSourceCheckFactAuthenticationAuthority,
  type KovoSourceCheckFactAuthenticationAuthority,
} from './build-crypto-authority.js';
import { kovoBuildOneShotDigest } from './build-one-shot-handoff.js';
import type { KovoSourceCheckProducerFactSession } from './build-export.js';

type TypeScriptApi = typeof import('typescript');
type SemanticBuilderProgram = import('typescript').SemanticDiagnosticsBuilderProgram;

const factDigestPattern = /^sha256:[0-9a-f]{64}$/u;
const factSchema = 'kovo-check-session-producer-fact/v1';
const typeScriptFactSchema = 'kovo-check-typescript-semantic-fact/v1';
const maximumFactEntries = 32;
const maximumFactPayloadBytes = 64 * 1024 * 1024;
const maximumFactTotalBytes = 256 * 1024 * 1024;
const hash = builtinHash;

type SerializableProducerPhase = 'app-source-trust' | 'config-trust' | 'stylesheet';

interface AuthenticatedProducerFact {
  readonly authentication: Buffer;
  readonly bytes: number;
  readonly payload: string;
}

interface TypeScriptBuilderState {
  readonly builder: SemanticBuilderProgram;
  readonly compatibilityDigest: string;
  readonly modulePath: string;
  readonly sourceFiles: ReadonlyMap<string, string>;
  readonly typescript: TypeScriptApi;
}

/** @internal Observable evidence for focused lifecycle and performance tests. */
export interface KovoSourceCheckSessionFactCacheSnapshot {
  readonly closed: boolean;
  readonly enabled: boolean;
  readonly entries: number;
  readonly hits: number;
  readonly misses: number;
  readonly payloadBytes: number;
  readonly typescript: {
    readonly changedFiles: number;
    readonly inputDigest: string;
    readonly programFiles: number;
    readonly reusedFiles: number;
  } | null;
}

/**
 * Session-confined compiler fact store for `kovo check source --watch`.
 *
 * Static/style payloads remain inert JSON strings authenticated with a process-random HMAC key.
 * TypeScript keeps only the compiler-owned semantic BuilderProgram in memory. Nothing is written
 * to `.kovo/cache`, and closing the foreground session destroys every retained value.
 */
export class KovoSourceCheckSessionFactCache implements KovoSourceCheckProducerFactSession {
  readonly #authenticationAuthority: KovoSourceCheckFactAuthenticationAuthority;
  readonly #enabled: boolean;
  readonly #facts = new Map<string, AuthenticatedProducerFact>();
  #closed = false;
  #hits = 0;
  #misses = 0;
  #payloadBytes = 0;
  #typescriptState: TypeScriptBuilderState | undefined;
  #typescriptSnapshot: KovoSourceCheckSessionFactCacheSnapshot['typescript'] = null;

  constructor(enabled: boolean) {
    if (typeof enabled !== 'boolean') {
      throw new TypeError('Source-check session cache posture must be boolean.');
    }
    this.#authenticationAuthority = createKovoSourceCheckFactAuthenticationAuthority();
    this.#enabled = enabled;
  }

  consumeProducerFact(phase: SerializableProducerPhase, inputDigest: string): string | undefined {
    this.#assertOpen();
    const key = this.#factKey(phase, inputDigest);
    if (!this.#enabled) {
      this.#misses += 1;
      return undefined;
    }
    const fact = this.#facts.get(key);
    if (fact === undefined) {
      this.#misses += 1;
      return undefined;
    }
    if (!this.#authenticationAuthority.verifyFact(key, fact.payload, fact.authentication)) {
      this.#deleteFact(key, fact);
      this.#misses += 1;
      return undefined;
    }
    this.#hits += 1;
    return fact.payload;
  }

  storeProducerFact(phase: SerializableProducerPhase, inputDigest: string, payload: string): void {
    this.#assertOpen();
    const key = this.#factKey(phase, inputDigest);
    if (typeof payload !== 'string') {
      throw new TypeError('Source-check producer fact payload must be a string.');
    }
    if (!this.#enabled) return;
    const bytes = Buffer.byteLength(payload, 'utf8');
    if (bytes > maximumFactPayloadBytes) {
      throw new TypeError('Source-check producer fact payload exceeds its byte limit.');
    }
    const previous = this.#facts.get(key);
    if (previous !== undefined) this.#deleteFact(key, previous);
    while (
      this.#facts.size >= maximumFactEntries ||
      this.#payloadBytes + bytes > maximumFactTotalBytes
    ) {
      const oldestKey = this.#facts.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldest = this.#facts.get(oldestKey);
      if (oldest === undefined) break;
      this.#deleteFact(oldestKey, oldest);
    }
    this.#facts.set(key, {
      authentication: this.#authenticate(key, payload),
      bytes,
      payload,
    });
    this.#payloadBytes += bytes;
  }

  async runTypeScriptPreflight(input: {
    readonly appModulePath: string;
    readonly invocationEnv: NodeJS.ProcessEnv;
    readonly invocationRoot: string;
  }): Promise<
    | {
        readonly executed: boolean;
        readonly inputDigest: string | null;
        readonly reusedAuthenticated: boolean;
      }
    | undefined
  > {
    this.#assertOpen();
    const relativeAppPath = relative(input.invocationRoot, input.appModulePath);
    if (
      isAbsolute(relativeAppPath) ||
      relativeAppPath.split(/[\\/]/u).some((part) => part.startsWith('.'))
    ) {
      return { executed: false, inputDigest: null, reusedAuthenticated: false };
    }
    const tsconfigPath = findNearestFile(dirname(input.appModulePath), 'tsconfig.json', {
      stopDir: input.invocationRoot,
    });
    if (tsconfigPath === undefined) {
      return { executed: false, inputDigest: null, reusedAuthenticated: false };
    }

    try {
      const projectDir = dirname(tsconfigPath);
      const projectRequire = createRequire(join(projectDir, 'package.json'));
      const modulePath = realpathSync(projectRequire.resolve('typescript'));
      const typescript = projectRequire(modulePath) as TypeScriptApi;
      const configReads = new Map<string, string>();
      const packageReads = new Map<string, string>();
      const rootConfigText = readFileSync(tsconfigPath, 'utf8');
      configReads.set(realpathOrResolved(tsconfigPath), rootConfigText);
      const config = typescript.parseConfigFileTextToJson(tsconfigPath, rootConfigText);
      if (config.error !== undefined) return undefined;
      const parseHost: import('typescript').ParseConfigHost = {
        fileExists: (path) => typescript.sys.fileExists(path),
        readDirectory: (path, extensions, excludes, includes, depth) =>
          typescript.sys.readDirectory(path, extensions, excludes, includes, depth),
        readFile(path) {
          const source = typescript.sys.readFile(path);
          if (source !== undefined) recordCompilerRead(path, source, configReads, packageReads);
          return source;
        },
        useCaseSensitiveFileNames: typescript.sys.useCaseSensitiveFileNames,
      };
      const parsed = typescript.parseJsonConfigFileContent(
        config.config,
        parseHost,
        projectDir,
        {
          allowImportingTsExtensions: true,
          incremental: true,
          noEmit: true,
        },
        tsconfigPath,
      );
      if (parsed.errors.length > 0) return undefined;
      const { tsBuildInfoFile: _discardedBuildInfoPath, ...parsedOptions } = parsed.options;
      const compilerOptions: import('typescript').CompilerOptions = {
        ...parsedOptions,
        allowImportingTsExtensions: true,
        incremental: true,
        noEmit: true,
      };
      const compatibilityDigest = kovoBuildOneShotDigest({
        compilerOptions,
        fileNames: parsed.fileNames,
        modulePath,
        projectReferences: parsed.projectReferences ?? [],
        schema: typeScriptFactSchema,
        tsconfigPath,
        typescriptVersion: typescript.version,
      });
      const previous =
        this.#enabled &&
        this.#typescriptState?.modulePath === modulePath &&
        this.#typescriptState.compatibilityDigest === compatibilityDigest
          ? this.#typescriptState
          : undefined;
      const host = typescript.createIncrementalCompilerHost(compilerOptions);
      // A BuilderProgram may reuse its prior module-resolution cache even when package exports or
      // an installed dependency changed without an authored importer edit. The watch session can
      // retain semantic/source facts, but resolution itself must be refreshed on every revision so
      // the new Program is bound to the currently installed package graph (SPEC §11.4).
      host.hasInvalidatedResolutions = () => true;
      const readFile = host.readFile.bind(host);
      host.readFile = (path: string): string | undefined => {
        const source = readFile(path);
        if (source !== undefined) recordCompilerRead(path, source, configReads, packageReads);
        return source;
      };
      host.writeFile = () => {
        throw new TypeError('Kovo foreground TypeScript preflight attempted to write output.');
      };
      const builder = typescript.createSemanticDiagnosticsBuilderProgram(
        parsed.fileNames,
        compilerOptions,
        host,
        previous?.builder,
        parsed.errors,
        parsed.projectReferences,
      );
      const diagnosticCount =
        builder.getConfigFileParsingDiagnostics().length +
        builder.getOptionsDiagnostics().length +
        builder.getGlobalDiagnostics().length +
        builder.getSyntacticDiagnostics().length +
        builder.getSemanticDiagnostics().length +
        (compilerOptions.declaration || compilerOptions.composite
          ? builder.getDeclarationDiagnostics().length
          : 0);
      if (diagnosticCount > 0) return undefined;

      const sourceRows = builder
        .getSourceFiles()
        .map((sourceFile) => ({
          digest: sha256(sourceFile.text),
          path: realpathOrResolved(sourceFile.fileName),
        }))
        .sort(comparePathRows);
      appendNearestPackageInputs(input.appModulePath, input.invocationRoot, packageReads);
      const typescriptManifest = findNearestFile(dirname(modulePath), 'package.json');
      if (typescriptManifest !== undefined) {
        const source = readFileSync(typescriptManifest, 'utf8');
        packageReads.set(realpathOrResolved(typescriptManifest), source);
      }
      const identity = {
        configDigest: digestCompilerReads(configReads),
        packageDigest: digestCompilerReads(packageReads),
        schema: typeScriptFactSchema,
        sourceDigest: kovoBuildOneShotDigest(sourceRows),
        versionDigest: kovoBuildOneShotDigest({
          modulePath,
          node: process.version,
          typescript: typescript.version,
        }),
      } as const;
      const inputDigest = kovoBuildOneShotDigest(identity);
      const sourceFiles = new Map<string, string>();
      let reusedFiles = 0;
      for (const sourceFile of builder.getSourceFiles()) {
        const digest = sha256(sourceFile.text);
        sourceFiles.set(sourceFile.fileName, digest);
        if (previous?.sourceFiles.get(sourceFile.fileName) === digest) reusedFiles += 1;
      }
      const programFiles = sourceFiles.size;
      const changedFiles = programFiles - reusedFiles;
      const reusedAuthenticated = previous !== undefined && reusedFiles > 0;
      this.#typescriptSnapshot = {
        changedFiles,
        inputDigest,
        programFiles,
        reusedFiles,
      };
      if (this.#enabled) {
        this.#typescriptState = {
          builder,
          compatibilityDigest,
          modulePath,
          sourceFiles,
          typescript,
        };
      }
      if (reusedAuthenticated) this.#hits += 1;
      else this.#misses += 1;
      return { executed: true, inputDigest, reusedAuthenticated };
    } catch {
      // Any loader/config/program ambiguity falls back to the ordinary one-shot tsc producer,
      // which owns the canonical diagnostic text and exit class.
      return undefined;
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#facts.clear();
    this.#payloadBytes = 0;
    this.#typescriptState = undefined;
    this.#typescriptSnapshot = null;
    this.#authenticationAuthority.destroy();
    this.#closed = true;
  }

  snapshot(): KovoSourceCheckSessionFactCacheSnapshot {
    return Object.freeze({
      closed: this.#closed,
      enabled: this.#enabled,
      entries: this.#facts.size,
      hits: this.#hits,
      misses: this.#misses,
      payloadBytes: this.#payloadBytes,
      typescript: this.#typescriptSnapshot,
    });
  }

  #assertOpen(): void {
    if (this.#closed) throw new TypeError('Source-check session cache is closed.');
  }

  #authenticate(key: string, payload: string): Buffer {
    return this.#authenticationAuthority.authenticate(key, payload);
  }

  #deleteFact(key: string, fact: AuthenticatedProducerFact): void {
    this.#facts.delete(key);
    this.#payloadBytes -= fact.bytes;
  }

  #factKey(phase: SerializableProducerPhase, inputDigest: string): string {
    if (
      (phase !== 'app-source-trust' && phase !== 'config-trust' && phase !== 'stylesheet') ||
      typeof inputDigest !== 'string' ||
      !factDigestPattern.test(inputDigest)
    ) {
      throw new TypeError('Source-check producer fact key is invalid.');
    }
    return kovoBuildOneShotDigest({ inputDigest, phase, schema: factSchema });
  }
}

function recordCompilerRead(
  path: string,
  source: string,
  configReads: Map<string, string>,
  packageReads: Map<string, string>,
): void {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const canonical = realpathOrResolved(path);
  if (name === 'package.json' || name.endsWith('.lock') || name.endsWith('-lock.yaml')) {
    packageReads.set(canonical, source);
  }
  if (/^(?:.*\/)?(?:jsconfig|tsconfig)(?:\.[^/]*)?\.json$/iu.test(path.replaceAll('\\', '/'))) {
    configReads.set(canonical, source);
  }
}

function appendNearestPackageInputs(
  appModulePath: string,
  invocationRoot: string,
  packageReads: Map<string, string>,
): void {
  const manifest = findNearestFile(dirname(appModulePath), 'package.json', {
    stopDir: invocationRoot,
  });
  if (manifest !== undefined) {
    packageReads.set(realpathOrResolved(manifest), readFileSync(manifest, 'utf8'));
  }
  const lockfile = findNearestFile(dirname(appModulePath), 'pnpm-lock.yaml');
  if (lockfile !== undefined) {
    packageReads.set(realpathOrResolved(lockfile), readFileSync(lockfile, 'utf8'));
  }
}

function digestCompilerReads(reads: ReadonlyMap<string, string>): string {
  const rows = [...reads.entries()]
    .map(([path, source]) => ({ digest: sha256(source), path }))
    .sort(comparePathRows);
  return kovoBuildOneShotDigest(rows);
}

function comparePathRows(
  left: { readonly path: string },
  right: { readonly path: string },
): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function realpathOrResolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function sha256(source: string): string {
  return `sha256:${hash('sha256', source, 'hex')}`;
}
