import { declareSystemPrincipal } from './auth-principal.js';
import { snapshotAuditReason, snapshotAuditText } from './audit-justification.js';
import { createPostgresSystemDb, usePostgresAppRuntimeDb } from './internal/postgres-capability.js';
import { sqliteSystemDbForAppRuntime } from './internal/sqlite-capability.js';
import type { KovoPostgresAppRuntimeDb } from './postgres-runtime.js';
import {
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessObjectIs,
  witnessOwnKeys,
  witnessFreeze,
} from './security-witness-intrinsics.js';
import type { KovoSqliteAppRuntime } from './sqlite.js';

declare const generatedIntegrationSystemDbBrand: unique symbol;

/**
 * Opaque system-write capability passed directly from generated runtime wiring to a reviewed
 * first-party integration. It intentionally exposes no database methods or raw carrier type.
 *
 * @generated Compiler/starter ABI; app-authored modules must not construct or retain this value.
 */
export interface GeneratedIntegrationSystemDb<Backend extends 'postgres' | 'sqlite'> {
  readonly [generatedIntegrationSystemDbBrand]: Backend;
}

/** Audited posture attached while generated integration wiring requests a system-write handle. */
export interface GeneratedIntegrationSystemDbOptions {
  operation: 'write';
  reason: string;
  surface: string;
}

/**
 * Mint the Postgres system-write capability for one generated first-party integration.
 *
 * @generated Compiler/starter ABI. Runtime identity is proven by the server's private WeakMap.
 */
export function postgresSystemDbForGeneratedIntegration(
  runtime: KovoPostgresAppRuntimeDb,
  options: GeneratedIntegrationSystemDbOptions,
): GeneratedIntegrationSystemDb<'postgres'>;
export function postgresSystemDbForGeneratedIntegration(
  runtime: KovoPostgresAppRuntimeDb,
  options: GeneratedIntegrationSystemDbOptions,
): unknown {
  const posture = snapshotGeneratedIntegrationSystemDbOptions(options, 'Postgres');
  const db = usePostgresAppRuntimeDb(runtime, {
    principalPosture: declareSystemPrincipal(posture.reason, {
      ingress: 'endpoint',
      operation: posture.operation,
      surface: posture.surface,
    }),
  });
  return createPostgresSystemDb(db);
}

/**
 * Recover the SQLite system-write capability for one generated first-party integration.
 *
 * @generated Compiler/starter ABI. Runtime identity is proven by the server's private WeakMap.
 */
export function sqliteSystemDbForGeneratedIntegration(
  runtime: KovoSqliteAppRuntime,
  options: GeneratedIntegrationSystemDbOptions,
): GeneratedIntegrationSystemDb<'sqlite'>;
export function sqliteSystemDbForGeneratedIntegration(
  runtime: KovoSqliteAppRuntime,
  options: GeneratedIntegrationSystemDbOptions,
): unknown {
  snapshotGeneratedIntegrationSystemDbOptions(options, 'SQLite');
  return sqliteSystemDbForAppRuntime(runtime);
}

function snapshotGeneratedIntegrationSystemDbOptions(
  source: GeneratedIntegrationSystemDbOptions,
  backend: 'Postgres' | 'SQLite',
): Readonly<GeneratedIntegrationSystemDbOptions> {
  if (typeof source !== 'object' || source === null || witnessIsArray(source)) {
    throw new TypeError(`${backend} generated system DB options must be an own-data object.`);
  }
  const keys = witnessOwnKeys(source);
  if (keys.length !== 3) {
    throw new TypeError(
      `${backend} generated system DB options require exactly operation, reason, and surface.`,
    );
  }
  let operation: unknown;
  let reason: unknown;
  let surface: unknown;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (key !== 'operation' && key !== 'reason' && key !== 'surface') {
      throw new TypeError(`${backend} generated system DB options contain an unknown field.`);
    }
    const before = witnessGetOwnPropertyDescriptor(source, key);
    const after = witnessGetOwnPropertyDescriptor(source, key);
    if (
      before === undefined ||
      after === undefined ||
      !('value' in before) ||
      !('value' in after) ||
      !witnessObjectIs(before.value, after.value)
    ) {
      throw new TypeError(`${backend} generated system DB options must use stable own data.`);
    }
    if (key === 'operation') operation = before.value;
    else if (key === 'reason') reason = before.value;
    else surface = before.value;
  }
  if (operation !== 'write') {
    throw new TypeError(`${backend} generated system DB operation must be write.`);
  }
  return witnessFreeze({
    operation: 'write',
    reason: snapshotAuditReason(
      reason,
      `${backend} generated system DB capability reason (SPEC §10.3)`,
    ),
    surface: snapshotAuditText(
      surface,
      `${backend} generated system DB capability surface (SPEC §10.3)`,
    ),
  });
}
