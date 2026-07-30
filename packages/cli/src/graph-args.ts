import { parseKovoCommandInvocation } from './commands-manifest.js';
import type { KovoDiagnosticFormat } from './diagnostic.js';
import { writeUsageError } from './shared.js';

/**
 * The kind of graph subject a targeted `kovo explain` describes — a component,
 * request context, mutation, query, page, or durable task (SPEC.md §5.3/§9.6).
 */
export type ExplainKind = 'component' | 'context' | 'mutation' | 'page' | 'query' | 'task';

/**
 * Options selecting which `kovo explain` view `kovoExplain` produces. The
 * discriminant is shared by the programmatic API and the CLI's literal
 * subcommand grammar (SPEC.md §5.3 and §11.4).
 */
export type KovoExplainOptions =
  | KovoAccessExplainOptions
  | KovoAuthLifecycleExplainOptions
  | KovoAuthorizationExplainOptions
  | KovoAgentExplainOptions
  | { view: 'capabilities' }
  | { view: 'cookies' }
  | KovoDocumentExplainOptions
  | KovoEndpointExplainOptions
  | KovoGrantExplainOptions
  | { view: 'model-boundaries' }
  | KovoRevealedExplainOptions
  | KovoSourcesSinksExplainOptions
  | KovoTasksExplainOptions
  | KovoTargetExplainOptions
  | { view: 'trust' }
  | KovoUnguardedExplainOptions
  | KovoUnscopedExplainOptions;

/**
 * `kovo explain access` options: emit the producer-owned access-decision
 * ledger from graph `access` facts (SPEC.md §10.2/§11.3).
 */
export interface KovoAccessExplainOptions {
  failOnFindings?: boolean;
  view: 'access';
}

/** `kovo explain auth-lifecycle`: print Better Auth ownership and explicit non-claims. */
export interface KovoAuthLifecycleExplainOptions {
  view: 'auth-lifecycle';
}

/** `kovo explain authorization`: print honest guard/RLS non-correspondence records. */
export interface KovoAuthorizationExplainOptions {
  view: 'authorization';
}

/** `kovo explain agent`: print compiler-derived model/tool effect closures by integrity. */
export interface KovoAgentExplainOptions {
  view: 'agent';
}

/**
 * `kovo explain document` options: emit the framework-owned document shell
 * source/sink row plus any document-owned trust escape facts in the optional
 * extracted graph (SPEC.md §9.5; plans/structured-document.md).
 */
export interface KovoDocumentExplainOptions {
  view: 'document';
}

/**
 * `kovo explain endpoints` options: emit the stable machine-ingress audit table
 * of every declared endpoint, webhook, file/stream route, and dynamic ingress
 * surface (SPEC.md §11.4; plans/sources-sinks.md Phase 3).
 */
export interface KovoEndpointExplainOptions {
  view: 'endpoints';
}

/** `kovo explain grants`: print the compiler-derived finite grant model (SPEC §10.3). */
export interface KovoGrantExplainOptions {
  view: 'grants';
}

/**
 * `kovo explain revealed` options: emit every declared confidentiality reveal,
 * labeling proof-grade server projections separately from audit-grade arbitrary
 * function reveals (SPEC.md §1.1/§2; plans/secure-by-construction.md Phase 1).
 */
export interface KovoRevealedExplainOptions {
  view: 'revealed';
}

/**
 * `kovo explain sources-sinks` options: emit the stable Phase 1 repository
 * source/sink inventory (SPEC.md §5.3; plans/sources-sinks.md Phase 1).
 */
export interface KovoSourcesSinksExplainOptions {
  view: 'sources-sinks';
}

/**
 * `kovo explain tasks` options: emit durable task nodes plus statically discovered composition
 * edges from task bodies (SPEC §9.6 and §11.4).
 */
export interface KovoTasksExplainOptions {
  view: 'tasks';
}

/**
 * Targeted `kovo explain` options: describe one graph subject of the given `kind`
 * and `target`, optionally including optimistic transform coverage for mutations
 * (SPEC.md §5.3).
 */
export interface KovoTargetExplainOptions {
  layouts?: boolean;
  optimistic?: boolean;
  target: string;
  view: ExplainKind;
}

/**
 * `kovo explain unguarded` options: audit every mutation, route, and query
 * reachable without an `authed` guard, optionally failing when findings exist
 * (SPEC.md §11.4).
 */
export interface KovoUnguardedExplainOptions {
  failOnFindings?: boolean;
  view: 'unguarded';
}

/**
 * `kovo explain unscoped` options: audit every query or write touching an
 * owner-annotated domain without an owner scope, optionally failing when findings
 * exist (SPEC.md §11.4).
 */
export interface KovoUnscopedExplainOptions {
  failOnFindings?: boolean;
  view: 'unscoped';
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
      appModulePath: string;
      cache: boolean;
      format: KovoDiagnosticFormat;
      ok: true;
      source: true;
      watch: boolean;
    }
  | {
      artifact: boolean;
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
  | {
      format: KovoDiagnosticFormat;
      lifecycle: true;
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
  if (parsed.value.form === 'lifecycle') {
    return {
      format: parsed.value.options.format,
      lifecycle: true,
      ok: true,
    };
  }
  if (parsed.value.form === 'endpoint-posture-suite') {
    return {
      artifact: false,
      family: 'endpoint-posture',
      format: parsed.value.options.format,
      inputPath: undefined,
      ok: true,
    };
  }
  if (parsed.value.form === 'advisories') {
    return {
      message: 'kovo: check advisories requires asynchronous command dispatch.\n',
      ok: false,
    };
  }
  if (
    parsed.value.form === 'source-default' ||
    parsed.value.form === 'source' ||
    parsed.value.form === 'source-watch'
  ) {
    return {
      appModulePath:
        parsed.value.form === 'source' || parsed.value.form === 'source-watch'
          ? (parsed.value.arguments.appModule ?? './src/app.tsx')
          : './src/app.tsx',
      cache: parsed.value.options.cache,
      format: parsed.value.options.format,
      ok: true,
      source: true,
      watch: parsed.value.form === 'source-watch',
    };
  }

  const inputPath = parsed.value.arguments.graph;
  const artifactPath = parsed.value.options.artifact;
  if (inputPath !== undefined && artifactPath !== undefined) {
    return {
      message: 'kovo: check accepts either a review graph or --artifact, not both.\n',
      ok: false,
    };
  }
  return {
    artifact: artifactPath !== undefined,
    family: parsed.value.arguments.family ?? 'all',
    format: parsed.value.options.format,
    inputPath: artifactPath ?? inputPath,
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
      artifact: boolean;
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
  const selectedGraph = (
    inputPath: string | undefined,
  ):
    | { artifact: boolean; inputPath: string | undefined; ok: true }
    | { message: string; ok: false } => {
    const artifactPath = 'artifact' in invocation.options ? invocation.options.artifact : undefined;
    if (inputPath !== undefined && artifactPath !== undefined) {
      return {
        message: 'kovo: explain accepts either a review graph or --artifact, not both.\n',
        ok: false,
      };
    }
    return { artifact: artifactPath !== undefined, inputPath: artifactPath ?? inputPath, ok: true };
  };
  const graph = selectedGraph(
    'graph' in invocation.arguments ? invocation.arguments.graph : undefined,
  );
  if (!graph.ok) return graph;
  switch (invocation.form) {
    case 'target':
      return {
        artifact: graph.artifact,
        format: invocation.options.format,
        inputPath: graph.inputPath,
        ok: true,
        options: {
          layouts: invocation.options.layouts,
          optimistic: invocation.options.optimistic,
          target: invocation.arguments.target,
          view: invocation.arguments.kind,
        },
      };
    case 'document':
      return {
        artifact: graph.artifact,
        format: invocation.options.format,
        inputPath: graph.inputPath,
        ok: true,
        options: { view: 'document' },
      };
    case 'sources-sinks':
      return {
        artifact: graph.artifact,
        format: invocation.options.format,
        inputPath: graph.inputPath,
        ok: true,
        options: { view: 'sources-sinks' },
      };
    case 'tasks':
      return {
        artifact: graph.artifact,
        format: invocation.options.format,
        inputPath: graph.inputPath,
        ok: true,
        options: { view: 'tasks' },
      };
    case 'agent':
      return {
        artifact: graph.artifact,
        format: invocation.options.format,
        inputPath: graph.inputPath,
        ok: true,
        options: { view: 'agent' },
      };
    case 'grants':
      return {
        artifact: graph.artifact,
        format: invocation.options.format,
        inputPath: graph.inputPath,
        ok: true,
        options: { view: 'grants' },
      };
    case 'endpoints':
      return {
        artifact: graph.artifact,
        format: invocation.options.format,
        inputPath: graph.inputPath,
        ok: true,
        options: { view: 'endpoints' },
      };
    case 'revealed':
      return {
        artifact: graph.artifact,
        format: invocation.options.format,
        inputPath: graph.inputPath,
        ok: true,
        options: { view: 'revealed' },
      };
    case 'trust':
      return {
        artifact: graph.artifact,
        format: invocation.options.format,
        inputPath: graph.inputPath,
        ok: true,
        options: { view: 'trust' },
      };
    case 'capabilities':
      return {
        artifact: graph.artifact,
        format: invocation.options.format,
        inputPath: graph.inputPath,
        ok: true,
        options: { view: 'capabilities' },
      };
    case 'cookies':
      return {
        artifact: graph.artifact,
        format: invocation.options.format,
        inputPath: graph.inputPath,
        ok: true,
        options: { view: 'cookies' },
      };
    case 'authorization':
      return {
        artifact: graph.artifact,
        format: invocation.options.format,
        inputPath: graph.inputPath,
        ok: true,
        options: { view: 'authorization' },
      };
    case 'access':
      return {
        artifact: graph.artifact,
        format: invocation.options.format,
        inputPath: graph.inputPath,
        ok: true,
        options: {
          failOnFindings: invocation.options.failOnFindings,
          view: 'access',
        },
      };
    case 'unguarded':
      return {
        artifact: graph.artifact,
        format: invocation.options.format,
        inputPath: graph.inputPath,
        ok: true,
        options: {
          failOnFindings: invocation.options.failOnFindings,
          view: 'unguarded',
        },
      };
    case 'unscoped':
      return {
        artifact: graph.artifact,
        format: invocation.options.format,
        inputPath: graph.inputPath,
        ok: true,
        options: {
          failOnFindings: invocation.options.failOnFindings,
          view: 'unscoped',
        },
      };
    case 'auth-lifecycle':
      return {
        artifact: false,
        format: invocation.options.format,
        inputPath: undefined,
        ok: true,
        options: { view: 'auth-lifecycle' },
      };
    case 'model-boundaries':
      return {
        artifact: false,
        format: invocation.options.format,
        inputPath: undefined,
        ok: true,
        options: { view: 'model-boundaries' },
      };
    case 'attest':
      return {
        message: 'kovo: explain attest requires asynchronous command dispatch.\n',
        ok: false,
      };
  }
}
