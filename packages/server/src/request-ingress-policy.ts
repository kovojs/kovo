/** One URL parse snapshot used by the shared request-ingress classifier. */
export interface RequestIngressUrlParse {
  readonly hash: string;
  readonly host: string;
  readonly href: string;
  readonly origin: string;
  readonly password: string;
  readonly pathname: string;
  readonly protocol: string;
  readonly search: string;
  readonly username: string;
}

interface RequestIngressClassifierControls {
  canonicalClientIp(value: string): string | undefined;
  charCodeAt(value: string, index: number): number;
  isArray(value: unknown): value is readonly unknown[];
  parseAuthority(
    authority: string,
    scheme: 'http' | 'https',
  ): Omit<RequestIngressUrlParse, 'href' | 'protocol'> | undefined;
  parseTarget(target: string, base?: string): RequestIngressUrlParse | undefined;
}

interface RequestIngressCommonInput {
  readonly method: string;
  readonly rawTarget: string;
}

export interface NodeHttp1RequestIngressInput extends RequestIngressCommonInput {
  readonly encrypted: boolean;
  readonly forwardedProto: unknown;
  readonly host: unknown;
  readonly httpVersion: string;
  readonly pseudoAuthority: unknown;
  readonly pseudoScheme: unknown;
  readonly rawHostHeaderCount: number | undefined;
  readonly rawHostHeaderValue: string | undefined;
  readonly source: 'node-http1';
  readonly trustedProxy: boolean;
}

export interface NodeHttp2RequestIngressInput extends RequestIngressCommonInput {
  readonly encrypted: boolean;
  readonly forwardedProto: unknown;
  readonly host: unknown;
  readonly httpVersion: string;
  readonly pseudoAuthority: unknown;
  readonly pseudoScheme: unknown;
  readonly rawHostHeaderCount: number | undefined;
  readonly rawHostHeaderValue: string | undefined;
  readonly source: 'node-http2';
  readonly trustedProxy: boolean;
}

export interface VercelNodeRequestIngressInput extends RequestIngressCommonInput {
  readonly host: unknown;
  readonly httpVersion: string;
  readonly platformClientIp: unknown;
  readonly platformScheme: unknown;
  readonly pseudoAuthority: unknown;
  readonly pseudoScheme: unknown;
  readonly rawHostHeaderCount: number | undefined;
  readonly rawHostHeaderValue: string | undefined;
  readonly source: 'vercel-node';
}

export interface PlatformFetchRequestIngressInput extends RequestIngressCommonInput {
  readonly authority: string;
  readonly scheme: string;
  readonly source: 'platform-fetch';
}

export type RequestIngressInput =
  | NodeHttp1RequestIngressInput
  | NodeHttp2RequestIngressInput
  | PlatformFetchRequestIngressInput
  | VercelNodeRequestIngressInput;

export type RequestIngressIssue =
  | 'authority'
  | 'forwarded-scheme'
  | 'method'
  | 'platform-client'
  | 'platform-scheme'
  | 'pseudo-scheme'
  | 'source'
  | 'target';

export type RequestIngressDecision =
  | {
      readonly authority: string;
      readonly clientIp?: string;
      readonly method: string;
      readonly ok: true;
      readonly scheme: 'http' | 'https';
      /** Canonical origin-form pathname plus query, reconstructed from the accepted target. */
      readonly target: string;
      readonly targetForm: 'absolute' | 'origin';
    }
  | { readonly issue: RequestIngressIssue; readonly ok: false };

export interface RequestIngressClassifier {
  classify(input: RequestIngressInput): RequestIngressDecision;
  classifyMethod(method: string): boolean;
}

/**
 * Build the one finite source/method/authority/scheme/target verdict used by live and emitted
 * adapters. Transport kind is an explicit discriminant, never inferred from whichever hostile
 * carrier fields happen to be present. Accepted values are reconstruction facts and must travel
 * with the snapshot that produced them (SPEC §2, §6.6 C9/C15, and §9.5).
 *
 * @internal
 */
export function createRequestIngressClassifier(
  controls: RequestIngressClassifierControls,
): RequestIngressClassifier {
  function classify(input: RequestIngressInput): RequestIngressDecision {
    if (!input || typeof input !== 'object') return { issue: 'source', ok: false };
    if (!classifyMethod(input.method)) return { issue: 'method', ok: false };

    let authority: string | undefined;
    let clientIp: string | undefined;
    let scheme: 'http' | 'https' | undefined;
    if (input.source === 'node-http1') {
      if (
        input.httpVersion[0] === '2' ||
        input.pseudoAuthority !== undefined ||
        input.pseudoScheme !== undefined
      ) {
        return { issue: 'source', ok: false };
      }
      authority = canonicalRawHttp1Authority(input);
      if (authority === undefined) return { issue: 'authority', ok: false };
      if (input.trustedProxy) {
        const forwarded = forwardedScheme(input.forwardedProto);
        if (!forwarded.ok) return forwarded;
        scheme = forwarded.scheme;
      } else {
        scheme = input.encrypted ? 'https' : 'http';
      }
    } else if (input.source === 'node-http2') {
      if (
        input.httpVersion[0] !== '2' ||
        input.host !== undefined ||
        input.forwardedProto !== undefined ||
        (input.rawHostHeaderCount !== undefined && input.rawHostHeaderCount !== 0) ||
        input.rawHostHeaderValue !== undefined
      ) {
        return { issue: 'source', ok: false };
      }
      authority = canonicalAuthorityValue(input.pseudoAuthority);
      if (authority === undefined) return { issue: 'authority', ok: false };
      const pseudo = exactScheme(input.pseudoScheme, 'pseudo-scheme');
      if (!pseudo.ok) return pseudo;
      scheme = pseudo.scheme;
      if (!input.trustedProxy && scheme !== (input.encrypted ? 'https' : 'http')) {
        return { issue: 'pseudo-scheme', ok: false };
      }
    } else if (input.source === 'vercel-node') {
      if (
        input.httpVersion[0] === '2' ||
        input.pseudoAuthority !== undefined ||
        input.pseudoScheme !== undefined
      ) {
        return { issue: 'source', ok: false };
      }
      authority = canonicalRawHttp1Authority(input);
      if (authority === undefined) return { issue: 'authority', ok: false };
      const platformScheme = exactScheme(input.platformScheme, 'platform-scheme');
      if (!platformScheme.ok) return platformScheme;
      scheme = platformScheme.scheme;
      if (typeof input.platformClientIp !== 'string') {
        return { issue: 'platform-client', ok: false };
      }
      clientIp = controls.canonicalClientIp(input.platformClientIp);
      if (clientIp === undefined || clientIp !== input.platformClientIp) {
        return { issue: 'platform-client', ok: false };
      }
    } else if (input.source === 'platform-fetch') {
      authority = canonicalAuthorityValue(input.authority);
      if (authority === undefined) return { issue: 'authority', ok: false };
      const platformScheme = exactScheme(input.scheme, 'platform-scheme');
      if (!platformScheme.ok) return platformScheme;
      scheme = platformScheme.scheme;
    } else {
      return { issue: 'source', ok: false };
    }

    const target = canonicalTarget(input.rawTarget, scheme, authority);
    if (target === undefined) return { issue: 'target', ok: false };
    return {
      authority,
      ...(clientIp === undefined ? {} : { clientIp }),
      method: input.method,
      ok: true,
      scheme,
      target: target.value,
      targetForm: target.form,
    };
  }

  function classifyMethod(method: string): boolean {
    if (typeof method !== 'string' || !isHttpMethodToken(method)) return false;
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

  function canonicalTarget(
    rawTarget: string,
    scheme: 'http' | 'https',
    authority: string,
  ): { readonly form: 'absolute' | 'origin'; readonly value: string } | undefined {
    // Kovo intentionally does not assign app/static semantics to server-wide OPTIONS *.
    if (typeof rawTarget !== 'string' || rawTarget === '' || rawTarget === '*') return undefined;
    const origin = `${scheme}://${authority}`;
    if (rawTarget[0] === '/') {
      if (
        rawTarget[1] === '/' ||
        contains(rawTarget, '\\') ||
        contains(rawTarget, '#') ||
        containsEncodedPathControl(rawTarget)
      ) {
        return undefined;
      }
      const parsed = controls.parseTarget(rawTarget, origin);
      if (
        parsed === undefined ||
        parsed.origin !== origin ||
        parsed.hash !== '' ||
        parsed.pathname + parsed.search !== rawTarget
      ) {
        return undefined;
      }
      return { form: 'origin', value: rawTarget };
    }

    const parsed = controls.parseTarget(rawTarget);
    if (
      parsed === undefined ||
      parsed.protocol !== `${scheme}:` ||
      parsed.host !== authority ||
      parsed.origin !== origin ||
      parsed.password !== '' ||
      parsed.hash !== '' ||
      parsed.username !== '' ||
      parsed.href !== rawTarget
    ) {
      return undefined;
    }
    return { form: 'absolute', value: parsed.pathname + parsed.search };
  }

  function canonicalAuthorityValue(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.length === 0) return undefined;
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      const code = controls.charCodeAt(value, index);
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
        return undefined;
      }
    }
    const http = controls.parseAuthority(value, 'http');
    const https = controls.parseAuthority(value, 'https');
    return http !== undefined &&
      https !== undefined &&
      http.origin !== 'null' &&
      https.origin !== 'null' &&
      http.password === '' &&
      https.password === '' &&
      http.host === value &&
      https.host === value &&
      http.pathname === '/' &&
      https.pathname === '/' &&
      http.search === '' &&
      https.search === '' &&
      http.hash === '' &&
      https.hash === '' &&
      http.username === '' &&
      https.username === ''
      ? value
      : undefined;
  }

  function canonicalRawHttp1Authority(input: {
    readonly host: unknown;
    readonly rawHostHeaderCount: number | undefined;
    readonly rawHostHeaderValue: string | undefined;
  }): string | undefined {
    if (input.rawHostHeaderCount !== 1 || input.rawHostHeaderValue !== input.host) return undefined;
    return canonicalAuthorityValue(input.host);
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
    for (let index = 0; index < list.length; index += 1) if (list[index] === ',') start = index + 1;
    return exactScheme(trimOws(list, start, list.length), 'forwarded-scheme');
  }

  function exactScheme<Issue extends 'forwarded-scheme' | 'platform-scheme' | 'pseudo-scheme'>(
    value: unknown,
    issue: Issue,
  ):
    | { readonly issue: Issue; readonly ok: false }
    | { readonly ok: true; readonly scheme: 'http' | 'https' } {
    return value === 'http' || value === 'https'
      ? { ok: true, scheme: value }
      : { issue, ok: false };
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

  function contains(value: string, expected: string): boolean {
    for (let index = 0; index < value.length; index += 1)
      if (value[index] === expected) return true;
    return false;
  }

  function containsEncodedPathControl(value: string): boolean {
    for (let index = 0; index + 2 < value.length; index += 1) {
      if (value[index] === '?') return false;
      if (value[index] !== '%') continue;
      const first = value[index + 1];
      const second = value[index + 2];
      if (first === '2' && (second === 'e' || second === 'E' || second === 'f' || second === 'F')) {
        return true;
      }
      if (first === '5' && (second === 'c' || second === 'C')) return true;
    }
    return false;
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

  return { classify, classifyMethod };
}
