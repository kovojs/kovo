import { createHash } from 'node:crypto';

import { escapeAttribute } from './html.js';

/** CSP hash metadata for inline scripts/styles generated during document assembly. */
export interface CspInlineMetadata {
  /** Stable CSP hashes for generated inline `<script>` bodies in document order. */
  scripts: readonly string[];
  /** Stable CSP hashes for generated inline `<style>` bodies in document order. */
  styles: readonly string[];
}

/** Options for assembling a `Content-Security-Policy` header from Kovo document metadata. */
export interface ContentSecurityPolicyOptions {
  connectSrc?: readonly string[];
  defaultSrc?: readonly string[];
  imgSrc?: readonly string[];
  scriptSrc?: readonly string[];
  styleSrc?: readonly string[];
}

export function cspSha256(value: string): string {
  return `sha256-${createHash('sha256').update(value).digest('base64')}`;
}

export function cspHashAttribute(hash: string): string {
  return `data-kovo-csp-hash="${escapeAttribute(hash)}"`;
}

export function emptyCspInlineMetadata(): CspInlineMetadata {
  return { scripts: [], styles: [] };
}

export function mergeCspInlineMetadata(
  ...metadata: readonly (CspInlineMetadata | undefined)[]
): CspInlineMetadata {
  return {
    scripts: dedupe(metadata.flatMap((item) => item?.scripts ?? [])),
    styles: dedupe(metadata.flatMap((item) => item?.styles ?? [])),
  };
}

export function hasCspInlineMetadata(metadata: CspInlineMetadata): boolean {
  return metadata.scripts.length > 0 || metadata.styles.length > 0;
}

/**
 * Assemble a CSP header value that references hashes returned by `renderDocument(...)`.
 *
 * Kovo emits deterministic hashes for generated inline scripts/styles rather than per-request
 * nonces, so apps can opt into CSP by passing `document.csp` here and setting the resulting
 * value as their `Content-Security-Policy` header.
 *
 * @internal
 */
export function renderContentSecurityPolicy(
  metadata: CspInlineMetadata,
  options: ContentSecurityPolicyOptions = {},
): string {
  const directives = [
    directive('default-src', options.defaultSrc ?? ["'self'"]),
    directive('script-src', [
      ...(options.scriptSrc ?? ["'self'"]),
      ...quoteHashes(metadata.scripts),
    ]),
    directive('style-src', [...(options.styleSrc ?? ["'self'"]), ...quoteHashes(metadata.styles)]),
    directive('img-src', options.imgSrc),
    directive('connect-src', options.connectSrc),
  ].filter((item): item is string => item !== undefined);

  return directives.join('; ');
}

function quoteHashes(hashes: readonly string[]): string[] {
  return hashes.map((hash) => `'${hash}'`);
}

function directive(name: string, values: readonly string[] | undefined): string | undefined {
  if (!values || values.length === 0) return undefined;
  return `${name} ${dedupe(values).join(' ')}`;
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
