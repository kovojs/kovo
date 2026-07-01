import {
  AUDIT_ARGV_SPEC,
  AUDIT_USAGE,
  CHECK_ARGV_SPEC,
  CHECK_USAGE,
  commandArgvError,
  EXPLAIN_ARGV_SPEC,
  EXPLAIN_USAGE_LINE,
  parsedBooleanOption,
  parseCommandArgv,
} from './commands-manifest.js';

/**
 * The kind of graph subject a targeted `kovo explain` describes — a component,
 * request context, mutation, query, or page (SPEC.md §5.3).
 */
export type ExplainKind = 'component' | 'context' | 'mutation' | 'page' | 'query' | 'task';

/**
 * Options selecting which `kovo explain` view `kovoExplain` produces: a targeted
 * component/mutation/query/page subject, the `--endpoints` machine-ingress audit,
 * or one of the access audits (SPEC.md §5.3 and §11.4).
 */
export type KovoExplainOptions =
  | KovoAccessExplainOptions
  | { capabilities: true }
  | { cookies: true }
  | KovoDocumentExplainOptions
  | KovoEndpointExplainOptions
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
  | { family: KovoCheckFamily; inputPath: string | undefined; ok: true }
  | { family: string | undefined; kind: 'too-many-args' | 'unsupported-family'; ok: false }
  | { message: string; ok: false };

export function parseCheckArgs(args: readonly string[]): CheckArgParseResult {
  const parsed = parseCommandArgv(args, CHECK_ARGV_SPEC);
  if (!parsed.ok) return commandArgvError('check', parsed, `kovo: ${CHECK_USAGE}`);

  const family = checkFamilyArg(parsed.value.positionals[0]);
  if (family !== 'all') {
    if (parsed.value.positionals.length > 2) {
      return { family: parsed.value.positionals[0], kind: 'too-many-args', ok: false };
    }
    return { family, inputPath: parsed.value.positionals[1], ok: true };
  }
  if (parsed.value.positionals.length > 1) {
    return { family: parsed.value.positionals[0], kind: 'unsupported-family', ok: false };
  }
  return { family, inputPath: parsed.value.positionals[0], ok: true };
}

export function writeCheckUsageError(error: Extract<CheckArgParseResult, { ok: false }>): number {
  if ('message' in error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
  const message =
    error.kind === 'unsupported-family'
      ? `kovo: unsupported check family ${stableArg(error.family)}. expected optimistic, coverage, endpoint-posture, or sources-sinks.\n`
      : `kovo: ${CHECK_USAGE}\n`;
  process.stderr.write(message);
  return 1;
}

type AuditArgParseResult =
  | { failOnFindings: boolean; inputPath: string | undefined; ok: true }
  | { message: string; ok: false };

export function parseAuditArgs(args: readonly string[]): AuditArgParseResult {
  const parsed = parseCommandArgv(args, AUDIT_ARGV_SPEC);
  if (!parsed.ok) return commandArgvError('audit', parsed, AUDIT_USAGE);
  if (parsed.value.positionals.length > 1) {
    return { message: `kovo: ${AUDIT_USAGE}`, ok: false };
  }

  return {
    failOnFindings: parsedBooleanOption(parsed.value, '--fail-on-findings'),
    inputPath: parsed.value.positionals[0],
    ok: true,
  };
}

type ExplainArgParseResult =
  | { inputPath: string | undefined; ok: true; options: KovoExplainOptions }
  | { message: string; ok: false };

export function parseExplainArgs(args: readonly string[]): ExplainArgParseResult {
  const parsed = parseCommandArgv(args, EXPLAIN_ARGV_SPEC);
  if (!parsed.ok) return commandArgvError('explain', parsed, `kovo: usage: ${EXPLAIN_USAGE_LINE}`);

  const flags = {
    has: (flag: string) => parsedBooleanOption(parsed.value, flag),
  };
  const positional = parsed.value.positionals;
  const modeFlags = [
    '--access',
    '--capabilities',
    '--cookies',
    '--endpoints',
    '--revealed',
    '--sources-sinks',
    '--tasks',
    '--trust',
    '--unguarded',
    '--unscoped',
  ].filter((flag) => flags.has(flag));
  if (modeFlags.length > 1) return explainUsage();

  if (flags.has('--access')) {
    if (flags.has('--layouts') || flags.has('--optimistic') || positional.length > 1) {
      return explainUsage();
    }
    return {
      inputPath: positional[0],
      ok: true,
      options: { access: true, failOnFindings: flags.has('--fail-on-findings') },
    };
  }

  if (flags.has('--sources-sinks')) {
    if (
      flags.has('--fail-on-findings') ||
      flags.has('--layouts') ||
      flags.has('--optimistic') ||
      positional.length > 0
    ) {
      return explainUsage();
    }
    return { inputPath: undefined, ok: true, options: { sourcesSinks: true } };
  }

  if (flags.has('--tasks')) {
    if (
      flags.has('--fail-on-findings') ||
      flags.has('--layouts') ||
      flags.has('--optimistic') ||
      positional.length > 1
    ) {
      return explainUsage();
    }
    return { inputPath: positional[0], ok: true, options: { tasks: true } };
  }

  if (flags.has('--endpoints')) {
    if (
      flags.has('--fail-on-findings') ||
      flags.has('--layouts') ||
      flags.has('--optimistic') ||
      positional.length > 1
    ) {
      return explainUsage();
    }
    return { inputPath: positional[0], ok: true, options: { endpoints: true } };
  }

  if (flags.has('--revealed')) {
    if (
      flags.has('--fail-on-findings') ||
      flags.has('--layouts') ||
      flags.has('--optimistic') ||
      positional.length > 1
    ) {
      return explainUsage();
    }
    return { inputPath: positional[0], ok: true, options: { revealed: true } };
  }

  if (flags.has('--trust')) {
    if (
      flags.has('--fail-on-findings') ||
      flags.has('--layouts') ||
      flags.has('--optimistic') ||
      positional.length > 1
    ) {
      return explainUsage();
    }
    return { inputPath: positional[0], ok: true, options: { trust: true } };
  }

  if (flags.has('--capabilities')) {
    if (
      flags.has('--fail-on-findings') ||
      flags.has('--layouts') ||
      flags.has('--optimistic') ||
      positional.length > 1
    ) {
      return explainUsage();
    }
    return { inputPath: positional[0], ok: true, options: { capabilities: true } };
  }

  if (flags.has('--cookies')) {
    if (
      flags.has('--fail-on-findings') ||
      flags.has('--layouts') ||
      flags.has('--optimistic') ||
      positional.length > 1
    ) {
      return explainUsage();
    }
    return { inputPath: positional[0], ok: true, options: { cookies: true } };
  }

  if (flags.has('--unguarded') || flags.has('--unscoped')) {
    if (flags.has('--layouts') || flags.has('--optimistic') || positional.length > 1) {
      return explainUsage();
    }
    const options = flags.has('--unguarded')
      ? ({ failOnFindings: flags.has('--fail-on-findings'), unguarded: true } as const)
      : ({ failOnFindings: flags.has('--fail-on-findings'), unscoped: true } as const);
    return { inputPath: positional[0], ok: true, options };
  }

  if (flags.has('--fail-on-findings')) return explainUsage();

  const [kind, target, inputPath, extra] = positional;
  if (kind === 'document') {
    if (
      flags.has('--layouts') ||
      flags.has('--optimistic') ||
      (target === undefined ? false : inputPath !== undefined)
    ) {
      return explainUsage();
    }
    return { inputPath: target, ok: true, options: { document: true } };
  }
  if (!isExplainKind(kind) || !target || extra) return explainUsage();
  if (flags.has('--layouts') && kind !== 'page') return explainUsage();
  if (flags.has('--optimistic') && kind !== 'mutation') return explainUsage();

  return {
    inputPath,
    ok: true,
    options: {
      kind,
      layouts: flags.has('--layouts'),
      optimistic: flags.has('--optimistic'),
      target,
    },
  };
}

function explainUsage(): ExplainArgParseResult {
  return {
    message: `kovo: usage: ${EXPLAIN_USAGE_LINE}`,
    ok: false,
  };
}

function stableArg(value: string | undefined): string {
  return value === undefined ? '-' : JSON.stringify(value);
}
