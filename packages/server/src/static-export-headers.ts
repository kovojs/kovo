import { wireEmitter } from '@kovojs/core/internal/security-markers';

import { buildOwnDataProperty, snapshotBuildArray } from './build-security-intrinsics.js';
import {
  createSecurityMap,
  createSecurityNullRecord,
  securityArrayIsArray,
  securityArraySort,
  securityHeadersForEach,
  securityIsHeaders,
  securityMapForEach,
  securityMapGet,
  securityMapSet,
  securityObjectKeys,
  securityRegExpTest,
  securityString,
  securityStringCharCodeAt,
  securityStringReplaceAll,
  securityStringStartsWith,
  securityStringToLowerCase,
} from './response-security-intrinsics.js';
import { assertNoSecretEgressValue } from './secret-egress.js';
import { witnessArrayAppend, witnessFreeze } from './security-witness-intrinsics.js';
import { StaticExportError, staticExportDiagnostic } from './static-export-diagnostics.js';
import { createTransportResponseHeaderClassifier } from './response-transport-headers.js';

interface StaticExportHeaderSinkOptions {
  path: string;
}

interface StaticExportFrameworkDocumentHeaderOptions extends StaticExportHeaderSinkOptions {
  buildToken: string;
}

interface StaticExportHeaderSink {
  append(name: unknown, value: unknown): void;
  set(name: unknown, value: unknown): void;
  toJSON(): Record<string, string>;
}

const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const classifyStaticTransportResponseHeaders = createTransportResponseHeaderClassifier({
  lowerCase: securityStringToLowerCase,
});

/**
 * @internal Static export writes durable metadata, so response and configured asset headers pass
 * through one fail-closed sink before entering manifests or filesystem plans (SPEC.md §9.5 and
 * §9.4 header-channel transport safety).
 */
export const createStaticExportHeaderSink = wireEmitter(
  'server.wire.static-export-header-sink',
  function (options: StaticExportHeaderSinkOptions): StaticExportHeaderSink {
    const headers = createSecurityMap<string, string>();

    return {
      append(name, value) {
        const normalizedName = normalizeStaticExportHeaderName(name, options);
        const normalizedValue = normalizeStaticExportHeaderValue(normalizedName, value, options);
        const existing = securityMapGet(headers, normalizedName);
        securityMapSet(
          headers,
          normalizedName,
          existing === undefined ? normalizedValue : `${existing}, ${normalizedValue}`,
        );
      },
      set(name, value) {
        const normalizedName = normalizeStaticExportHeaderName(name, options);
        securityMapSet(
          headers,
          normalizedName,
          normalizeStaticExportHeaderValue(normalizedName, value, options),
        );
      },
      toJSON() {
        const names: string[] = [];
        securityMapForEach(headers, (_value, name) => {
          witnessArrayAppend(
            names,
            name,
            'Server packages/server/src/static-export-headers.ts collection',
          );
        });
        securityArraySort(names, (left, right) => (left < right ? -1 : left > right ? 1 : 0));
        const record = createSecurityNullRecord<string>();
        for (let index = 0; index < names.length; index += 1) {
          const name = names[index]!;
          record[name] = securityMapGet(headers, name)!;
        }
        return witnessFreeze(record);
      },
    };
  },
);

export const staticExportHeaders = wireEmitter(
  'server.wire.static-export-headers',
  function (
    source: Headers | HeadersInit | undefined,
    options: StaticExportHeaderSinkOptions,
  ): Record<string, string> {
    const sink = createStaticExportHeaderSink(options);
    if (source === undefined) return sink.toJSON();

    const entries = staticExportHeaderEntries(source, options);
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]!;
      sink.append(entry[0], entry[1]);
    }

    return sink.toJSON();
  },
);

/**
 * @internal Capture a provenance-marked framework document's durable headers. The runtime-only
 * `Kovo-Build` transport proof is verified against the private render token and omitted from the
 * file artifact; generic/app-authored Kovo headers still fail in {@link staticExportHeaders}.
 */
export const staticExportFrameworkDocumentHeaders = wireEmitter(
  'server.wire.static-export-framework-document-headers',
  function (
    source: Headers,
    options: StaticExportFrameworkDocumentHeaderOptions,
  ): Record<string, string> {
    const sink = createStaticExportHeaderSink(options);
    const entries = staticExportHeaderEntries(source, options);
    let observedBuildToken = false;

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]!;
      const rawName = securityString(entry[0]);
      if (securityStringToLowerCase(rawName) !== 'kovo-build') {
        sink.append(entry[0], entry[1]);
        continue;
      }
      if (observedBuildToken) {
        throw staticExportHeaderError(
          options,
          'framework document responses must carry exactly one Kovo-Build proof.',
        );
      }
      observedBuildToken = true;
      const value = normalizeStaticExportHeaderValue('kovo-build', entry[1], options);
      if (options.buildToken === '' || value !== options.buildToken) {
        throw staticExportHeaderError(
          options,
          'framework document Kovo-Build transport proof does not match its render proof.',
        );
      }
    }

    if (!observedBuildToken) {
      throw staticExportHeaderError(
        options,
        'framework document response is missing its Kovo-Build transport proof.',
      );
    }
    return sink.toJSON();
  },
);

function staticExportHeaderEntries(
  source: Headers | HeadersInit,
  options: StaticExportHeaderSinkOptions,
): readonly (readonly [string, unknown])[] {
  const entries: (readonly [string, unknown])[] = [];
  if (securityIsHeaders(source)) {
    securityHeadersForEach(source, (value, name) => {
      witnessArrayAppend(
        entries,
        witnessFreeze([name, value] as const),
        'Server packages/server/src/static-export-headers.ts collection',
      );
    });
    return witnessFreeze(entries);
  }

  if (securityArrayIsArray(source)) {
    const sourceEntries = snapshotBuildArray(source, 'static-export header entries');
    for (let index = 0; index < sourceEntries.length; index += 1) {
      const entry = sourceEntries[index];
      if (!securityArrayIsArray(entry)) {
        throw staticExportHeaderError(
          options,
          'static export header entries must be [name, value] pairs.',
        );
      }
      const pair = snapshotBuildArray(entry, `static-export header entry ${index}`);
      if (pair.length !== 2) {
        throw staticExportHeaderError(
          options,
          'static export header entries must be [name, value] pairs.',
        );
      }
      witnessArrayAppend(
        entries,
        witnessFreeze([pair[0]!, pair[1]] as const),
        'Server packages/server/src/static-export-headers.ts collection',
      );
    }
    return witnessFreeze(entries);
  }

  const names = securityObjectKeys(source);
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]!;
    const property = buildOwnDataProperty(source, name, `static-export header '${name}'`);
    if (!property.present) {
      throw staticExportHeaderError(options, `static export header '${name}' is unavailable.`);
    }
    witnessArrayAppend(
      entries,
      witnessFreeze([name, property.value] as const),
      'Server packages/server/src/static-export-headers.ts collection',
    );
  }
  return witnessFreeze(entries);
}

function normalizeStaticExportHeaderName(
  name: unknown,
  options: StaticExportHeaderSinkOptions,
): string {
  assertNoSecretEgressValue(name, 'static export header name');
  const text = securityString(name);
  if (
    text === '' ||
    hasHeaderControlCharacter(text) ||
    !securityRegExpTest(HEADER_NAME_PATTERN, text)
  ) {
    throw staticExportHeaderError(
      options,
      `static export header name '${printableStaticExportHeaderToken(text)}' is not a valid HTTP header token.`,
    );
  }

  const normalizedName = securityStringToLowerCase(text);
  const transportViolation = classifyStaticTransportResponseHeaders([{ name: text, value: '' }]);
  if (transportViolation !== undefined) {
    throw staticExportHeaderError(options, `KV415 ${transportViolation.detail}`);
  }
  if (normalizedName === 'set-cookie') {
    throw staticExportHeaderError(
      options,
      'static export artifacts cannot carry Set-Cookie because static files have no response-specific cookie channel.',
    );
  }

  if (securityStringStartsWith(normalizedName, 'kovo-')) {
    throw staticExportHeaderError(
      options,
      `static export artifacts cannot carry framework-reserved '${text}' headers.`,
    );
  }

  return normalizedName;
}

function normalizeStaticExportHeaderValue(
  name: string,
  value: unknown,
  options: StaticExportHeaderSinkOptions,
): string {
  assertNoSecretEgressValue(value, `static export header "${name}"`);
  const text = securityString(value);
  if (hasHeaderControlCharacter(text)) {
    throw staticExportHeaderError(
      options,
      `static export header '${name}' contains a control character and cannot be represented safely.`,
    );
  }

  return text;
}

function hasHeaderControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = securityStringCharCodeAt(value, index);
    if (code <= 0x1f || code === 0x7f) return true;
  }

  return false;
}

function printableStaticExportHeaderToken(value: string): string {
  return securityStringReplaceAll(
    securityStringReplaceAll(securityStringReplaceAll(value, '\0', '\\0'), '\r', '\\r'),
    '\n',
    '\\n',
  );
}

function staticExportHeaderError(
  options: StaticExportHeaderSinkOptions,
  message: string,
): StaticExportError {
  return new StaticExportError([staticExportDiagnostic(options.path, `KV229 ${message}`)]);
}
