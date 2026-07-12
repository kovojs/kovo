import { escapeAttribute, escapeHtml } from '../html.js';
import {
  securityArrayIsArray,
  securityArrayJoin,
  securityArrayPush,
  securityJsonStringify,
} from '../response-security-intrinsics.js';
import { witnessGetOwnPropertyDescriptor } from '../security-witness-intrinsics.js';
import type { MutationFail } from './definition.js';
import type { ValidationFailurePayload } from '../schema.js';

export function renderDefaultFailureFragmentContent(failure: MutationFail): string {
  const error = snapshotMutationFailureError(failure);
  return renderFailureFragment(error);
}

export function renderDefaultFailurePage(failure: MutationFail): string {
  const error = snapshotMutationFailureError(failure);
  return `<!doctype html><html><body>${renderFailureFragment(error)}</body></html>`;
}

function renderFailureFragment(error: FailureErrorSnapshot): string {
  const validation =
    error.code === 'VALIDATION' ? snapshotValidationFailurePayload(error.payload) : undefined;
  if (validation !== undefined) {
    const rendered: string[] = [];
    for (let index = 0; index < validation.issues.length; index += 1) {
      const issue = validation.issues[index]!;
      securityArrayPush(
        rendered,
        `<output role="alert" data-error-path="${escapeAttribute(securityArrayJoin(issue.path, '.'))}">${escapeHtml(issue.message)}</output>`,
      );
    }
    return securityArrayJoin(rendered, '');
  }

  return `<output role="alert" data-error-code="${escapeAttribute(error.code)}">${escapeHtml(securityJsonStringify(error.payload) ?? 'undefined')}</output>`;
}

interface FailureErrorSnapshot {
  readonly code: string;
  readonly payload: unknown;
}

const MAX_VALIDATION_ISSUES = 1_000;
const MAX_VALIDATION_PATH_PARTS = 100;

// SPEC §6.6/§9.5: the built-in 422 renderer is an HTML output choke. Snapshot every
// caller-visible carrier before escaping, then assemble only through boot-captured operations.
function snapshotMutationFailureError(failure: MutationFail): FailureErrorSnapshot {
  const error = ownDataValue(failure, 'error');
  if (!isRecord(error)) throw new TypeError('Mutation failure error must be an own-data record.');
  const code = ownDataValue(error, 'code');
  if (typeof code !== 'string') throw new TypeError('Mutation failure code must be a string.');
  return { code, payload: ownDataValue(error, 'payload') };
}

function snapshotValidationFailurePayload(value: unknown): ValidationFailurePayload | undefined {
  if (!isRecord(value)) return undefined;
  const issues = ownDataValue(value, 'issues');
  if (!securityArrayIsArray(issues)) return undefined;
  const issueCount = boundedDenseArrayLength(issues, MAX_VALIDATION_ISSUES);
  if (issueCount === undefined) return undefined;

  const issueSnapshots: ValidationFailurePayload['issues'][number][] = [];
  for (let index = 0; index < issueCount; index += 1) {
    const issue = ownArrayElement(issues, index);
    if (!isRecord(issue)) return undefined;
    const message = ownDataValue(issue, 'message');
    const path = ownDataValue(issue, 'path');
    if (typeof message !== 'string' || !securityArrayIsArray(path)) return undefined;
    const pathLength = boundedDenseArrayLength(path, MAX_VALIDATION_PATH_PARTS);
    if (pathLength === undefined) return undefined;
    const pathSnapshot: string[] = [];
    for (let pathIndex = 0; pathIndex < pathLength; pathIndex += 1) {
      const part = ownArrayElement(path, pathIndex);
      if (typeof part !== 'string') return undefined;
      securityArrayPush(pathSnapshot, part);
    }
    securityArrayPush(issueSnapshots, { message, path: pathSnapshot });
  }
  return { issues: issueSnapshots };
}

function boundedDenseArrayLength(value: readonly unknown[], limit: number): number | undefined {
  const descriptor = witnessGetOwnPropertyDescriptor(value, 'length');
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'number' ||
    descriptor.value < 0 ||
    descriptor.value % 1 !== 0 ||
    descriptor.value > limit
  ) {
    return undefined;
  }
  return descriptor.value;
}

function ownArrayElement(value: readonly unknown[], index: number): unknown {
  const descriptor = witnessGetOwnPropertyDescriptor(value, index);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
}

function ownDataValue(value: object, key: PropertyKey): unknown {
  const descriptor = witnessGetOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new TypeError(`Mutation failure ${String(key)} must be an own data property.`);
  }
  return descriptor.value;
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}
