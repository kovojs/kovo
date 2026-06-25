/**
 * Agent-exposed server tool declarations (SPEC §6.6).
 *
 * This is a runtime/API substrate for capability-bounded tool adapters. It is a
 * fail-closed runtime floor at Kovo's invocation boundary, not prompt-injection
 * immunity and not a compiler proof.
 */

/** Named authority a tool is allowed to exercise. */
export type AgentToolAuthority =
  | {
      /** A capability token/key/scope supplied by the agent runtime, not ambient browser cookies. */
      capability: string;
      kind: 'capability';
      requirement: string;
    }
  | {
      /** A principal requirement the agent runtime must bind before invoking the tool. */
      kind: 'principal';
      principal: string;
      requirement: string;
    };

/** Named sink/capability a tool handler is allowed to touch. */
export interface AgentToolCapability {
  /** Human-readable capability name, e.g. `orders.write` or `email.send`. */
  name: string;
  /** Why this capability is needed for the tool's declared purpose. */
  reason: string;
}

/** Audit owner and review notes for an agent tool declaration. */
export interface AgentToolAuditMetadata {
  /** Human/team owner responsible for reviewing the tool's blast radius. */
  owner: string;
  /** Optional review note, ticket, or runbook reference. */
  review?: string;
  /** Optional source span for explain/audit output; defaults to `agent-tool:<name>`. */
  site?: string;
}

/** Ambient browser/session credential posture for an agent tool. */
export type AgentToolAmbientCredentials =
  | {
      /** Explicitly permit browser credential headers to reach the handler. */
      allow: true;
      /** Why broad ambient browser credentials are acceptable for this tool. */
      justification: string;
    }
  | {
      /** Default and recommended posture: reject ambient browser/session credentials. */
      allow?: false;
    };

/** Request shape passed to an agent tool only after the ambient-credential gate passes. */
export type AgentToolRequest = Request & { readonly session?: never };

/** Invocation context for an agent tool handler. */
export interface AgentToolInvocationContext<Context = unknown> {
  /** Capability/principal binding supplied by the agent runtime for this call. */
  authority: AgentToolAuthority;
  /** Optional framework-scrubbed request; never exposes the app `session` extension. */
  request?: AgentToolRequest;
  /** App-owned extra context, e.g. a DB handle or service client. */
  value: Context;
}

/** Definition accepted by {@link tool}. */
export interface AgentToolDefinition<Input, Output, Context = unknown> {
  /** Ambient browser/session credential posture. Omit to fail closed. */
  ambientCredentials?: AgentToolAmbientCredentials;
  /** Review metadata surfaced by audit/explain tooling. */
  audit: AgentToolAuditMetadata;
  /** Capabilities/sinks this tool may use. Empty lists are rejected. */
  capabilities: readonly AgentToolCapability[];
  /** Handler invoked after Kovo validates authority and ambient credential posture. */
  handler(input: Input, context: AgentToolInvocationContext<Context>): Output | Promise<Output>;
  /** Stable tool name exposed to the agent runtime. */
  name: string;
  /** Human purpose surfaced by audit/explain tooling. */
  purpose: string;
  /** Principal/capability authority accepted by this tool. Empty lists are rejected. */
  authority: readonly AgentToolAuthority[];
}

/** First-class agent tool declaration returned by {@link tool}. */
export interface AgentToolDeclaration<
  Input = unknown,
  Output = unknown,
  Context = unknown,
> extends AgentToolDefinition<Input, Output, Context> {
  ambientCredentials: AgentToolAmbientCredentials;
}

/** Audit fact suitable for `kovo explain --capabilities` rendering. */
export interface AgentToolAuditFact {
  readonly ambientBrowserCredentials: 'allowed' | 'rejected';
  readonly ambientJustification?: string;
  readonly authority: readonly string[];
  readonly declaredCapabilities: readonly string[];
  readonly kind: 'agentTool';
  readonly name: string;
  readonly owner: string;
  readonly purpose: string;
  readonly site: string;
  readonly target: string;
}

/** Error thrown when an agent tool declaration or invocation violates the fail-closed boundary. */
export class AgentToolCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentToolCapabilityError';
  }
}

/**
 * Declare an agent-exposed server tool with explicit purpose, authority, allowed capabilities,
 * audit owner, and ambient-credential posture.
 */
export function tool<const Input, Output, Context = unknown>(
  definition: AgentToolDefinition<Input, Output, Context>,
): AgentToolDeclaration<Input, Output, Context> {
  assertNonEmpty(definition.name, 'tool.name');
  assertNonEmpty(definition.purpose, 'tool.purpose');
  assertNonEmpty(definition.audit?.owner, 'tool.audit.owner');
  if (definition.audit?.site !== undefined)
    assertNonEmpty(definition.audit.site, 'tool.audit.site');
  assertAuthority(definition.authority);
  assertCapabilities(definition.capabilities);
  assertAmbientCredentials(definition.ambientCredentials);

  return {
    ...definition,
    ambientCredentials: definition.ambientCredentials ?? { allow: false },
  };
}

/**
 * Invoke a declared tool through Kovo's runtime boundary. The boundary rejects missing
 * authority bindings and rejects ambient browser/session credentials unless the declaration
 * explicitly opted into them with a justification.
 */
export async function runAgentTool<Input, Output, Context = unknown>(
  declaration: AgentToolDeclaration<Input, Output, Context>,
  input: Input,
  context: {
    authority: AgentToolAuthority;
    request?: Request;
    value: Context;
  },
): Promise<Output> {
  assertAuthorityAllowed(declaration, context.authority);
  if (context.request !== undefined) {
    assertNoAmbientCredentials(declaration, context.request);
  }

  return declaration.handler(input, {
    authority: context.authority,
    ...(context.request === undefined ? {} : { request: requestWithoutSession(context.request) }),
    value: context.value,
  });
}

/** Produce audit facts for declared agent tools. */
export function agentToolAuditFacts(
  tools: readonly AgentToolDeclaration<unknown, unknown, unknown>[],
): readonly AgentToolAuditFact[] {
  return tools.map((declaration) => {
    const ambient = declaration.ambientCredentials;
    return {
      ambientBrowserCredentials: ambient.allow === true ? 'allowed' : 'rejected',
      ...(ambient.allow === true ? { ambientJustification: ambient.justification } : {}),
      authority: declaration.authority.map(describeAuthority),
      declaredCapabilities: declaration.capabilities.map((capability) => capability.name),
      kind: 'agentTool',
      name: declaration.name,
      owner: declaration.audit.owner,
      purpose: declaration.purpose,
      site: declaration.audit.site ?? `agent-tool:${declaration.name}`,
      target: declaration.name,
    };
  });
}

function assertAuthorityAllowed(
  declaration: AgentToolDeclaration<unknown, unknown, unknown>,
  authority: AgentToolAuthority,
): void {
  const requested = describeAuthority(authority);
  if (!declaration.authority.some((allowed) => describeAuthority(allowed) === requested)) {
    throw new AgentToolCapabilityError(
      `Agent tool "${declaration.name}" cannot run with undeclared authority "${requested}".`,
    );
  }
}

function assertNoAmbientCredentials(
  declaration: AgentToolDeclaration<unknown, unknown, unknown>,
  request: Request,
): void {
  if (declaration.ambientCredentials.allow === true) return;

  if (
    request.headers.has('cookie') ||
    request.headers.has('authorization') ||
    'session' in request
  ) {
    throw new AgentToolCapabilityError(
      `Agent tool "${declaration.name}" rejects ambient browser/session credentials by default.`,
    );
  }
}

function requestWithoutSession(request: Request): AgentToolRequest {
  if (!('session' in request)) return request as AgentToolRequest;

  return new Proxy(request, {
    get(target, property) {
      if (property === 'session') return undefined;

      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
    has(target, property) {
      if (property === 'session') return false;
      return property in target;
    },
  }) as AgentToolRequest;
}

function assertAuthority(authority: readonly AgentToolAuthority[] | undefined): void {
  if (authority === undefined || authority.length === 0) {
    throw new AgentToolCapabilityError('tool.authority must declare at least one authority.');
  }

  for (const entry of authority) {
    assertNonEmpty(entry.requirement, 'tool.authority[].requirement');
    if (entry.kind === 'principal') {
      assertNonEmpty(entry.principal, 'tool.authority[].principal');
    } else {
      assertNonEmpty(entry.capability, 'tool.authority[].capability');
    }
  }
}

function assertCapabilities(capabilities: readonly AgentToolCapability[] | undefined): void {
  if (capabilities === undefined || capabilities.length === 0) {
    throw new AgentToolCapabilityError('tool.capabilities must declare at least one capability.');
  }

  for (const capability of capabilities) {
    assertNonEmpty(capability.name, 'tool.capabilities[].name');
    assertNonEmpty(capability.reason, 'tool.capabilities[].reason');
  }
}

function assertAmbientCredentials(ambient: AgentToolAmbientCredentials | undefined): void {
  if (ambient?.allow === true) {
    assertNonEmpty(ambient.justification, 'tool.ambientCredentials.justification');
  }
}

function assertNonEmpty(value: string | undefined, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AgentToolCapabilityError(`${field} must be a non-empty string.`);
  }
}

function describeAuthority(authority: AgentToolAuthority): string {
  return authority.kind === 'principal'
    ? `principal:${authority.principal}`
    : `capability:${authority.capability}`;
}
