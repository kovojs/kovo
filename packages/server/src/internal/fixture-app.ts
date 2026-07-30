/**
 * @internal Framework-owned fixture bridge.
 *
 * Public application source uses `defineKovo()` and `app.assemble()`. Repository integration and
 * adversarial fixtures retain this narrow constructor entry while they migrate independently,
 * without evaluating the broader server testing facade or restoring `createApp` at the root
 * (SPEC §6.2.1/§9.5).
 */
import { createApp as createRuntimeApp } from '../app.js';
import {
  createKovoAppToken,
  resolveKovoAppToken,
  type KovoApp,
} from '../app-token.js';
import type {
  AppLifecycleRequest,
  CreateAppOptions,
  KovoApp as RuntimeKovoApp,
} from '../app-types.js';

/** @internal Construct an opaque token from the legacy fixture aggregate in one exact realm. */
export function createApp<
  SessionValue = never,
  DbValue = never,
  RawRequest extends globalThis.Request = globalThis.Request,
  AppRequest = AppLifecycleRequest<RawRequest, SessionValue, DbValue>,
  EnvValue extends Record<string, unknown> = Record<never, never>,
>(
  options: CreateAppOptions<SessionValue, DbValue, RawRequest, AppRequest, EnvValue> = {},
): KovoApp {
  return createKovoAppToken(
    createRuntimeApp<SessionValue, DbValue, RawRequest, AppRequest, EnvValue>(options),
  );
}

/** @internal Unwrap a fixture token before framework-owned DB derivation. */
export function resolveFixtureAppToken(app: KovoApp): RuntimeKovoApp {
  return resolveKovoAppToken(app, 'Kovo fixture app derivation');
}

/** @internal Close a framework-derived fixture aggregate behind the public opaque contract. */
export function createFixtureAppToken(app: RuntimeKovoApp): KovoApp {
  return createKovoAppToken(app);
}
