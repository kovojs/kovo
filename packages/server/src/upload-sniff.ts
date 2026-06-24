import { randomUUID } from 'node:crypto';

/**
 * KV428 upload inline-XSS gate (SPEC §6.6/§9.1; plans/secure-framework.md Phase 6 Tier 1).
 *
 * The live hole this module closes: `respond.stream({ disposition: 'inline' })` serves
 * attacker-controlled bytes (SVG-with-script, HTML, polyglots) inline same-origin, and the
 * upload schema stored the *verbatim client `file.type`* as the served `Content-Type`.
 * `X-Content-Type-Options: nosniff` does NOT neuter honestly-typed active content: a response
 * truthfully labelled `image/svg+xml` or `text/html` still runs script when rendered inline.
 *
 * The defense has three by-construction-ish parts plus a runtime fail-closed floor:
 *
 *  1. Default `Content-Disposition: attachment` + `nosniff` for EVERYTHING served from uploads
 *     (handled at the `respond.*` sink in `response.ts`).
 *  2. The served `Content-Type` is minted from SNIFFED bytes (server truth overrides the client
 *     lie). {@link sniffUploadBytes} probes magic bytes and ZIP/OOXML containers.
 *  3. Inline rendering is a BRANDED opt-in requiring verified-safe bytes: the sniffer must return
 *     an `inlineSafe` type (a known-passive raster image / PDF / plain media). HTML / SVG / XML /
 *     ambiguous / polyglot bytes are NEVER inline-safe — SVG is XML+script, so a magic-prefix
 *     check on it is meaningless; SVG must be rasterized or downloaded, never sniff-and-trusted.
 *
 * Honest ceiling (SPEC §6.6 — runtime defense-in-depth, NOT a by-construction proof): the
 * guarantee is "attacker bytes are never RENDERED INLINE as active content" (attachment-default +
 * a conservative passive-only inline allowlist), NOT "the sniffed type is unspoofable". A crafted
 * polyglot can still mislabel its *download* type; the win is that it can never execute inline.
 */

/** A content-type the deep sniffer recognised, and whether it is safe to render inline. */
export interface SniffedContentType {
  /**
   * The server-minted MIME derived from the bytes. Never the client-declared `file.type`. For
   * unrecognised bytes this is `application/octet-stream` (the safe download-only fallback).
   */
  readonly contentType: string;
  /**
   * `true` only for bytes proven to be a passive, non-active-content type (raster image / PDF /
   * plain media). HTML, SVG, XML, scripts, ambiguous, and unrecognised bytes are `false`: they
   * may only be served as `attachment`.
   */
  readonly inlineSafe: boolean;
}

const UNKNOWN: SniffedContentType = {
  contentType: 'application/octet-stream',
  inlineSafe: false,
};

function bytesStartWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

/** ASCII-lowercase the first `limit` bytes, skipping leading whitespace/BOM, for HTML/XML sniffing. */
function leadingAsciiLower(bytes: Uint8Array, limit = 512): string {
  let start = 0;
  // Skip a UTF-8 BOM and leading ASCII whitespace so `  <SVG`/`﻿<html` are still caught.
  if (bytesStartWith(bytes, [0xef, 0xbb, 0xbf])) start = 3;
  while (start < bytes.length) {
    const b = bytes[start];
    if (b === 0x09 || b === 0x0a || b === 0x0c || b === 0x0d || b === 0x20) start += 1;
    else break;
  }
  let out = '';
  for (let i = start; i < bytes.length && out.length < limit; i += 1) {
    const b = bytes[i] ?? 0;
    if (b === 0) return out; // a NUL in the prefix → not text; stop (also kills `<\0script>` tricks).
    out += String.fromCharCode(b >= 0x41 && b <= 0x5a ? b + 0x20 : b);
  }
  return out;
}

/**
 * Conservative active-content / polyglot detector. Returns `true` if the leading bytes look like
 * HTML, SVG, XML, a script, or otherwise anything a browser might execute when rendered inline.
 * Deliberately broad and low-false-negative: any hit forces attachment-only.
 */
function looksLikeActiveContent(bytes: Uint8Array): boolean {
  const head = leadingAsciiLower(bytes);
  if (head.length === 0) return false;
  // Any XML/HTML/SVG markup opener (a PI, DOCTYPE, or a known active-content tag) ANYWHERE in the
  // prefix, or a `javascript:` URI. SVG is XML + script, so an `<svg`/`<?xml`/`<!doctype` lead is
  // treated as active content unconditionally — a prefix "is it really SVG?" check is meaningless
  // because the script can live anywhere in the document. Scanning the whole prefix (not just the
  // start) is the polyglot guard: a media header followed by embedded markup still trips this.
  return (
    /<(\?xml|!doctype|html|svg|script|iframe|object|embed|link|style)\b/.test(head) ||
    head.includes('javascript:')
  );
}

/**
 * Deep-sniff buffered upload bytes into a server-minted {@link SniffedContentType}. Probes magic
 * bytes for the common passive media types, recognises ZIP/OOXML containers, and refuses to mark
 * anything that looks like active content (HTML/SVG/XML/script/polyglot) as inline-safe.
 *
 * @param bytes - The fully-buffered upload bytes (already read via `file.arrayBuffer()`).
 */
export function sniffUploadBytes(bytes: Uint8Array): SniffedContentType {
  // Active-content / polyglot check FIRST: a file that begins with markup, or a media header
  // carrying an embedded `<script>`/`<svg>` in its prefix, is never inline-safe regardless of any
  // later magic-byte match. This is the SVG/HTML/polyglot rejection the gate hinges on.
  const active = looksLikeActiveContent(bytes);

  const recognized = recognizePassiveMagic(bytes);
  if (recognized !== undefined) {
    // A recognised passive type is inline-safe only if the prefix carries no active-content
    // markers (polyglot defense). Otherwise serve it download-only with its real type.
    return { contentType: recognized, inlineSafe: !active };
  }

  // Unrecognised bytes (or active-content markup): octet-stream, never inline-safe.
  return UNKNOWN;
}

/** Recognise a passive (non-active-content) media type by magic bytes; `undefined` if unknown. */
function recognizePassiveMagic(bytes: Uint8Array): string | undefined {
  if (bytesStartWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (bytesStartWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (bytesStartWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif'; // GIF8
  if (
    bytesStartWith(bytes, [0x52, 0x49, 0x46, 0x46]) && // RIFF
    bytesStartWith(bytes, [0x57, 0x45, 0x42, 0x50], 8) // WEBP
  ) {
    return 'image/webp';
  }
  if (bytesStartWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  if (
    bytesStartWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || // local file header
    bytesStartWith(bytes, [0x50, 0x4b, 0x05, 0x06]) || // empty archive
    bytesStartWith(bytes, [0x50, 0x4b, 0x07, 0x08]) // spanned
  ) {
    // A ZIP/OOXML container (docx/xlsx/pptx are ZIPs). We do not crack the central directory here;
    // a ZIP is download-only by policy (recognised, NOT inline-safe — a ZIP can carry HTML).
    return 'application/zip';
  }
  return undefined;
}

/**
 * Sanitize a client-supplied filename into safe download-`filename` METADATA. The result is NEVER
 * used as a storage key (see {@link mintStorageKey}); it only labels the `Content-Disposition`
 * download name. Strips path separators, control chars, and `..` so a `../../etc/passwd` name
 * cannot traverse and a header-injection name cannot break out of the quoted filename.
 *
 * @param name - The raw client `file.name`.
 */
export function sanitizeDownloadFilename(name: string): string {
  // Take the last path segment (kills `../` and absolute paths), strip control chars and quotes.
  const base = name.split(/[/\\]/).pop() ?? '';
  const cleaned = base
    // Strip ASCII control chars (\x00-\x1f, \x7f) plus quote/backslash so the result is a safe,
    // header-injection-free quoted Content-Disposition filename value.
    // eslint-disable-next-line no-control-regex
    .replace(/[ -"\\]/g, '')
    .replace(/^\.+/, '') // no leading dots (no hidden/`..` names)
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 255) : 'download';
}

/**
 * Mint a server-generated, opaque, collision-free storage key. Random by construction, so an
 * attacker-controlled filename can never become the storage key (no path traversal, no overwrite
 * of a victim's object). An optional `prefix` namespaces uploads (e.g. `'avatars'`); it is itself
 * sanitized to a single safe segment.
 *
 * @param prefix - Optional namespace segment for the key.
 */
export function mintStorageKey(prefix?: string): string {
  const id = randomUUID();
  if (prefix === undefined || prefix === '') return id;
  const safePrefix = prefix.replace(/[^a-z0-9._-]/gi, '').replace(/^\.+/, '');
  return safePrefix.length > 0 ? `${safePrefix}/${id}` : id;
}

/**
 * The audited escape (SPEC §6.6/§9.1): opt OUT of byte-sniffing and trust the client-declared MIME.
 * This is the ONLY verbatim-client-MIME path that survives the `.mime()` removal. It records a
 * capability fact surfaced in `kovo explain --capabilities` so a reviewer sees every place the
 * server trusts the client's content-type claim.
 *
 * The unverified type is STILL forced to attachment (it is by definition not inline-safe); the
 * escape only changes the *download* type, never re-enables inline rendering of unverified bytes.
 */
export interface UnverifiedAcceptance {
  readonly justification: string;
  readonly types: readonly string[];
  readonly unverified: true;
}

/** A recorded `accept.unverified()` capability fact for `kovo explain --capabilities`. */
export interface UnverifiedMimeFact {
  readonly justification: string;
  readonly types: readonly string[];
}

const unverifiedMimeFacts: UnverifiedMimeFact[] = [];

/**
 * The verified-MIME / unverified-escape acceptance namespace passed to `s.file().accept(...)`.
 *
 * - `accept([...types])` — the bytes are sniffed and the sniffed type must be one of `types`
 *   (server truth must agree with the app's allowlist). By-construction-ish.
 * - `accept.unverified([...types], justification)` — the audited escape: trust the client MIME,
 *   recorded for `kovo explain --capabilities`. Still attachment-forced.
 */
export const accept = Object.assign(
  (types: readonly string[]): readonly string[] => types,
  {
    unverified(types: readonly string[], justification: string): UnverifiedAcceptance {
      if (!justification || justification.trim().length === 0) {
        throw new Error('accept.unverified(...) requires a justification (KV428, SPEC §6.6/§9.1).');
      }
      unverifiedMimeFacts.push({ justification, types });
      return { justification, types, unverified: true };
    },
  },
);

/**
 * Drain the recorded `accept.unverified()` capability facts (SPEC §6.6/§9.1).
 *
 * SF-WIRE(graph-output): render --capabilities unverified-MIME escapes — wire
 * {@link drainUnverifiedMimeFacts} into `kovo explain --capabilities` so each place the server
 * trusts the client content-type is surfaced in the audit a reviewer runs.
 */
export function drainUnverifiedMimeFacts(): readonly UnverifiedMimeFact[] {
  return unverifiedMimeFacts.splice(0, unverifiedMimeFacts.length);
}

/**
 * Thrown at the `respond.*` inline sink when an upload is served inline (`disposition: 'inline'`)
 * but the content type is NOT verified-safe (KV428, SPEC §6.6/§9.1). This is the runtime
 * fail-closed floor: when the static brand degrades (e.g. `respond.storedFile(key)` takes a bare
 * string key with no compile-visible verification), the runtime refuses to serve unverified bytes
 * inline rather than rendering attacker-controlled active content same-origin.
 */
export class InlineUnverifiedUploadError extends Error {
  readonly code = 'KV428' as const;

  constructor(message: string) {
    super(`KV428 ${message}`);
    this.name = 'InlineUnverifiedUploadError';
  }
}

/**
 * Assert that bytes about to be served inline are verified-safe; throw {@link
 * InlineUnverifiedUploadError} otherwise. The fail-closed runtime backstop for the inline path
 * (SPEC §6.6 — defense-in-depth floor, not a by-construction proof).
 *
 * @param bytes - The fully-buffered bytes to be served.
 * @returns The sniffed type (whose `contentType` the caller should serve, server-truth).
 */
export function assertInlineSafe(bytes: Uint8Array): SniffedContentType {
  const sniffed = sniffUploadBytes(bytes);
  if (!sniffed.inlineSafe) {
    throw new InlineUnverifiedUploadError(
      'Refusing to serve unverified upload bytes inline: the sniffed content type is not a ' +
        'known-passive type (HTML/SVG/XML/ambiguous bytes are attachment-only). Serve as an ' +
        'attachment, or rasterize/re-encode the bytes before inline rendering.',
    );
  }
  return sniffed;
}
