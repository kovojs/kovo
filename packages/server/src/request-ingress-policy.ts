/** One URL parse snapshot used by the shared request-ingress classifier. */
export interface RequestIngressAuthorityParse {
  readonly hash: string;
  readonly host: string;
  readonly origin: string;
  readonly pathname: string;
  readonly search: string;
}

interface RequestIngressClassifierControls {
  charCodeAt(value: string, index: number): number;
  isArray(value: unknown): value is readonly unknown[];
  parseAuthority(
    authority: string,
    scheme: 'http' | 'https',
  ): RequestIngressAuthorityParse | undefined;
}

export interface RequestIngressAuthorityInput {
  readonly host: unknown;
  readonly httpVersion: string;
  readonly pseudoAuthority: unknown;
  readonly rawHostHeaderCount?: number;
}

export interface NodeRequestIngressInput extends RequestIngressAuthorityInput {
  readonly encrypted: boolean;
  readonly forwardedProto: unknown;
  readonly method: string;
  readonly pseudoScheme: unknown;
  readonly trustedProxy: boolean;
}

export type RequestIngressIssue =
  | 'authority'
  | 'forwarded-scheme'
  | 'method'
  | 'platform-scheme'
  | 'pseudo-scheme';

export type RequestIngressDecision =
  | {
      readonly authority?: string;
      readonly method: string;
      readonly ok: true;
      readonly scheme: 'http' | 'https';
    }
  | { readonly issue: RequestIngressIssue; readonly ok: false };

export interface RequestIngressClassifier {
  classifyAuthority(
    input: RequestIngressAuthorityInput,
  ): { readonly authority?: string; readonly ok: true } | { readonly ok: false };
  classifyMethod(method: string): boolean;
  classifyNode(input: NodeRequestIngressInput): RequestIngressDecision;
  classifyPlatformFetch(input: {
    readonly authority: string;
    readonly method: string;
    readonly scheme: string;
  }): RequestIngressDecision;
}

/**
 * Build the single finite method/authority/scheme verdict used by source and emitted adapters.
 *
 * Transport adapters first snapshot the source they are entitled to trust: raw Node HTTP/1 or
 * HTTP/2 fields, platform-owned Vercel fields, or a platform-owned Fetch request. This classifier
 * then applies one strict grammar and returns reconstructed values; it never rereads a transport
 * carrier (SPEC §6.6 C9/C15 and §9.5).
 *
 * @internal
 */
export function createRequestIngressClassifier(
  controls: RequestIngressClassifierControls,
): RequestIngressClassifier {
  function classifyMethod(method: string): boolean {
    if (!isHttpMethodToken(method)) return false;
    if (equalsAsciiCaseInsensitive(method, 'delete')) return method === 'DELETE';
    if (equalsAsciiCaseInsensitive(method, 'get')) return method === 'GET';
    if (equalsAsciiCaseInsensitive(method, 'head')) return method === 'HEAD';
    if (equalsAsciiCaseInsensitive(method, 'options')) return method === 'OPTIONS';
    if (equalsAsciiCaseInsensitive(method, 'post')) return method === 'POST';
    if (equalsAsciiCaseInsensitive(method, 'put')) return method === 'PUT';
    return (
      !equalsAsciiCaseInsensitive(method, 'connect') &&
      !equalsAsciiCaseInsensitive(method, 'trace') &&
      !equalsAsciiCaseInsensitive(method, 'track')
    );
  }

  function classifyAuthority(
    input: RequestIngressAuthorityInput,
  ): { readonly authority?: string; readonly ok: true } | { readonly ok: false } {
    const authority = input.pseudoAuthority === undefined ? input.host : input.pseudoAuthority;
    if (input.pseudoAuthority === undefined && input.rawHostHeaderCount !== undefined) {
      if (authority === undefined) {
        if (input.rawHostHeaderCount !== 0 || input.httpVersion !== '1.0') return { ok: false };
      } else if (input.rawHostHeaderCount !== 1) {
        return { ok: false };
      }
    }
    if (authority === undefined) return { ok: true };
    if (typeof authority !== 'string' || !canonicalAuthority(authority)) return { ok: false };
    return { authority, ok: true };
  }

  function classifyNode(input: NodeRequestIngressInput): RequestIngressDecision {
    if (!classifyMethod(input.method)) return { issue: 'method', ok: false };
    const authority = classifyAuthority(input);
    if (!authority.ok) return { issue: 'authority', ok: false };
    const scheme = input.trustedProxy
      ? input.forwardedProto === undefined
        ? pseudoScheme(input.pseudoScheme, input.encrypted)
        : forwardedScheme(input.forwardedProto)
      : { ok: true as const, scheme: input.encrypted ? ('https' as const) : ('http' as const) };
    if (!scheme.ok) return { issue: scheme.issue, ok: false };
    return {
      ...(authority.authority === undefined ? {} : { authority: authority.authority }),
      method: input.method,
      ok: true,
      scheme: scheme.scheme,
    };
  }

  function classifyPlatformFetch(input: {
    readonly authority: string;
    readonly method: string;
    readonly scheme: string;
  }): RequestIngressDecision {
    if (!classifyMethod(input.method)) return { issue: 'method', ok: false };
    const authority = classifyAuthority({
      host: undefined,
      httpVersion: 'platform-fetch',
      pseudoAuthority: input.authority,
    });
    if (!authority.ok || authority.authority === undefined) {
      return { issue: 'authority', ok: false };
    }
    if (input.scheme !== 'http' && input.scheme !== 'https') {
      return { issue: 'platform-scheme', ok: false };
    }
    return {
      authority: authority.authority,
      method: input.method,
      ok: true,
      scheme: input.scheme,
    };
  }

  function canonicalAuthority(authority: string): boolean {
    if (authority.length === 0) return false;
    for (let index = 0; index < authority.length; index += 1) {
      const character = authority[index];
      const code = controls.charCodeAt(authority, index);
      if (
        code <= 0x20 ||
        code === 0x7f ||
        character === '@' ||
        character === '/' ||
        character === '\\' ||
        character === '?' ||
        character === '#' ||
        character === ','
      ) {
        return false;
      }
    }
    const parsedHttp = controls.parseAuthority(authority, 'http');
    const parsedHttps = controls.parseAuthority(authority, 'https');
    return (
      parsedHttp !== undefined &&
      parsedHttps !== undefined &&
      parsedHttp.origin !== 'null' &&
      parsedHttps.origin !== 'null' &&
      parsedHttp.host === authority &&
      parsedHttps.host === authority &&
      parsedHttp.pathname === '/' &&
      parsedHttps.pathname === '/' &&
      parsedHttp.search === '' &&
      parsedHttps.search === '' &&
      parsedHttp.hash === '' &&
      parsedHttps.hash === ''
    );
  }

  function forwardedScheme(
    value: unknown,
  ):
    | { readonly issue: 'forwarded-scheme'; readonly ok: false }
    | { readonly ok: true; readonly scheme: 'http' | 'https' } {
    let list = value;
    if (controls.isArray(value)) {
      if (value.length === 0) return { issue: 'forwarded-scheme', ok: false };
      list = value[value.length - 1];
    }
    if (typeof list !== 'string') return { issue: 'forwarded-scheme', ok: false };
    let start = 0;
    for (let index = 0; index < list.length; index += 1) {
      if (list[index] === ',') start = index + 1;
    }
    const scheme = trimOws(list, start, list.length);
    return scheme === 'http' || scheme === 'https'
      ? { ok: true, scheme }
      : { issue: 'forwarded-scheme', ok: false };
  }

  function pseudoScheme(
    value: unknown,
    encrypted: boolean,
  ):
    | { readonly issue: 'pseudo-scheme'; readonly ok: false }
    | { readonly ok: true; readonly scheme: 'http' | 'https' } {
    if (value === undefined) return { ok: true, scheme: encrypted ? 'https' : 'http' };
    if (typeof value !== 'string') return { issue: 'pseudo-scheme', ok: false };
    if (equalsAsciiCaseInsensitive(value, 'http')) return { ok: true, scheme: 'http' };
    if (equalsAsciiCaseInsensitive(value, 'https')) return { ok: true, scheme: 'https' };
    return { issue: 'pseudo-scheme', ok: false };
  }

  function trimOws(value: string, initialStart: number, initialEnd: number): string {
    let start = initialStart;
    let end = initialEnd;
    while (start < end && (value[start] === ' ' || value[start] === '\t')) start += 1;
    while (end > start && (value[end - 1] === ' ' || value[end - 1] === '\t')) end -= 1;
    let result = '';
    for (let index = start; index < end; index += 1) result += value[index];
    return result;
  }

  function equalsAsciiCaseInsensitive(value: string, lower: string): boolean {
    if (value.length !== lower.length) return false;
    for (let index = 0; index < value.length; index += 1) {
      let code = controls.charCodeAt(value, index);
      if (code >= 0x41 && code <= 0x5a) code += 0x20;
      if (code !== controls.charCodeAt(lower, index)) return false;
    }
    return true;
  }

  function isHttpMethodToken(method: string): boolean {
    if (method.length === 0) return false;
    for (let index = 0; index < method.length; index += 1) {
      const code = controls.charCodeAt(method, index);
      if (
        (code >= 0x30 && code <= 0x39) ||
        (code >= 0x41 && code <= 0x5a) ||
        (code >= 0x61 && code <= 0x7a) ||
        code === 0x21 ||
        (code >= 0x23 && code <= 0x27) ||
        code === 0x2a ||
        code === 0x2b ||
        code === 0x2d ||
        code === 0x2e ||
        code === 0x5e ||
        code === 0x5f ||
        code === 0x60 ||
        code === 0x7c ||
        code === 0x7e
      ) {
        continue;
      }
      return false;
    }
    return true;
  }

  return { classifyAuthority, classifyMethod, classifyNode, classifyPlatformFetch };
}
