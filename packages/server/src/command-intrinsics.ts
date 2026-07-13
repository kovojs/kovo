import { execFile as builtinExecFile, type ExecFileOptions } from 'node:child_process';

/**
 * Boot-pinned controls for the shell-free command door (SPEC §6.6 / §10.3 C9).
 *
 * Application modules share this realm. A reviewed command must therefore never be re-expanded
 * through a late Array iterator, a replaced child-process binding, or caller-owned accessors after
 * the framework has validated it.
 */

const NativeArray = globalThis.Array;
const NativeJSON = globalThis.JSON;
const NativeNumber = globalThis.Number;
const NativeObject = globalThis.Object;
const NativePromise = globalThis.Promise;
const NativeRegExp = globalThis.RegExp;
const NativeReflect = globalThis.Reflect;
const NativeString = globalThis.String;
const NativeTypeError = globalThis.TypeError;
const nativeArrayIsArray = NativeArray.isArray;
const nativeExecFile = builtinExecFile;
const nativeJsonStringify = NativeJSON.stringify;
const nativeNumberIsSafeInteger = NativeNumber.isSafeInteger;
const nativeObjectDefineProperty = NativeObject.defineProperty;
const nativeObjectFreeze = NativeObject.freeze;
const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeObjectIs = NativeObject.is;
const nativeObjectIsFrozen = NativeObject.isFrozen;
const nativeRegExpExec = NativeRegExp.prototype.exec;
const nativeReflectApply = NativeReflect.apply;
const nativeStringCharCodeAt = NativeString.prototype.charCodeAt;
const nativeStringIndexOf = NativeString.prototype.indexOf;
const nativeStringTrim = NativeString.prototype.trim;

function apply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return nativeReflectApply(fn, receiver, args) as Return;
}

function defineProperty(
  target: object,
  property: PropertyKey,
  descriptor: PropertyDescriptor,
): void {
  apply(nativeObjectDefineProperty, NativeObject, [target, property, descriptor]);
}

function freeze<Value extends object>(value: Value): Readonly<Value> {
  return apply(nativeObjectFreeze, NativeObject, [value]);
}

function getOwnPropertyDescriptor(
  value: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  return apply(nativeObjectGetOwnPropertyDescriptor, NativeObject, [value, property]);
}

function objectIs(left: unknown, right: unknown): boolean {
  return apply(nativeObjectIs, NativeObject, [left, right]);
}

interface PinnedCommandExecOptions extends ExecFileOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly maxBuffer?: number;
  readonly shell: false;
  readonly signal?: AbortSignal;
  readonly timeout?: number;
}

export interface PinnedCommandResult {
  readonly stderr: string;
  readonly stdout: string;
}

function sameDataDescriptor(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    'value' in left &&
    'value' in right &&
    objectIs(left.value, right.value) &&
    left.configurable === right.configurable &&
    left.enumerable === right.enumerable &&
    left.writable === right.writable
  );
}

function commandControlsAreSound(): boolean {
  try {
    if (apply(nativeArrayIsArray, NativeArray, [[]]) !== true) return false;
    if (apply(nativeArrayIsArray, NativeArray, [{}]) !== false) return false;
    if (apply<string>(nativeStringTrim, ' kovo-command ', []) !== 'kovo-command') {
      return false;
    }
    if (apply<number>(nativeStringCharCodeAt, 'A\n', [0]) !== 0x41) return false;
    if (apply<number>(nativeStringCharCodeAt, 'A\n', [1]) !== 0x0a) return false;
    if (apply<number>(nativeStringIndexOf, 'kovo-command', ['command']) !== 5) return false;
    if (
      apply<RegExpExecArray | null>(nativeRegExpExec, /^safe$/u, ['safe']) === null ||
      apply<RegExpExecArray | null>(nativeRegExpExec, /^safe$/u, ['unsafe']) !== null
    ) {
      return false;
    }
    if (
      apply(nativeNumberIsSafeInteger, NativeNumber, [42]) !== true ||
      apply(nativeNumberIsSafeInteger, NativeNumber, [42.5]) !== false
    ) {
      return false;
    }
    if (apply<string | undefined>(nativeJsonStringify, NativeJSON, ['a"b']) !== '"a\\"b"') {
      return false;
    }
    const marker = {};
    const record = {};
    defineProperty(record, 'marker', { value: marker });
    const markerDescriptor = getOwnPropertyDescriptor(record, 'marker');
    if (
      markerDescriptor === undefined ||
      !('value' in markerDescriptor) ||
      !objectIs(markerDescriptor.value, marker)
    ) {
      return false;
    }
    if (freeze(record) !== record || apply(nativeObjectIsFrozen, NativeObject, [record]) !== true) {
      return false;
    }

    let promiseExecutorRan = false;
    void new NativePromise<void>((resolve) => {
      promiseExecutorRan = true;
      resolve();
    });
    return promiseExecutorRan;
  } catch {
    return false;
  }
}

const commandControlsSound = commandControlsAreSound();

export function assertCommandIntrinsics(): void {
  if (!commandControlsSound) {
    throw new NativeTypeError(
      'Kovo command controls are unavailable because process or realm intrinsics were modified before framework initialization.',
    );
  }
}

export function commandArrayIsArray(value: unknown): value is unknown[] {
  assertCommandIntrinsics();
  return apply(nativeArrayIsArray, NativeArray, [value]);
}

export function commandCloneDenseStringArray(value: unknown, label: string): string[] {
  assertCommandIntrinsics();
  if (!commandArrayIsArray(value)) {
    throw new NativeTypeError(`${label} must be an array of strings.`);
  }
  const beforeLength = getOwnPropertyDescriptor(value, 'length');
  const afterLength = getOwnPropertyDescriptor(value, 'length');
  if (
    !sameDataDescriptor(beforeLength, afterLength) ||
    beforeLength === undefined ||
    !('value' in beforeLength) ||
    typeof beforeLength.value !== 'number' ||
    !commandNumberIsSafeInteger(beforeLength.value) ||
    beforeLength.value < 0 ||
    beforeLength.value > 100_000
  ) {
    throw new NativeTypeError(`${label} must have a bounded, stable length.`);
  }

  const snapshot: string[] = [];
  for (let index = 0; index < beforeLength.value; index += 1) {
    const before = getOwnPropertyDescriptor(value, index);
    const after = getOwnPropertyDescriptor(value, index);
    if (
      !sameDataDescriptor(before, after) ||
      before === undefined ||
      !('value' in before) ||
      typeof before.value !== 'string'
    ) {
      throw new NativeTypeError(`${label}[${index}] must be a stable own string value.`);
    }
    defineProperty(snapshot, index, {
      configurable: true,
      enumerable: true,
      value: before.value,
      writable: true,
    });
  }
  return snapshot;
}

export function commandOwnDataValue(
  source: unknown,
  property: PropertyKey,
  label: string,
): unknown {
  assertCommandIntrinsics();
  if ((typeof source !== 'object' && typeof source !== 'function') || source === null) {
    throw new NativeTypeError(`${label} must be an object with stable own data properties.`);
  }
  const before = getOwnPropertyDescriptor(source, property);
  const after = getOwnPropertyDescriptor(source, property);
  if (!sameDataDescriptor(before, after)) {
    throw new NativeTypeError(`${label}.${NativeString(property)} changed while it was pinned.`);
  }
  if (before === undefined) return undefined;
  if (!('value' in before)) {
    throw new NativeTypeError(`${label}.${NativeString(property)} must be an own data property.`);
  }
  return before.value;
}

export function commandStringTrim(value: string): string {
  assertCommandIntrinsics();
  return apply(nativeStringTrim, value, []);
}

export function commandRegExpTest(expression: RegExp, value: string): boolean {
  assertCommandIntrinsics();
  return apply<RegExpExecArray | null>(nativeRegExpExec, expression, [value]) !== null;
}

export function commandStringCharCodeAt(value: string, index: number): number {
  assertCommandIntrinsics();
  return apply(nativeStringCharCodeAt, value, [index]);
}

export function commandNumberIsSafeInteger(value: unknown): boolean {
  assertCommandIntrinsics();
  return apply(nativeNumberIsSafeInteger, NativeNumber, [value]);
}

export function commandJsonStringify(value: unknown): string {
  assertCommandIntrinsics();
  const rendered = apply<string | undefined>(nativeJsonStringify, NativeJSON, [value]);
  return rendered ?? 'undefined';
}

export function commandFreeze<Value extends object>(value: Value): Readonly<Value> {
  assertCommandIntrinsics();
  return freeze(value);
}

export function commandPinnedExecOptions(values: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
  signal?: AbortSignal;
  timeout?: number;
}): PinnedCommandExecOptions {
  assertCommandIntrinsics();
  return commandFreeze({
    ...(values.cwd === undefined ? {} : { cwd: values.cwd }),
    ...(values.env === undefined ? {} : { env: values.env }),
    ...(values.maxBuffer === undefined ? {} : { maxBuffer: values.maxBuffer }),
    shell: false as const,
    ...(values.signal === undefined ? {} : { signal: values.signal }),
    ...(values.timeout === undefined ? {} : { timeout: values.timeout }),
  });
}

export function commandExecFile(
  program: string,
  argv: string[],
  options: PinnedCommandExecOptions,
): Promise<PinnedCommandResult> {
  assertCommandIntrinsics();
  const exactArgv = commandFreeze(commandCloneDenseStringArray(argv, 'Command exec argv'));
  return new NativePromise<PinnedCommandResult>((resolve, reject) => {
    nativeExecFile(program, exactArgv as string[], options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      if (typeof stdout !== 'string' || typeof stderr !== 'string') {
        reject(
          new NativeTypeError('Kovo command execution returned non-text output unexpectedly.'),
        );
        return;
      }
      resolve(commandFreeze({ stderr, stdout }));
    });
  });
}
