import {
  securityArrayAppend,
  securityGetOwnPropertyDescriptor,
  securityOwnArrayEntry,
} from './security-witness-intrinsics.js';

const MAX_DISPOSERS = 100_000;

/** @internal Append lifecycle authority cleanup without inherited numeric-setter dispatch. */
export function appendDisposer(disposers: Array<() => void>, disposer: () => void): void {
  securityArrayAppend(disposers, disposer, 'Browser lifecycle disposer stack');
}

/** @internal Drain cleanup in reverse enrollment order through an own-data snapshot. */
export function drainDisposers(disposers: Array<() => void>): void {
  const length = securityGetOwnPropertyDescriptor(disposers, 'length');
  if (
    !length ||
    !('value' in length) ||
    typeof length.value !== 'number' ||
    length.value % 1 !== 0 ||
    length.value < 0 ||
    length.value > MAX_DISPOSERS
  ) {
    throw new TypeError('Kovo lifecycle disposer stack is invalid or too large.');
  }
  const snapshot: Array<() => void> = [];
  for (let index = 0; index < length.value; index += 1) {
    const entry = securityOwnArrayEntry(disposers, index);
    if (!entry.ok || typeof entry.value !== 'function') {
      throw new TypeError('Kovo lifecycle disposer stack must be dense functions.');
    }
    securityArrayAppend(snapshot, entry.value, 'Browser lifecycle disposer snapshot');
  }
  disposers.length = 0;

  let firstError: unknown;
  for (let index = snapshot.length - 1; index >= 0; index -= 1) {
    const entry = securityOwnArrayEntry(snapshot, index);
    if (!entry.ok) continue;
    try {
      entry.value();
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError !== undefined) throw firstError;
}
