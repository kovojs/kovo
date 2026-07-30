import {
  agentIntegrityAllows,
  agentMinimumIntegrityForOperations,
  attenuateAgentIntegrity,
  isServerSecurityOperationKind,
  securityOperationDoorForKind,
  type ServerSecurityOperationFact,
} from '@kovojs/core/internal/security-operation-ir';

import {
  frameworkSessionPrincipalPostureFromRequest,
  principalPostureFromRequest,
  registerFrameworkSessionPrincipalSnapshot,
} from './auth-principal.js';
import { registerAppAgentDefinition, type BoundAgentSessionOptions } from './agent-app-bridge.js';
import { frameworkEgressFetch } from './egress.js';
import {
  isFrameworkManagedDbProvider,
  resolveLifecycleRequest,
  type AppDbProvider,
  type DbProvider,
  type SessionProvider,
} from './guards.js';
import type { ServerErrorHandler } from './diagnostics.js';
import { runAgentToolMutation } from './mutation.js';
import { isDeclaredMutationDefinition, type MutationDefinition } from './mutation/definition.js';
import type { Schema } from './schema.js';
import { snapshotPinnedDataTreeValue } from './request-carrier.js';
import {
  createWitnessMap,
  createWitnessSet,
  createWitnessWeakMap,
  witnessArrayAppend,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessMapGet,
  witnessMapSet,
  witnessObjectIs,
  witnessReflectApply,
  witnessRegExpTest,
  witnessSetAdd,
  witnessSetHas,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

declare const agentContentBrand: unique symbol;
declare const agentDefinitionBrand: unique symbol;
declare const agentSessionBrand: unique symbol;
declare const agentToolBrand: unique symbol;

type AnyMutationDefinition = MutationDefinition<
  string,
  Schema<unknown>,
  Record<string, Schema<unknown>>,
  any,
  unknown,
  any
>;

/** Closed integrity order carried by an agent session, from least to most trusted. */
export type AgentIntegrity = 'principal' | 'retrieved' | 'untrusted' | 'validated';

/** Content admitted to an agent turn with an explicit, finite integrity level (SPEC §6.6). */
export interface AgentContent<Value = unknown> {
  readonly [agentContentBrand]: 'kovo-agent-content';
  readonly integrity: AgentIntegrity;
  readonly value: Value;
}

/** A model-visible descriptor; it contains no executable mutation capability. */
export interface AgentToolDescriptor {
  readonly description: string;
  readonly name: string;
}

/** The only model decisions accepted by the mediation door. */
export type AgentModelDecision<Output = unknown> =
  | { readonly input: unknown; readonly kind: 'tool-call'; readonly tool: string }
  | { readonly kind: 'output'; readonly value: Output };

/** Finite model adapter context. `fetch` is the framework egress door, never ambient fetch. */
export interface AgentModelContext {
  readonly fetch: typeof globalThis.fetch;
  readonly integrity: AgentIntegrity;
  readonly tools: readonly AgentToolDescriptor[];
}

/** Public opaque declaration for one mutation-backed tool. */
export interface AgentToolDefinition<Name extends string = string> {
  readonly [agentToolBrand]: {
    readonly name: Name;
  };
  readonly name: Name;
}

/** Minimal typed mutation reference accepted by `tool()`; runtime requires the exact declaration. */
export interface AgentToolMutation {
  readonly key: string;
}

/** Tool declaration: a model can select this name, but only the exact mutation can execute. */
export interface AgentToolOptions {
  readonly description: string;
  readonly mutation: AgentToolMutation;
  /** Tool output can only introduce untrusted or retrieved content; it can never raise authority. */
  readonly resultIntegrity?: Extract<AgentIntegrity, 'retrieved' | 'untrusted'>;
}

/** Public opaque declaration for one capability-bounded agent. */
export interface AgentDefinition<Name extends string = string> {
  readonly [agentDefinitionBrand]: { readonly name: Name };
  readonly name: Name;
}

/** Inline finite model and the exact tools it may select. */
export interface AgentOptions<Output = unknown> {
  readonly model: (
    turn: AgentContent,
    context: AgentModelContext,
  ) => AgentModelDecision<Output> | Promise<AgentModelDecision<Output>>;
  readonly tools: readonly AgentToolDefinition[];
}

/** Options that pin a request principal before any model-selected effect can run. */
export interface CreateAgentSessionOptions<
  Request extends object,
  SessionValue = unknown,
  DbValue = unknown,
> {
  clientIp?: (request: Request) => string | undefined;
  db?: AppDbProvider<DbValue>;
  onError?: ServerErrorHandler;
  onSessionSetCookie?: (rawSetCookie: string) => void;
  request: Request;
  sessionProvider?: SessionProvider<Request, SessionValue>;
}

/** Public opaque mutable session; only runAgentTurn may attenuate its integrity. */
export interface AgentSession {
  readonly [agentSessionBrand]: 'kovo-agent-session';
  readonly agent: string;
}

/** Public projection of a successful mutation-backed tool execution. */
export interface AgentToolSuccess {
  readonly ok: true;
  readonly value: unknown;
}

/** Public projection of a failed mutation-backed tool execution. */
export interface AgentToolFailure {
  readonly error: { readonly code: string; readonly payload?: unknown };
  readonly ok: false;
  readonly retryAfter?: number;
  readonly status: number;
}

/** Public result projection; internal mutation bookkeeping is intentionally not exposed here. */
export type AgentToolOutcome = AgentToolFailure | AgentToolSuccess;

/** One mediated model output or mutation-backed tool result, with the retained integrity. */
export type AgentTurnResult =
  | {
      readonly integrity: AgentIntegrity;
      readonly kind: 'output';
      readonly offeredTools: readonly string[];
      readonly value: unknown;
    }
  | {
      readonly integrity: AgentIntegrity;
      readonly kind: 'tool-result';
      readonly offeredTools: readonly string[];
      readonly result: AgentToolOutcome;
      readonly tool: string;
    };

interface AgentToolRecord {
  readonly description: string;
  readonly mutation: AnyMutationDefinition;
  operations?: readonly ServerSecurityOperationFact[];
  readonly resultIntegrity: Extract<AgentIntegrity, 'retrieved' | 'untrusted'>;
}

interface AgentRecord {
  readonly model: AgentOptions['model'];
  modelOperations?: readonly ServerSecurityOperationFact[];
  readonly tools: readonly AgentToolDefinition[];
}

interface AgentSessionRecord {
  integrity: AgentIntegrity;
  running: boolean;
  readonly definition: AgentDefinition;
  readonly db: unknown;
  readonly clientIp: unknown;
  readonly onError: ServerErrorHandler | undefined;
  readonly request: object;
}

interface AgentContentRecord {
  readonly integrity: AgentIntegrity;
  readonly value: unknown;
}

const toolRecords = createWitnessWeakMap<object, AgentToolRecord>();
const agentRecords = createWitnessWeakMap<object, AgentRecord>();
const sessionRecords = createWitnessWeakMap<object, AgentSessionRecord>();
const contentRecords = createWitnessWeakMap<object, AgentContentRecord>();

/** Mark ordinary data with its admitted integrity. No content classifier is consulted. */
export function agentContent<Value>(value: Value, integrity: AgentIntegrity): AgentContent<Value> {
  assertAgentIntegrity(integrity);
  const snapshot = snapshotPinnedDataTreeValue(value, { label: 'Agent content' });
  const content = witnessFreeze({ integrity, value: snapshot }) as unknown as AgentContent<Value>;
  witnessWeakMapSet(contentRecords, content, { integrity, value: snapshot });
  return content;
}

/** Declare an exact mutation-backed tool; compiler lowering installs its finite operation witness. */
export function tool<const Name extends string>(
  name: Name,
  options: AgentToolOptions,
): AgentToolDefinition<Name> {
  if (!isAgentName(name)) throw new TypeError('tool() requires a stable 1..128 character token.');
  const description = ownData(options, 'description', 'tool description');
  const mutation = ownData(options, 'mutation', 'tool mutation');
  const resultIntegrity = optionalData(options, 'resultIntegrity') ?? 'untrusted';
  if (typeof description !== 'string' || description.length === 0) {
    throw new TypeError('tool() requires a non-empty description.');
  }
  if (!isDeclaredMutationDefinition(mutation)) {
    throw new TypeError('tool() requires an exact framework mutation() declaration.');
  }
  if (resultIntegrity !== 'untrusted' && resultIntegrity !== 'retrieved') {
    throw new TypeError('tool() resultIntegrity must be untrusted or retrieved.');
  }
  const declaration = witnessFreeze({ name }) as unknown as AgentToolDefinition<Name>;
  witnessWeakMapSet(toolRecords, declaration, {
    description,
    mutation: mutation as AnyMutationDefinition,
    resultIntegrity,
  });
  return declaration;
}

/** Declare an inline model adapter and exact tool set; compiler lowering witnesses its model IR. */
export function agent<const Name extends string>(
  name: Name,
  options: AgentOptions,
): AgentDefinition<Name> {
  if (!isAgentName(name)) throw new TypeError('agent() requires a stable 1..128 character token.');
  const model = ownData(options, 'model', 'agent model');
  const tools = ownData(options, 'tools', 'agent tools');
  if (typeof model !== 'function')
    throw new TypeError('agent() requires an inline model function.');
  if (!witnessIsArray(tools)) throw new TypeError('agent() tools must be a dense literal array.');
  const snapshot: AgentToolDefinition[] = [];
  const names = createWitnessSet<string>();
  for (let index = 0; index < tools.length; index += 1) {
    const candidate = ownArrayEntry(tools, index, 'agent tools');
    if (!isObject(candidate) || witnessWeakMapGet(toolRecords, candidate) === undefined) {
      throw new TypeError(`agent() tools[${index}] is not an exact tool() declaration.`);
    }
    const toolName = (candidate as AgentToolDefinition).name;
    if (witnessSetHas(names, toolName)) throw new TypeError(`agent() duplicates tool ${toolName}.`);
    witnessSetAdd(names, toolName);
    witnessArrayAppend(snapshot, candidate as AgentToolDefinition, 'Agent tool snapshot');
  }
  witnessFreeze(snapshot);
  const declaration = witnessFreeze({ name }) as unknown as AgentDefinition<Name>;
  witnessWeakMapSet(agentRecords, declaration, {
    model: model as AgentOptions['model'],
    tools: snapshot,
  });
  registerAppAgentDefinition(declaration, (sessionOptions) =>
    createAppAgentSession(declaration, sessionOptions),
  );
  return declaration;
}

/** @internal Install the compiler-derived terminal operation closure on one exact tool. */
export function assignDerivedAgentToolOperations<Definition extends AgentToolDefinition>(
  definition: Definition,
  operations: readonly ServerSecurityOperationFact[],
): Definition {
  const record = witnessWeakMapGet(toolRecords, definition);
  if (record === undefined) throw new TypeError('Agent tool operation witness requires tool().');
  if (record.operations !== undefined) {
    throw new TypeError(`Agent tool ${definition.name} already has a derived operation witness.`);
  }
  record.operations = snapshotTerminalOperations(operations, `tool ${definition.name}`);
  return definition;
}

/** @internal Install the compiler-derived model operation closure on one exact agent. */
export function assignDerivedAgentModelOperations<Definition extends AgentDefinition>(
  definition: Definition,
  operations: readonly ServerSecurityOperationFact[],
): Definition {
  const record = witnessWeakMapGet(agentRecords, definition);
  if (record === undefined) throw new TypeError('Agent model operation witness requires agent().');
  if (record.modelOperations !== undefined) {
    throw new TypeError(`Agent ${definition.name} already has a derived model operation witness.`);
  }
  const snapshot = snapshotTerminalOperations(operations, `agent ${definition.name}`);
  for (let index = 0; index < snapshot.length; index += 1) {
    if (snapshot[index]!.kind !== 'server.egress.request') {
      throw new TypeError(
        `Agent ${definition.name} model effect ${snapshot[index]!.kind} must use a mutation-backed tool.`,
      );
    }
  }
  record.modelOperations = snapshot;
  return definition;
}

/** Pin the invoking request/session. Ambient structural principals are rejected fail closed. */
export async function createAgentSession<
  Request extends object,
  SessionValue = unknown,
  DbValue = unknown,
>(
  definition: AgentDefinition,
  options: CreateAgentSessionOptions<Request, SessionValue, DbValue>,
): Promise<AgentSession> {
  const request = ownData(options, 'request', 'agent request');
  if (!isObject(request)) throw new TypeError('createAgentSession() request must be an object.');
  if (witnessGetOwnPropertyDescriptor(options, 'principalPosture') !== undefined) {
    throw new TypeError('Agent sessions cannot accept an ambient service principal.');
  }
  const sessionProvider = optionalFunctionData(options, 'sessionProvider');
  const db = optionalData(options, 'db');
  if (db !== undefined && !isFrameworkManagedDbProvider(db)) {
    throw new TypeError('Agent sessions require an exact framework-managed DB provider token.');
  }
  const clientIp = optionalFunctionData(options, 'clientIp') as
    | ((request: Request) => string | undefined)
    | undefined;
  const onSessionSetCookie = optionalFunctionData(options, 'onSessionSetCookie') as
    | ((rawSetCookie: string) => void)
    | undefined;
  const onError = optionalFunctionData(options, 'onError') as ServerErrorHandler | undefined;
  return createResolvedAgentSession<Request, SessionValue, DbValue, Record<never, never>>(
    definition,
    {
      ...(clientIp === undefined ? {} : { clientIp }),
      ...(db === undefined
        ? {}
        : { db: db as unknown as DbProvider<Request, DbValue, SessionValue> }),
      ...(onError === undefined ? {} : { onError }),
      ...(onSessionSetCookie === undefined ? {} : { onSessionSetCookie }),
      request: request as Request,
      ...(sessionProvider === undefined
        ? {}
        : { sessionProvider: sessionProvider as SessionProvider<Request, SessionValue> }),
    },
  );
}

/**
 * Bind an exact advanced agent declaration to the providers already validated by one assembled
 * app contract. This remains internal so the task capability family stays on `/agent`; ordinary
 * app code reaches it only through `app.agent(declaration)` (SPEC §6.2.1/§6.6).
 *
 * @internal
 */
async function createAppAgentSession<
  Request extends object,
  SessionValue,
  DbValue,
  EnvValue extends Record<string, unknown>,
>(
  definition: AgentDefinition,
  options: BoundAgentSessionOptions<Request, SessionValue, DbValue, EnvValue>,
): Promise<AgentSession> {
  const request = ownData(options, 'request', 'app agent request');
  if (!isObject(request)) throw new TypeError('app agent session request must be an object.');
  const clientIp = optionalFunctionData(options, 'clientIp') as
    | ((request: Request) => string | undefined)
    | undefined;
  const db = optionalData(options, 'db') as DbProvider<Request, DbValue, SessionValue> | undefined;
  const env = ownData(options, 'env', 'app agent environment') as Readonly<EnvValue>;
  const onError = optionalFunctionData(options, 'onError') as ServerErrorHandler | undefined;
  const onSessionSetCookie = optionalFunctionData(options, 'onSessionSetCookie') as
    | ((rawSetCookie: string) => void)
    | undefined;
  const sessionProvider = optionalFunctionData(options, 'sessionProvider') as
    | SessionProvider<Request, SessionValue>
    | undefined;
  return createResolvedAgentSession(definition, {
    ...(clientIp === undefined ? {} : { clientIp }),
    ...(db === undefined ? {} : { db }),
    env,
    ...(onError === undefined ? {} : { onError }),
    ...(onSessionSetCookie === undefined ? {} : { onSessionSetCookie }),
    request: request as Request,
    ...(sessionProvider === undefined ? {} : { sessionProvider }),
  });
}

async function createResolvedAgentSession<
  Request extends object,
  SessionValue,
  DbValue,
  EnvValue extends Record<string, unknown>,
>(
  definition: AgentDefinition,
  options: BoundAgentSessionOptions<Request, SessionValue, DbValue, EnvValue>,
): Promise<AgentSession> {
  const record = witnessWeakMapGet(agentRecords, definition);
  if (record?.modelOperations === undefined) {
    throw new TypeError('Agent session requires compiler-derived model operation evidence.');
  }
  for (let index = 0; index < record.tools.length; index += 1) {
    const toolRecord = witnessWeakMapGet(toolRecords, record.tools[index]!);
    if (toolRecord?.operations === undefined) {
      throw new TypeError(
        `Agent tool ${record.tools[index]!.name} lacks compiler-derived effects.`,
      );
    }
  }

  const request = options.request;
  const sessionProvider = options.sessionProvider;
  const clientIp = options.clientIp;
  const onSessionSetCookie = options.onSessionSetCookie;
  const lifecycleRequest = await resolveLifecycleRequest<Request, SessionValue, never, EnvValue>(
    request,
    {
      ...(sessionProvider === undefined ? {} : { sessionProvider }),
      ...(clientIp === undefined ? {} : { clientIp }),
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(onSessionSetCookie === undefined ? {} : { onSessionSetCookie }),
    },
  );
  let principal = frameworkSessionPrincipalPostureFromRequest(lifecycleRequest);
  if (principal === undefined) {
    if (principalPostureFromRequest(lifecycleRequest).kind !== 'anonymous') {
      throw new TypeError(
        'Agent invocation authority must come from a framework session provider, not a structural principal.',
      );
    }
    registerFrameworkSessionPrincipalSnapshot(lifecycleRequest as object, null);
    principal = { kind: 'anonymous' };
  }
  if (principal.kind === 'unresolved') {
    throw new TypeError('Agent invocation principal is unresolved.');
  }

  const session = witnessFreeze({ agent: definition.name }) as unknown as AgentSession;
  witnessWeakMapSet(sessionRecords, session, {
    clientIp,
    db: options.db,
    definition,
    integrity: 'principal',
    running: false,
    onError: options.onError,
    request: lifecycleRequest as object,
  });
  return session;
}

/** Run one model decision and, at most, one witnessed mutation effect. */
export async function runAgentTurn(
  session: AgentSession,
  content: AgentContent | readonly AgentContent[],
): Promise<AgentTurnResult> {
  const sessionRecord = witnessWeakMapGet(sessionRecords, session);
  if (sessionRecord === undefined) throw new TypeError('runAgentTurn() requires an AgentSession.');
  if (sessionRecord.running) {
    throw new TypeError('AgentSession accepts only one in-flight turn.');
  }
  sessionRecord.running = true;
  try {
    return await runExclusiveAgentTurn(sessionRecord, content);
  } finally {
    sessionRecord.running = false;
  }
}

async function runExclusiveAgentTurn(
  sessionRecord: AgentSessionRecord,
  content: AgentContent | readonly AgentContent[],
): Promise<AgentTurnResult> {
  const incoming = snapshotAgentContent(content);
  sessionRecord.integrity = attenuateAgentIntegrity(sessionRecord.integrity, incoming.integrity);
  const agentRecord = witnessWeakMapGet(agentRecords, sessionRecord.definition)!;
  const offeredDefinitions: AgentToolDefinition[] = [];
  const descriptors: AgentToolDescriptor[] = [];
  const offeredNames: string[] = [];
  const offeredByName = createWitnessMap<string, AgentToolDefinition>();
  for (let index = 0; index < agentRecord.tools.length; index += 1) {
    const definition = agentRecord.tools[index]!;
    const toolRecord = witnessWeakMapGet(toolRecords, definition)!;
    const minimum = agentMinimumIntegrityForOperations(toolRecord.operations!);
    if (!agentIntegrityAllows(sessionRecord.integrity, minimum)) continue;
    witnessArrayAppend(offeredDefinitions, definition, 'Offered agent tools');
    witnessArrayAppend(
      descriptors,
      witnessFreeze({ description: toolRecord.description, name: definition.name }),
      'Agent tool descriptors',
    );
    witnessArrayAppend(offeredNames, definition.name, 'Offered agent tool names');
    witnessMapSet(offeredByName, definition.name, definition);
  }
  witnessFreeze(descriptors);
  witnessFreeze(offeredNames);
  const context = witnessDefineProperty(
    { integrity: sessionRecord.integrity, tools: descriptors },
    'fetch',
    { configurable: false, enumerable: true, value: frameworkEgressFetch, writable: false },
  ) as unknown as AgentModelContext;
  const decision = await witnessReflectApply<ReturnType<AgentOptions['model']>>(
    agentRecord.model,
    undefined,
    [incoming, witnessFreeze(context)],
  );
  const kind = isObject(decision) ? ownData(decision, 'kind', 'agent decision kind') : undefined;
  if (kind === 'output') {
    return witnessFreeze({
      integrity: sessionRecord.integrity,
      kind: 'output' as const,
      offeredTools: offeredNames,
      value: ownData(decision, 'value', 'agent output'),
    });
  }
  if (kind !== 'tool-call') throw new TypeError('Agent model returned an unsupported decision.');
  const toolName = ownData(decision, 'tool', 'agent selected tool');
  if (typeof toolName !== 'string') throw new TypeError('Agent tool decision requires a name.');
  const selected = witnessMapGet(offeredByName, toolName);
  if (selected === undefined) {
    throw new TypeError(
      `Agent tool ${toolName} is not available at integrity ${sessionRecord.integrity}.`,
    );
  }
  const toolRecord = witnessWeakMapGet(toolRecords, selected)!;
  const result = await runAgentToolMutation(
    toolRecord.mutation,
    ownData(decision, 'input', 'agent tool input'),
    sessionRecord.request,
    {
      ...(typeof sessionRecord.clientIp === 'function'
        ? { clientIp: sessionRecord.clientIp as (request: object) => string | undefined }
        : {}),
      ...(sessionRecord.db === undefined ? {} : { db: sessionRecord.db as never }),
      ...(sessionRecord.onError === undefined ? {} : { onError: sessionRecord.onError }),
    },
  );
  sessionRecord.integrity = attenuateAgentIntegrity(
    sessionRecord.integrity,
    toolRecord.resultIntegrity,
  );
  return witnessFreeze({
    integrity: sessionRecord.integrity,
    kind: 'tool-result' as const,
    offeredTools: offeredNames,
    result,
    tool: selected.name,
  });
}

function snapshotAgentContent(content: AgentContent | readonly AgentContent[]): AgentContent {
  const values = witnessIsArray(content) ? content : [content];
  if (values.length === 0) throw new TypeError('Agent turn requires at least one content value.');
  let integrity: AgentIntegrity = 'principal';
  const payload: unknown[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const item = ownArrayEntry(values, index, 'agent content');
    if (!isObject(item)) throw new TypeError(`Agent content[${index}] is not agentContent().`);
    const record = witnessWeakMapGet(contentRecords, item);
    if (record === undefined) {
      throw new TypeError(`Agent content[${index}] is not an exact agentContent() carrier.`);
    }
    integrity = attenuateAgentIntegrity(integrity, record.integrity);
    witnessArrayAppend(payload, record.value, 'Agent payload');
  }
  return agentContent(values.length === 1 ? payload[0] : witnessFreeze(payload), integrity);
}

function snapshotTerminalOperations(
  operations: readonly ServerSecurityOperationFact[],
  owner: string,
): readonly ServerSecurityOperationFact[] {
  if (!witnessIsArray(operations)) throw new TypeError(`${owner} operations must be an array.`);
  const result: ServerSecurityOperationFact[] = [];
  for (let index = 0; index < operations.length; index += 1) {
    const operation = ownArrayEntry(operations, index, `${owner} operations`);
    if (!isObject(operation)) throw new TypeError(`${owner} operation ${index} is invalid.`);
    const kind = ownData(operation, 'kind', `${owner} operation kind`);
    const door = ownData(operation, 'door', `${owner} operation door`);
    if (
      !isServerSecurityOperationKind(kind) ||
      door !== securityOperationDoorForKind(kind) ||
      kind === 'server.handler.root' ||
      kind === 'server.helper.call'
    ) {
      throw new TypeError(`${owner} operation ${index} is not a terminal finite operation.`);
    }
    const target = optionalData(operation, 'target');
    const justification = optionalData(operation, 'justification');
    witnessArrayAppend(
      result,
      witnessFreeze({
        door: securityOperationDoorForKind(kind),
        kind,
        ...(typeof target === 'string' ? { target } : {}),
        ...(typeof justification === 'string' ? { justification } : {}),
      }),
      `${owner} operation snapshot`,
    );
  }
  return witnessFreeze(result);
}

function assertAgentIntegrity(value: unknown): asserts value is AgentIntegrity {
  if (
    value !== 'untrusted' &&
    value !== 'retrieved' &&
    value !== 'validated' &&
    value !== 'principal'
  ) {
    throw new TypeError('Agent integrity must be untrusted, retrieved, validated, or principal.');
  }
}

function isAgentName(value: unknown): value is string {
  return (
    typeof value === 'string' && witnessRegExpTest(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u, value)
  );
}

function isObject(value: unknown): value is object {
  return (typeof value === 'object' || typeof value === 'function') && value !== null;
}

function ownArrayEntry(value: readonly unknown[], index: number, label: string): unknown {
  const descriptor = witnessGetOwnPropertyDescriptor(value, index);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new TypeError(`${label}[${index}] must be own data.`);
  }
  return descriptor.value;
}

function ownData(value: object, key: PropertyKey, label: string): unknown {
  const before = witnessGetOwnPropertyDescriptor(value, key);
  const after = witnessGetOwnPropertyDescriptor(value, key);
  if (
    before === undefined ||
    after === undefined ||
    !('value' in before) ||
    !('value' in after) ||
    !witnessObjectIs(before.value, after.value)
  ) {
    throw new TypeError(`${label} must be stable own data.`);
  }
  return before.value;
}

function optionalData(value: object, key: PropertyKey): unknown {
  const descriptor = witnessGetOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) throw new TypeError(`${String(key)} must be own data.`);
  return descriptor.value;
}

function optionalFunctionData(value: object, key: PropertyKey): Function | undefined {
  const candidate = optionalData(value, key);
  if (candidate === undefined) return undefined;
  if (typeof candidate !== 'function') throw new TypeError(`${String(key)} must be a function.`);
  return candidate;
}
