import type { AgentSession } from './agent.js';
import type { ServerErrorHandler } from './diagnostics.js';
import type { DbProvider, SessionProvider } from './guards.js';
import {
  createWitnessWeakMap,
  witnessReflectApply,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

/**
 * Provider set inherited by an advanced agent adopted through one assembled app contract.
 *
 * This type-only contract deliberately lives in the minimal bridge module. The ordinary server
 * root can therefore recognize and invoke an exact registered declaration without statically
 * importing the `/agent` capability implementation (SPEC §6.2.1/§6.6).
 *
 * @internal
 */
export interface BoundAgentSessionOptions<
  Request extends object,
  SessionValue,
  DbValue,
  EnvValue extends Record<string, unknown>,
> {
  readonly clientIp?: (request: Request) => string | undefined;
  readonly db?: DbProvider<Request, DbValue, SessionValue>;
  readonly env?: Readonly<EnvValue>;
  readonly onError?: ServerErrorHandler;
  readonly onSessionSetCookie?: (rawSetCookie: string) => void;
  readonly request: Request;
  readonly sessionProvider?: SessionProvider<Request, SessionValue>;
}

interface RegisteredAgentSessionFactory {
  <Request extends object, SessionValue, DbValue, EnvValue extends Record<string, unknown>>(
    options: BoundAgentSessionOptions<Request, SessionValue, DbValue, EnvValue>,
  ): Promise<AgentSession>;
}

const registeredAgentSessions = createWitnessWeakMap<object, RegisteredAgentSessionFactory>();

/** @internal Register the exact declaration and session closure minted by the `/agent` subpath. */
export function registerAppAgentDefinition(
  definition: object,
  createSession: RegisteredAgentSessionFactory,
): void {
  if (witnessWeakMapGet(registeredAgentSessions, definition) !== undefined) {
    throw new TypeError('Agent declaration is already registered with the app bridge.');
  }
  witnessWeakMapSet(registeredAgentSessions, definition, createSession);
}

/** @internal Exact-identity check used by the ordinary app-contract surface. */
export function isRegisteredAppAgentDefinition(value: unknown): value is object {
  return isObject(value) && witnessWeakMapGet(registeredAgentSessions, value) !== undefined;
}

/** @internal Invoke only the session closure registered by the exact `/agent` declaration. */
export function createRegisteredAppAgentSession<
  Request extends object,
  SessionValue,
  DbValue,
  EnvValue extends Record<string, unknown>,
>(
  definition: object,
  options: BoundAgentSessionOptions<Request, SessionValue, DbValue, EnvValue>,
): Promise<AgentSession> {
  const createSession = witnessWeakMapGet(registeredAgentSessions, definition);
  if (createSession === undefined) {
    throw new TypeError('App agent session requires an exact registered agent() declaration.');
  }
  return witnessReflectApply<Promise<AgentSession>>(createSession, undefined, [options]);
}

function isObject(value: unknown): value is object {
  return (typeof value === 'object' || typeof value === 'function') && value !== null;
}
