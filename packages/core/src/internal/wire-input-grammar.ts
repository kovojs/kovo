/* oxlint-disable typescript/unbound-method -- Boot-captured controls are invoked through captured Reflect.apply. */

/**
 * Core-owned mutation wire grammar (SPEC §9.1).
 *
 * Browser encoders, the inline-loader encoder, and the server decoder instantiate this exact
 * finite data and codec constructor. Keep protocol delimiters here rather than duplicating them
 * at either side of the wire.
 *
 * @internal
 */
export const FRAMEWORK_WIRE_INPUT_GRAMMAR = Object.freeze({
  descriptor: Object.freeze({
    attestationPropsSeparator: ':',
    componentAttestationSeparator: '@',
    targetComponentSeparator: '#',
  }),
  entrySeparator: ';',
  maxEntries: 64,
  maxCurrentUrlCharacters: 1_536,
  // Node's default HTTP parser accepts roughly 16 KiB across the entire request-header block.
  // Two 4 KiB Kovo target headers plus a normal maximum-size cookie still leave room for the
  // origin, content type, CSRF/idempotency metadata, names, and ordinary transport headers.
  maxHeaderCharacters: 4 * 1024,
  // Count exact framework-owned header-line bytes (name + `: ` + value + CRLF), leaving roughly
  // 7 KiB of Node's default door for a 4 KiB cookie and ordinary browser transport headers.
  maxTargetRequestHeaderBytes: 9 * 1024,
  presentationSeparator: '; ',
  schema: 'kovo.wire-input-grammar/v2',
  target: Object.freeze({
    assignmentSeparator: '=',
    dependencySeparator: ' ',
  }),
} as const);

/** @internal */
export type FrameworkWireInputCarrier =
  | 'header'
  | 'request-cookie'
  | 'request-header'
  | 'response-header'
  | 'search-param'
  | 'search-params'
  | 'stdio-line';

/** @internal */
export type FrameworkWireInputGrammarKind =
  | 'boolean-literal'
  | 'capability-token'
  | 'content-disposition'
  | 'cookie-value'
  | 'fragment-target'
  | 'http-field-value'
  | 'idempotency-token'
  | 'json'
  | 'live-target-list'
  | 'media-type'
  | 'opaque-token'
  | 'reviewed-door'
  | 'same-origin-path'
  | 'same-origin-url'
  | 'schema-validated-record'
  | 'target-list';

/** @internal */
export interface FrameworkWireInputRegistryEntry {
  readonly carrier: FrameworkWireInputCarrier;
  readonly grammar: FrameworkWireInputGrammarKind;
  readonly id: string;
  readonly name: string;
}

/**
 * Closed vocabulary for framework-owned header, cookie, and URL-search reads (SPEC §9.1).
 * `check:wire-input-boundary` resolves the exact reader symbols and requires every call site to
 * bind to one of these entries. `*` is reserved for reviewed dynamic-name or whole-carrier doors;
 * a literal read cannot bind to it.
 *
 * @internal
 */
export const FRAMEWORK_WIRE_INPUT_REGISTRY = Object.freeze({
  inputs: Object.freeze([
    {
      carrier: 'header',
      grammar: 'reviewed-door',
      id: 'header.dynamic-framework-door',
      name: '*',
    },
    {
      carrier: 'request-cookie',
      grammar: 'cookie-value',
      id: 'request-cookie.dynamic-name',
      name: '*',
    },
    {
      carrier: 'request-header',
      grammar: 'http-field-value',
      id: 'request-header.accept',
      name: 'accept',
    },
    {
      carrier: 'request-header',
      grammar: 'http-field-value',
      id: 'request-header.authorization',
      name: 'authorization',
    },
    {
      carrier: 'request-header',
      grammar: 'media-type',
      id: 'request-header.content-type',
      name: 'content-type',
    },
    {
      carrier: 'request-header',
      grammar: 'http-field-value',
      id: 'request-header.cookie',
      name: 'cookie',
    },
    {
      carrier: 'request-header',
      grammar: 'reviewed-door',
      id: 'request-header.dynamic-framework-door',
      name: '*',
    },
    {
      carrier: 'request-header',
      grammar: 'opaque-token',
      id: 'request-header.if-none-match',
      name: 'if-none-match',
    },
    {
      carrier: 'request-header',
      grammar: 'opaque-token',
      id: 'request-header.kovo-build',
      name: 'kovo-build',
    },
    {
      carrier: 'request-header',
      grammar: 'same-origin-url',
      id: 'request-header.kovo-current-url',
      name: 'kovo-current-url',
    },
    {
      carrier: 'request-header',
      grammar: 'fragment-target',
      id: 'request-header.kovo-form-target',
      name: 'kovo-form-target',
    },
    {
      carrier: 'request-header',
      grammar: 'boolean-literal',
      id: 'request-header.kovo-fragment',
      name: 'kovo-fragment',
    },
    {
      carrier: 'request-header',
      grammar: 'idempotency-token',
      id: 'request-header.kovo-idem',
      name: 'kovo-idem',
    },
    {
      carrier: 'request-header',
      grammar: 'live-target-list',
      id: 'request-header.kovo-live-targets',
      name: 'kovo-live-targets',
    },
    {
      carrier: 'request-header',
      grammar: 'boolean-literal',
      id: 'request-header.kovo-stream',
      name: 'kovo-stream',
    },
    {
      carrier: 'request-header',
      grammar: 'target-list',
      id: 'request-header.kovo-targets',
      name: 'kovo-targets',
    },
    {
      carrier: 'request-header',
      grammar: 'same-origin-url',
      id: 'request-header.origin',
      name: 'origin',
    },
    {
      carrier: 'request-header',
      grammar: 'same-origin-url',
      id: 'request-header.referer',
      name: 'referer',
    },
    {
      carrier: 'response-header',
      grammar: 'http-field-value',
      id: 'response-header.cache-control',
      name: 'cache-control',
    },
    {
      carrier: 'response-header',
      grammar: 'content-disposition',
      id: 'response-header.content-disposition',
      name: 'content-disposition',
    },
    {
      carrier: 'response-header',
      grammar: 'media-type',
      id: 'response-header.content-type',
      name: 'content-type',
    },
    {
      carrier: 'response-header',
      grammar: 'opaque-token',
      id: 'response-header.kovo-build',
      name: 'kovo-build',
    },
    {
      carrier: 'response-header',
      grammar: 'json',
      id: 'response-header.kovo-changes',
      name: 'kovo-changes',
    },
    {
      carrier: 'response-header',
      grammar: 'same-origin-path',
      id: 'response-header.kovo-reauth',
      name: 'kovo-reauth',
    },
    {
      carrier: 'response-header',
      grammar: 'opaque-token',
      id: 'response-header.kovo-session-transition',
      name: 'kovo-session-transition',
    },
    {
      carrier: 'response-header',
      grammar: 'same-origin-url',
      id: 'response-header.location',
      name: 'location',
    },
    {
      carrier: 'response-header',
      grammar: 'http-field-value',
      id: 'response-header.vary',
      name: 'vary',
    },
    {
      carrier: 'search-param',
      grammar: 'opaque-token',
      id: 'search-param.build',
      name: 'build',
    },
    {
      carrier: 'search-param',
      grammar: 'capability-token',
      id: 'search-param.kovo-cap',
      name: 'kovo-cap',
    },
    {
      carrier: 'search-param',
      grammar: 'opaque-token',
      id: 'search-param.old-build',
      name: 'oldBuild',
    },
    {
      carrier: 'search-param',
      grammar: 'same-origin-url',
      id: 'search-param.url',
      name: 'url',
    },
    {
      carrier: 'search-param',
      grammar: 'opaque-token',
      id: 'search-param.version',
      name: 'v',
    },
    {
      carrier: 'search-params',
      grammar: 'schema-validated-record',
      id: 'search-params.query-input',
      name: '*',
    },
    {
      carrier: 'stdio-line',
      grammar: 'json',
      id: 'stdio-line.json-rpc',
      name: 'json-rpc',
    },
  ] satisfies readonly FrameworkWireInputRegistryEntry[]),
  schema: 'kovo.wire-input-registry/v1',
} as const);

/** @internal */
export interface FrameworkWireTarget {
  readonly deps: readonly string[];
  readonly target: string;
}

/** @internal */
export interface FrameworkWireLiveTarget<Props extends object = Record<string, unknown>> {
  readonly attestation: string;
  readonly component: string;
  readonly props: Props;
  readonly target: string;
}

/** Raw browser-side descriptor accepted by the closed live-target encoder. @internal */
export interface FrameworkWireLiveTargetInput {
  readonly attestation: string;
  readonly component: string;
  readonly propsSource: string | null | undefined;
  readonly target: string;
}

/** One semantic DOM target paired with its canonical ASCII wire entry. @internal */
export interface FrameworkWireEntrySnapshot {
  readonly target: string;
  readonly wireEntry: string;
}

/** Inputs to the shared target-bearing request-header planner. @internal */
export interface FrameworkTargetRequestHeaderInput {
  readonly currentUrl: string;
  readonly formTarget?: string;
  readonly idem?: string;
  readonly liveTargets: readonly FrameworkWireEntrySnapshot[];
  readonly stream?: boolean;
  readonly targets: readonly FrameworkWireEntrySnapshot[];
}

/** Exact admitted target-bearing request headers and their semantic snapshots. @internal */
export interface FrameworkTargetRequestHeaderPlan {
  readonly headers: Readonly<Record<string, string>>;
  readonly liveTargets: readonly FrameworkWireEntrySnapshot[];
  readonly targets: readonly FrameworkWireEntrySnapshot[];
}

/** @internal */
export interface FrameworkWireTargetCodec {
  attestationIsValid(value: unknown): value is string;
  componentIsValid(value: unknown): value is string;
  decodeFormTargetHeader(value: unknown): string | undefined;
  decodeIdentityToken(value: unknown): string | undefined;
  decodeLiveTargetHeader(
    value: string,
    parseJson: (source: string) => unknown,
  ): FrameworkWireLiveTarget[];
  decodeTargetHeader(value: string): FrameworkWireTarget[];
  encodeEntryList(values: readonly string[], maxCharacters?: number): string;
  encodeFormTargetHeader(value: unknown): string | undefined;
  encodeIdentityToken(value: unknown): string | undefined;
  encodeLiveTargetHeader(values: readonly FrameworkWireLiveTargetInput[]): string;
  encodeTargetHeader(values: readonly FrameworkWireTarget[]): string;
  /** Scalar DOM identity validity; an explicitly present empty identity remains distinct. */
  domIdentityIsValid(value: unknown): value is string;
  /** Header/query identity validity, where the empty string is an ambiguous absence. */
  identityIsValid(value: unknown): value is string;
  planTargetRequestHeaders(
    input: FrameworkTargetRequestHeaderInput,
  ): FrameworkTargetRequestHeaderPlan | undefined;
  snapshotLiveTargetProps(source: string | null | undefined): string;
}

/** @internal */
export type FrameworkWireInputGrammar = typeof FRAMEWORK_WIRE_INPUT_GRAMMAR;

/**
 * Standalone codec constructor. It deliberately closes over no module state so the inline-loader
 * builder can embed this exact function together with the frozen grammar data.
 *
 * @internal
 */
export function createFrameworkWireTargetCodec(
  grammar: FrameworkWireInputGrammar,
): FrameworkWireTargetCodec {
  // This constructor is serialized into the inline browser loader as well as evaluated by the
  // server. Capture every scalar/collection control while the framework realm still owns boot so
  // later app code cannot rewrite a wire identity, dependency, or descriptor verdict (SPEC
  // §6.6 rule 6 / §9.1). Keep these captures local: the emitted loader must remain a
  // self-contained rendering of this function plus the frozen grammar data.
  const apply = Reflect.apply;
  const IntrinsicArray = Array;
  const IntrinsicJson = JSON;
  const IntrinsicNumber = Number;
  const IntrinsicObject = Object;
  const IntrinsicString = String;
  const arrayIsArray = IntrinsicArray.isArray;
  const arrayJoin = IntrinsicArray.prototype.join;
  const arrayPush = IntrinsicArray.prototype.push;
  const arraySort = IntrinsicArray.prototype.sort;
  const decodeUriComponent = decodeURIComponent;
  const encodeUriComponent = encodeURIComponent;
  const jsonParse = JSON.parse;
  const numberIsFinite = Number.isFinite;
  const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  const objectCreate = Object.create;
  const objectFreeze = Object.freeze;
  const objectKeys = Object.keys;
  const regexpTest = RegExp.prototype.test;
  const stringCharCodeAt = String.prototype.charCodeAt;
  const stringIndexOf = String.prototype.indexOf;
  const stringLastIndexOf = String.prototype.lastIndexOf;
  const stringSlice = String.prototype.slice;
  const stringTrim = String.prototype.trim;
  const whitespace = /\s/u;
  const hexadecimal = '0123456789abcdef';

  const ownData = <Value>(
    carrier: unknown,
    name: string | number,
  ): { readonly found: boolean; readonly value?: Value } => {
    if (carrier === null || (typeof carrier !== 'object' && typeof carrier !== 'function')) {
      return { found: false };
    }
    const descriptor = apply(objectGetOwnPropertyDescriptor, IntrinsicObject, [carrier, name]) as
      | PropertyDescriptor
      | undefined;
    if (descriptor === undefined) return { found: false };
    const descriptorValue = apply(objectGetOwnPropertyDescriptor, IntrinsicObject, [
      descriptor,
      'value',
    ]) as PropertyDescriptor | undefined;
    return descriptorValue === undefined
      ? { found: false }
      : { found: true, value: descriptorValue.value as Value };
  };

  const arrayLength = (value: unknown, label: string): number => {
    if (!apply(arrayIsArray, IntrinsicArray, [value])) {
      throw new TypeError(label + ' must be an array.');
    }
    const length = ownData<number>(value, 'length');
    if (
      !length.found ||
      typeof length.value !== 'number' ||
      length.value < 0 ||
      length.value % 1 !== 0 ||
      length.value > grammar.maxHeaderCharacters
    ) {
      throw new TypeError(label + ' must have a bounded own-data length.');
    }
    return length.value;
  };

  const push = <Value>(values: Value[], value: Value): void => {
    apply(arrayPush, values, [value]);
  };
  const trim = (value: string): string => apply(stringTrim, value, []);
  const slice = (value: string, start: number, end?: number): string =>
    end === undefined
      ? apply(stringSlice, value, [start])
      : apply(stringSlice, value, [start, end]);
  const indexOf = (value: string, search: string, start?: number): number =>
    start === undefined
      ? apply(stringIndexOf, value, [search])
      : apply(stringIndexOf, value, [search, start]);
  const lastIndexOf = (value: string, search: string): number =>
    apply(stringLastIndexOf, value, [search]);
  const isWhitespace = (value: string): boolean => apply(regexpTest, whitespace, [value]);

  const escapeJsonString = (value: string): string => {
    let output = '"';
    for (let index = 0; index < value.length; index += 1) {
      const code = apply(stringCharCodeAt, value, [index]);
      if (code === 0x22) {
        output += '\\"';
      } else if (code === 0x5c) {
        output += '\\\\';
      } else if (code === 0x08) {
        output += '\\b';
      } else if (code === 0x09) {
        output += '\\t';
      } else if (code === 0x0a) {
        output += '\\n';
      } else if (code === 0x0c) {
        output += '\\f';
      } else if (code === 0x0d) {
        output += '\\r';
      } else if (code < 0x20 || code === 0x7f || code > 0x7e) {
        // Fetch converts header values through Web IDL ByteString, while Node's outgoing HTTP
        // transport also rejects DEL. Preserve every JSON string code unit while keeping the
        // emitted field value transport-safe; DEL, surrogate pairs, and U+2028/U+2029 therefore
        // travel as JSON \u escapes.
        output +=
          '\\u' +
          hexadecimal[(code >>> 12) & 0x0f] +
          hexadecimal[(code >>> 8) & 0x0f] +
          hexadecimal[(code >>> 4) & 0x0f] +
          hexadecimal[code & 0x0f];
      } else {
        output += slice(value, index, index + 1);
      }
    }
    return output + '"';
  };

  const jsonArrayIndex = (key: string): number => {
    // JSON.stringify enumerates canonical array-index property names ahead of every other
    // string key, even when those properties were inserted in lexical order. Match that final
    // server canonicalJsonStringify ordering without converting attacker-controlled keys through
    // an ambient numeric coercion hook.
    if (key.length === 0 || key.length > 10) return -1;
    const first = apply(stringCharCodeAt, key, [0]);
    if (first < 0x30 || first > 0x39 || (first === 0x30 && key.length > 1)) return -1;
    let index = 0;
    for (let offset = 0; offset < key.length; offset += 1) {
      const code = apply(stringCharCodeAt, key, [offset]);
      if (code < 0x30 || code > 0x39) return -1;
      index = index * 10 + code - 0x30;
      if (index > 4_294_967_294) return -1;
    }
    return index;
  };

  const compareCanonicalJsonKeys = (left: string, right: string): number => {
    const leftIndex = jsonArrayIndex(left);
    const rightIndex = jsonArrayIndex(right);
    if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex;
    if (leftIndex >= 0) return -1;
    if (rightIndex >= 0) return 1;
    return left < right ? -1 : left > right ? 1 : 0;
  };

  const snapshotLiveTargetProps = (source: string | null | undefined): string => {
    if (source === null || source === undefined || source === '') return '{}';
    if (typeof source !== 'string') {
      throw new TypeError('Kovo live-target props source must be JSON text.');
    }
    if (source.length > grammar.maxHeaderCharacters) {
      throw new TypeError(
        'Kovo live-target props exceed the ' +
          grammar.maxHeaderCharacters +
          '-character wire budget.',
      );
    }

    let parsed: unknown;
    try {
      parsed = apply(jsonParse, IntrinsicJson, [source]);
    } catch {
      return '{}';
    }
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      apply(arrayIsArray, IntrinsicArray, [parsed])
    ) {
      return '{}';
    }

    let nodeCount = 0;
    const encodeJsonValue = (value: unknown, depth: number): string => {
      nodeCount += 1;
      if (depth > 64 || nodeCount > grammar.maxHeaderCharacters) {
        throw new TypeError('Kovo live-target props exceed the bounded JSON snapshot budget.');
      }
      if (value === null) return 'null';
      if (typeof value === 'string') return escapeJsonString(value);
      if (typeof value === 'boolean') return value ? 'true' : 'false';
      if (typeof value === 'number') {
        if (!apply(numberIsFinite, IntrinsicNumber, [value])) {
          throw new TypeError('Kovo live-target props contain a non-finite number.');
        }
        return apply(IntrinsicString, undefined, [value]);
      }
      if (typeof value !== 'object') {
        throw new TypeError('Kovo live-target props contain a non-JSON value.');
      }

      if (apply(arrayIsArray, IntrinsicArray, [value])) {
        const length = arrayLength(value, 'Kovo live-target props array');
        let output = '[';
        for (let index = 0; index < length; index += 1) {
          const entry = ownData<unknown>(value, index);
          if (!entry.found) {
            throw new TypeError(
              'Kovo live-target props arrays must contain dense own-data values.',
            );
          }
          output += (index === 0 ? '' : ',') + encodeJsonValue(entry.value, depth + 1);
        }
        return output + ']';
      }

      const keys = apply(objectKeys, IntrinsicObject, [value]) as string[];
      apply(arraySort, keys, [compareCanonicalJsonKeys]);
      const keyCount = arrayLength(keys, 'Kovo live-target props key snapshot');
      let output = '{';
      for (let index = 0; index < keyCount; index += 1) {
        const keyEntry = ownData<string>(keys, index);
        if (!keyEntry.found || typeof keyEntry.value !== 'string') {
          throw new TypeError('Kovo live-target props keys must be dense strings.');
        }
        const entry = ownData<unknown>(value, keyEntry.value);
        if (!entry.found) {
          throw new TypeError('Kovo live-target props must contain own-data values.');
        }
        output +=
          (index === 0 ? '' : ',') +
          escapeJsonString(keyEntry.value) +
          ':' +
          encodeJsonValue(entry.value, depth + 1);
      }
      return output + '}';
    };

    return encodeJsonValue(parsed, 0);
  };

  const domIdentityIsValid = (value: unknown): value is string => {
    if (typeof value !== 'string') return false;
    for (let index = 0; index < value.length; index += 1) {
      const code = apply(stringCharCodeAt, value, [index]);
      if (code === 0x00 || code === 0x0d) return false;
      if (code >= 0xd800 && code <= 0xdbff) {
        if (index + 1 >= value.length) return false;
        const next = apply(stringCharCodeAt, value, [index + 1]);
        if (next < 0xdc00 || next > 0xdfff) return false;
        index += 1;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        return false;
      }
    }
    return true;
  };

  const identityIsValid = (value: unknown): value is string =>
    domIdentityIsValid(value) && value.length > 0;

  const componentIsValid = (value: unknown): value is string => identityIsValid(value);

  const attestationIsValid = (value: unknown): value is string => {
    if (typeof value !== 'string' || value.length === 0 || value.length > 512) return false;
    for (let index = 0; index < value.length; index += 1) {
      const code = apply(stringCharCodeAt, value, [index]);
      if (
        !(
          (code >= 0x30 && code <= 0x39) ||
          (code >= 0x41 && code <= 0x5a) ||
          code === 0x5f ||
          (code >= 0x61 && code <= 0x7a) ||
          code === 0x2d
        )
      ) {
        return false;
      }
    }
    return true;
  };

  const encodeIdentityToken = (value: unknown): string | undefined => {
    if (!identityIsValid(value)) return undefined;
    let encoded: string;
    try {
      encoded = apply(encodeUriComponent, undefined, [value]);
    } catch {
      return undefined;
    }
    // encodeURIComponent deliberately leaves five reserved punctuation characters raw. Encode
    // them too so the sole canonical alphabet is RFC 3986 unreserved plus uppercase %HH bytes.
    let canonical = '';
    for (let index = 0; index < encoded.length; index += 1) {
      const code = apply(stringCharCodeAt, encoded, [index]);
      if (code === 0x21) canonical += '%21';
      else if (code === 0x27) canonical += '%27';
      else if (code === 0x28) canonical += '%28';
      else if (code === 0x29) canonical += '%29';
      else if (code === 0x2a) canonical += '%2A';
      else canonical += encoded[index] ?? '';
    }
    return canonical;
  };

  const decodeIdentityToken = (value: unknown): string | undefined => {
    if (typeof value !== 'string' || value.length === 0) {
      return undefined;
    }
    let decoded: string;
    try {
      decoded = apply(decodeUriComponent, undefined, [value]);
    } catch {
      return undefined;
    }
    return identityIsValid(decoded) && encodeIdentityToken(decoded) === value ? decoded : undefined;
  };

  const encodeFormTargetHeader = (value: unknown): string | undefined => {
    const encoded = encodeIdentityToken(value);
    return encoded !== undefined && encoded.length <= grammar.maxHeaderCharacters
      ? encoded
      : undefined;
  };

  const decodeFormTargetHeader = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length <= grammar.maxHeaderCharacters
      ? decodeIdentityToken(value)
      : undefined;

  const appendUniqueByTarget = <Value extends { readonly target: string }>(
    output: Value[],
    value: Value,
  ): void => {
    for (let index = 0; index < output.length; index += 1) {
      if (output[index]?.target === value.target) return;
    }
    push(output, value);
  };

  const encodeEntryList = (
    values: readonly string[],
    maxCharacters: number = grammar.maxHeaderCharacters,
  ): string => {
    const valueCount = arrayLength(values, 'Kovo wire input entry list');
    if (
      valueCount > grammar.maxEntries ||
      typeof maxCharacters !== 'number' ||
      maxCharacters < 0 ||
      maxCharacters % 1 !== 0 ||
      maxCharacters > grammar.maxHeaderCharacters
    ) {
      throw new TypeError('Kovo wire input exceeds the ' + grammar.maxEntries + '-entry budget.');
    }
    let output = '';
    for (let index = 0; index < valueCount; index += 1) {
      const entry = ownData<string>(values, index);
      if (!entry.found || typeof entry.value !== 'string' || entry.value.length === 0) {
        throw new TypeError('Kovo wire input entries must be non-empty strings.');
      }
      const candidate = output + (output === '' ? '' : grammar.presentationSeparator) + entry.value;
      if (candidate.length > maxCharacters) break;
      output = candidate;
    }
    return output;
  };

  const encodeTargetHeader = (values: readonly FrameworkWireTarget[]): string => {
    const encoded: string[] = [];
    const valueCount = arrayLength(values, 'Kovo target header input');
    if (valueCount > grammar.maxEntries) {
      throw new TypeError('Kovo wire input exceeds the ' + grammar.maxEntries + '-entry budget.');
    }
    for (let index = 0; index < valueCount; index += 1) {
      const value = ownData<FrameworkWireTarget>(values, index);
      const target = ownData<unknown>(value.value, 'target');
      const dependencies = ownData<unknown>(value.value, 'deps');
      const targetToken = encodeIdentityToken(target.value);
      if (!value.found || !target.found || targetToken === undefined) {
        throw new TypeError('Kovo target header contains an invalid wire identity.');
      }
      if (!dependencies.found) {
        throw new TypeError('Kovo target header contains an invalid dependency list.');
      }
      const dependencyCount = arrayLength(dependencies.value, 'Kovo target header dependency list');
      let entry = targetToken;
      if (dependencyCount > 0) {
        const deps: string[] = [];
        for (let depIndex = 0; depIndex < dependencyCount; depIndex += 1) {
          const dep = ownData<unknown>(dependencies.value, depIndex);
          const depToken = encodeIdentityToken(dep.value);
          if (!dep.found || depToken === undefined) {
            throw new TypeError('Kovo target header contains an invalid dependency wire identity.');
          }
          push(deps, depToken);
        }
        entry +=
          grammar.target.assignmentSeparator +
          apply(arrayJoin, deps, [grammar.target.dependencySeparator]);
      }
      push(encoded, entry);
    }
    return encodeEntryList(encoded);
  };

  const encodeLiveTargetHeader = (values: readonly FrameworkWireLiveTargetInput[]): string => {
    const encoded: string[] = [];
    const valueCount = arrayLength(values, 'Kovo live-target header input');
    if (valueCount > grammar.maxEntries) {
      throw new TypeError('Kovo wire input exceeds the ' + grammar.maxEntries + '-entry budget.');
    }
    for (let index = 0; index < valueCount; index += 1) {
      const value = ownData<FrameworkWireLiveTargetInput>(values, index);
      const target = ownData<unknown>(value.value, 'target');
      const component = ownData<unknown>(value.value, 'component');
      const attestation = ownData<unknown>(value.value, 'attestation');
      const propsSource = ownData<unknown>(value.value, 'propsSource');
      const targetToken = encodeIdentityToken(target.value);
      const componentToken = encodeIdentityToken(component.value);
      if (!value.found || !target.found || targetToken === undefined) {
        throw new TypeError('Kovo live-target header contains an invalid target wire identity.');
      }
      if (!component.found || componentToken === undefined) {
        throw new TypeError('Kovo live-target header contains an invalid component wire identity.');
      }
      if (!attestation.found || !attestationIsValid(attestation.value)) {
        throw new TypeError(
          'Kovo live-target header contains an invalid attestation wire identity.',
        );
      }
      if (
        !propsSource.found ||
        (typeof propsSource.value !== 'string' &&
          propsSource.value !== null &&
          propsSource.value !== undefined)
      ) {
        throw new TypeError('Kovo live-target props source must be own JSON text.');
      }
      const props = snapshotLiveTargetProps(propsSource.value);
      push(
        encoded,
        targetToken +
          grammar.descriptor.targetComponentSeparator +
          componentToken +
          grammar.descriptor.componentAttestationSeparator +
          attestation.value +
          grammar.descriptor.attestationPropsSeparator +
          props,
      );
    }
    return encodeEntryList(encoded);
  };

  const boundedInput = (value: string): boolean =>
    typeof value === 'string' && value.length <= grammar.maxHeaderCharacters;

  const splitTargetEntries = (value: string): string[] => {
    const entries: string[] = [];
    let start = 0;
    for (let index = 0; index <= value.length; index += 1) {
      const character = index === value.length ? grammar.entrySeparator : value[index];
      if (character !== grammar.entrySeparator && character !== ',') continue;
      push(entries, slice(value, start, index));
      if (entries.length === grammar.maxEntries) return entries;
      start = index + 1;
    }
    return entries;
  };

  const splitDescriptorEntries = (value: string): string[] => {
    const entries: string[] = [];
    let depth = 0;
    let quoted = false;
    let start = 0;
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      if (quoted) {
        if (character === '\\') {
          index += 1;
        } else if (character === '"') {
          quoted = false;
        }
        continue;
      }
      if (character === '"') {
        quoted = true;
      } else if (character === '{' || character === '[') {
        depth += 1;
      } else if (character === '}' || character === ']') {
        if (depth > 0) depth -= 1;
      } else if (character === grammar.entrySeparator && depth === 0) {
        push(entries, slice(value, start, index));
        if (entries.length === grammar.maxEntries) return entries;
        start = index + 1;
      }
    }
    if (entries.length < grammar.maxEntries) push(entries, slice(value, start));
    return entries;
  };

  const decodeTargetHeader = (value: string): FrameworkWireTarget[] => {
    if (!boundedInput(value)) return [];
    const output: FrameworkWireTarget[] = [];
    const entries = splitTargetEntries(value);
    for (let index = 0; index < entries.length; index += 1) {
      const entry = trim(entries[index] ?? '');
      if (entry === '') continue;
      const separator = indexOf(entry, grammar.target.assignmentSeparator);
      const target = decodeIdentityToken(trim(separator < 0 ? entry : slice(entry, 0, separator)));
      if (target === undefined) continue;
      const deps: string[] = [];
      if (separator >= 0) {
        const rawDeps = slice(entry, separator + 1);
        let start = 0;
        for (let depIndex = 0; depIndex <= rawDeps.length; depIndex += 1) {
          const character = depIndex === rawDeps.length ? ' ' : (rawDeps[depIndex] ?? '');
          if (character !== ',' && !isWhitespace(character)) continue;
          if (depIndex > start) {
            const dep = decodeIdentityToken(trim(slice(rawDeps, start, depIndex)));
            if (dep !== undefined) push(deps, dep);
          }
          start = depIndex + 1;
        }
      }
      appendUniqueByTarget(output, { deps, target });
    }
    return output;
  };

  const decodeLiveTargetHeader = (
    value: string,
    parseJson: (source: string) => unknown,
  ): FrameworkWireLiveTarget[] => {
    if (!boundedInput(value)) return [];
    const output: FrameworkWireLiveTarget[] = [];
    const entries = splitDescriptorEntries(value);
    for (let index = 0; index < entries.length; index += 1) {
      const entry = trim(entries[index] ?? '');
      if (entry === '') continue;
      const targetEnd = indexOf(entry, grammar.descriptor.targetComponentSeparator);
      const propsStart = indexOf(
        entry,
        grammar.descriptor.attestationPropsSeparator,
        targetEnd + 1,
      );
      if (targetEnd <= 0 || propsStart <= targetEnd + 1) continue;
      const componentAndAttestation = trim(slice(entry, targetEnd + 1, propsStart));
      const attestationStart = lastIndexOf(
        componentAndAttestation,
        grammar.descriptor.componentAttestationSeparator,
      );
      if (attestationStart <= 0) continue;
      const target = decodeIdentityToken(trim(slice(entry, 0, targetEnd)));
      const component = decodeIdentityToken(
        trim(slice(componentAndAttestation, 0, attestationStart)),
      );
      const attestation = trim(slice(componentAndAttestation, attestationStart + 1));
      if (target === undefined || component === undefined || !attestationIsValid(attestation)) {
        continue;
      }
      let props: unknown;
      try {
        props = parseJson(trim(slice(entry, propsStart + 1)));
      } catch {
        continue;
      }
      if (props === null || typeof props !== 'object' || arrayIsArray(props)) continue;
      appendUniqueByTarget(output, {
        attestation,
        ['component']: component,
        props: props as Record<string, unknown>,
        target,
      });
    }
    return output;
  };

  const headerValueIsAscii = (value: unknown): value is string => {
    if (typeof value !== 'string') return false;
    for (let index = 0; index < value.length; index += 1) {
      const code = apply(stringCharCodeAt, value, [index]);
      if (code < 0x20 || code > 0x7e) return false;
    }
    return true;
  };

  const idemIsCanonical = (value: unknown): value is string => {
    if (typeof value !== 'string' || value.length !== 49) return false;
    if (
      apply(stringCharCodeAt, value, [0]) !== 0x76 ||
      apply(stringCharCodeAt, value, [1]) !== 0x31 ||
      apply(stringCharCodeAt, value, [2]) !== 0x5f ||
      apply(stringCharCodeAt, value, [16]) !== 0x5f
    ) {
      return false;
    }
    for (let index = 3; index < 16; index += 1) {
      const code = apply(stringCharCodeAt, value, [index]);
      if (code < 0x30 || code > 0x39) return false;
    }
    for (let index = 17; index < 49; index += 1) {
      const code = apply(stringCharCodeAt, value, [index]);
      if (!((code >= 0x30 && code <= 0x39) || (code >= 0x61 && code <= 0x66))) return false;
    }
    return true;
  };

  const canonicalTargetEntryTarget = (wireEntry: string): string | undefined => {
    const decoded = decodeTargetHeader(wireEntry);
    if (arrayLength(decoded, 'Kovo decoded target entry') !== 1) return undefined;
    const entry = ownData<FrameworkWireTarget>(decoded, 0);
    if (!entry.found || encodeTargetHeader([entry.value!]) !== wireEntry) return undefined;
    const target = ownData<unknown>(entry.value, 'target');
    return target.found && typeof target.value === 'string' ? target.value : undefined;
  };

  const canonicalLiveTargetEntryTarget = (wireEntry: string): string | undefined => {
    if (!boundedInput(wireEntry) || trim(wireEntry) !== wireEntry) return undefined;
    const targetEnd = indexOf(wireEntry, grammar.descriptor.targetComponentSeparator);
    const propsStart = indexOf(
      wireEntry,
      grammar.descriptor.attestationPropsSeparator,
      targetEnd + 1,
    );
    if (targetEnd <= 0 || propsStart <= targetEnd + 1) return undefined;
    const componentAndAttestation = slice(wireEntry, targetEnd + 1, propsStart);
    const attestationStart = lastIndexOf(
      componentAndAttestation,
      grammar.descriptor.componentAttestationSeparator,
    );
    if (attestationStart <= 0) return undefined;
    const targetToken = slice(wireEntry, 0, targetEnd);
    const componentToken = slice(componentAndAttestation, 0, attestationStart);
    const attestation = slice(componentAndAttestation, attestationStart + 1);
    const propsSource = slice(wireEntry, propsStart + 1);
    const target = decodeIdentityToken(targetToken);
    const component = decodeIdentityToken(componentToken);
    if (target === undefined || component === undefined || !attestationIsValid(attestation)) {
      return undefined;
    }
    try {
      if (snapshotLiveTargetProps(propsSource) !== propsSource) return undefined;
    } catch {
      return undefined;
    }
    return encodeIdentityToken(target)! +
      grammar.descriptor.targetComponentSeparator +
      encodeIdentityToken(component)! +
      grammar.descriptor.componentAttestationSeparator +
      attestation +
      grammar.descriptor.attestationPropsSeparator +
      propsSource ===
      wireEntry
      ? target
      : undefined;
  };

  const encodeSnapshotEntries = (
    snapshots: unknown,
    maxCharacters: number,
    kind: 'live-target' | 'target',
  ): { readonly entries: FrameworkWireEntrySnapshot[]; readonly header: string } => {
    const count = arrayLength(snapshots, 'Kovo target request snapshot');
    const accepted: FrameworkWireEntrySnapshot[] = [];
    let header = '';
    for (let index = 0; index < count && index < grammar.maxEntries; index += 1) {
      const snapshot = ownData<unknown>(snapshots, index);
      const target = ownData<unknown>(snapshot.value, 'target');
      const wireEntry = ownData<unknown>(snapshot.value, 'wireEntry');
      const decodedTarget =
        typeof wireEntry.value === 'string'
          ? kind === 'target'
            ? canonicalTargetEntryTarget(wireEntry.value)
            : canonicalLiveTargetEntryTarget(wireEntry.value)
          : undefined;
      if (
        !snapshot.found ||
        !target.found ||
        typeof target.value !== 'string' ||
        !wireEntry.found ||
        !headerValueIsAscii(wireEntry.value) ||
        wireEntry.value.length === 0 ||
        decodedTarget !== target.value
      ) {
        continue;
      }
      const candidate =
        header + (header === '' ? '' : grammar.presentationSeparator) + wireEntry.value;
      if (candidate.length > maxCharacters) break;
      header = candidate;
      push(
        accepted,
        apply(objectFreeze, IntrinsicObject, [
          { target: target.value, wireEntry: wireEntry.value },
        ]) as FrameworkWireEntrySnapshot,
      );
    }
    return { entries: accepted, header };
  };

  const planTargetRequestHeaders = (
    input: FrameworkTargetRequestHeaderInput,
  ): FrameworkTargetRequestHeaderPlan | undefined => {
    const currentUrl = ownData<unknown>(input, 'currentUrl');
    const formTarget = ownData<unknown>(input, 'formTarget');
    const idem = ownData<unknown>(input, 'idem');
    const liveTargets = ownData<unknown>(input, 'liveTargets');
    const stream = ownData<unknown>(input, 'stream');
    const targets = ownData<unknown>(input, 'targets');
    if (
      !currentUrl.found ||
      !headerValueIsAscii(currentUrl.value) ||
      currentUrl.value.length === 0 ||
      currentUrl.value.length > grammar.maxCurrentUrlCharacters ||
      indexOf(currentUrl.value, '#') >= 0 ||
      !liveTargets.found ||
      !targets.found
    ) {
      return undefined;
    }
    if (idem.found && !idemIsCanonical(idem.value)) return undefined;
    if (stream.found && typeof stream.value !== 'boolean') return undefined;

    const headers = apply(objectCreate, IntrinsicObject, [null]) as Record<string, string>;
    let used = 0;
    const addRequired = (name: string, value: string): boolean => {
      const lineBytes = name.length + 2 + value.length + 2;
      if (used + lineBytes > grammar.maxTargetRequestHeaderBytes) return false;
      headers[name] = value;
      used += lineBytes;
      return true;
    };

    if (!addRequired('Kovo-Fragment', 'true')) return undefined;
    if (idem.found && !addRequired('Kovo-Idem', idem.value as string)) return undefined;
    if (stream.value === true && !addRequired('Kovo-Stream', 'true')) return undefined;
    if (!addRequired('Kovo-Current-Url', currentUrl.value)) return undefined;
    if (formTarget.found) {
      const encodedFormTarget = encodeFormTargetHeader(formTarget.value);
      if (encodedFormTarget === undefined || !addRequired('Kovo-Form-Target', encodedFormTarget)) {
        return undefined;
      }
    }

    const addEntries = (
      name: string,
      snapshots: unknown,
      kind: 'live-target' | 'target',
    ): { readonly entries: FrameworkWireEntrySnapshot[]; readonly ok: boolean } => {
      const lineOverhead = name.length + 4;
      const remaining = grammar.maxTargetRequestHeaderBytes - used - lineOverhead;
      if (remaining < 0) return { entries: [], ok: false };
      const maxCharacters =
        remaining < grammar.maxHeaderCharacters ? remaining : grammar.maxHeaderCharacters;
      const encoded = encodeSnapshotEntries(snapshots, maxCharacters, kind);
      return {
        entries: encoded.entries,
        ok: encoded.header === '' || addRequired(name, encoded.header),
      };
    };

    const targetPlan = addEntries('Kovo-Targets', targets.value, 'target');
    if (!targetPlan.ok) return undefined;
    const liveTargetPlan = addEntries('Kovo-Live-Targets', liveTargets.value, 'live-target');
    if (!liveTargetPlan.ok) return undefined;
    return apply(objectFreeze, IntrinsicObject, [
      {
        headers: apply(objectFreeze, IntrinsicObject, [headers]),
        liveTargets: apply(objectFreeze, IntrinsicObject, [liveTargetPlan.entries]),
        targets: apply(objectFreeze, IntrinsicObject, [targetPlan.entries]),
      },
    ]) as FrameworkTargetRequestHeaderPlan;
  };

  return {
    attestationIsValid,
    componentIsValid,
    decodeFormTargetHeader,
    decodeIdentityToken,
    decodeLiveTargetHeader,
    decodeTargetHeader,
    domIdentityIsValid,
    encodeEntryList,
    encodeFormTargetHeader,
    encodeIdentityToken,
    encodeLiveTargetHeader,
    encodeTargetHeader,
    identityIsValid,
    planTargetRequestHeaders,
    snapshotLiveTargetProps,
  };
}

const frameworkWireTargetCodec = createFrameworkWireTargetCodec(FRAMEWORK_WIRE_INPUT_GRAMMAR);

/** @internal */
export const decodeFrameworkFormTargetHeader: FrameworkWireTargetCodec['decodeFormTargetHeader'] = (
  value,
) => frameworkWireTargetCodec.decodeFormTargetHeader(value);
/** @internal */
export const decodeFrameworkIdentityToken: FrameworkWireTargetCodec['decodeIdentityToken'] = (
  value,
) => frameworkWireTargetCodec.decodeIdentityToken(value);
/** @internal */
export const decodeFrameworkLiveTargetHeader: FrameworkWireTargetCodec['decodeLiveTargetHeader'] = (
  value,
  parseJson,
) => frameworkWireTargetCodec.decodeLiveTargetHeader(value, parseJson);
/** @internal */
export const decodeFrameworkTargetHeader: FrameworkWireTargetCodec['decodeTargetHeader'] = (
  value,
) => frameworkWireTargetCodec.decodeTargetHeader(value);
/** @internal */
export const encodeFrameworkWireEntryList: FrameworkWireTargetCodec['encodeEntryList'] = (
  values,
  maxCharacters,
) => frameworkWireTargetCodec.encodeEntryList(values, maxCharacters);
/** @internal */
export const encodeFrameworkFormTargetHeader: FrameworkWireTargetCodec['encodeFormTargetHeader'] = (
  value,
) => frameworkWireTargetCodec.encodeFormTargetHeader(value);
/** @internal */
export const encodeFrameworkIdentityToken: FrameworkWireTargetCodec['encodeIdentityToken'] = (
  value,
) => frameworkWireTargetCodec.encodeIdentityToken(value);
/** @internal */
export const encodeFrameworkLiveTargetHeader: FrameworkWireTargetCodec['encodeLiveTargetHeader'] = (
  values,
) => frameworkWireTargetCodec.encodeLiveTargetHeader(values);
/** @internal */
export const encodeFrameworkTargetHeader: FrameworkWireTargetCodec['encodeTargetHeader'] = (
  values,
) => frameworkWireTargetCodec.encodeTargetHeader(values);
/** @internal */
export const frameworkWireAttestationIsValid: FrameworkWireTargetCodec['attestationIsValid'] = (
  value,
) => frameworkWireTargetCodec.attestationIsValid(value);
/** @internal */
export const frameworkWireComponentIsValid: FrameworkWireTargetCodec['componentIsValid'] = (
  value,
) => frameworkWireTargetCodec.componentIsValid(value);
/** @internal */
export const frameworkDomIdentityIsValid: FrameworkWireTargetCodec['domIdentityIsValid'] = (
  value,
) => frameworkWireTargetCodec.domIdentityIsValid(value);
/** @internal */
export const frameworkWireIdentityIsValid: FrameworkWireTargetCodec['identityIsValid'] = (value) =>
  frameworkWireTargetCodec.identityIsValid(value);
/** @internal */
export const planFrameworkTargetRequestHeaders: FrameworkWireTargetCodec['planTargetRequestHeaders'] =
  (input) => frameworkWireTargetCodec.planTargetRequestHeaders(input);
/** @internal */
export const snapshotFrameworkLiveTargetProps: FrameworkWireTargetCodec['snapshotLiveTargetProps'] =
  (source) => frameworkWireTargetCodec.snapshotLiveTargetProps(source);
