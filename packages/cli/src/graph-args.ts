import { parseKovoCommandInvocation } from './commands-manifest.js';
import type { KovoDiagnosticFormat } from './diagnostic.js';
import { writeUsageError } from './shared.js';

/**
 * The kind of graph subject a targeted `kovo explain` describes — a component,
 * request context, mutation, query, page, or durable task (SPEC.md §5.3/§9.6).
 */
export type ExplainKind = 'component' | 'context' | 'mutation' | 'page' | 'query' | 'task';

/**
 * Options selecting which `kovo explain` view `kovoExplain` produces: a targeted
 * component/mutation/query/page/task subject, the `--endpoints` machine-ingress
 * audit, or one of the security review modes (SPEC.md §5.3 and §11.4).
 */
export type KovoExplainOptions =
  | KovoAccessExplainOptions
  | KovoAuthLifecycleExplainOptions
  | KovoAuthorizationExplainOptions
  | KovoAgentExplainOptions
  | { capabilities: true }
  | { cookies: true }
  | KovoDocumentExplainOptions
  | KovoEndpointExplainOptions
  | KovoGrantExplainOptions
  | { modelBoundaries: true }
  | KovoRevealedExplainOptions
  | KovoSourcesSinksExplainOptions
  | KovoTasksExplainOptions
  | KovoTargetExplainOptions
  | { trust: true }
  | KovoUnguardedExplainOptions
  | KovoUnscopedExplainOptions;

/**
 * `kovo explain --access` options: emit the producer-owned access-decision
 * ledger from graph `access` facts (SPEC.md §10.2/§11.3).
 */
export interface KovoAccessExplainOptions {
  access: true;
  failOnFindings?: boolean;
}

/** `kovo explain --auth-lifecycle`: print Better Auth ownership and explicit non-claims. */
export interface KovoAuthLifecycleExplainOptions {
  authLifecycle: true;
}

/** `kovo explain --authorization`: print honest guard/RLS non-correspondence records. */
export interface KovoAuthorizationExplainOptions {
  authorization: true;
}

/** `kovo explain --agent`: print compiler-derived model/tool effect closures by integrity. */
export interface KovoAgentExplainOptions {
  agent: true;
}

/**
 * `kovo explain document` options: emit the framework-owned document shell
 * source/sink row plus any document-owned trust escape facts in the optional
 * extracted graph (SPEC.md §9.5; plans/structured-document.md).
 */
export interface KovoDocumentExplainOptions {
  document: true;
}

/**
 * `kovo explain --endpoints` options: emit the stable machine-ingress audit table
 * of every declared endpoint, webhook, file/stream route, and dynamic ingress
 * surface (SPEC.md §11.4; plans/sources-sinks.md Phase 3).
 */
export interface KovoEndpointExplainOptions {
  endpoints: true;
}

/** `kovo explain --grants`: print the compiler-derived finite grant model (SPEC §10.3). */
export interface KovoGrantExplainOptions {
  grants: true;
}

/**
 * `kovo explain --revealed` options: emit every declared confidentiality reveal,
 * labeling proof-grade server projections separately from audit-grade arbitrary
 * function reveals (SPEC.md §1.1/§2; plans/secure-by-construction.md Phase 1).
 */
export interface KovoRevealedExplainOptions {
  revealed: true;
}

/**
 * `kovo explain --sources-sinks` options: emit the stable Phase 1 repository
 * source/sink inventory (SPEC.md §5.3; plans/sources-sinks.md Phase 1).
 */
export interface KovoSourcesSinksExplainOptions {
  sourcesSinks: true;
}

/**
 * `kovo explain --tasks` options: emit durable task nodes plus statically discovered composition
 * edges from task bodies (SPEC §9.6 and §11.4).
 */
export interface KovoTasksExplainOptions {
  tasks: true;
}

/**
 * Targeted `kovo explain` options: describe one graph subject of the given `kind`
 * and `target`, optionally including optimistic transform coverage for mutations
 * (SPEC.md §5.3).
 */
export interface KovoTargetExplainOptions {
  kind: ExplainKind;
  layouts?: boolean;
  optimistic?: boolean;
  target: string;
}

/**
 * `kovo explain --unguarded` options: audit every mutation, route, and query
 * reachable without an `authed` guard, optionally failing when findings exist
 * (SPEC.md §11.4).
 */
export interface KovoUnguardedExplainOptions {
  failOnFindings?: boolean;
  unguarded: true;
}

/**
 * `kovo explain --unscoped` options: audit every query or write touching an
 * owner-annotated domain without an owner scope, optionally failing when findings
 * exist (SPEC.md §11.4).
 */
export interface KovoUnscopedExplainOptions {
  failOnFindings?: boolean;
  unscoped: true;
}

/** Check family selector accepted by {@link kovoCheck} and `kovo check`. */
export type KovoCheckFamily =
  | 'all'
  | 'coverage'
  | 'endpoint-posture'
  | 'optimistic'
  | 'sources-sinks';

export function checkFamilyArg(value: string | undefined): KovoCheckFamily {
  return value === 'optimistic' ||
    value === 'coverage' ||
    value === 'endpoint-posture' ||
    value === 'sources-sinks'
    ? value
    : 'all';
}

export function isExplainKind(value: string | undefined): value is ExplainKind {
  return (
    value === 'component' ||
    value === 'context' ||
    value === 'mutation' ||
    value === 'page' ||
    value === 'query' ||
    value === 'task'
  );
}

type CheckArgParseResult =
  | {
      family: KovoCheckFamily;
      format: KovoDiagnosticFormat;
      inputPath: string | undefined;
      ok: true;
    }
  | {
      environment: true;
      format: KovoDiagnosticFormat;
      inputPath: string | undefined;
      ok: true;
    }
  | { message: string; ok: false };

export function parseCheckArgs(args: readonly string[]): CheckArgParseResult {
  const parsed = parseKovoCommandInvocation('check', args);
  if (!parsed.ok) return { message: parsed.message, ok: false };

  if (parsed.value.form === 'environment') {
    return {
      environment: true,
      format: parsed.value.options.format,
      inputPath: parsed.value.arguments.deployment,
      ok: true,
    };
  }
  if (parsed.value.form === 'advisories') {
    return {
      message: 'kovo: check advisories requires asynchronous command dispatch.\n',
      ok: false,
    };
  }

  return {
    family: parsed.value.arguments.family ?? 'all',
    format: parsed.value.options.format,
    inputPath: parsed.value.arguments.graph,
    ok: true,
  };
}

export function writeCheckUsageError(error: Extract<CheckArgParseResult, { ok: false }>): number {
  return writeUsageError(error.message, 'check');
}

type AuditArgParseResult =
  | { failOnFindings: boolean; inputPath: string | undefined; ok: true }
  | { message: string; ok: false };

export function parseAuditArgs(args: readonly string[]): AuditArgParseResult {
  const parsed = parseKovoCommandInvocation('audit', args);
  if (!parsed.ok) return { message: parsed.message, ok: false };

  return {
    failOnFindings: parsed.value.options.failOnFindings,
    inputPath: parsed.value.arguments.graph,
    ok: true,
  };
}

type ExplainArgParseResult =
  | {
      format: KovoDiagnosticFormat;
      inputPath: string | undefined;
      ok: true;
      options: KovoExplainOptions;
    }
  | { message: string; ok: false };

export function parseExplainArgs(args: readonly string[]): ExplainArgParseResult {
  const parsed = parseKovoCommandInvocation('explain', args);
  if (!parsed.ok) return { message: parsed.message, ok: false };

  const invocation = parsed.value;
  switch (invocation.form) {
    case 'target':
      return {
        format: invocation.options.format,
        inputPath: invocation.arguments.graph,
        ok: true,
        options: {
          kind: invocation.arguments.kind,
          layouts: invocation.options.layouts,
          optimistic: invocation.options.optimistic,
          target: invocation.arguments.target,
        },
      };
    case 'document':
      return {
        format: invocation.options.format,
        inputPath: invocation.arguments.graph,
        ok: true,
        options: { document: true },
      };
    case 'sources-sinks':
      return {
        format: invocation.options.format,
        inputPath: invocation.arguments.graph,
        ok: true,
        options: { sourcesSinks: true },
      };
    case 'tasks':
      return {
        format: invocation.options.format,
        inputPath: invocation.arguments.graph,
        ok: true,
        options: { tasks: true },
      };
    case 'agent':
      return {
        format: invocation.options.format,
        inputPath: invocation.arguments.graph,
        ok: true,
        options: { agent: true },
      };
    case 'grants':
      return {
        format: invocation.options.format,
        inputPath: invocation.arguments.graph,
        ok: true,
        options: { grants: true },
      };
    case 'endpoints':
      return {
        format: invocation.options.format,
        inputPath: invocation.arguments.graph,
        ok: true,
        options: { endpoints: true },
      };
    case 'revealed':
      return {
        format: invocation.options.format,
        inputPath: invocation.arguments.graph,
        ok: true,
        options: { revealed: true },
      };
    case 'trust':
      return {
        format: invocation.options.format,
        inputPath: invocation.arguments.graph,
        ok: true,
        options: { trust: true },
      };
    case 'capabilities':
      return {
        format: invocation.options.format,
        inputPath: invocation.arguments.graph,
        ok: true,
        options: { capabilities: true },
      };
    case 'cookies':
      return {
        format: invocation.options.format,
        inputPath: invocation.arguments.graph,
        ok: true,
        options: { cookies: true },
      };
    case 'authorization':
      return {
        format: invocation.options.format,
        inputPath: invocation.arguments.graph,
        ok: true,
        options: { authorization: true },
      };
    case 'access':
      return {
        format: invocation.options.format,
        inputPath: invocation.arguments.graph,
        ok: true,
        options: {
          access: true,
          failOnFindings: invocation.options.failOnFindings,
        },
      };
    case 'unguarded':
      return {
        format: invocation.options.format,
        inputPath: invocation.arguments.graph,
        ok: true,
        options: {
          failOnFindings: invocation.options.failOnFindings,
          unguarded: true,
        },
      };
    case 'unscoped':
      return {
        format: invocation.options.format,
        inputPath: invocation.arguments.graph,
        ok: true,
        options: {
          failOnFindings: invocation.options.failOnFindings,
          unscoped: true,
        },
      };
    case 'auth-lifecycle':
      return {
        format: invocation.options.format,
        inputPath: undefined,
        ok: true,
        options: { authLifecycle: true },
      };
    case 'model-boundaries':
      return {
        format: invocation.options.format,
        inputPath: undefined,
        ok: true,
        options: { modelBoundaries: true },
      };
    case 'attest':
      return {
        message: 'kovo: explain --attest requires asynchronous command dispatch.\n',
        ok: false,
      };
  }
}
