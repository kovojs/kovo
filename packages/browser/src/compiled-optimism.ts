import { assertAllowedKovoDynamicImportUrlForModule } from './dynamic-import-url.js';
import type { ImportHandlerModule } from './handlers.js';
import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';
import {
  canonicalInstanceKeyValue,
  type OptimisticChange,
  type OptimisticEntry,
  type OptimisticPlan,
  type OptimisticQueryKey,
} from './optimism.js';
import { queryStoreKey } from './query-store.js';
import {
  defineSecurityProperties,
  freezeSecurityValue,
  securityArrayAppend,
  securityArrayIsArray,
  securityGetOwnPropertyDescriptor,
  securityNumber,
  securityObjectKeys,
  securityOwnArrayEntry,
  securitySet,
  securitySetAdd,
  securitySetHas,
  securityString,
  securityStringToLowerCase,
} from './security-witness-intrinsics.js';

const COMPILED_OPTIMISTIC_PLAN_SCHEMA = 'kovo.optimistic-plan/v1';
const COMPILED_OPTIMISTIC_PLAN_EXPORT = 'kovoOptimisticMutationPlans';
const MAX_COMPILED_OPTIMISTIC_ENTRIES = 1_024;
const compiledOptimismBrowserSecurity = createBrowserNavigationSecurityControls();

type CompiledInputFieldCoercion = 'boolean' | 'file' | 'number' | 'string' | 'unknown';

interface CompiledInputField {
  readonly coercion: CompiledInputFieldCoercion;
  readonly defaulted: boolean;
  readonly name: string;
  readonly optional: boolean;
  readonly required: boolean;
}

/** @internal Validated compiler plan plus the mutation input decoded from the submitted FormData. */
export interface CompiledOptimisticSubmission {
  readonly input: Readonly<Record<string, unknown>>;
  readonly optimistic: OptimisticPlan<Readonly<Record<string, unknown>>>;
}

/**
 * Resolve one compiler-emitted optimistic mutation plan through the loader's guarded importer.
 *
 * The immutable module URL authenticates the exact emitted bytes. This boundary still validates
 * the namespace and plan grammar before any imported predictor executes, so a wrong export,
 * mutation, status set, invalidation set, or keyed-instance carrier fails closed (SPEC §5.2/§10.4).
 */
export async function loadCompiledOptimisticSubmission(options: {
  readonly formData: unknown;
  readonly importModule: ImportHandlerModule;
  readonly moduleHref: string;
  readonly mutation: string;
}): Promise<CompiledOptimisticSubmission> {
  assertAllowedKovoDynamicImportUrlForModule(options.moduleHref, options.importModule);
  const namespace = await options.importModule(options.moduleHref);
  const plans = ownData(
    namespace,
    COMPILED_OPTIMISTIC_PLAN_EXPORT,
    'Kovo optimistic compiler module',
  );
  if (!isRecord(plans)) {
    throw new TypeError(
      `Kovo optimistic compiler module must export own-data ${COMPILED_OPTIMISTIC_PLAN_EXPORT}.`,
    );
  }
  const rawPlan = ownData(plans, options.mutation, 'Kovo optimistic compiler plans');
  if (!isRecord(rawPlan)) {
    throw new TypeError(
      `Kovo optimistic compiler module has no exact plan for ${options.mutation}.`,
    );
  }
  assertExactOwnKeys(
    rawPlan,
    [
      'inputFields',
      'invalidations',
      'keys',
      'mutation',
      'queue',
      'schema',
      'statuses',
      'transforms',
    ],
    ['keys', 'queue'],
    `Kovo optimistic plan ${options.mutation}`,
  );
  if (
    ownData(rawPlan, 'schema', `Kovo optimistic plan ${options.mutation}`) !==
      COMPILED_OPTIMISTIC_PLAN_SCHEMA ||
    ownData(rawPlan, 'mutation', `Kovo optimistic plan ${options.mutation}`) !== options.mutation
  ) {
    throw new TypeError(
      `Kovo optimistic compiler module plan identity does not match ${options.mutation}.`,
    );
  }

  const invalidations = denseUniqueStrings(
    ownData(rawPlan, 'invalidations', `Kovo optimistic plan ${options.mutation}`),
    `Kovo optimistic plan ${options.mutation} invalidations`,
  );
  if (invalidations.length === 0) {
    throw new TypeError(`Kovo optimistic plan ${options.mutation} has no invalidations.`);
  }
  const statuses = ownData(rawPlan, 'statuses', `Kovo optimistic plan ${options.mutation}`);
  const rawTransforms = ownData(rawPlan, 'transforms', `Kovo optimistic plan ${options.mutation}`);
  if (!isRecord(statuses) || !isRecord(rawTransforms)) {
    throw new TypeError(
      `Kovo optimistic plan ${options.mutation} requires own-data statuses and transforms.`,
    );
  }
  assertExactRecordKeys(
    statuses,
    invalidations,
    `Kovo optimistic plan ${options.mutation} statuses`,
  );
  assertExactRecordKeys(
    rawTransforms,
    invalidations,
    `Kovo optimistic plan ${options.mutation} transforms`,
  );

  const transforms: Record<string, OptimisticEntry<Readonly<Record<string, unknown>>>> = {};
  for (let index = 0; index < invalidations.length; index += 1) {
    const queryName = invalidations[index]!;
    const status = ownData(statuses, queryName, `Kovo optimistic statuses ${options.mutation}`);
    const transform = ownData(
      rawTransforms,
      queryName,
      `Kovo optimistic transforms ${options.mutation}`,
    );
    if (
      (status === 'await-fragment' && transform !== 'await-fragment') ||
      (status === 'hand-written' && typeof transform !== 'function') ||
      (status !== 'await-fragment' && status !== 'hand-written')
    ) {
      throw new TypeError(
        `Kovo optimistic plan ${options.mutation} has inconsistent status/transform facts for ${queryName}.`,
      );
    }
    defineSecurityProperties(transforms, {
      [queryName]: {
        configurable: false,
        enumerable: true,
        value: transform,
        writable: false,
      },
    });
  }

  const rawKeys = ownData(rawPlan, 'keys', `Kovo optimistic plan ${options.mutation}`);
  const keys =
    rawKeys === undefined
      ? undefined
      : compiledOptimisticKeys(rawKeys, statuses, invalidations, options.mutation);
  const inputFields = compiledInputFields(
    ownData(rawPlan, 'inputFields', `Kovo optimistic plan ${options.mutation}`),
    options.mutation,
  );
  const input = decodeCompiledOptimisticInput(options.formData, inputFields);
  const rawQueue = ownData(rawPlan, 'queue', `Kovo optimistic plan ${options.mutation}`);
  if (
    rawQueue !== undefined &&
    (typeof rawQueue !== 'string' || rawQueue.length === 0 || rawQueue.length > 256)
  ) {
    throw new TypeError(`Kovo optimistic plan ${options.mutation} has an invalid queue.`);
  }

  return freezeSecurityValue({
    input: freezeSecurityValue(input),
    optimistic: freezeSecurityValue({
      ...(keys === undefined ? {} : { keys: freezeSecurityValue(keys) }),
      ...(rawQueue === undefined ? {} : { queue: rawQueue }),
      transforms: freezeSecurityValue(transforms),
    }),
  });
}

function compiledOptimisticKeys(
  rawKeys: unknown,
  statuses: Record<string, unknown>,
  invalidations: readonly string[],
  mutation: string,
): Record<string, OptimisticQueryKey<Readonly<Record<string, unknown>>>> {
  if (!isRecord(rawKeys)) {
    throw new TypeError(`Kovo optimistic plan ${mutation} keys must be an own object.`);
  }
  const queryNames = securityObjectKeys(rawKeys);
  if (queryNames.length > invalidations.length) {
    throw new TypeError(`Kovo optimistic plan ${mutation} has unrelated keyed queries.`);
  }
  const invalidationSet = securitySet<string>();
  for (let index = 0; index < invalidations.length; index += 1) {
    securitySetAdd(invalidationSet, invalidations[index]!);
  }
  const keys: Record<string, OptimisticQueryKey<Readonly<Record<string, unknown>>>> = {};
  for (let index = 0; index < queryNames.length; index += 1) {
    const queryName = queryNames[index]!;
    const derive = ownData(rawKeys, queryName, `Kovo optimistic plan ${mutation} keys`);
    if (
      !securitySetHas(invalidationSet, queryName) ||
      ownData(statuses, queryName, `Kovo optimistic plan ${mutation} statuses`) !==
        'hand-written' ||
      typeof derive !== 'function'
    ) {
      throw new TypeError(
        `Kovo optimistic plan ${mutation} has an invalid keyed binding for ${queryName}.`,
      );
    }
    const resolve = (
      change: OptimisticChange<Readonly<Record<string, unknown>>>,
    ): readonly string[] => {
      const derived = derive(change.input) as unknown;
      if (
        !securityArrayIsArray(derived) ||
        derived.length === 0 ||
        derived.length > MAX_COMPILED_OPTIMISTIC_ENTRIES
      ) {
        throw new TypeError(
          `Kovo optimistic plan ${mutation} keys(${queryName}) must return a bounded non-empty dense args array.`,
        );
      }
      const identities: string[] = [];
      const seen = securitySet<string>();
      for (let keyIndex = 0; keyIndex < derived.length; keyIndex += 1) {
        const argsEntry = securityOwnArrayEntry(derived, keyIndex);
        if (!argsEntry.ok || !isRecord(argsEntry.value)) {
          throw new TypeError(
            `Kovo optimistic plan ${mutation} keys(${queryName}) must return exact args objects.`,
          );
        }
        const argNames = securityObjectKeys(argsEntry.value);
        if (argNames.length === 0 || argNames.length > 64) {
          throw new TypeError(
            `Kovo optimistic plan ${mutation} keys(${queryName}) returned malformed query args.`,
          );
        }
        const keyValue = canonicalInstanceKeyValue(
          argsEntry.value as Record<string, string | number | boolean>,
        );
        const identity = `${queryName}:${keyValue}`;
        queryStoreKey(queryName, identity);
        if (securitySetHas(seen, identity)) {
          throw new TypeError(
            `Kovo optimistic plan ${mutation} keys(${queryName}) returned a duplicate instance.`,
          );
        }
        securitySetAdd(seen, identity);
        securityArrayAppend(identities, identity, 'Compiled optimistic query identities');
      }
      return identities;
    };
    defineSecurityProperties(keys, {
      [queryName]: {
        configurable: false,
        enumerable: true,
        value: resolve,
        writable: false,
      },
    });
  }
  return keys;
}

function compiledInputFields(value: unknown, mutation: string): CompiledInputField[] {
  if (!securityArrayIsArray(value) || value.length > MAX_COMPILED_OPTIMISTIC_ENTRIES) {
    throw new TypeError(`Kovo optimistic plan ${mutation} inputFields must be a bounded array.`);
  }
  const fields: CompiledInputField[] = [];
  const names = securitySet<string>();
  for (let index = 0; index < value.length; index += 1) {
    const entry = securityOwnArrayEntry(value, index);
    if (!entry.ok || !isRecord(entry.value)) {
      throw new TypeError(`Kovo optimistic plan ${mutation} inputFields must be dense objects.`);
    }
    assertExactOwnKeys(
      entry.value,
      ['coercion', 'defaulted', 'name', 'optional', 'required'],
      [],
      `Kovo optimistic plan ${mutation} inputFields[${index}]`,
    );
    const coercion = ownData(entry.value, 'coercion', `Kovo optimistic input field ${index}`);
    const defaulted = ownData(entry.value, 'defaulted', `Kovo optimistic input field ${index}`);
    const name = ownData(entry.value, 'name', `Kovo optimistic input field ${index}`);
    const optional = ownData(entry.value, 'optional', `Kovo optimistic input field ${index}`);
    const required = ownData(entry.value, 'required', `Kovo optimistic input field ${index}`);
    if (
      !isCompiledInputCoercion(coercion) ||
      typeof defaulted !== 'boolean' ||
      typeof name !== 'string' ||
      name.length === 0 ||
      name.length > 256 ||
      typeof optional !== 'boolean' ||
      typeof required !== 'boolean' ||
      (required && (optional || defaulted)) ||
      securitySetHas(names, name)
    ) {
      throw new TypeError(`Kovo optimistic plan ${mutation} has an invalid input field.`);
    }
    securitySetAdd(names, name);
    securityArrayAppend(
      fields,
      { coercion, defaulted, name, optional, required },
      'Compiled optimistic input fields',
    );
  }
  return fields;
}

function decodeCompiledOptimisticInput(
  formData: unknown,
  fields: readonly CompiledInputField[],
): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]!;
    const value = compiledOptimismBrowserSecurity.readFormDataValue(formData, field.name);
    const missing = value === undefined || value === null || value === '';
    if (missing && field.coercion !== 'boolean') {
      if (field.optional) continue;
      if (field.defaulted) {
        throw new TypeError(
          `Kovo optimistic mutation input field ${field.name} relies on a server schema default.`,
        );
      }
      throw new TypeError(
        `Kovo optimistic mutation input is missing required field ${field.name}.`,
      );
    }
    let decoded: unknown = value;
    if (field.coercion === 'boolean') {
      if (missing) decoded = false;
      else if (typeof value === 'boolean') decoded = value;
      else if (typeof value === 'string') {
        const normalized = securityStringToLowerCase(value);
        if (
          normalized === '1' ||
          normalized === 'on' ||
          normalized === 'true' ||
          normalized === 'yes'
        ) {
          decoded = true;
        } else if (
          normalized === '0' ||
          normalized === 'false' ||
          normalized === 'no' ||
          normalized === 'off'
        ) {
          decoded = false;
        } else {
          throw new TypeError(`Kovo optimistic mutation input field ${field.name} is not boolean.`);
        }
      } else {
        throw new TypeError(`Kovo optimistic mutation input field ${field.name} is not boolean.`);
      }
    } else if (field.coercion === 'number') {
      const number = typeof value === 'number' ? value : securityNumber(value);
      if (number !== number || number === Infinity || number === -Infinity) {
        throw new TypeError(`Kovo optimistic mutation input field ${field.name} is not numeric.`);
      }
      decoded = number;
    } else if (field.coercion === 'string' && typeof value !== 'string') {
      throw new TypeError(`Kovo optimistic mutation input field ${field.name} is not text.`);
    }
    defineSecurityProperties(input, {
      [field.name]: {
        configurable: false,
        enumerable: true,
        value: decoded,
        writable: false,
      },
    });
  }
  return input;
}

function denseUniqueStrings(value: unknown, label: string): string[] {
  if (
    !securityArrayIsArray(value) ||
    value.length === 0 ||
    value.length > MAX_COMPILED_OPTIMISTIC_ENTRIES
  ) {
    throw new TypeError(`${label} must be a bounded non-empty dense string array.`);
  }
  const result: string[] = [];
  const seen = securitySet<string>();
  for (let index = 0; index < value.length; index += 1) {
    const entry = securityOwnArrayEntry(value, index);
    if (
      !entry.ok ||
      typeof entry.value !== 'string' ||
      entry.value.length === 0 ||
      securitySetHas(seen, entry.value)
    ) {
      throw new TypeError(`${label} must contain unique non-empty own-data strings.`);
    }
    securitySetAdd(seen, entry.value);
    securityArrayAppend(result, entry.value, label);
  }
  return result;
}

function assertExactRecordKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = securityObjectKeys(value);
  if (actual.length !== expected.length)
    throw new TypeError(`${label} do not match invalidations.`);
  const expectedSet = securitySet<string>();
  for (let index = 0; index < expected.length; index += 1) {
    securitySetAdd(expectedSet, expected[index]!);
  }
  for (let index = 0; index < actual.length; index += 1) {
    if (!securitySetHas(expectedSet, actual[index]!)) {
      throw new TypeError(`${label} do not match invalidations.`);
    }
  }
}

function assertExactOwnKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowedSet = securitySet<string>();
  const optionalSet = securitySet<string>();
  for (let index = 0; index < allowed.length; index += 1) {
    securitySetAdd(allowedSet, allowed[index]!);
  }
  for (let index = 0; index < optional.length; index += 1) {
    securitySetAdd(optionalSet, optional[index]!);
  }
  const actual = securityObjectKeys(value);
  for (let index = 0; index < actual.length; index += 1) {
    if (!securitySetHas(allowedSet, actual[index]!)) {
      throw new TypeError(`${label} contains an unknown property ${actual[index]}.`);
    }
  }
  for (let index = 0; index < allowed.length; index += 1) {
    const name = allowed[index]!;
    if (!securitySetHas(optionalSet, name) && ownData(value, name, label) === undefined) {
      throw new TypeError(`${label} is missing ${name}.`);
    }
  }
}

function ownData(value: object, property: PropertyKey, label: string): unknown {
  const descriptor = securityGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) {
    throw new TypeError(`${label}.${securityString(property)} must be an own-data property.`);
  }
  return descriptor.value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !securityArrayIsArray(value);
}

function isCompiledInputCoercion(value: unknown): value is CompiledInputFieldCoercion {
  return (
    value === 'boolean' ||
    value === 'file' ||
    value === 'number' ||
    value === 'string' ||
    value === 'unknown'
  );
}
