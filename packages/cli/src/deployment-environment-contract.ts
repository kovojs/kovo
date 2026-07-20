import deploymentEnvironmentDoorDocument from './deployment-environment-doors.v1.json' with { type: 'json' };
import { resolve } from 'node:path';

import type { CliCommandResult, KovoCheckResult } from './shared.js';
import { readJsonRecord } from './tooling.js';

export const DEPLOYMENT_ENVIRONMENT_INPUT_SCHEMA = 'kovo.deployment-environment/v1' as const;
export const DEPLOYMENT_ENVIRONMENT_OUTPUT_VERSION = 'kovo-check-env/v1' as const;

type AntecedentVerdict = 'contradicted' | 'discharged' | 'retained';
type DeploymentPosture = 'mounted' | 'standalone';

interface DeploymentAntecedent {
  readonly id: string;
  readonly obligation: string;
  readonly probeability: 'local-config' | 'partial' | 'retained';
}

interface DeploymentGuarantee {
  readonly authority: string;
  readonly id: string;
  readonly kind: 'normative-conditional' | 'published';
}

interface DeploymentDoor {
  readonly antecedents: readonly string[];
  readonly guarantees: readonly string[];
  readonly id: string;
  readonly source: string;
  readonly sourceNeedles: readonly string[];
}

interface DeploymentDoorRegistry {
  readonly antecedents: readonly DeploymentAntecedent[];
  readonly doors: readonly DeploymentDoor[];
  readonly guarantees: readonly DeploymentGuarantee[];
  readonly schema: 'kovo.deployment-environment-doors/v1';
}

interface SingleKovoComposition {
  readonly kind: 'single-kovo';
}

interface SharedRegistrableDomainComposition {
  readonly kind: 'shared-registrable-domain';
  readonly members: readonly { readonly appId: string; readonly origin: string }[];
  readonly registrableDomain: string;
}

interface ForeignHostComposition {
  readonly hostOrigin: string;
  readonly kind: 'foreign-host';
  readonly mountPath: string;
}

type DeploymentComposition =
  | ForeignHostComposition
  | SharedRegistrableDomainComposition
  | SingleKovoComposition;

interface DeploymentEnvironmentInput {
  readonly composition: DeploymentComposition;
  readonly posture: DeploymentPosture;
  readonly schema: typeof DEPLOYMENT_ENVIRONMENT_INPUT_SCHEMA;
}

interface AntecedentResult {
  readonly id: string;
  readonly probe: string;
  readonly verdict: AntecedentVerdict;
}

const NativeURL = URL;
const nativeArrayIsArray = Array.isArray;
const nativeObjectFreeze = Object.freeze;
const nativeObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const nativeObjectKeys = Object.keys;
const nativeStringEndsWith = String.prototype.endsWith;
const nativeStringStartsWith = String.prototype.startsWith;
const nativeReflectApply = Reflect.apply;
const domainPattern =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const appIdPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/u;
const mountPathPattern = /^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/u;
const dotPathSegmentPattern = /(?:^|\/)\.{1,2}(?:\/|$)/u;

const deploymentDoorRegistry = validateDeploymentDoorRegistry(
  deploymentEnvironmentDoorDocument as unknown,
);

/** @internal Read an optional deployment contract and run `kovo check env`. */
export function runDeploymentEnvironmentCheck(
  inputPath: string | undefined,
  invocationCwd: string,
  environment: Readonly<Record<string, string | undefined>>,
): CliCommandResult {
  if (inputPath === undefined) {
    return checkDeploymentEnvironment(
      {
        composition: { kind: 'single-kovo' },
        posture: 'standalone',
        schema: DEPLOYMENT_ENVIRONMENT_INPUT_SCHEMA,
      },
      environment,
    );
  }
  const resolvedPath = resolve(invocationCwd, inputPath);
  const read = readJsonRecord(resolvedPath);
  if (!read.ok) {
    return {
      error: `kovo-check-env/v1 ERROR INPUT contract-${read.error.kind} path=${resolvedPath}`,
      exitCode: 1,
    };
  }
  return checkDeploymentEnvironment(read.value, environment);
}

/**
 * Evaluate the SPEC §6.6/§9.5 assume-guarantee boundary without treating operator assertions as
 * proof. Only facts observable in this invocation can be discharged; every other antecedent stays
 * attached to the exact published or normative conditional guarantee that consumes it.
 *
 * @internal CLI command implementation, not an importable application API.
 */
export function checkDeploymentEnvironment(
  input: unknown,
  environment: Readonly<Record<string, string | undefined>>,
): KovoCheckResult {
  const parsed = parseDeploymentEnvironmentInput(input);
  if (!parsed.ok) {
    return {
      exitCode: 1,
      output: `${DEPLOYMENT_ENVIRONMENT_OUTPUT_VERSION}\nERROR INPUT ${parsed.error}\n`,
    };
  }

  const guaranteeAntecedents = deriveGuaranteeAntecedents(deploymentDoorRegistry);
  const results = deploymentAntecedentResults(parsed.value, environment);
  const resultById = new Map(results.map((result) => [result.id, result]));
  const affectedByAntecedent = new Map<string, string[]>();
  for (const [guarantee, antecedents] of guaranteeAntecedents) {
    for (const antecedent of antecedents) {
      const affected = affectedByAntecedent.get(antecedent) ?? [];
      affected.push(guarantee);
      affectedByAntecedent.set(antecedent, affected);
    }
  }

  const lines = [
    DEPLOYMENT_ENVIRONMENT_OUTPUT_VERSION,
    `POSTURE ${parsed.value.posture}`,
    `COMPOSITION ${parsed.value.composition.kind}`,
  ];
  for (const antecedent of deploymentDoorRegistry.antecedents) {
    const result = resultById.get(antecedent.id);
    if (result === undefined) {
      throw new TypeError(`Deployment antecedent ${antecedent.id} has no evaluator verdict.`);
    }
    const guarantees = sortedStrings(affectedByAntecedent.get(antecedent.id) ?? []);
    lines.push(
      `${result.verdict.toUpperCase()} antecedent=${result.id} probe=${result.probe} guarantees=${list(guarantees)} obligation=${JSON.stringify(antecedent.obligation)}`,
    );
  }

  let failed = false;
  let active = 0;
  let suspended = 0;
  let withheld = 0;
  for (const guarantee of sortedGuarantees(deploymentDoorRegistry.guarantees)) {
    const antecedents = guaranteeAntecedents.get(guarantee.id) ?? [];
    const mountedWithheld =
      parsed.value.posture === 'mounted' && mountedHostGuarantees.has(guarantee.id);
    const contradicted = antecedents.filter(
      (antecedent) => resultById.get(antecedent)?.verdict === 'contradicted',
    );
    const retained = antecedents.filter(
      (antecedent) => resultById.get(antecedent)?.verdict === 'retained',
    );
    if (mountedWithheld) {
      failed = true;
      withheld += 1;
      lines.push(
        `GUARANTEE ${guarantee.id} WITHHELD posture=mounted antecedents=${list(antecedents)}`,
      );
    } else if (contradicted.length > 0) {
      failed = true;
      withheld += 1;
      lines.push(`GUARANTEE ${guarantee.id} WITHHELD antecedents=${list(contradicted)}`);
    } else if (retained.length > 0) {
      failed = true;
      suspended += 1;
      lines.push(`GUARANTEE ${guarantee.id} SUSPENDED antecedents=${list(retained)}`);
    } else {
      active += 1;
      lines.push(`GUARANTEE ${guarantee.id} ACTIVE antecedents=${list(antecedents)}`);
    }
  }
  lines.push(`SUMMARY active=${active} suspended=${suspended} withheld=${withheld}`);
  return { exitCode: failed ? 1 : 0, output: `${lines.join('\n')}\n` };
}

const mountedHostGuarantees = new Set([
  'browser-state-cache-isolation',
  'csrf-principal-binding',
  'request-origin-binding',
]);

function deploymentAntecedentResults(
  input: DeploymentEnvironmentInput,
  environment: Readonly<Record<string, string | undefined>>,
): AntecedentResult[] {
  const byId = new Map<string, AntecedentResult>();
  for (const antecedent of deploymentDoorRegistry.antecedents) {
    byId.set(antecedent.id, {
      id: antecedent.id,
      probe: `unprobeable:${antecedent.probeability}`,
      verdict: 'retained',
    });
  }

  const nodeOptions = stableOwnString(environment, 'NODE_OPTIONS');
  if (nodeOptions !== undefined && nodeOptions !== '') {
    byId.set('bootstrap-order', {
      id: 'bootstrap-order',
      probe: 'node-options-host-preload',
      verdict: 'contradicted',
    });
  } else {
    byId.set('bootstrap-order', {
      id: 'bootstrap-order',
      probe: 'host-preload-not-fully-observable',
      verdict: 'retained',
    });
  }

  byId.set('trusted-proxy-chain', trustedProxyAntecedent(environment));
  if (input.composition.kind === 'shared-registrable-domain') {
    byId.set('sole-registrable-domain-occupant', {
      id: 'sole-registrable-domain-occupant',
      probe: `known-kovo-members:${input.composition.members.length}`,
      verdict: 'contradicted',
    });
  } else if (input.composition.kind === 'foreign-host') {
    byId.set('sole-registrable-domain-occupant', {
      id: 'sole-registrable-domain-occupant',
      probe: 'foreign-host-owns-cookie-namespace',
      verdict: 'contradicted',
    });
  } else {
    byId.set('sole-registrable-domain-occupant', {
      id: 'sole-registrable-domain-occupant',
      probe: 'external-domain-occupancy-not-observable',
      verdict: 'retained',
    });
  }
  return [...byId.values()];
}

function trustedProxyAntecedent(
  environment: Readonly<Record<string, string | undefined>>,
): AntecedentResult {
  const origin = stableOwnString(environment, 'KOVO_NODE_ORIGIN');
  const trustedProxy = stableOwnString(environment, 'KOVO_NODE_TRUSTED_PROXY');
  if (origin !== undefined && trustedProxy !== undefined) {
    return {
      id: 'trusted-proxy-chain',
      probe: 'ambiguous-node-authority',
      verdict: 'contradicted',
    };
  }
  if (trustedProxy !== undefined) {
    return trustedProxy === '1'
      ? {
          id: 'trusted-proxy-chain',
          probe: 'one-hop-edge-identity-not-observable',
          verdict: 'retained',
        }
      : {
          id: 'trusted-proxy-chain',
          probe: 'invalid-trusted-proxy-value',
          verdict: 'contradicted',
        };
  }
  if (origin !== undefined) {
    return canonicalOrigin(origin) === origin
      ? {
          id: 'trusted-proxy-chain',
          probe: 'fixed-origin-zero-hop',
          verdict: 'discharged',
        }
      : {
          id: 'trusted-proxy-chain',
          probe: 'invalid-fixed-origin',
          verdict: 'contradicted',
        };
  }
  return {
    id: 'trusted-proxy-chain',
    probe: 'node-public-authority-unconfigured',
    verdict: 'retained',
  };
}

function deriveGuaranteeAntecedents(
  registry: DeploymentDoorRegistry,
): ReadonlyMap<string, readonly string[]> {
  const guarantees = new Map(registry.guarantees.map((guarantee) => [guarantee.id, guarantee]));
  const result = new Map<string, string[]>();
  for (const guarantee of registry.guarantees) result.set(guarantee.id, []);
  for (const door of registry.doors) {
    const affected = door.guarantees.includes('*')
      ? registry.guarantees.filter((guarantee) => guarantee.kind === 'published')
      : door.guarantees.map((id) => {
          const guarantee = guarantees.get(id);
          if (guarantee === undefined) {
            throw new TypeError(`Deployment door ${door.id} references unknown guarantee ${id}.`);
          }
          return guarantee;
        });
    for (const guarantee of affected) {
      const antecedents = result.get(guarantee.id);
      if (antecedents === undefined) throw new TypeError('Deployment guarantee relation drifted.');
      for (const antecedent of door.antecedents) {
        if (!antecedents.includes(antecedent)) antecedents.push(antecedent);
      }
    }
  }
  return new Map(
    [...result].map(([guarantee, antecedents]) => [guarantee, sortedStrings(antecedents)]),
  );
}

type DeploymentParseResult =
  | { readonly error: string; readonly ok: false }
  | { readonly ok: true; readonly value: DeploymentEnvironmentInput };

function parseDeploymentEnvironmentInput(input: unknown): DeploymentParseResult {
  const root = exactRecord(input, '$');
  if (!root.ok) return root;
  const unknownRoot = unsupportedField(root.value, ['composition', 'posture', 'schema']);
  if (unknownRoot !== undefined)
    return { error: `$.${unknownRoot} is not a supported field`, ok: false };
  const schema = ownValue(root.value, 'schema');
  if (schema !== DEPLOYMENT_ENVIRONMENT_INPUT_SCHEMA) {
    return { error: `$.schema must be ${DEPLOYMENT_ENVIRONMENT_INPUT_SCHEMA}`, ok: false };
  }
  const posture = ownValue(root.value, 'posture');
  if (posture !== 'mounted' && posture !== 'standalone') {
    return { error: '$.posture must be mounted or standalone', ok: false };
  }
  const compositionResult = parseComposition(ownValue(root.value, 'composition'));
  if (!compositionResult.ok) return compositionResult;
  if (compositionResult.value.kind === 'foreign-host' && posture !== 'mounted') {
    return { error: 'posture foreign-host composition requires posture=mounted', ok: false };
  }
  if (compositionResult.value.kind !== 'foreign-host' && posture !== 'standalone') {
    return { error: 'posture mounted is reserved for foreign-host composition', ok: false };
  }
  return {
    ok: true,
    value: nativeObjectFreeze({
      composition: compositionResult.value,
      posture,
      schema: DEPLOYMENT_ENVIRONMENT_INPUT_SCHEMA,
    }),
  };
}

function parseComposition(
  input: unknown,
):
  | { readonly error: string; readonly ok: false }
  | { readonly ok: true; readonly value: DeploymentComposition } {
  const record = exactRecord(input, '$.composition');
  if (!record.ok) return record;
  const kind = ownValue(record.value, 'kind');
  if (kind === 'single-kovo') {
    const unknown = unsupportedField(record.value, ['kind']);
    if (unknown !== undefined) {
      return { error: `$.composition.${unknown} is not a supported field`, ok: false };
    }
    return { ok: true, value: nativeObjectFreeze({ kind }) };
  }
  if (kind === 'foreign-host') {
    const unknown = unsupportedField(record.value, ['hostOrigin', 'kind', 'mountPath']);
    if (unknown !== undefined) {
      return { error: `$.composition.${unknown} is not a supported field`, ok: false };
    }
    const hostOrigin = ownValue(record.value, 'hostOrigin');
    const mountPath = ownValue(record.value, 'mountPath');
    if (typeof hostOrigin !== 'string' || canonicalHttpsOrigin(hostOrigin) !== hostOrigin) {
      return { error: '$.composition.hostOrigin must be one canonical HTTPS origin', ok: false };
    }
    if (
      typeof mountPath !== 'string' ||
      mountPath === '/' ||
      !mountPathPattern.test(mountPath) ||
      dotPathSegmentPattern.test(mountPath)
    ) {
      return {
        error: '$.composition.mountPath must be one canonical non-root path prefix',
        ok: false,
      };
    }
    return {
      ok: true,
      value: nativeObjectFreeze({ hostOrigin, kind, mountPath }),
    };
  }
  if (kind === 'shared-registrable-domain') {
    const unknown = unsupportedField(record.value, ['kind', 'members', 'registrableDomain']);
    if (unknown !== undefined) {
      return { error: `$.composition.${unknown} is not a supported field`, ok: false };
    }
    const registrableDomain = ownValue(record.value, 'registrableDomain');
    if (
      typeof registrableDomain !== 'string' ||
      !domainPattern.test(registrableDomain) ||
      registrableDomain !== registrableDomain.toLowerCase()
    ) {
      return { error: '$.composition.registrableDomain must be a lowercase DNS suffix', ok: false };
    }
    const rawMembers = ownValue(record.value, 'members');
    if (!nativeArrayIsArray(rawMembers) || rawMembers.length < 2) {
      return { error: '$.composition.members must contain at least two Kovo apps', ok: false };
    }
    const members: { appId: string; origin: string }[] = [];
    const appIds = new Set<string>();
    const origins = new Set<string>();
    for (let index = 0; index < rawMembers.length; index += 1) {
      const member = exactRecord(
        ownArrayValue(rawMembers, index),
        `$.composition.members[${index}]`,
      );
      if (!member.ok) return member;
      const unknownMember = unsupportedField(member.value, ['appId', 'origin']);
      if (unknownMember !== undefined) {
        return {
          error: `$.composition.members[${index}].${unknownMember} is not a supported field`,
          ok: false,
        };
      }
      const appId = ownValue(member.value, 'appId');
      const origin = ownValue(member.value, 'origin');
      if (typeof appId !== 'string' || !appIdPattern.test(appId)) {
        return { error: `$.composition.members[${index}].appId is invalid`, ok: false };
      }
      if (typeof origin !== 'string' || canonicalHttpsOrigin(origin) !== origin) {
        return {
          error: `$.composition.members[${index}].origin must be one canonical HTTPS origin`,
          ok: false,
        };
      }
      const hostname = new NativeURL(origin).hostname;
      if (hostname !== registrableDomain && !endsWith(hostname, `.${registrableDomain}`)) {
        return {
          error: `$.composition.members[${index}].origin is outside ${registrableDomain}`,
          ok: false,
        };
      }
      if (appIds.has(appId) || origins.has(origin)) {
        return {
          error: '$.composition.members must have unique appId and origin values',
          ok: false,
        };
      }
      appIds.add(appId);
      origins.add(origin);
      members.push(nativeObjectFreeze({ appId, origin }));
    }
    return {
      ok: true,
      value: nativeObjectFreeze({
        kind,
        members: nativeObjectFreeze(members),
        registrableDomain,
      }),
    };
  }
  return {
    error: '$.composition.kind must be single-kovo, shared-registrable-domain, or foreign-host',
    ok: false,
  };
}

function validateDeploymentDoorRegistry(input: unknown): DeploymentDoorRegistry {
  const root = exactRecord(input, 'deployment environment door registry');
  if (!root.ok) throw new TypeError(root.error);
  if (ownValue(root.value, 'schema') !== 'kovo.deployment-environment-doors/v1') {
    throw new TypeError('Deployment environment door registry schema is invalid.');
  }
  const antecedents = registryArray<DeploymentAntecedent>(root.value, 'antecedents');
  const guarantees = registryArray<DeploymentGuarantee>(root.value, 'guarantees');
  const doors = registryArray<DeploymentDoor>(root.value, 'doors');
  const antecedentIds = new Set<string>();
  for (const antecedent of antecedents) {
    if (
      typeof antecedent.id !== 'string' ||
      antecedent.id.trim() === '' ||
      typeof antecedent.obligation !== 'string' ||
      antecedent.obligation.trim() === '' ||
      !['local-config', 'partial', 'retained'].includes(antecedent.probeability) ||
      antecedentIds.has(antecedent.id)
    ) {
      throw new TypeError('Deployment environment antecedent registry is invalid.');
    }
    antecedentIds.add(antecedent.id);
  }
  const guaranteeIds = new Set<string>();
  for (const guarantee of guarantees) {
    if (
      typeof guarantee.id !== 'string' ||
      guarantee.id.trim() === '' ||
      typeof guarantee.authority !== 'string' ||
      guarantee.authority.trim() === '' ||
      (guarantee.kind !== 'published' && guarantee.kind !== 'normative-conditional') ||
      guaranteeIds.has(guarantee.id)
    ) {
      throw new TypeError('Deployment environment guarantee registry is invalid.');
    }
    guaranteeIds.add(guarantee.id);
  }
  const doorIds = new Set<string>();
  for (const door of doors) {
    if (
      typeof door.id !== 'string' ||
      door.id.trim() === '' ||
      typeof door.source !== 'string' ||
      door.source.trim() === '' ||
      !nativeArrayIsArray(door.antecedents) ||
      door.antecedents.length === 0 ||
      !nativeArrayIsArray(door.guarantees) ||
      door.guarantees.length === 0 ||
      !nativeArrayIsArray(door.sourceNeedles) ||
      door.sourceNeedles.length === 0 ||
      doorIds.has(door.id)
    ) {
      throw new TypeError('Deployment environment consuming-door registry is invalid.');
    }
    doorIds.add(door.id);
    for (const antecedent of door.antecedents) {
      if (typeof antecedent !== 'string' || !antecedentIds.has(antecedent)) {
        throw new TypeError(`Deployment door ${door.id} references an unknown antecedent.`);
      }
    }
    for (const guarantee of door.guarantees) {
      if (typeof guarantee !== 'string' || (guarantee !== '*' && !guaranteeIds.has(guarantee))) {
        throw new TypeError(`Deployment door ${door.id} references an unknown guarantee.`);
      }
    }
    for (const sourceNeedle of door.sourceNeedles) {
      if (typeof sourceNeedle !== 'string' || sourceNeedle.trim() === '') {
        throw new TypeError(`Deployment door ${door.id} has an invalid source anchor.`);
      }
    }
  }
  return nativeObjectFreeze({
    antecedents: nativeObjectFreeze(antecedents),
    doors: nativeObjectFreeze(doors),
    guarantees: nativeObjectFreeze(guarantees),
    schema: 'kovo.deployment-environment-doors/v1',
  });
}

function registryArray<T>(source: Record<string, unknown>, field: string): T[] {
  const value = ownValue(source, field);
  if (!nativeArrayIsArray(value))
    throw new TypeError(`Deployment registry ${field} must be an array.`);
  const result: T[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = ownArrayValue(value, index);
    const record = exactRecord(entry, `Deployment registry ${field}[${index}]`);
    if (!record.ok) throw new TypeError(record.error);
    result.push(nativeObjectFreeze(record.value) as T);
  }
  return result;
}

function exactRecord(
  value: unknown,
  path: string,
):
  | { readonly error: string; readonly ok: false }
  | { readonly ok: true; readonly value: Record<string, unknown> } {
  if (typeof value !== 'object' || value === null || nativeArrayIsArray(value)) {
    return { error: `${path} must be an object`, ok: false };
  }
  const keys = nativeObjectKeys(value);
  const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = nativeObjectGetOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      return { error: `${path}.${key} must be own data`, ok: false };
    }
    Object.defineProperty(snapshot, key, {
      configurable: false,
      enumerable: true,
      value: descriptor.value,
      writable: false,
    });
  }
  return { ok: true, value: nativeObjectFreeze(snapshot) };
}

function ownValue(source: Record<string, unknown>, key: string): unknown {
  const descriptor = nativeObjectGetOwnPropertyDescriptor(source, key);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
}

function ownArrayValue(source: readonly unknown[], index: number): unknown {
  const descriptor = nativeObjectGetOwnPropertyDescriptor(source, index);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new TypeError(`Deployment input arrays must be dense own data at index ${index}.`);
  }
  return descriptor.value;
}

function unsupportedField(
  source: Record<string, unknown>,
  supported: readonly string[],
): string | undefined {
  const supportedSet = new Set(supported);
  return nativeObjectKeys(source).find((key) => !supportedSet.has(key));
}

function stableOwnString(
  source: Readonly<Record<string, string | undefined>>,
  key: string,
): string | undefined {
  const before = nativeObjectGetOwnPropertyDescriptor(source, key);
  const after = nativeObjectGetOwnPropertyDescriptor(source, key);
  if (!sameDescriptor(before, after)) {
    throw new TypeError(`Deployment environment ${key} changed while inspected.`);
  }
  if (before === undefined) return undefined;
  if (!('value' in before) || typeof before.value !== 'string') {
    throw new TypeError(`Deployment environment ${key} must be an own string.`);
  }
  return before.value;
}

function sameDescriptor(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    'value' in left &&
    'value' in right &&
    Object.is(left.value, right.value) &&
    left.configurable === right.configurable &&
    left.enumerable === right.enumerable &&
    left.writable === right.writable
  );
}

function canonicalOrigin(value: string): string | undefined {
  try {
    const parsed = new NativeURL(value);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.origin !== value ||
      parsed.pathname !== '/' ||
      parsed.search !== '' ||
      parsed.hash !== '' ||
      parsed.username !== '' ||
      parsed.password !== ''
    ) {
      return undefined;
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function canonicalHttpsOrigin(value: string): string | undefined {
  const origin = canonicalOrigin(value);
  return origin !== undefined && startsWith(origin, 'https://') ? origin : undefined;
}

function startsWith(value: string, prefix: string): boolean {
  return nativeReflectApply(nativeStringStartsWith, value, [prefix]) as boolean;
}

function endsWith(value: string, suffix: string): boolean {
  return nativeReflectApply(nativeStringEndsWith, value, [suffix]) as boolean;
}

function sortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function sortedGuarantees(values: readonly DeploymentGuarantee[]): DeploymentGuarantee[] {
  return [...values].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

function list(values: readonly string[]): string {
  return values.length === 0 ? '-' : values.join(',');
}
