/* oxlint-disable typescript/unbound-method -- Boot-captured controls are invoked through captured Reflect.apply. */

import type {
  FrameworkWireInputGrammar,
  FrameworkWireTargetCodec,
} from '@kovojs/core/internal/wire-input-grammar';

/** @internal Closed HMR target producer serialized into the dev-only client module. */
export function createHmrTargetSnapshotReader(
  grammar: FrameworkWireInputGrammar,
  codec: FrameworkWireTargetCodec,
  scope: typeof globalThis = globalThis,
) {
  // This function is embedded with Function#toString by the Vite dev server. Keep every runtime
  // dependency inside this closure so the emitted module captures DOM and collection controls
  // before authored HMR callbacks can replace them (SPEC §6.6 rule 6 / §9.1).
  const NativeArray = Array;
  const NativeDocument = scope.Document;
  const NativeElement = scope.Element;
  const NativeNodeList = scope.NodeList;
  const NativeObject = Object;
  const NativeReflect = Reflect;
  const NativeRegExp = RegExp;
  const NativeTypeError = TypeError;
  const bootDocument = scope.document;
  const nativeReflectApply = NativeReflect.apply;
  const arrayIsArray = NativeArray.isArray;
  const arrayPush = NativeArray.prototype.push;
  const objectFreeze = NativeObject.freeze;
  const objectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
  const regexpTest = NativeRegExp.prototype.test;
  const stringSlice = String.prototype.slice;
  const dependencySeparator = /\s/u;
  const maxCollectionElements = 100_000;

  const apply = <Result>(method: Function, receiver: unknown, args: readonly unknown[]): Result =>
    nativeReflectApply(method, receiver, args) as Result;

  const descriptor = (carrier: object, name: PropertyKey): PropertyDescriptor | undefined =>
    apply(objectGetOwnPropertyDescriptor, NativeObject, [carrier, name]);
  const ownData = <Value>(carrier: unknown, name: PropertyKey): Value | undefined => {
    if (carrier === null || (typeof carrier !== 'object' && typeof carrier !== 'function')) {
      return undefined;
    }
    const found = descriptor(carrier, name);
    if (found === undefined) return undefined;
    const value = descriptor(found, 'value');
    return value === undefined ? undefined : (value.value as Value);
  };
  const ownGetter = (carrier: object, name: PropertyKey): Function | undefined => {
    const found = descriptor(carrier, name);
    if (found === undefined) return undefined;
    const getter = descriptor(found, 'get');
    return getter !== undefined && typeof getter.value === 'function' ? getter.value : undefined;
  };
  const ownMethod = (carrier: object | undefined, name: PropertyKey): Function | undefined => {
    if (carrier === undefined) return undefined;
    const value = ownData<unknown>(carrier, name);
    return typeof value === 'function' ? value : undefined;
  };
  const ownArrayLength = (values: unknown, label: string, maximum: number): number => {
    if (apply(arrayIsArray, NativeArray, [values]) !== true) {
      throw new NativeTypeError(label + ' must be an array.');
    }
    const length = ownData<unknown>(values, 'length');
    if (typeof length !== 'number' || length < 0 || length % 1 !== 0 || length > maximum) {
      throw new NativeTypeError(label + ' must have a bounded own-data length.');
    }
    return length;
  };
  const ownArrayEntry = <Value>(values: unknown, index: number): Value => {
    const entry = ownData<Value>(values, index);
    if (entry === undefined) {
      throw new NativeTypeError('Kovo HMR snapshots must contain dense own-data entries.');
    }
    return entry;
  };
  const appendDense = <Value>(values: Value[], value: Value, label: string): void => {
    const before = ownArrayLength(values, label, maxCollectionElements);
    apply(arrayPush, values, [value]);
    const after = ownArrayLength(values, label, maxCollectionElements);
    if (after !== before + 1 || ownArrayEntry<Value>(values, before) !== value) {
      throw new NativeTypeError(label + ' append did not commit one dense own-data value.');
    }
  };

  const documentPrototype = NativeDocument?.prototype;
  const elementPrototype = NativeElement?.prototype;
  const nodeListPrototype = NativeNodeList?.prototype;
  const documentQuerySelectorAll = ownMethod(documentPrototype, 'querySelectorAll');
  const documentCreateElement = ownMethod(documentPrototype, 'createElement');
  const elementGetAttribute = ownMethod(elementPrototype, 'getAttribute');
  const elementSetAttribute = ownMethod(elementPrototype, 'setAttribute');
  const nodeListLength = nodeListPrototype ? ownGetter(nodeListPrototype, 'length') : undefined;
  const nodeListItem = ownMethod(nodeListPrototype, 'item');
  const encodeLiveTargetHeader = ownMethod(codec, 'encodeLiveTargetHeader');
  const encodeTargetHeader = ownMethod(codec, 'encodeTargetHeader');
  const identityIsValid = ownMethod(codec, 'identityIsValid');
  const componentIsValid = ownMethod(codec, 'componentIsValid');
  const attestationIsValid = ownMethod(codec, 'attestationIsValid');
  const maxEntries = ownData<unknown>(grammar, 'maxEntries');
  const maxHeaderCharacters = ownData<unknown>(grammar, 'maxHeaderCharacters');

  const rawNodeListLength = (values: unknown): number => {
    if (!nodeListLength || values === null || typeof values !== 'object') {
      throw new NativeTypeError('Kovo HMR NodeList controls are unavailable.');
    }
    const length = apply<unknown>(nodeListLength, values, []);
    if (
      typeof length !== 'number' ||
      length < 0 ||
      length % 1 !== 0 ||
      length > maxCollectionElements
    ) {
      throw new NativeTypeError('Kovo HMR query results exceed their bounded length.');
    }
    return length;
  };
  const rawReadAttribute = (element: unknown, name: string): string | null => {
    if (!elementGetAttribute || element === null || typeof element !== 'object') return null;
    try {
      const value = apply<unknown>(elementGetAttribute, element, [name]);
      return typeof value === 'string' ? value : null;
    } catch {
      return null;
    }
  };

  const controlsSound = (() => {
    if (
      bootDocument === undefined ||
      bootDocument === null ||
      typeof bootDocument !== 'object' ||
      !documentQuerySelectorAll ||
      !documentCreateElement ||
      !elementGetAttribute ||
      !elementSetAttribute ||
      !nodeListLength ||
      !nodeListItem ||
      !encodeLiveTargetHeader ||
      !encodeTargetHeader ||
      !identityIsValid ||
      !componentIsValid ||
      !attestationIsValid ||
      typeof maxEntries !== 'number' ||
      maxEntries !== 64 ||
      typeof maxHeaderCharacters !== 'number' ||
      maxHeaderCharacters !== 6_144
    ) {
      return false;
    }
    try {
      const arrayControl: unknown[] = [];
      appendDense(arrayControl, 'array-control', 'Kovo HMR array control');
      if (ownArrayEntry(arrayControl, 0) !== 'array-control') return false;
      if (apply(regexpTest, dependencySeparator, [' ']) !== true) return false;
      if (apply(regexpTest, dependencySeparator, ['x']) !== false) return false;
      const element = apply<unknown>(documentCreateElement, bootDocument, ['div']);
      if (element === null || typeof element !== 'object') return false;
      apply(elementSetAttribute, element, ['data-kovo-hmr-control', 'exact']);
      if (rawReadAttribute(element, 'data-kovo-hmr-control') !== 'exact') return false;
      if (rawReadAttribute(element, 'data-kovo-hmr-missing') !== null) return false;
      const empty = apply<unknown>(documentQuerySelectorAll, bootDocument, [':not(*)']);
      if (rawNodeListLength(empty) !== 0) return false;
      const html = apply<unknown>(documentQuerySelectorAll, bootDocument, ['html']);
      if (rawNodeListLength(html) < 1) return false;
      const htmlElement = apply<unknown>(nodeListItem, html, [0]);
      if (htmlElement === null || typeof htmlElement !== 'object') return false;
      if (apply<boolean>(identityIsValid, codec, ['hmr-control']) !== true) return false;
      if (apply<boolean>(identityIsValid, codec, ['bad target']) !== false) return false;
      if (
        apply<string>(encodeTargetHeader, codec, [
          [{ deps: ['query-control'], target: 'target-control' }],
        ]) !== 'target-control=query-control'
      ) {
        return false;
      }
      if (
        apply<string>(encodeLiveTargetHeader, codec, [
          [
            {
              attestation: 'token-control',
              component: 'component-control',
              propsSource: '{}',
              target: 'target-control',
            },
          ],
        ]) !== 'target-control#component-control@token-control:{}'
      ) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  })();

  const assertControls = (): void => {
    if (!controlsSound) {
      throw new NativeTypeError('Kovo HMR target snapshot controls are unavailable.');
    }
  };
  const queryElements = (root: unknown, selector: string): object[] => {
    assertControls();
    if (root === null || typeof root !== 'object') return [];
    const collection = apply<unknown>(documentQuerySelectorAll!, root, [selector]);
    const length = rawNodeListLength(collection);
    const output: object[] = [];
    for (let index = 0; index < length; index += 1) {
      const value = apply<unknown>(nodeListItem!, collection, [index]);
      if (value === null || typeof value !== 'object') {
        throw new NativeTypeError('Kovo HMR query results must contain dense element entries.');
      }
      appendDense(output, value, 'Kovo HMR element snapshot');
    }
    return output;
  };
  const readAttribute = (element: unknown, name: string): string | null => {
    assertControls();
    return rawReadAttribute(element, name);
  };
  const writeAttribute = (element: unknown, name: string, value: string): void => {
    assertControls();
    if (element === null || typeof element !== 'object') {
      throw new NativeTypeError('Kovo HMR attribute target must be an element.');
    }
    apply(elementSetAttribute!, element, [name, value]);
    if (rawReadAttribute(element, name) !== value) {
      throw new NativeTypeError('Kovo HMR attribute write did not commit exact bytes.');
    }
  };
  const contains = (values: readonly string[], value: string): boolean => {
    const length = ownArrayLength(values, 'Kovo HMR identity snapshot', maxEntries as number);
    for (let index = 0; index < length; index += 1) {
      if (ownArrayEntry<string>(values, index) === value) return true;
    }
    return false;
  };
  const readDependencies = (value: string | null): string[] => {
    assertControls();
    const source = value ?? '';
    if (source.length > (maxHeaderCharacters as number)) {
      throw new NativeTypeError('Kovo dependency input exceeds the wire character budget.');
    }
    const output: string[] = [];
    let start = 0;
    for (let index = 0; index <= source.length; index += 1) {
      const character = index === source.length ? ',' : (source[index] ?? '');
      if (
        character !== ',' &&
        apply<boolean>(regexpTest, dependencySeparator, [character]) !== true
      ) {
        continue;
      }
      if (index > start) {
        appendDense(
          output,
          apply<string>(stringSlice, source, [start, index]),
          'Kovo HMR dependency snapshot',
        );
      }
      start = index + 1;
    }
    return output;
  };
  const targetIdentity = (element: unknown): string => {
    const fragmentTarget = readAttribute(element, 'kovo-fragment-target');
    if (fragmentTarget !== null) return fragmentTarget;
    const id = readAttribute(element, 'id');
    if (id !== null) return id;
    return readAttribute(element, 'kovo-c') ?? '';
  };
  const liveComponentIdentity = (element: unknown): string =>
    readAttribute(element, 'kovo-live-component') ??
    readAttribute(element, 'kovo-c') ??
    targetIdentity(element);

  const liveTargets = (root: unknown): string[] => {
    const seen: string[] = [];
    const output: string[] = [];
    const elements = queryElements(root, '[kovo-deps]');
    const elementCount = ownArrayLength(
      elements,
      'Kovo HMR element snapshot',
      maxCollectionElements,
    );
    for (let index = 0; index < elementCount; index += 1) {
      const element = ownArrayEntry<object>(elements, index);
      const target = targetIdentity(element);
      const component = liveComponentIdentity(element);
      const attestation = readAttribute(element, 'kovo-live-token');
      if (
        apply<boolean>(identityIsValid!, codec, [target]) !== true ||
        apply<boolean>(componentIsValid!, codec, [component]) !== true ||
        apply<boolean>(attestationIsValid!, codec, [attestation]) !== true ||
        target === '' ||
        contains(seen, target)
      ) {
        continue;
      }
      appendDense(seen, target, 'Kovo HMR live-target identity snapshot');
      appendDense(
        output,
        apply<string>(encodeLiveTargetHeader!, codec, [
          [
            {
              attestation,
              component,
              propsSource: readAttribute(element, 'kovo-props'),
              target,
            },
          ],
        ]),
        'Kovo HMR live-target header snapshot',
      );
      if (
        ownArrayLength(output, 'Kovo HMR live-target header snapshot', maxEntries as number) ===
        maxEntries
      ) {
        break;
      }
    }
    return output;
  };

  const dependencyTargets = (root: unknown): string[] => {
    const seen: string[] = [];
    const output: string[] = [];
    const elements = queryElements(root, '[kovo-deps]');
    const elementCount = ownArrayLength(
      elements,
      'Kovo HMR element snapshot',
      maxCollectionElements,
    );
    for (let index = 0; index < elementCount; index += 1) {
      const element = ownArrayEntry<object>(elements, index);
      const target = targetIdentity(element);
      const dependencies = readDependencies(readAttribute(element, 'kovo-deps'));
      let safe = apply<boolean>(identityIsValid!, codec, [target]) === true;
      const dependencyCount = ownArrayLength(
        dependencies,
        'Kovo HMR dependency snapshot',
        maxHeaderCharacters as number,
      );
      for (
        let dependencyIndex = 0;
        safe && dependencyIndex < dependencyCount;
        dependencyIndex += 1
      ) {
        safe =
          apply<boolean>(identityIsValid!, codec, [
            ownArrayEntry<string>(dependencies, dependencyIndex),
          ]) === true;
      }
      if (!safe || target === '' || contains(seen, target)) continue;
      appendDense(seen, target, 'Kovo HMR target identity snapshot');
      appendDense(
        output,
        apply<string>(encodeTargetHeader!, codec, [[{ deps: dependencies, target }]]),
        'Kovo HMR target header snapshot',
      );
      if (
        ownArrayLength(output, 'Kovo HMR target header snapshot', maxEntries as number) ===
        maxEntries
      ) {
        break;
      }
    }
    return output;
  };

  const currentBuild = (root: unknown): string => {
    const elements = queryElements(root, 'meta[name="kovo-build"]');
    const length = ownArrayLength(elements, 'Kovo HMR build-meta snapshot', maxCollectionElements);
    return length === 0 ? '' : (readAttribute(ownArrayEntry(elements, 0), 'content') ?? '');
  };
  const writeBuild = (root: unknown, value: string): void => {
    const elements = queryElements(root, 'meta[name="kovo-build"]');
    const length = ownArrayLength(elements, 'Kovo HMR build-meta snapshot', maxCollectionElements);
    if (length > 0) writeAttribute(ownArrayEntry(elements, 0), 'content', value);
  };

  return apply(objectFreeze, NativeObject, [
    { currentBuild, dependencyTargets, liveTargets, writeBuild },
  ]);
}
