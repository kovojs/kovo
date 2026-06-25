import { StaticExportError, staticExportDiagnostic } from './static-export-diagnostics.js';

interface StaticExportHeaderSinkOptions {
  path: string;
}

interface StaticExportHeaderSink {
  append(name: string, value: string): void;
  set(name: string, value: string): void;
  toJSON(): Record<string, string>;
}

const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * @internal Static export writes durable metadata, so response and configured asset headers pass
 * through one fail-closed sink before entering manifests or filesystem plans (SPEC.md §9.5 and
 * §9.4 header-channel transport safety).
 */
export function createStaticExportHeaderSink(
  options: StaticExportHeaderSinkOptions,
): StaticExportHeaderSink {
  const headers = new Map<string, string>();

  return {
    append(name, value) {
      const normalizedName = normalizeStaticExportHeaderName(name, options);
      const normalizedValue = normalizeStaticExportHeaderValue(normalizedName, value, options);
      const existing = headers.get(normalizedName);
      headers.set(
        normalizedName,
        existing === undefined ? normalizedValue : `${existing}, ${normalizedValue}`,
      );
    },
    set(name, value) {
      const normalizedName = normalizeStaticExportHeaderName(name, options);
      headers.set(normalizedName, normalizeStaticExportHeaderValue(normalizedName, value, options));
    },
    toJSON() {
      return Object.fromEntries(
        [...headers.entries()].sort(([left], [right]) => left.localeCompare(right)),
      );
    },
  };
}

export function staticExportHeaders(
  source: Headers | HeadersInit | undefined,
  options: StaticExportHeaderSinkOptions,
): Record<string, string> {
  const sink = createStaticExportHeaderSink(options);
  if (source === undefined) return sink.toJSON();

  for (const [name, value] of staticExportHeaderEntries(source, options)) {
    sink.append(name, value);
  }

  return sink.toJSON();
}

function* staticExportHeaderEntries(
  source: Headers | HeadersInit,
  options: StaticExportHeaderSinkOptions,
): Generator<readonly [string, string]> {
  if (source instanceof Headers) {
    yield* source.entries();
    return;
  }

  if (Array.isArray(source)) {
    for (const entry of source) {
      if (!Array.isArray(entry) || entry.length !== 2) {
        throw staticExportHeaderError(
          options,
          'static export header entries must be [name, value] pairs.',
        );
      }
      yield [String(entry[0]), String(entry[1])];
    }
    return;
  }

  for (const [name, value] of Object.entries(source)) {
    yield [name, String(value)];
  }
}

function normalizeStaticExportHeaderName(
  name: string,
  options: StaticExportHeaderSinkOptions,
): string {
  if (name === '' || hasHeaderControlCharacter(name) || !HEADER_NAME_PATTERN.test(name)) {
    throw staticExportHeaderError(
      options,
      `static export header name '${printableStaticExportHeaderToken(name)}' is not a valid HTTP header token.`,
    );
  }

  const normalizedName = name.toLowerCase();
  if (normalizedName === 'set-cookie') {
    throw staticExportHeaderError(
      options,
      'static export artifacts cannot carry Set-Cookie because static files have no response-specific cookie channel.',
    );
  }

  if (normalizedName.startsWith('kovo-')) {
    throw staticExportHeaderError(
      options,
      `static export artifacts cannot carry framework-reserved '${name}' headers.`,
    );
  }

  return normalizedName;
}

function normalizeStaticExportHeaderValue(
  name: string,
  value: string,
  options: StaticExportHeaderSinkOptions,
): string {
  if (hasHeaderControlCharacter(value)) {
    throw staticExportHeaderError(
      options,
      `static export header '${name}' contains a control character and cannot be represented safely.`,
    );
  }

  return value;
}

function hasHeaderControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }

  return false;
}

function printableStaticExportHeaderToken(value: string): string {
  return value.replaceAll('\0', '\\0').replaceAll('\r', '\\r').replaceAll('\n', '\\n');
}

function staticExportHeaderError(
  options: StaticExportHeaderSinkOptions,
  message: string,
): StaticExportError {
  return new StaticExportError([staticExportDiagnostic(options.path, `KV229 ${message}`)]);
}
