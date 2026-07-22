/* oxlint-disable typescript/unbound-method -- Boot-captured controls are invoked through captured Reflect.apply. */

import type {
  FrameworkQueryDependencyIdentity,
  FrameworkWireEntrySnapshot,
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
  const NativeJson = JSON;
  const NativeNodeList = scope.NodeList;
  const NativeObject = Object;
  const NativeReflect = Reflect;
  const NativeTypeError = TypeError;
  const bootDocument = scope.document;
  const nativeReflectApply = NativeReflect.apply;
  const arrayIsArray = NativeArray.isArray;
  const arrayPush = NativeArray.prototype.push;
  const jsonParse = NativeJson.parse;
  const objectFreeze = NativeObject.freeze;
  const objectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
  const stringSlice = String.prototype.slice;
  const stringToLowerCase = String.prototype.toLowerCase;
  const stringTrim = String.prototype.trim;
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
  const snapshotLiveTargetProps = ownMethod(codec, 'snapshotLiveTargetProps');
  const decodeIdentityToken = ownMethod(codec, 'decodeIdentityToken');
  const decodeQueryDependencyToken = ownMethod(codec, 'decodeQueryDependencyToken');
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
      !snapshotLiveTargetProps ||
      !decodeIdentityToken ||
      !decodeQueryDependencyToken ||
      !identityIsValid ||
      !componentIsValid ||
      !attestationIsValid ||
      typeof maxEntries !== 'number' ||
      maxEntries !== 64 ||
      typeof maxHeaderCharacters !== 'number' ||
      maxHeaderCharacters !== 4_096
    ) {
      return false;
    }
    try {
      const arrayControl: unknown[] = [];
      appendDense(arrayControl, 'array-control', 'Kovo HMR array control');
      if (ownArrayEntry(arrayControl, 0) !== 'array-control') return false;
      const element = apply<unknown>(documentCreateElement, bootDocument, ['div']);
      if (element === null || typeof element !== 'object') return false;
      apply(elementSetAttribute, element, ['data-kovo-hmr-control', 'exact']);
      if (rawReadAttribute(element, 'data-kovo-hmr-control') !== 'exact') return false;
      if (rawReadAttribute(element, 'data-kovo-hmr-missing') !== null) return false;
      const jsonControl = apply<unknown>(jsonParse, NativeJson, ['{"hmr":1}']);
      if (ownData<number>(jsonControl, 'hmr') !== 1) return false;
      let rejectedMalformedJson = false;
      try {
        apply(jsonParse, NativeJson, ['{malformed']);
      } catch {
        rejectedMalformedJson = true;
      }
      if (!rejectedMalformedJson) return false;
      const empty = apply<unknown>(documentQuerySelectorAll, bootDocument, [':not(*)']);
      if (rawNodeListLength(empty) !== 0) return false;
      const html = apply<unknown>(documentQuerySelectorAll, bootDocument, ['html']);
      if (rawNodeListLength(html) < 1) return false;
      const htmlElement = apply<unknown>(nodeListItem, html, [0]);
      if (htmlElement === null || typeof htmlElement !== 'object') return false;
      if (apply<boolean>(identityIsValid, codec, ['hmr-control']) !== true) return false;
      if (apply<boolean>(identityIsValid, codec, ['bad\0target']) !== false) return false;
      if (apply<string>(decodeIdentityToken, codec, ['query%3Acontrol']) !== 'query:control') {
        return false;
      }
      const keyedDependency = apply<unknown>(decodeQueryDependencyToken, codec, [
        '!query!query%3Acontrol',
      ]);
      if (
        ownData<string>(keyedDependency, 'name') !== 'query' ||
        ownData<string>(keyedDependency, 'key') !== 'query:control'
      ) {
        return false;
      }
      if (
        apply<string>(encodeTargetHeader, codec, [
          [{ deps: [{ name: 'query-control' }], target: 'target-control' }],
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
      if (apply<string>(snapshotLiveTargetProps, codec, ['{"z":1,"a":2}']) !== '{"a":2,"z":1}') {
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
  const readDependencies = (value: string | null): FrameworkQueryDependencyIdentity[] => {
    assertControls();
    const source = value ?? '';
    if (source.length > (maxHeaderCharacters as number)) {
      throw new NativeTypeError('Kovo HMR dependency input exceeds its bounded wire length.');
    }
    const output: FrameworkQueryDependencyIdentity[] = [];
    let start = 0;
    for (let index = 0; index <= source.length; index += 1) {
      const character = index === source.length ? ' ' : (source[index] ?? '');
      if (character !== ' ') continue;
      if (index > start) {
        const token = apply<string>(stringSlice, source, [start, index]);
        const dependency = apply<unknown>(decodeQueryDependencyToken!, codec, [token]);
        if (dependency === undefined) {
          throw new NativeTypeError(
            'Kovo HMR dependency input must contain canonical query identity tokens.',
          );
        }
        const name = ownData<unknown>(dependency, 'name');
        const key = ownData<unknown>(dependency, 'key');
        if (typeof name !== 'string' || (key !== undefined && typeof key !== 'string')) {
          throw new NativeTypeError('Kovo HMR dependency codec returned malformed identity facts.');
        }
        if (
          ownArrayLength(output, 'Kovo HMR dependency snapshot', maxEntries as number) ===
          maxEntries
        ) {
          throw new NativeTypeError(
            'Kovo HMR dependency input exceeds its bounded identity count.',
          );
        }
        for (let depIndex = 0; depIndex < output.length; depIndex += 1) {
          const existing = ownArrayEntry<FrameworkQueryDependencyIdentity>(output, depIndex);
          if (
            ownData<string>(existing, 'name') === name &&
            ownData<string>(existing, 'key') === key
          ) {
            throw new NativeTypeError('Kovo HMR dependency identities must be unique.');
          }
        }
        appendDense(
          output,
          dependency as FrameworkQueryDependencyIdentity,
          'Kovo HMR dependency snapshot',
        );
      }
      start = index + 1;
    }
    return output;
  };
  const responseEnvelopeIsFragment = (
    contentType: unknown,
    contentDisposition: unknown,
  ): boolean => {
    assertControls();
    if (typeof contentType !== 'string' || contentType.length === 0 || contentType.length > 8_192) {
      return false;
    }
    const normalizedContentType = apply<string>(stringToLowerCase, contentType, []);
    const trimmedContentType = apply<string>(stringTrim, normalizedContentType, []);
    if (
      trimmedContentType !== 'text/vnd.kovo.fragment+html' &&
      trimmedContentType !== 'text/vnd.kovo.fragment+html; charset=utf-8'
    ) {
      return false;
    }
    if (contentDisposition === null || contentDisposition === undefined) return true;
    if (
      typeof contentDisposition !== 'string' ||
      contentDisposition.length === 0 ||
      contentDisposition.length > 8_192
    ) {
      return false;
    }
    return (
      apply<string>(stringToLowerCase, apply<string>(stringTrim, contentDisposition, []), []) ===
      'inline'
    );
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

  const liveTargets = (root: unknown): readonly FrameworkWireEntrySnapshot[] => {
    const seen: string[] = [];
    const output: FrameworkWireEntrySnapshot[] = [];
    const elements = queryElements(root, '[kovo-deps]');
    const elementCount = ownArrayLength(
      elements,
      'Kovo HMR element snapshot',
      maxCollectionElements,
    );
    for (let index = 0; index < elementCount; index += 1) {
      const element = ownArrayEntry<object>(elements, index);
      const attestation = readAttribute(element, 'kovo-live-token');
      // Dependency-only roots are expected in this collection. Once a root advertises a live
      // attestation, however, its whole descriptor must be usable: silently dropping a malformed
      // sibling would turn one DOM snapshot into a partially refreshed document (SPEC §9.5).
      if (attestation === null) continue;
      const target = targetIdentity(element);
      const component = liveComponentIdentity(element);
      if (
        apply<boolean>(identityIsValid!, codec, [target]) !== true ||
        apply<boolean>(componentIsValid!, codec, [component]) !== true ||
        apply<boolean>(attestationIsValid!, codec, [attestation]) !== true ||
        target === ''
      ) {
        throw new NativeTypeError('Kovo HMR live-target metadata is invalid.');
      }
      if (contains(seen, target)) {
        throw new NativeTypeError('Kovo HMR live-target identities must be unique.');
      }
      appendDense(seen, target, 'Kovo HMR live-target identity snapshot');
      const propsSource = readAttribute(element, 'kovo-props');
      if (propsSource !== null) {
        if (propsSource.length > (maxHeaderCharacters as number)) {
          throw new NativeTypeError('Kovo HMR live-target props exceed their wire budget.');
        }
        let parsedProps: unknown;
        try {
          parsedProps = apply(jsonParse, NativeJson, [propsSource]);
        } catch {
          throw new NativeTypeError('Kovo HMR live-target props must be JSON object text.');
        }
        if (
          parsedProps === null ||
          typeof parsedProps !== 'object' ||
          apply(arrayIsArray, NativeArray, [parsedProps]) === true
        ) {
          throw new NativeTypeError('Kovo HMR live-target props must be JSON object text.');
        }
      }
      const wireEntry = apply<string>(encodeLiveTargetHeader!, codec, [
        [
          {
            attestation,
            component,
            propsSource,
            target,
          },
        ],
      ]);
      if (wireEntry === '') {
        throw new NativeTypeError('Kovo HMR live-target metadata encoded to an empty entry.');
      }
      appendDense(
        output,
        apply(objectFreeze, NativeObject, [{ target, wireEntry }]) as FrameworkWireEntrySnapshot,
        'Kovo HMR live-target header snapshot',
      );
    }
    return apply(objectFreeze, NativeObject, [output]) as readonly FrameworkWireEntrySnapshot[];
  };

  const dependencyTargets = (root: unknown): readonly FrameworkWireEntrySnapshot[] => {
    const seen: string[] = [];
    const output: FrameworkWireEntrySnapshot[] = [];
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
      ownArrayLength(dependencies, 'Kovo HMR dependency snapshot', maxCollectionElements);
      if (apply<boolean>(identityIsValid!, codec, [target]) !== true || target === '') {
        throw new NativeTypeError('Kovo HMR dependency-target metadata is invalid.');
      }
      if (contains(seen, target)) {
        throw new NativeTypeError('Kovo HMR dependency-target identities must be unique.');
      }
      appendDense(seen, target, 'Kovo HMR target identity snapshot');
      const wireEntry = apply<string>(encodeTargetHeader!, codec, [
        [{ deps: dependencies, target }],
      ]);
      if (wireEntry === '') {
        throw new NativeTypeError('Kovo HMR dependency-target metadata encoded to an empty entry.');
      }
      appendDense(
        output,
        apply(objectFreeze, NativeObject, [{ target, wireEntry }]) as FrameworkWireEntrySnapshot,
        'Kovo HMR target header snapshot',
      );
    }
    return apply(objectFreeze, NativeObject, [output]) as readonly FrameworkWireEntrySnapshot[];
  };

  const currentBuild = (root: unknown): string => {
    const elements = queryElements(root, 'meta[name="kovo-build"]');
    const length = ownArrayLength(elements, 'Kovo HMR build-meta snapshot', maxCollectionElements);
    if (length === 0) return '';
    if (length !== 1) {
      throw new NativeTypeError('Kovo HMR requires exactly one document build identity.');
    }
    const value = readAttribute(ownArrayEntry(elements, 0), 'content') ?? '';
    if (apply<boolean>(identityIsValid!, codec, [value]) !== true) {
      throw new NativeTypeError('Kovo HMR document build identity is invalid.');
    }
    return value;
  };
  const writeBuild = (root: unknown, value: string): void => {
    const elements = queryElements(root, 'meta[name="kovo-build"]');
    const length = ownArrayLength(elements, 'Kovo HMR build-meta snapshot', maxCollectionElements);
    if (length !== 1 || apply<boolean>(identityIsValid!, codec, [value]) !== true) {
      throw new NativeTypeError('Kovo HMR build transition requires exact document identities.');
    }
    writeAttribute(ownArrayEntry(elements, 0), 'content', value);
  };

  return apply(objectFreeze, NativeObject, [
    { currentBuild, dependencyTargets, liveTargets, responseEnvelopeIsFragment, writeBuild },
  ]);
}
