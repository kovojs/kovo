import type { SessionProvider } from './guards.js';

export type SessionProviderBoundary = 'default-owned' | 'delegated' | 'owned';

const NORMALIZED_SESSION_PROVIDER = Symbol.for('kovo.normalizedSessionProvider');

export type NormalizedSessionProvider<RawRequest, SessionValue> = SessionProvider<
  RawRequest,
  SessionValue
> & {
  readonly [NORMALIZED_SESSION_PROVIDER]: SessionProviderBoundary;
};

export function markNormalizedSessionProvider<RawRequest, SessionValue>(
  provider: SessionProvider<RawRequest, SessionValue>,
  boundary: SessionProviderBoundary,
): NormalizedSessionProvider<RawRequest, SessionValue> {
  Object.defineProperty(provider, NORMALIZED_SESSION_PROVIDER, {
    configurable: true,
    enumerable: false,
    value: boundary,
  });
  return provider as NormalizedSessionProvider<RawRequest, SessionValue>;
}

export function sessionProviderBoundary(value: unknown): SessionProviderBoundary | undefined {
  if (typeof value !== 'function') return undefined;
  const boundary = (value as { [NORMALIZED_SESSION_PROVIDER]?: unknown })[
    NORMALIZED_SESSION_PROVIDER
  ];
  return isSessionProviderBoundary(boundary) ? boundary : undefined;
}

export function isNormalizedSessionProvider(
  value: unknown,
): value is NormalizedSessionProvider<unknown, unknown> {
  return sessionProviderBoundary(value) !== undefined;
}

export function assertNormalizedSessionProvider(value: unknown): void {
  if (isNormalizedSessionProvider(value)) return;
  throw new Error(
    'Request lifecycle sessionProvider must come from createApp() normalized session ownership ' +
      'or an explicit framework-owned boundary marker (SPEC §6.5 / OPP-11). Plain session ' +
      'provider functions cannot be passed directly to lower-level request shell helpers.',
  );
}

function isSessionProviderBoundary(value: unknown): value is SessionProviderBoundary {
  return value === 'default-owned' || value === 'delegated' || value === 'owned';
}
