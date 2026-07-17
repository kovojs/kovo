import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import {
  ResponseHeaderChannelError,
  type TransportResponseHeaderEntry,
} from './response-transport-headers.js';

/**
 * Header names an app may write directly on a structured response outcome.
 *
 * Body representation, validators, disposition, redirects, cookies, and Kovo protocol fields use
 * their dedicated typed APIs instead (SPEC §9.1.1; KV415).
 */
export type AppResponseHeaderName = 'Cache-Control' | 'Last-Modified' | 'Vary';

export interface AppResponseHeaderViolation {
  readonly detail: string;
  readonly headerName: string;
}

interface AppResponseHeaderClassifierControls {
  lowerCase(value: string): string;
}

export type AppResponseHeaderClassifier = (
  entries: readonly TransportResponseHeaderEntry[],
) => AppResponseHeaderViolation | undefined;

/**
 * Build the exact structured app-response header classifier used by source and emitted runtimes.
 *
 * @internal
 */
export function createAppResponseHeaderClassifier(
  controls: AppResponseHeaderClassifierControls,
): AppResponseHeaderClassifier {
  return function classifyAppResponseHeaders(
    entries: readonly TransportResponseHeaderEntry[],
  ): AppResponseHeaderViolation | undefined {
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const entry = entries[entryIndex]!;
      const normalizedName = controls.lowerCase(entry.name);
      switch (normalizedName) {
        case 'cache-control':
        case 'last-modified':
        case 'vary':
          continue;
        case 'content-type':
          return {
            detail: `Structured app header "${entry.name}" is not directly settable; use the contentType option.`,
            headerName: entry.name,
          };
        case 'etag':
          return {
            detail: `Structured app header "${entry.name}" is not directly settable; use the etag option.`,
            headerName: entry.name,
          };
        case 'content-disposition':
          return {
            detail: `Structured app header "${entry.name}" is not directly settable; use filename/disposition options.`,
            headerName: entry.name,
          };
        case 'location':
          return {
            detail: `Structured app header "${entry.name}" is not directly settable; return redirect() instead.`,
            headerName: entry.name,
          };
        case 'set-cookie':
          return {
            detail: `Structured app header "${entry.name}" is not directly settable; use the typed mutation cookie builder.`,
            headerName: entry.name,
          };
        default:
          return {
            detail:
              `Structured app header "${entry.name}" is outside the direct allowlist. ` +
              'Only Cache-Control, Last-Modified, and Vary are accepted.',
            headerName: entry.name,
          };
      }
    }

    return undefined;
  };
}

/** @internal Reject names outside the direct structured app-response metadata allowlist. */
export function assertAllowedAppResponseHeaders(
  entries: readonly TransportResponseHeaderEntry[],
  classifyAppResponseHeaders: AppResponseHeaderClassifier,
): void {
  const violation = classifyAppResponseHeaders(entries);
  if (violation === undefined) return;
  throw new ResponseHeaderChannelError(
    `${diagnosticDefinitions.KV415.message} ${violation.detail}`,
  );
}
