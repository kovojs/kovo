import { isSecret } from '@kovojs/core';

import {
  loggingCreateError,
  loggingDiagnosticUrlParts,
  loggingHasAbsoluteUrlScheme,
  loggingIsArray,
  loggingIsError,
  loggingNeutralizeControlCharacters,
  loggingReplaceAllLiteral,
  loggingString,
} from './logging-intrinsics.js';
import {
  createWitnessWeakMap,
  witnessDefineProperty,
  witnessGetOwnPropertyDescriptor,
  witnessGetPrototypeOf,
  witnessObjectKeys,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

const SECRET_REDACTION = '[secret]';

/**
 * SPEC §6.6 / KV439: log neutralization is a runtime defense-in-depth floor.
 * It keeps request-derived values from forging extra log lines or terminal controls.
 */
export function neutralizeLogValue(value: unknown): string {
  return loggingNeutralizeControlCharacters(loggingString(scrubSecretLifecycleValue(value)));
}

export function formatLogMessage(strings: TemplateStringsArray, ...values: unknown[]): string {
  let message = strings[0] ?? '';
  for (let index = 0; index < values.length; index += 1) {
    message += neutralizeLogValue(values[index]) + (strings[index + 1] ?? '');
  }
  return neutralizeLogValue(message);
}

/**
 * SPEC §6.6: diagnostic URLs are credential-bearing input. Preserve only the
 * pathname and the ordered query-key names (including duplicates); discard every
 * query value, the origin, and the fragment before an observability sink sees it.
 * The function is deliberately self-contained because the Node preset embeds the
 * same implementation in its outer, pre-handler error boundary.
 */
export function sanitizeDiagnosticUrl(value: string): string {
  const url = loggingDiagnosticUrlParts(value);
  if (url === undefined) return '/';
  let query = '';
  for (let index = 0; index < url.encodedQueryKeys.length; index += 1) {
    query += `${index === 0 ? '?' : '&'}${url.encodedQueryKeys[index]}`;
  }
  return `${url.pathname}${query}`;
}

/**
 * Replace occurrences of request URLs inside an error message/stack with their
 * value-free diagnostic form. `sanitizeUrl` is passed explicitly so this helper
 * remains self-contained when embedded in generated Node output.
 */
export function sanitizeDiagnosticText(
  value: string,
  requestUrls: readonly string[],
  sanitizeUrl: (value: string) => string,
): string {
  let result = value;
  const replacements: Array<readonly [unsafe: string, safe: string]> = [];

  for (let index = 0; index < requestUrls.length; index += 1) {
    const requestUrl = requestUrls[index]!;
    const parsed = loggingDiagnosticUrlParts(requestUrl);
    if (parsed === undefined) continue;
    const safe = sanitizeUrl(requestUrl);
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    insertDiagnosticReplacement(replacements, requestUrl, safe);
    insertDiagnosticReplacement(replacements, path, safe);
    if (loggingHasAbsoluteUrlScheme(requestUrl)) {
      insertDiagnosticReplacement(replacements, parsed.href, safe);
    }
  }

  for (let index = 0; index < replacements.length; index += 1) {
    const [unsafe, safe] = replacements[index]!;
    if (unsafe !== '' && unsafe !== safe) {
      result = loggingReplaceAllLiteral(result, unsafe, safe);
    }
  }
  return result;
}

/**
 * SPEC §6.6 / DEC5: runtime secret tags are defense-in-depth provenance for
 * observability and persistence sinks. Clone only the branches that contain a
 * secret so ordinary diagnostics retain identity for app onError handlers.
 */
export function scrubSecretLifecycleValue(value: unknown): unknown {
  return scrubSecretLifecycleValueInner(value, createWitnessWeakMap<object, unknown>());
}

export function scrubConsoleArgs(args: readonly unknown[]): unknown[] {
  const scrubbed: unknown[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(args, index);
    scrubbed[index] =
      descriptor !== undefined && 'value' in descriptor
        ? scrubSecretLifecycleValue(descriptor.value)
        : '[redacted]';
  }
  return scrubbed;
}

function scrubSecretLifecycleValueInner(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (isSecret(value)) return SECRET_REDACTION;
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;

  const object = value as object;
  const existing = witnessWeakMapGet(seen, object);
  if (existing !== undefined) return existing;

  if (loggingIsArray(value)) {
    let changed = false;
    const next: unknown[] = [];
    witnessWeakMapSet(seen, object, next);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = witnessGetOwnPropertyDescriptor(value, index);
      if (descriptor === undefined || !('value' in descriptor)) {
        next[index] = '[redacted]';
        changed = true;
        continue;
      }
      const item = descriptor.value;
      const scrubbed = scrubSecretLifecycleValueInner(item, seen);
      next[index] = scrubbed;
      if (scrubbed !== item) changed = true;
    }
    if (!changed) {
      witnessWeakMapSet(seen, object, value);
      return value;
    }
    return next;
  }

  if (loggingIsError(value)) {
    const messageDescriptor = witnessGetOwnPropertyDescriptor(value, 'message');
    const nameDescriptor = witnessGetOwnPropertyDescriptor(value, 'name');
    const stackDescriptor = witnessGetOwnPropertyDescriptor(value, 'stack');
    const message = ownStringDataProperty(value, 'message') ?? '';
    const cloned = loggingCreateError(message);
    const name = ownStringDataProperty(value, 'name');
    if (name !== undefined) cloned.name = name;
    const stack = ownStringDataProperty(value, 'stack');
    if (stack !== undefined) cloned.stack = stack;
    witnessWeakMapSet(seen, object, cloned);

    let changed =
      isUnsafeStringDescriptor(messageDescriptor) ||
      isUnsafeStringDescriptor(nameDescriptor) ||
      isUnsafeStringDescriptor(stackDescriptor);
    const causeDescriptor = witnessGetOwnPropertyDescriptor(value, 'cause');
    if (causeDescriptor !== undefined) {
      const cause = 'value' in causeDescriptor ? causeDescriptor.value : '[redacted]';
      const scrubbedCause = scrubSecretLifecycleValueInner(cause, seen);
      witnessDefineProperty(cloned, 'cause', {
        configurable: true,
        enumerable: false,
        value: scrubbedCause,
        writable: true,
      });
      if (scrubbedCause !== cause || !('value' in causeDescriptor)) changed = true;
    }
    const record = value as unknown as Record<string, unknown>;
    const keys = witnessObjectKeys(value);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      const descriptor = witnessGetOwnPropertyDescriptor(record, key);
      const current =
        descriptor !== undefined && 'value' in descriptor ? descriptor.value : '[redacted]';
      const scrubbed = scrubSecretLifecycleValueInner(current, seen);
      if (scrubbed !== current || descriptor === undefined || !('value' in descriptor))
        changed = true;
      witnessDefineProperty(cloned, key, {
        configurable: true,
        enumerable: true,
        value: scrubbed,
        writable: true,
      });
    }
    if (!changed) {
      witnessWeakMapSet(seen, object, value);
      return value;
    }
    return cloned;
  }

  if (!isPlainObject(value)) return value;

  const next: Record<string, unknown> = {};
  witnessWeakMapSet(seen, object, next);
  let changed = false;
  const record = value as Record<string, unknown>;
  const keys = witnessObjectKeys(record);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const descriptor = witnessGetOwnPropertyDescriptor(record, key);
    const current =
      descriptor !== undefined && 'value' in descriptor ? descriptor.value : '[redacted]';
    const scrubbed = scrubSecretLifecycleValueInner(current, seen);
    witnessDefineProperty(next, key, {
      configurable: true,
      enumerable: true,
      value: scrubbed,
      writable: true,
    });
    if (scrubbed !== current || descriptor === undefined || !('value' in descriptor))
      changed = true;
  }
  if (!changed) {
    witnessWeakMapSet(seen, object, value);
    return value;
  }
  return next;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = witnessGetPrototypeOf(value);
  return prototype === witnessGetPrototypeOf({}) || prototype === null;
}

function insertDiagnosticReplacement(
  replacements: Array<readonly [unsafe: string, safe: string]>,
  unsafe: string,
  safe: string,
): void {
  let index = replacements.length;
  while (index > 0 && replacements[index - 1]![0].length < unsafe.length) {
    replacements[index] = replacements[index - 1]!;
    index -= 1;
  }
  replacements[index] = [unsafe, safe];
}

function ownStringDataProperty(value: object, property: PropertyKey): string | undefined {
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  return descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'string'
    ? descriptor.value
    : undefined;
}

function isUnsafeStringDescriptor(descriptor: PropertyDescriptor | undefined): boolean {
  return (
    descriptor !== undefined && (!('value' in descriptor) || typeof descriptor.value !== 'string')
  );
}
