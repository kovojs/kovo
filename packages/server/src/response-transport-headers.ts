import {
  createRegisteredDiagnostic,
  diagnosticDefinitions,
} from '@kovojs/core/internal/diagnostics';

/** @internal Exact app-forbidden response names owned by HTTP transport adapters. */
export type TransportOwnedResponseHeaderName =
  | 'connection'
  | 'content-length'
  | 'http2-settings'
  | 'keep-alive'
  | 'proxy-authenticate'
  | 'proxy-authorization'
  | 'proxy-connection'
  | 'te'
  | 'trailer'
  | 'transfer-encoding'
  | 'upgrade';

/** Browser navigation metadata that app response channels may never emit. */
export type BrowserNavigationResponseHeaderName = 'refresh';

/** One stable response-header field observed before an HTTP adapter owns wire framing. */
export interface TransportResponseHeaderEntry {
  readonly name: string;
  readonly value: string;
}

export interface TransportResponseHeaderViolation {
  readonly detail: string;
  readonly headerName: string;
  readonly kind: 'browser-navigation' | 'hop-by-hop' | 'message-framing';
}

interface TransportResponseHeaderClassifierControls {
  lowerCase(value: string): string;
}

export type TransportResponseHeaderClassifier = (
  entries: readonly TransportResponseHeaderEntry[],
) => TransportResponseHeaderViolation | undefined;

/**
 * Build the single forbidden response-header classifier used by source and generated runtimes.
 *
 * The generated Node/Vercel/Cloudflare adapters embed this reviewed function body through the
 * build source serializer. Keeping the verdict function here prevents live and emitted response
 * paths from growing independent framing or browser-navigation deny sets (SPEC §9.1.1 / §9.5;
 * KV415).
 *
 * @internal
 */
export function createTransportResponseHeaderClassifier(
  controls: TransportResponseHeaderClassifierControls,
): TransportResponseHeaderClassifier {
  function forbiddenResponseHeaderKind(
    name: string,
  ): 'browser-navigation' | 'hop-by-hop' | 'message-framing' | undefined {
    switch (name) {
      case 'refresh':
        return 'browser-navigation';
      case 'content-length':
      case 'transfer-encoding':
        return 'message-framing';
      case 'connection':
      case 'http2-settings':
      case 'keep-alive':
      case 'proxy-authenticate':
      case 'proxy-authorization':
      case 'proxy-connection':
      case 'te':
      case 'trailer':
      case 'upgrade':
        return 'hop-by-hop';
      default:
        return undefined;
    }
  }

  return function classifyTransportResponseHeaders(
    entries: readonly TransportResponseHeaderEntry[],
  ): TransportResponseHeaderViolation | undefined {
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const entry = entries[entryIndex]!;
      const normalizedName = controls.lowerCase(entry.name);
      const kind = forbiddenResponseHeaderKind(normalizedName);
      if (kind === undefined) continue;
      return {
        detail:
          kind === 'browser-navigation'
            ? `Response header "${entry.name}" triggers browser navigation outside Kovo's typed Location redirect posture; application response channels cannot supply it.`
            : `Response header "${entry.name}" is ${
                kind === 'message-framing' ? 'message-framing' : 'hop-by-hop'
              } metadata owned by the HTTP adapter; ` +
              (normalizedName === 'connection'
                ? 'the field and every header it nominates are rejected before adapter mutation.'
                : 'application response channels cannot supply it.'),
        headerName: entry.name,
        kind,
      };
    }

    return undefined;
  };
}

/** KV415 runtime error for a response-header channel that cannot safely reach an adapter. */
export class ResponseHeaderChannelError extends Error {
  readonly code: 'KV415';

  constructor(message: string) {
    const diagnostic = createRegisteredDiagnostic('KV415', {}, { message });
    super(`${diagnostic.code} ${diagnostic.message}`);
    this.code = diagnostic.code;
    this.name = 'ResponseHeaderChannelError';
  }
}

/** @internal Reject app-authored browser navigation, message-framing, and hop-by-hop metadata. */
export function assertSafeTransportResponseHeaders(
  entries: readonly TransportResponseHeaderEntry[],
  classifyTransportResponseHeaders: TransportResponseHeaderClassifier,
): void {
  const violation = classifyTransportResponseHeaders(entries);
  if (violation === undefined) return;
  throw new ResponseHeaderChannelError(
    `${diagnosticDefinitions.KV415.message} ${violation.detail}`,
  );
}
