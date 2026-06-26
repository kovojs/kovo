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

/** Reachable sink/capability row declared at the framework-owned tool boundary. */
export interface AgentToolReachableSink {
  /** Capability needed to exercise this sink, e.g. `email.send` or `secrets.read`. */
  capability: string;
  /** Why the handler body can reach this sink. Kept audit-grade, not proof. */
  evidence: string;
  /** Sink family reached by the handler body. */
  kind: 'egress' | 'mutation' | 'secret-read' | 'write';
  /** Optional source span for this sink; defaults to the tool audit site. */
  site?: string;
  /** Sink target, e.g. `smtp`, `stripe`, `env.STRIPE_SECRET_KEY`, or a write domain. */
  target: string;
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

/** Ambient credential carrier classes a reviewed agent tool may accept at invocation time. */
export type AgentToolAmbientCredentialKind =
  | 'auth-proxy'
  | 'authorization'
  | 'cookie'
  | 'proxy-authorization'
  | 'session';

/** Structured review record for the rare case where an agent tool accepts ambient credentials. */
export interface AgentToolAmbientCredentialJustification {
  /** Why this tool cannot be expressed through explicit agent authority alone. */
  reason: string;
  /** How the ambient browser/session authority is constrained to the intended end user. */
  authorityBoundary: string;
}

/** Ambient browser/session credential posture for an agent tool. */
export type AgentToolAmbientCredentials =
  | {
      /** Explicitly permit reviewed ambient browser/session credentials at the invocation boundary. */
      allow: true;
      /** Exact ambient credential classes this tool may receive. */
      credentialKinds: readonly AgentToolAmbientCredentialKind[];
      /** Structured review rationale for this confused-deputy exception. */
      justification: AgentToolAmbientCredentialJustification;
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
  /**
   * Handler-body sinks the author or a static analyzer can identify at the tool boundary.
   * Rows emitted by this public API are audit-grade only; sound enforcement comes from
   * compiler/graph analyzer rows that can prove reachability.
   */
  reachableSinks?: readonly AgentToolReachableSink[];
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
  readonly ambientCredentialKinds?: readonly AgentToolAmbientCredentialKind[];
  readonly ambientJustification?: AgentToolAmbientCredentialJustification;
  readonly authority: readonly string[];
  readonly declaredCapabilities: readonly string[];
  readonly kind: 'agentTool';
  readonly name: string;
  readonly owner: string;
  readonly purpose: string;
  readonly reachableSinks?: readonly AgentToolReachableSinkAuditFact[];
  readonly site: string;
  readonly target: string;
}

/** Audit-grade reachable sink fact emitted for `kovo explain --capabilities`. */
export interface AgentToolReachableSinkAuditFact {
  readonly capability: string;
  readonly evidence?: string;
  readonly grade: 'audit';
  readonly kind: AgentToolReachableSink['kind'];
  readonly site: string;
  readonly target: string;
  readonly tool: string;
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
  assertReachableSinks(definition.reachableSinks);

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
  const request =
    context.request === undefined
      ? undefined
      : normalizeAgentToolRequest(declaration, context.request);

  return declaration.handler(input, {
    authority: context.authority,
    ...(request === undefined ? {} : { request }),
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
      ...(ambient.allow === true
        ? {
            ambientCredentialKinds: [...ambient.credentialKinds],
            ambientJustification: ambient.justification,
          }
        : {}),
      authority: declaration.authority.map(describeAuthority),
      declaredCapabilities: declaration.capabilities.map((capability) => capability.name),
      kind: 'agentTool',
      name: declaration.name,
      owner: declaration.audit.owner,
      purpose: declaration.purpose,
      ...(declaration.reachableSinks === undefined || declaration.reachableSinks.length === 0
        ? {}
        : {
            reachableSinks: declaration.reachableSinks.map((sink) =>
              reachableSinkAuditFact(declaration, sink),
            ),
          }),
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

type AmbientCredentialHeader = {
  readonly header: string;
  readonly kind: AgentToolAmbientCredentialKind;
};

type AmbientCredentialFinding = {
  readonly kind: AgentToolAmbientCredentialKind;
  readonly source: string;
};

const ambientCredentialHeaders = [
  { header: 'authorization', kind: 'authorization' },
  { header: 'cookie', kind: 'cookie' },
  { header: 'cf-access-authenticated-user-email', kind: 'auth-proxy' },
  { header: 'cf-access-jwt-assertion', kind: 'auth-proxy' },
  { header: 'proxy-authorization', kind: 'proxy-authorization' },
  { header: 'x-amzn-oidc-accesstoken', kind: 'auth-proxy' },
  { header: 'x-amzn-oidc-data', kind: 'auth-proxy' },
  { header: 'x-amzn-oidc-identity', kind: 'auth-proxy' },
  { header: 'x-auth-request-access-token', kind: 'auth-proxy' },
  { header: 'x-auth-request-email', kind: 'auth-proxy' },
  { header: 'x-auth-request-user', kind: 'auth-proxy' },
  { header: 'x-forwarded-access-token', kind: 'auth-proxy' },
  { header: 'x-forwarded-authorization', kind: 'authorization' },
  { header: 'x-goog-authenticated-user-email', kind: 'auth-proxy' },
  { header: 'x-goog-authenticated-user-id', kind: 'auth-proxy' },
  { header: 'x-ms-client-principal', kind: 'auth-proxy' },
  { header: 'x-ms-client-principal-id', kind: 'auth-proxy' },
  { header: 'x-ms-client-principal-name', kind: 'auth-proxy' },
] as const satisfies readonly AmbientCredentialHeader[];

const ambientCredentialKinds = [
  'auth-proxy',
  'authorization',
  'cookie',
  'proxy-authorization',
  'session',
] as const satisfies readonly AgentToolAmbientCredentialKind[];

function normalizeAgentToolRequest(
  declaration: AgentToolDeclaration<unknown, unknown, unknown>,
  request: Request,
): AgentToolRequest {
  const findings = ambientCredentialFindings(request);
  const allowedKinds =
    declaration.ambientCredentials.allow === true
      ? new Set(declaration.ambientCredentials.credentialKinds)
      : new Set<AgentToolAmbientCredentialKind>();

  if (declaration.ambientCredentials.allow !== true && findings.length > 0) {
    throw new AgentToolCapabilityError(
      `Agent tool "${declaration.name}" rejects ambient browser/session credentials by default: ${describeAmbientCredentialFindings(
        findings,
      )}.`,
    );
  }

  const disallowed = findings.filter((finding) => !allowedKinds.has(finding.kind));
  if (disallowed.length > 0) {
    throw new AgentToolCapabilityError(
      `Agent tool "${declaration.name}" received undeclared ambient credential kinds: ${describeAmbientCredentialFindings(
        disallowed,
      )}.`,
    );
  }

  const headers = new Headers(request.headers);
  for (const { header, kind } of ambientCredentialHeaders) {
    if (!allowedKinds.has(kind)) headers.delete(header);
  }

  return requestWithoutSession(new Request(request, { credentials: 'omit', headers }));
}

function ambientCredentialFindings(request: Request): AmbientCredentialFinding[] {
  const findings: AmbientCredentialFinding[] = [];

  for (const { header, kind } of ambientCredentialHeaders) {
    if (request.headers.has(header)) findings.push({ kind, source: `header:${header}` });
  }

  if ('session' in request) findings.push({ kind: 'session', source: 'property:session' });

  return findings;
}

function describeAmbientCredentialFindings(findings: readonly AmbientCredentialFinding[]): string {
  return findings.map((finding) => `${finding.kind}(${finding.source})`).join(', ');
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
    assertAmbientCredentialKinds(ambient.credentialKinds);
    assertNonEmpty(ambient.justification?.reason, 'tool.ambientCredentials.justification.reason');
    assertNonEmpty(
      ambient.justification?.authorityBoundary,
      'tool.ambientCredentials.justification.authorityBoundary',
    );
  }
}

function assertAmbientCredentialKinds(
  kinds: readonly AgentToolAmbientCredentialKind[] | undefined,
): void {
  if (kinds === undefined || kinds.length === 0) {
    throw new AgentToolCapabilityError(
      'tool.ambientCredentials.credentialKinds must declare at least one credential kind.',
    );
  }

  const seen = new Set<AgentToolAmbientCredentialKind>();
  for (const kind of kinds) {
    if (!ambientCredentialKinds.includes(kind)) {
      throw new AgentToolCapabilityError(
        'tool.ambientCredentials.credentialKinds[] must be a known credential kind.',
      );
    }
    if (seen.has(kind)) {
      throw new AgentToolCapabilityError(
        'tool.ambientCredentials.credentialKinds must not contain duplicate credential kinds.',
      );
    }
    seen.add(kind);
  }
}

function assertReachableSinks(sinks: readonly AgentToolReachableSink[] | undefined): void {
  if (sinks === undefined) return;

  for (const sink of sinks) {
    if (
      sink.kind !== 'egress' &&
      sink.kind !== 'mutation' &&
      sink.kind !== 'secret-read' &&
      sink.kind !== 'write'
    ) {
      throw new AgentToolCapabilityError('tool.reachableSinks[].kind must be a known sink kind.');
    }
    assertNonEmpty(sink.capability, 'tool.reachableSinks[].capability');
    assertNonEmpty(sink.evidence, 'tool.reachableSinks[].evidence');
    assertNonEmpty(sink.target, 'tool.reachableSinks[].target');
    if (sink.site !== undefined) assertNonEmpty(sink.site, 'tool.reachableSinks[].site');
  }
}

function reachableSinkAuditFact(
  declaration: AgentToolDeclaration<unknown, unknown, unknown>,
  sink: AgentToolReachableSink,
): AgentToolReachableSinkAuditFact {
  return {
    capability: sink.capability,
    evidence: sink.evidence,
    grade: 'audit',
    kind: sink.kind,
    site: sink.site ?? declaration.audit.site ?? `agent-tool:${declaration.name}`,
    target: sink.target,
    tool: declaration.name,
  };
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
