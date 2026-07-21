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
  maxHeaderCharacters: 64 * 1024,
  presentationSeparator: '; ',
  schema: 'kovo.wire-input-grammar/v1',
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
  | 'search-params';

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

/** @internal */
export interface FrameworkWireTargetCodec {
  attestationIsValid(value: unknown): value is string;
  componentIsValid(value: unknown): value is string;
  decodeLiveTargetHeader(
    value: string,
    parseJson: (source: string) => unknown,
  ): FrameworkWireLiveTarget[];
  decodeTargetHeader(value: string): FrameworkWireTarget[];
  encodeEntryList(values: readonly string[]): string;
  encodeLiveTargetHeader(
    values: readonly FrameworkWireLiveTarget[],
    stringifyJson: (value: unknown) => string | undefined,
  ): string;
  encodeTargetHeader(values: readonly FrameworkWireTarget[]): string;
  identityIsValid(value: unknown): value is string;
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
  const identityIsValid = (value: unknown): value is string => {
    if (typeof value !== 'string' || value.length === 0) return false;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      const character = value[index] ?? '';
      if (
        code <= 0x1f ||
        code === 0x7f ||
        /\s/u.test(character) ||
        character === grammar.entrySeparator ||
        character === ',' ||
        character === grammar.descriptor.targetComponentSeparator ||
        character === grammar.target.assignmentSeparator
      ) {
        return false;
      }
    }
    return true;
  };

  const componentIsValid = (value: unknown): value is string =>
    identityIsValid(value) && !value.includes(grammar.descriptor.attestationPropsSeparator);

  const attestationIsValid = (value: unknown): value is string =>
    identityIsValid(value) &&
    !value.includes(grammar.descriptor.componentAttestationSeparator) &&
    !value.includes(grammar.descriptor.attestationPropsSeparator);

  const appendUniqueByTarget = <Value extends { readonly target: string }>(
    output: Value[],
    value: Value,
  ): void => {
    for (let index = 0; index < output.length; index += 1) {
      if (output[index]?.target === value.target) return;
    }
    output.push(value);
  };

  const encodeEntryList = (values: readonly string[]): string => {
    if (values.length > grammar.maxEntries) {
      throw new TypeError('Kovo wire input exceeds the ' + grammar.maxEntries + '-entry budget.');
    }
    let output = '';
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError('Kovo wire input entries must be non-empty strings.');
      }
      output += (index === 0 ? '' : grammar.presentationSeparator) + value;
      if (output.length > grammar.maxHeaderCharacters) {
        throw new TypeError(
          'Kovo wire input exceeds the ' + grammar.maxHeaderCharacters + '-character budget.',
        );
      }
    }
    return output;
  };

  const encodeTargetHeader = (values: readonly FrameworkWireTarget[]): string => {
    const encoded: string[] = [];
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      if (value === undefined || !identityIsValid(value.target)) {
        throw new TypeError('Kovo target header contains an invalid wire identity.');
      }
      let entry = value.target;
      if (value.deps.length > 0) {
        const deps: string[] = [];
        for (let depIndex = 0; depIndex < value.deps.length; depIndex += 1) {
          const dep = value.deps[depIndex];
          if (!identityIsValid(dep)) {
            throw new TypeError('Kovo target header contains an invalid dependency wire identity.');
          }
          deps.push(dep);
        }
        entry += grammar.target.assignmentSeparator + deps.join(grammar.target.dependencySeparator);
      }
      encoded.push(entry);
    }
    return encodeEntryList(encoded);
  };

  const encodeLiveTargetHeader = (
    values: readonly FrameworkWireLiveTarget[],
    stringifyJson: (value: unknown) => string | undefined,
  ): string => {
    const encoded: string[] = [];
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      if (value === undefined || !identityIsValid(value.target)) {
        throw new TypeError('Kovo live-target header contains an invalid target wire identity.');
      }
      if (!componentIsValid(value.component)) {
        throw new TypeError('Kovo live-target header contains an invalid component wire identity.');
      }
      if (!attestationIsValid(value.attestation)) {
        throw new TypeError(
          'Kovo live-target header contains an invalid attestation wire identity.',
        );
      }
      const props = stringifyJson(value.props);
      if (typeof props !== 'string') {
        throw new TypeError('Kovo live-target props must serialize to JSON text.');
      }
      encoded.push(
        value.target +
          grammar.descriptor.targetComponentSeparator +
          value.component +
          grammar.descriptor.componentAttestationSeparator +
          value.attestation +
          grammar.descriptor.attestationPropsSeparator +
          props,
      );
    }
    return encodeEntryList(encoded);
  };

  const boundedInput = (value: string): boolean =>
    typeof value === 'string' && value.length <= grammar.maxHeaderCharacters;

  const trim = (value: string): string => value.trim();

  const splitTargetEntries = (value: string): string[] => {
    const entries: string[] = [];
    let start = 0;
    for (let index = 0; index <= value.length; index += 1) {
      const character = index === value.length ? grammar.entrySeparator : value[index];
      if (character !== grammar.entrySeparator && character !== ',') continue;
      entries.push(value.slice(start, index));
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
        entries.push(value.slice(start, index));
        if (entries.length === grammar.maxEntries) return entries;
        start = index + 1;
      }
    }
    if (entries.length < grammar.maxEntries) entries.push(value.slice(start));
    return entries;
  };

  const decodeTargetHeader = (value: string): FrameworkWireTarget[] => {
    if (!boundedInput(value)) return [];
    const output: FrameworkWireTarget[] = [];
    const entries = splitTargetEntries(value);
    for (let index = 0; index < entries.length; index += 1) {
      const entry = trim(entries[index] ?? '');
      if (entry === '') continue;
      const separator = entry.indexOf(grammar.target.assignmentSeparator);
      const target = trim(separator < 0 ? entry : entry.slice(0, separator));
      if (!identityIsValid(target)) continue;
      const deps: string[] = [];
      if (separator >= 0) {
        const rawDeps = entry.slice(separator + 1);
        let start = 0;
        for (let depIndex = 0; depIndex <= rawDeps.length; depIndex += 1) {
          const character = depIndex === rawDeps.length ? ' ' : (rawDeps[depIndex] ?? '');
          if (character !== ',' && !/\s/u.test(character)) continue;
          if (depIndex > start) {
            const dep = trim(rawDeps.slice(start, depIndex));
            if (identityIsValid(dep)) deps.push(dep);
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
      const targetEnd = entry.indexOf(grammar.descriptor.targetComponentSeparator);
      const propsStart = entry.indexOf(grammar.descriptor.attestationPropsSeparator, targetEnd + 1);
      if (targetEnd <= 0 || propsStart <= targetEnd + 1) continue;
      const componentAndAttestation = trim(entry.slice(targetEnd + 1, propsStart));
      const attestationStart = componentAndAttestation.lastIndexOf(
        grammar.descriptor.componentAttestationSeparator,
      );
      if (attestationStart <= 0) continue;
      const target = trim(entry.slice(0, targetEnd));
      const component = trim(componentAndAttestation.slice(0, attestationStart));
      const attestation = trim(componentAndAttestation.slice(attestationStart + 1));
      if (
        !identityIsValid(target) ||
        !componentIsValid(component) ||
        !attestationIsValid(attestation)
      ) {
        continue;
      }
      let props: unknown;
      try {
        props = parseJson(trim(entry.slice(propsStart + 1)));
      } catch {
        continue;
      }
      if (props === null || typeof props !== 'object' || Array.isArray(props)) continue;
      appendUniqueByTarget(output, {
        attestation,
        component,
        props: props as Record<string, unknown>,
        target,
      });
    }
    return output;
  };

  return {
    attestationIsValid,
    componentIsValid,
    decodeLiveTargetHeader,
    decodeTargetHeader,
    encodeEntryList,
    encodeLiveTargetHeader,
    encodeTargetHeader,
    identityIsValid,
  };
}

const frameworkWireTargetCodec = createFrameworkWireTargetCodec(FRAMEWORK_WIRE_INPUT_GRAMMAR);

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
export const encodeFrameworkWireEntryList: FrameworkWireTargetCodec['encodeEntryList'] = (values) =>
  frameworkWireTargetCodec.encodeEntryList(values);
/** @internal */
export const encodeFrameworkLiveTargetHeader: FrameworkWireTargetCodec['encodeLiveTargetHeader'] = (
  values,
  stringifyJson,
) => frameworkWireTargetCodec.encodeLiveTargetHeader(values, stringifyJson);
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
export const frameworkWireIdentityIsValid: FrameworkWireTargetCodec['identityIsValid'] = (value) =>
  frameworkWireTargetCodec.identityIsValid(value);
