import { extractKovoRuntimeDbMetadata, type KovoRuntimeDbMetadata } from '@kovojs/drizzle';
import { extractCompilerBoundKovoRuntimeDbMetadata as extractDrizzleCompilerBoundRuntimeDbMetadata } from '@kovojs/drizzle/internal/runtime-metadata';

import {
  runtimeRegistryTableSecurityFromFacts,
  type RuntimeTableSecurityWireManifest,
} from './internal/runtime-registry-wire.js';
import { buildSecuritySourceLiteral } from './build-security-intrinsics.js';

let registeredManifest: RuntimeTableSecurityWireManifest | undefined;
let registeredManifestLiteral: string | undefined;
let registeredManifestPermanent = false;

/**
 * @internal Register the compiler-owned table-security manifest before app modules evaluate.
 *
 * First registration wins permanently. Generated entry modules execute before authored imports;
 * a later app/plugin import therefore cannot replace authorization or confidentiality authority
 * with a forged Drizzle callback projection (SPEC §6.6 rule 5 / §10.3).
 */
export function registerGeneratedTableSecurityManifest(
  manifest: RuntimeTableSecurityWireManifest,
): RuntimeTableSecurityWireManifest {
  const { literal, snapshot } = snapshotGeneratedTableSecurityManifest(manifest);
  if (registeredManifest !== undefined) {
    if (literal === registeredManifestLiteral) {
      // A generated boot registration permanently adopts an identical command-scoped snapshot.
      // Otherwise the caller that installed the temporary copy could retain its release closure,
      // clear the compiler authority after this function returned, and make runtime extraction
      // fall back to mutable Drizzle callbacks (SPEC §6.6 rule 6 / §10.3 C9).
      registeredManifestPermanent = true;
      return snapshot;
    }
    throw new TypeError('Generated table-security manifest is already registered for this boot.');
  }
  registeredManifest = snapshot;
  registeredManifestLiteral = literal;
  registeredManifestPermanent = true;
  return snapshot;
}

/**
 * @internal Install compiler facts for one CLI DB-command lifetime.
 *
 * The CLI calls this before authored schema evaluation and retains the returned module-private
 * release closure. A later app/plugin call cannot acquire a release capability once a manifest is
 * installed; production generated entries use the permanent registration function above.
 */
export function installGeneratedTableSecurityManifestForCommand(
  manifest: RuntimeTableSecurityWireManifest,
): () => void {
  const { literal, snapshot } = snapshotGeneratedTableSecurityManifest(manifest);
  if (registeredManifest !== undefined) {
    if (literal !== registeredManifestLiteral) {
      throw new TypeError('Generated table-security manifest is already registered for this boot.');
    }
    return () => {};
  }
  registeredManifest = snapshot;
  registeredManifestLiteral = literal;
  registeredManifestPermanent = false;
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    if (
      !registeredManifestPermanent &&
      registeredManifest === snapshot &&
      registeredManifestLiteral === literal
    ) {
      registeredManifest = undefined;
      registeredManifestLiteral = undefined;
      registeredManifestPermanent = false;
    }
  };
}

/** @internal Return the compiler-owned manifest registered for this app boot, if present. */
export function registeredGeneratedTableSecurityManifest():
  | RuntimeTableSecurityWireManifest
  | undefined {
  return registeredManifest;
}

/**
 * @internal Extract runtime column identities while binding every security fact to compiler source.
 *
 * The no-manifest fallback supports direct framework-library tests and non-generated tooling. Kovo
 * dev/prod entries always register the manifest first; those supported app paths compare the exact
 * runtime schema and fail closed on any callback-slot replacement.
 */
export function extractCompilerBoundKovoRuntimeDbMetadata(
  tables: readonly unknown[],
): KovoRuntimeDbMetadata {
  const manifest = registeredManifest;
  return manifest === undefined
    ? extractKovoRuntimeDbMetadata(tables)
    : extractDrizzleCompilerBoundRuntimeDbMetadata(tables, manifest);
}

function snapshotGeneratedTableSecurityManifest(manifest: RuntimeTableSecurityWireManifest): {
  literal: string;
  snapshot: RuntimeTableSecurityWireManifest;
} {
  const snapshot = runtimeRegistryTableSecurityFromFacts(manifest);
  return { literal: buildSecuritySourceLiteral(snapshot), snapshot };
}
