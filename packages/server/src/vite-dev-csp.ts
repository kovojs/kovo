import {
  securityArrayIsArray,
  securityArrayJoin,
  securityArrayPush,
  securityStringCharCodeAt,
  securityStringEndsWith,
  securityStringSlice,
  securityStringToLowerCase,
} from './response-security-intrinsics.js';
import { witnessReflectGet } from './security-witness-intrinsics.js';

const maximumPolicyChars = 65_536;
const maximumPolicies = 32;
const maximumDirectives = 256;
const maximumDirectiveTokens = 512;

/** @internal Admit Vite's fresh style nonce to every enforced CSP policy without broadening it. */
export function admitKovoViteDevStyleNonce(policy: string, nonce: string): string {
  assertBoundedNonce(nonce);
  if (typeof policy !== 'string' || policy.length > maximumPolicyChars) {
    throw new TypeError('Vite dev CSP policy exceeds its parser bound');
  }
  const policies = splitBoundedCsp(policy, ',', maximumPolicies, 'policy');
  const admitted: string[] = [];
  for (let index = 0; index < policies.length; index += 1) {
    securityArrayPush(admitted, admitNonceToPolicy(policies[index]!, nonce));
  }
  return securityArrayJoin(admitted, ', ');
}

/** @internal Node may retain repeated CSP fields as an exact string array. */
export function admitKovoViteDevStyleNonceHeader(
  policy: unknown,
  nonce: string,
): string | readonly string[] | null {
  assertBoundedNonce(nonce);
  if (typeof policy === 'string') return admitKovoViteDevStyleNonce(policy, nonce);
  if (!securityArrayIsArray(policy) || policy.length > maximumPolicies) return null;
  const admitted: string[] = [];
  for (let index = 0; index < policy.length; index += 1) {
    const member = witnessReflectGet(policy, index);
    if (typeof member !== 'string') return null;
    securityArrayPush(admitted, admitKovoViteDevStyleNonce(member, nonce));
  }
  return admitted;
}

function admitNonceToPolicy(policy: string, nonce: string): string {
  const source = `'nonce-${nonce}'`;
  const sourceDirectives = splitBoundedCsp(policy, ';', maximumDirectives, 'directive');
  const directives: string[][] = [];
  let defaultSources: string[] | null = null;
  let hasStyleSource = false;

  for (let index = 0; index < sourceDirectives.length; index += 1) {
    const tokens = tokenizeDirective(sourceDirectives[index]!);
    if (tokens.length === 0) continue;
    const name = securityStringToLowerCase(tokens[0]!);
    assertDirectiveName(name);
    if (name === 'default-src' && defaultSources === null) {
      defaultSources = copyDirectiveSources(tokens);
    }
    if (name === 'style-src') {
      hasStyleSource = true;
      appendSourceOnce(tokens, source);
    } else if (name === 'style-src-elem') {
      // CSP3 style-src-elem overrides style-src for Vite's nonce-bearing <style> elements.
      // style-src-attr is intentionally untouched: nonces do not authorize style attributes.
      appendSourceOnce(tokens, source);
    }
    securityArrayPush(directives, tokens);
  }

  if (!hasStyleSource) {
    const styleSources = ['style-src'];
    if (defaultSources !== null) {
      for (let index = 0; index < defaultSources.length; index += 1) {
        securityArrayPush(styleSources, defaultSources[index]!);
      }
    }
    appendSourceOnce(styleSources, source);
    securityArrayPush(directives, styleSources);
  }

  const serialized: string[] = [];
  for (let index = 0; index < directives.length; index += 1) {
    securityArrayPush(serialized, securityArrayJoin(directives[index]!, ' '));
  }
  return securityArrayJoin(serialized, '; ');
}

function splitBoundedCsp(value: string, delimiter: ',' | ';', maximum: number, label: string) {
  const parts: string[] = [];
  let start = 0;
  const delimiterCode = delimiter === ',' ? 44 : 59;
  for (let index = 0; index < value.length; index += 1) {
    const code = securityStringCharCodeAt(value, index);
    if (code === 0 || code === 10 || code === 13 || (code < 32 && code !== 9) || code === 127) {
      throw new TypeError(`Vite dev CSP ${label} contains a forbidden control character`);
    }
    if (code !== delimiterCode) continue;
    securityArrayPush(parts, trimCspWhitespace(securityStringSlice(value, start, index)));
    if (parts.length >= maximum) {
      throw new TypeError(`Vite dev CSP ${label} census exceeds its parser bound`);
    }
    start = index + 1;
  }
  securityArrayPush(parts, trimCspWhitespace(securityStringSlice(value, start)));
  if (parts.length > maximum) {
    throw new TypeError(`Vite dev CSP ${label} census exceeds its parser bound`);
  }
  return parts;
}

function tokenizeDirective(value: string): string[] {
  const tokens: string[] = [];
  let start = -1;
  for (let index = 0; index <= value.length; index += 1) {
    const code = index === value.length ? 32 : securityStringCharCodeAt(value, index);
    const whitespace = code === 9 || code === 32;
    if (!whitespace && start === -1) start = index;
    if (!whitespace || start === -1) continue;
    securityArrayPush(tokens, securityStringSlice(value, start, index));
    if (tokens.length > maximumDirectiveTokens) {
      throw new TypeError('Vite dev CSP directive token census exceeds its parser bound');
    }
    start = -1;
  }
  return tokens;
}

function trimCspWhitespace(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end) {
    const code = securityStringCharCodeAt(value, start);
    if (code !== 9 && code !== 32) break;
    start += 1;
  }
  while (end > start) {
    const code = securityStringCharCodeAt(value, end - 1);
    if (code !== 9 && code !== 32) break;
    end -= 1;
  }
  return securityStringSlice(value, start, end);
}

function copyDirectiveSources(tokens: readonly string[]): string[] {
  const sources: string[] = [];
  for (let index = 1; index < tokens.length; index += 1) {
    securityArrayPush(sources, tokens[index]!);
  }
  return sources;
}

function appendSourceOnce(tokens: string[], source: string): void {
  for (let index = 1; index < tokens.length; index += 1) {
    if (tokens[index] === source) return;
  }
  securityArrayPush(tokens, source);
}

function assertDirectiveName(value: string): void {
  if (value.length < 1 || value.length > 64) {
    throw new TypeError('Vite dev CSP directive name is malformed');
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = securityStringCharCodeAt(value, index);
    if (!((code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 45)) {
      throw new TypeError('Vite dev CSP directive name is malformed');
    }
  }
}

function assertBoundedNonce(value: string): void {
  if (typeof value !== 'string' || value.length !== 24 || !securityStringEndsWith(value, '==')) {
    throw new TypeError('Vite dev CSP nonce is malformed');
  }
  for (let index = 0; index < 22; index += 1) {
    const code = securityStringCharCodeAt(value, index);
    if (
      !(
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        (code >= 48 && code <= 57) ||
        code === 43 ||
        code === 47
      )
    ) {
      throw new TypeError('Vite dev CSP nonce is malformed');
    }
  }
}
