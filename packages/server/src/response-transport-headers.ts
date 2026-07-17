import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

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

/** One stable response-header field observed before an HTTP adapter owns wire framing. */
export interface TransportResponseHeaderEntry {
  readonly name: string;
  readonly value: string;
}

export interface TransportResponseHeaderViolation {
  readonly detail: string;
  readonly headerName: string;
  readonly kind: 'hop-by-hop' | 'message-framing';
}

interface TransportResponseHeaderClassifierControls {
  lowerCase(value: string): string;
}

export type TransportResponseHeaderClassifier = (
  entries: readonly TransportResponseHeaderEntry[],
) => TransportResponseHeaderViolation | undefined;

/**
 * Build the single response transport-header classifier used by source and generated runtimes.
 *
 * The generated Node/Vercel adapters embed this reviewed function body through the build source
 * serializer. Keeping the verdict function here prevents the live and emitted transports from
 * growing independent framing allowlists (SPEC §9.1.1 / §9.5; KV415).
 *
 * @internal
 */
export function createTransportResponseHeaderClassifier(
  controls: TransportResponseHeaderClassifierControls,
): TransportResponseHeaderClassifier {
  function transportOwnedKind(name: string): 'hop-by-hop' | 'message-framing' | undefined {
    switch (name) {
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
      const kind = transportOwnedKind(normalizedName);
      if (kind === undefined) continue;
      return {
        detail:
          `Response header "${entry.name}" is ${
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
  readonly code = 'KV415' as const;

  constructor(message: string) {
    super(`KV415 ${message}`);
    this.name = 'ResponseHeaderChannelError';
  }
}

/** @internal Reject app-authored message-framing and hop-by-hop response metadata. */
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
