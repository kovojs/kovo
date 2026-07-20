/**
 * Framework-internal response-equivalence primitives (SPEC §9.2).
 *
 * The policy token is a review/control-plane witness. It does not make application work constant
 * time. The dual-world oracle consumes observations produced by the real boundary and compares
 * only the tuple axes the policy declares.
 */

export { runUniformWork, type UniformWorkOptions } from './password.js';

/** @internal Version token shared by the static policy census and adapter oracle. */
export const RESPONSE_OBSERVATION_SCHEMA = 'kovo-response-observation/v1' as const;

export type ResponseObservationClass =
  | 'account-creation'
  | 'account-recovery'
  | 'resource-concealment'
  | 'unexpected-failure';

export type ResponseObservationWorld =
  | 'absent'
  | 'account-absent'
  | 'account-present'
  | 'exists-not-owned'
  | 'unexpected-cause-a'
  | 'unexpected-cause-b';

export type ResponseObservationWorldPair =
  | readonly ['account-present', 'account-absent']
  | readonly ['exists-not-owned', 'absent']
  | readonly ['unexpected-cause-a', 'unexpected-cause-b'];

export interface ResponseObservationTuplePolicy {
  body: 'equal-content-and-length' | 'generic-accepted-equal-length';
  connection: 'complete';
  cookiesAndTokens: 'none' | 'shape-equal';
  headers: readonly string[];
  redirect: 'equal';
  status: 'equal';
  timingBudget: string;
  workFactor: string;
}

/** @internal Reviewed input to the framework-owned policy mint. */
export interface ResponseObservationPolicyOptions {
  class: ResponseObservationClass;
  id: string;
  schema: typeof RESPONSE_OBSERVATION_SCHEMA;
  tuple: ResponseObservationTuplePolicy;
  worlds: ResponseObservationWorldPair;
}

declare const responseObservationPolicyBrand: unique symbol;

/** Opaque, validated response-equivalence policy. */
export interface ResponseObservationPolicy extends ResponseObservationPolicyOptions {
  readonly [responseObservationPolicyBrand]: true;
}

/** @internal Normalized attacker tuple consumed by the dual-world oracle. */
export interface ResponseObservation {
  body: {
    content: string;
    length: number;
    mediaType: string;
  };
  connection: 'aborted' | 'complete' | 'reset' | 'timeout';
  cookiesAndTokens: readonly string[];
  headers: Readonly<Record<string, string>>;
  redirect: string | null;
  status: number;
  timingMs: number;
  workFactor: string;
}

export interface ResponseObservationDifference {
  actual: unknown;
  axis: keyof ResponseObservationTuplePolicy;
  expected: string;
}

/** @internal Exact tuple comparison result. */
export interface ResponseObservationVerdict {
  differences: readonly ResponseObservationDifference[];
  equal: boolean;
}

const policyWitnesses = new WeakSet<object>();

/** Validate and privately witness one explicit surface policy. */
export function defineResponseObservationPolicy(
  options: ResponseObservationPolicyOptions,
): ResponseObservationPolicy {
  if (!isOwnRecord(options)) {
    throw new TypeError('Response observation policy must be a stable own-data record.');
  }
  if (options.schema !== RESPONSE_OBSERVATION_SCHEMA) {
    throw new TypeError('Response observation policy requires kovo-response-observation/v1.');
  }
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/u.test(options.id)) {
    throw new TypeError('Response observation policy id must be a stable dotted identifier.');
  }
  assertClassWorldPair(options.class, options.worlds);
  assertTuple(options.tuple);

  const policy = Object.freeze({
    class: options.class,
    id: options.id,
    schema: options.schema,
    tuple: Object.freeze({
      ...options.tuple,
      headers: Object.freeze([...options.tuple.headers]),
    }),
    worlds: Object.freeze([...options.worlds]),
  });
  policyWitnesses.add(policy);
  return policy as ResponseObservationPolicy;
}

/** Fail closed when a remotely reachable candidate lacks an exact validated policy token. */
export function requireResponseObservationPolicy(
  surface: string,
  policy: unknown,
): asserts policy is ResponseObservationPolicy {
  if (typeof surface !== 'string' || surface.trim() === '') {
    throw new TypeError('Response observation surface requires a stable non-empty id.');
  }
  if (typeof policy !== 'object' || policy === null || !policyWitnesses.has(policy)) {
    throw new TypeError(
      `Unclassified remotely reachable response-observation surface ${surface} (SPEC §9.2).`,
    );
  }
}

/** Compare the declared attacker tuple. Timing samples are checked by the statistical oracle. */
export function compareResponseObservations(
  policy: ResponseObservationPolicy,
  left: ResponseObservation,
  right: ResponseObservation,
): ResponseObservationVerdict {
  requireResponseObservationPolicy(policy.id, policy);
  const differences: ResponseObservationDifference[] = [];
  compareAxis(differences, 'status', left.status, right.status, 'equal status');
  compareAxis(differences, 'redirect', left.redirect, right.redirect, 'equal redirect');

  for (const rawName of policy.tuple.headers) {
    const name = rawName.toLowerCase();
    compareAxis(
      differences,
      'headers',
      left.headers[name] ?? null,
      right.headers[name] ?? null,
      `equal ${name} header`,
    );
  }
  compareStringArrays(
    differences,
    'cookiesAndTokens',
    left.cookiesAndTokens,
    right.cookiesAndTokens,
    policy.tuple.cookiesAndTokens,
  );
  compareAxis(
    differences,
    'body',
    left.body.mediaType,
    right.body.mediaType,
    'equal body media type',
  );
  compareAxis(differences, 'body', left.body.length, right.body.length, 'equal body length');
  compareAxis(
    differences,
    'body',
    left.body.content,
    right.body.content,
    policy.tuple.body === 'generic-accepted-equal-length'
      ? 'equal generic accepted body'
      : 'equal body content',
  );
  compareAxis(
    differences,
    'connection',
    left.connection,
    right.connection,
    'equal complete connection behavior',
  );
  compareAxis(
    differences,
    'workFactor',
    left.workFactor,
    right.workFactor,
    `equal ${policy.tuple.workFactor} work factor`,
  );

  return Object.freeze({
    differences: Object.freeze(differences),
    equal: differences.length === 0,
  });
}

function assertClassWorldPair(
  responseClass: ResponseObservationClass,
  worlds: ResponseObservationWorldPair,
): void {
  if (!Array.isArray(worlds) || worlds.length !== 2) {
    throw new TypeError('Response observation policy requires exactly two worlds.');
  }
  const joined = `${worlds[0]}:${worlds[1]}`;
  const expected =
    responseClass === 'resource-concealment'
      ? 'exists-not-owned:absent'
      : responseClass === 'unexpected-failure'
        ? 'unexpected-cause-a:unexpected-cause-b'
        : 'account-present:account-absent';
  if (joined !== expected) {
    throw new TypeError(`Response observation class ${responseClass} requires worlds ${expected}.`);
  }
}

function assertTuple(tuple: ResponseObservationTuplePolicy): void {
  if (!isOwnRecord(tuple)) {
    throw new TypeError('Response observation tuple must be a stable own-data record.');
  }
  if (tuple.status !== 'equal' || tuple.redirect !== 'equal' || tuple.connection !== 'complete') {
    throw new TypeError('Response observation tuple must close status, redirect, and connection.');
  }
  if (tuple.cookiesAndTokens !== 'none' && tuple.cookiesAndTokens !== 'shape-equal') {
    throw new TypeError('Response observation tuple requires a cookie/token relation.');
  }
  if (tuple.body !== 'equal-content-and-length' && tuple.body !== 'generic-accepted-equal-length') {
    throw new TypeError('Response observation tuple requires a body content/length relation.');
  }
  if (!Array.isArray(tuple.headers) || tuple.headers.some((name) => typeof name !== 'string')) {
    throw new TypeError('Response observation tuple headers must be a finite string array.');
  }
  if (
    typeof tuple.workFactor !== 'string' ||
    tuple.workFactor.trim() === '' ||
    typeof tuple.timingBudget !== 'string' ||
    tuple.timingBudget.trim() === ''
  ) {
    throw new TypeError('Response observation tuple requires work-factor and timing-budget ids.');
  }
}

function compareAxis(
  differences: ResponseObservationDifference[],
  axis: keyof ResponseObservationTuplePolicy,
  left: unknown,
  right: unknown,
  expected: string,
): void {
  if (Object.is(left, right)) return;
  differences.push({ actual: Object.freeze([left, right]), axis, expected });
}

function compareStringArrays(
  differences: ResponseObservationDifference[],
  axis: keyof ResponseObservationTuplePolicy,
  left: readonly string[],
  right: readonly string[],
  expected: string,
): void {
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  if (
    leftSorted.length === rightSorted.length &&
    leftSorted.every((value, index) => value === rightSorted[index])
  ) {
    return;
  }
  differences.push({ actual: Object.freeze([leftSorted, rightSorted]), axis, expected });
}

function isOwnRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
