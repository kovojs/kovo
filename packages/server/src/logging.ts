import { isSecret } from '@kovojs/core';

// eslint-disable-next-line no-control-regex -- KV439 intentionally neutralizes control chars.
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/g;
const SECRET_REDACTION = '[secret]';

function visibleControlEscape(char: string): string {
  return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
}

/**
 * SPEC §6.6 / KV439: log neutralization is a runtime defense-in-depth floor.
 * It keeps request-derived values from forging extra log lines or terminal controls.
 */
export function neutralizeLogValue(value: unknown): string {
  return String(scrubSecretLifecycleValue(value)).replace(
    CONTROL_CHARACTER_PATTERN,
    visibleControlEscape,
  );
}

export function formatLogMessage(strings: TemplateStringsArray, ...values: unknown[]): string {
  let message = strings[0] ?? '';
  for (let index = 0; index < values.length; index += 1) {
    message += neutralizeLogValue(values[index]) + (strings[index + 1] ?? '');
  }
  return neutralizeLogValue(message);
}

/**
 * SPEC §6.6 / DEC5: runtime secret tags are defense-in-depth provenance for
 * observability and persistence sinks. Clone only the branches that contain a
 * secret so ordinary diagnostics retain identity for app onError handlers.
 */
export function scrubSecretLifecycleValue(value: unknown): unknown {
  return scrubSecretLifecycleValueInner(value, new WeakMap<object, unknown>());
}

export function scrubConsoleArgs(args: readonly unknown[]): unknown[] {
  return args.map((arg) => scrubSecretLifecycleValue(arg));
}

function scrubSecretLifecycleValueInner(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (isSecret(value)) return SECRET_REDACTION;
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;

  const object = value as object;
  const existing = seen.get(object);
  if (existing !== undefined) return existing;

  if (Array.isArray(value)) {
    let changed = false;
    const next: unknown[] = [];
    seen.set(object, next);
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index];
      const scrubbed = scrubSecretLifecycleValueInner(item, seen);
      next[index] = scrubbed;
      if (scrubbed !== item) changed = true;
    }
    if (!changed) {
      seen.set(object, value);
      return value;
    }
    return next;
  }

  if (value instanceof Error) {
    const cloned = new Error(value.message);
    cloned.name = value.name;
    if (value.stack !== undefined) cloned.stack = value.stack;
    seen.set(object, cloned);

    let changed = false;
    if (value.cause !== undefined) {
      const scrubbedCause = scrubSecretLifecycleValueInner(value.cause, seen);
      Object.defineProperty(cloned, 'cause', {
        configurable: true,
        enumerable: false,
        value: scrubbedCause,
        writable: true,
      });
      if (scrubbedCause !== value.cause) changed = true;
    }
    const record = value as unknown as Record<string, unknown>;
    for (const key of Object.keys(value)) {
      const current = record[key];
      const scrubbed = scrubSecretLifecycleValueInner(current, seen);
      if (scrubbed !== current) changed = true;
      Object.defineProperty(cloned, key, {
        configurable: true,
        enumerable: true,
        value: scrubbed,
        writable: true,
      });
    }
    if (!changed) {
      seen.set(object, value);
      return value;
    }
    return cloned;
  }

  if (!isPlainObject(value)) return value;

  const next: Record<string, unknown> = {};
  seen.set(object, next);
  let changed = false;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const current = record[key];
    const scrubbed = scrubSecretLifecycleValueInner(current, seen);
    next[key] = scrubbed;
    if (scrubbed !== current) changed = true;
  }
  if (!changed) {
    seen.set(object, value);
    return value;
  }
  return next;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
