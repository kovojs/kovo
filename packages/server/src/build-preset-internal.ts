import type { KovoNeutralBuild } from './neutral-build.js';
import {
  createWitnessWeakMap,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

/** @internal Framework-owned deployment preset names accepted by `kovo build`. */
export type KovoBuildPresetName = 'cloudflare' | 'node' | 'vercel';

/** @internal Preset-owned durable task runner capability (SPEC §9.6). */
export interface KovoBuildJobRunnerCapability {
  readonly adapter: 'node-in-process';
  readonly mode: 'serve-and-run';
}

/** @internal Deployment capabilities owned by a built-in preset. */
export interface KovoBuildPresetCapabilities {
  readonly jobRunner?: KovoBuildJobRunnerCapability;
}

/** @internal Context passed to a built-in preset's inspection implementation. */
export interface KovoBuildPresetInspectContext {
  readonly declaredEnv: readonly string[];
  readonly readServerHandlerSource?: () => Promise<string | undefined> | string | undefined;
}

/** @internal Context passed to a built-in preset's artifact emitter. */
export interface KovoBuildPresetContext extends KovoBuildPresetInspectContext {
  readonly log: (message: string) => void;
  readonly outDir: string;
  readonly projectRoot?: string;
  readonly readNeutral: () => KovoNeutralBuild;
}

/** @internal Diagnostic returned by a framework-owned preset implementation. */
export interface KovoBuildPresetDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: 'error' | 'warning';
}

/**
 * Framework-private preset engine. Public preset values are opaque registry keys and never expose
 * these build-authority callbacks reflectively (SPEC §5.2 and §6.6).
 *
 * @internal
 */
export interface KovoBuildPreset {
  readonly capabilities?: KovoBuildPresetCapabilities;
  readonly emit: (build: KovoNeutralBuild, context: KovoBuildPresetContext) => Promise<void> | void;
  readonly inspect?: (
    build: KovoNeutralBuild,
    context: KovoBuildPresetInspectContext,
  ) => Promise<readonly KovoBuildPresetDiagnostic[]> | readonly KovoBuildPresetDiagnostic[];
  readonly name: KovoBuildPresetName;
}

const presetEngines = createWitnessWeakMap<object, KovoBuildPreset>();

/** @internal Register one frozen public token with its framework-private preset engine. */
export function registerKovoBuildPreset<Token extends object>(
  token: Token,
  engine: KovoBuildPreset,
): Token {
  if (witnessWeakMapGet(presetEngines, token) !== undefined) {
    throw new TypeError('Kovo build preset token is already registered.');
  }
  witnessWeakMapSet(presetEngines, token, engine);
  return token;
}

/** @internal Resolve only an exact token produced by this module instance's built-in factories. */
export function resolveKovoBuildPreset(value: unknown): KovoBuildPreset | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  return witnessWeakMapGet(presetEngines, value);
}
