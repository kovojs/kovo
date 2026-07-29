/**
 * @internal
 *
 * Semantic source of truth for the `kovo` command contract.
 *
 * The schema deliberately contains concepts rather than pre-rendered argv text:
 * commands and options have stable ids, while aliases, value syntax, defaults,
 * repeatability, help, completion, reference data, exit classes, and result
 * protocol versions are adapters over those facts. This keeps the command line
 * inspectable without making an argv-shaped interface the programmatic API.
 */
import { KOVO_ADD_COMPONENT_NAMES } from './add-component-names.js';

/** @internal Human-facing command groups used by root help and generated references. */
export type KovoCommandCategory = 'agent-operator' | 'daily-build' | 'inspect-security';

/** @internal Value grammars understood by the shared argv adapter. */
export type KovoCommandValueKind = 'enum' | 'integer' | 'path' | 'string' | 'url';

/** @internal Stable result classes and their process exit codes. */
export interface KovoCommandExitBehavior {
  readonly finding: 1;
  readonly success: 0;
  readonly usage: 2;
  /**
   * Authenticated commands may retain SPEC §11.4's fail-closed UNKNOWN class.
   * It intentionally shares exit 2 with invocation/config errors while remaining
   * distinguishable in the versioned result protocol.
   */
  readonly unknown?: 2;
}

/** @internal Compiler-realm posture the executable must establish before dispatch. */
export type KovoCommandCompilerRealm = 'locked-before-dispatch' | 'unlocked';

/** @internal Process lifetime owned by one command invocation. */
export type KovoCommandProcessLifecycle = 'long-lived' | 'one-shot';

/** @internal A value accepted by a positional argument or option. */
export interface KovoCommandValueSchema {
  readonly default?: number | string;
  readonly kind: KovoCommandValueKind;
  readonly label: string;
  readonly maximum?: number;
  readonly minimum?: number;
  readonly usage?: 'label';
  readonly values?: readonly string[];
}

/** @internal One semantic CLI option. `id` is the programmatic key; `flags` are adapters. */
export interface KovoCommandOptionSchema {
  /**
   * Semantic boolean represented by the flag's presence. Negative argv flags
   * such as `--no-cache` set this to `false`, so programmatic callers express
   * the concept (`cache: false`) instead of copying argv polarity.
   */
  readonly booleanValue?: boolean;
  readonly defaultBoolean?: boolean;
  readonly category?: 'advanced' | 'input' | 'output' | 'posture' | 'selection';
  readonly description: string;
  readonly flags: readonly [`--${string}`, ...string[]];
  readonly id: string;
  readonly invalidValueMessage?: string;
  readonly missingValueMessage?: string;
  readonly repeatable?: boolean;
  readonly value?: KovoCommandValueSchema;
}

/** @internal One token in a generated usage form. */
export type KovoCommandUsageToken =
  | {
      readonly kind: 'group';
      readonly required: boolean;
      readonly tokens: readonly {
        readonly kind: 'option';
        readonly option: string;
        readonly required?: boolean;
        readonly valueLabel?: string;
      }[];
    }
  | {
      readonly description?: string;
      readonly invalidValueMessage?: string;
      readonly invalidValueUsage?: 'omit';
      readonly kind: 'argument';
      readonly missingValueMessage?: string;
      readonly name: string;
      readonly repeatable?: boolean;
      readonly required: boolean;
      readonly unexpectedValueMessage?: string;
      readonly usageErrorPrefix?: 'kovo';
      readonly value: KovoCommandValueSchema;
    }
  | {
      readonly description?: string;
      readonly kind: 'literal';
      readonly value: string;
    }
  | {
      readonly kind: 'option';
      readonly option: string;
      readonly required?: boolean;
      readonly valueLabel?: string;
    };

/** @internal One valid command shape. */
export interface KovoCommandUsageForm {
  /** This form requires the asynchronous dispatcher even when sibling forms do not. */
  readonly async?: true;
  readonly id: string;
  /** Cross-field grammar that remains semantic rather than argv-shaped. */
  readonly optionRequiresArgument?: readonly {
    readonly argument: string;
    readonly option: string;
    readonly values: readonly string[];
  }[];
  readonly summary?: string;
  readonly tokens: readonly KovoCommandUsageToken[];
}

/** @internal One complete command node in the semantic AST. */
export interface KovoCommandSchemaEntry {
  readonly aliases: readonly string[];
  readonly async?: true;
  readonly category: KovoCommandCategory;
  readonly compilerRealm: KovoCommandCompilerRealm;
  readonly examples: readonly string[];
  readonly exits: KovoCommandExitBehavior;
  readonly name: string;
  readonly options: readonly KovoCommandOptionSchema[];
  readonly order: number;
  readonly processLifecycle: KovoCommandProcessLifecycle;
  readonly referenceUsage: 'inline' | 'multiline';
  readonly resultProtocol: string | null;
  readonly summary: string;
  readonly usage: readonly KovoCommandUsageForm[];
  readonly usageErrorPrefix?: 'kovo';
}

/** @internal One framework-owned meta command handled before capability dispatch. */
export interface KovoMetaCommandSchemaEntry {
  readonly aliases: readonly string[];
  readonly examples: readonly string[];
  readonly name: 'completion' | 'help' | 'version';
  readonly options: readonly KovoCommandOptionSchema[];
  readonly summary: string;
  readonly usage: readonly KovoCommandUsageForm[];
}

const exits = Object.freeze({
  finding: 1,
  success: 0,
  usage: 2,
} as const);

const exitsWithUnknown = Object.freeze({
  ...exits,
  unknown: 2,
} as const);

/**
 * Freeze the complete framework-owned semantic graph before any adapter builds
 * registries or rendered output from it. TypeScript readonly modifiers are
 * author-time guardrails; this runtime freeze prevents an imported schema
 * reference from changing parser, help, completion, or reference behavior.
 */
function deepFreezeSemanticSchema<const Value>(schema: Value): Value {
  if (schema === null || typeof schema !== 'object' || Object.isFrozen(schema)) return schema;
  for (const child of Object.values(schema)) deepFreezeSemanticSchema(child);
  return Object.freeze(schema);
}

function value<
  const Kind extends KovoCommandValueKind,
  const Label extends string,
  const Options extends {
    readonly default?: number | string;
    readonly maximum?: number;
    readonly minimum?: number;
    readonly usage?: 'label';
    readonly values?: readonly string[];
  } = {},
>(
  kind: Kind,
  label: Label,
  options: Options = {} as Options,
): Readonly<{ kind: Kind; label: Label }> & Options {
  return { kind, label, ...options };
}

function argument<
  const Name extends string,
  const Schema,
  const Options extends {
    readonly description?: string;
    readonly invalidValueMessage?: string;
    readonly invalidValueUsage?: 'omit';
    readonly missingValueMessage?: string;
    readonly repeatable?: boolean;
    readonly required?: boolean;
    readonly unexpectedValueMessage?: string;
    readonly usageErrorPrefix?: 'kovo';
  } = {},
>(
  name: Name,
  schema: Schema,
  options: Options = {} as Options,
): Readonly<{
  kind: 'argument';
  name: Name;
  required: Options extends { readonly required: infer Required extends boolean } ? Required : true;
  value: Schema;
}> &
  Omit<Options, 'required'> {
  return {
    kind: 'argument',
    name,
    required: options.required ?? true,
    value: schema,
    ...(options.description === undefined ? {} : { description: options.description }),
    ...(options.invalidValueMessage === undefined
      ? {}
      : { invalidValueMessage: options.invalidValueMessage }),
    ...(options.invalidValueUsage === undefined
      ? {}
      : { invalidValueUsage: options.invalidValueUsage }),
    ...(options.missingValueMessage === undefined
      ? {}
      : { missingValueMessage: options.missingValueMessage }),
    ...(options.repeatable === undefined ? {} : { repeatable: options.repeatable }),
    ...(options.unexpectedValueMessage === undefined
      ? {}
      : { unexpectedValueMessage: options.unexpectedValueMessage }),
    ...(options.usageErrorPrefix === undefined
      ? {}
      : { usageErrorPrefix: options.usageErrorPrefix }),
  } as Readonly<{
    kind: 'argument';
    name: Name;
    required: Options extends { readonly required: infer Required extends boolean }
      ? Required
      : true;
    value: Schema;
  }> &
    Omit<Options, 'required'>;
}

function literal<const Value extends string>(
  value: Value,
  description?: string,
): Readonly<{ description?: string; kind: 'literal'; value: Value }> {
  return {
    kind: 'literal',
    value,
    ...(description === undefined ? {} : { description }),
  };
}

function option<const Option extends string, const Required extends boolean = false>(
  option: Option,
  required: Required = false as Required,
  valueLabel?: string,
): Readonly<{ kind: 'option'; option: Option; valueLabel?: string }> &
  (Required extends true ? Readonly<{ required: true }> : unknown) {
  return {
    kind: 'option',
    option,
    ...(required ? { required: true } : {}),
    ...(valueLabel === undefined ? {} : { valueLabel }),
  } as Readonly<{ kind: 'option'; option: Option; valueLabel?: string }> &
    (Required extends true ? Readonly<{ required: true }> : unknown);
}

function optionGroup<
  const Tokens extends readonly {
    readonly kind: 'option';
    readonly option: string;
    readonly required?: boolean;
    readonly valueLabel?: string;
  }[],
  const Required extends boolean = false,
>(
  tokens: Tokens,
  required: Required = false as Required,
): Readonly<{ kind: 'group'; required: Required; tokens: Tokens }> {
  return { kind: 'group', required, tokens };
}

function flag<
  const Id extends string,
  const Flags extends readonly [`--${string}`, ...string[]],
  const Options extends Omit<KovoCommandOptionSchema, 'description' | 'flags' | 'id'>,
>(
  id: Id,
  flags: Flags,
  description: string,
  options: Options = {} as Options,
): Readonly<{ description: string; flags: Flags; id: Id }> & Options {
  return { id, flags, description, ...options };
}

const diagnosticFormatOption = flag(
  'format',
  ['--format'],
  'Select human, JSON, or GitHub diagnostic output.',
  {
    category: 'output',
    invalidValueMessage: 'kovo: --format requires human, json, or github.\n',
    missingValueMessage: 'kovo: --format requires human, json, or github.\n',
    value: value('enum', 'human|json|github', {
      default: 'human',
      values: ['human', 'json', 'github'],
    }),
  },
);

const checkOptions = [
  flag('feed', ['--feed'], 'Override the default HTTPS advisory feed.', {
    category: 'input',
    missingValueMessage: 'kovo: check advisories --feed requires a URL or file.\n',
    value: value('string', 'url|file'),
  }),
  flag('attestation', ['--attestation'], 'Use an explicit Sigstore attestation bundle.', {
    category: 'input',
    missingValueMessage: 'kovo: check advisories --attestation requires a URL or file.\n',
    value: value('string', 'url|file'),
  }),
  flag('state', ['--state'], 'Override the local advisory epoch/equivocation state file.', {
    category: 'input',
    missingValueMessage: 'kovo: check advisories --state requires a file.\n',
    value: value('path', 'file', { default: '.kovo/advisory-state.json' }),
  }),
  flag('severityFloor', ['--severity-floor'], 'Set the blocking advisory severity floor.', {
    category: 'selection',
    invalidValueMessage: 'kovo: --severity-floor must be low, moderate, high, or critical.\n',
    missingValueMessage: 'kovo: check advisories --severity-floor requires a severity.\n',
    value: value('enum', 'low|moderate|high|critical', {
      default: 'high',
      values: ['low', 'moderate', 'high', 'critical'],
    }),
  }),
  diagnosticFormatOption,
] as const;

const explainOptions = [
  flag('optimistic', ['--optimistic'], 'Include optimistic-update detail.', {
    category: 'selection',
  }),
  flag('layouts', ['--layouts'], 'Include the page layout chain.', { category: 'selection' }),
  flag('sourcesSinks', ['--sources-sinks'], 'Print the source/sink inventory.', {
    category: 'selection',
  }),
  flag('tasks', ['--tasks'], 'List durable-task facts and composition edges.', {
    category: 'selection',
  }),
  flag('agent', ['--agent'], 'Print model/tool effect closures by integrity level.', {
    category: 'selection',
  }),
  flag('grants', ['--grants'], 'Print compiler-derived grant and attenuation facts.', {
    category: 'selection',
  }),
  flag('endpoints', ['--endpoints'], 'Audit every machine-ingress surface.', {
    category: 'selection',
  }),
  flag('revealed', ['--revealed'], 'List confidentiality reveals and their proof grade.', {
    category: 'selection',
  }),
  flag('trust', ['--trust'], 'List explicit trust escape hatches.', {
    category: 'selection',
  }),
  flag('capabilities', ['--capabilities'], 'List held capabilities and closed paths.', {
    category: 'selection',
  }),
  flag('cookies', ['--cookies'], 'List cookie posture and downgrade findings.', {
    category: 'selection',
  }),
  flag('authLifecycle', ['--auth-lifecycle'], 'Print the Better Auth lifecycle contract.', {
    category: 'selection',
  }),
  flag('modelBoundaries', ['--model-boundaries'], 'Print bounded-model assumptions.', {
    category: 'selection',
  }),
  flag('authorization', ['--authorization'], 'Compare app guard facts and Postgres policies.', {
    category: 'selection',
  }),
  flag('access', ['--access'], 'Review producer-owned access decisions.', {
    category: 'selection',
  }),
  flag('unguarded', ['--unguarded'], 'Audit handlers reachable without a guard.', {
    category: 'selection',
  }),
  flag('unscoped', ['--unscoped'], 'Audit owner data reached without owner scope.', {
    category: 'selection',
  }),
  flag('failOnFindings', ['--fail-on-findings'], 'Exit 1 when an audit reports findings.', {
    category: 'posture',
  }),
  flag('attest', ['--attest'], 'Attest a live deployment URL.', {
    category: 'input',
    missingValueMessage: 'kovo: explain --attest requires a deployment URL.\n',
    value: value('url', 'url'),
  }),
  flag('artifact', ['--artifact'], 'Use the explicitly named build graph.', {
    category: 'input',
    missingValueMessage: 'kovo: explain --artifact requires a graph path.\n',
    value: value('path', 'graph.json'),
  }),
  flag('trustAnchor', ['--trust-anchor'], 'Verify with the named SHA-256 trust anchor.', {
    category: 'posture',
    missingValueMessage: 'kovo: explain --trust-anchor requires a sha256 fingerprint.\n',
    value: value('string', 'sha256:fingerprint'),
  }),
  flag('escapeReviews', ['--escape-reviews'], 'Read signed escape-obligation reviews.', {
    category: 'input',
    missingValueMessage: 'kovo: explain --escape-reviews requires a review file.\n',
    value: value('path', 'reviews.json'),
  }),
  flag('escapeCensusReviews', ['--escape-census-reviews'], 'Read signed escape-census reviews.', {
    category: 'input',
    missingValueMessage: 'kovo: explain --escape-census-reviews requires a review file.\n',
    value: value('path', 'reviews.json'),
  }),
  diagnosticFormatOption,
] as const;

const compileOptions = [
  flag('out', ['--out'], 'Artifact path to write or verify.', {
    category: 'output',
    missingValueMessage: 'kovo: compile --out requires a path.\n',
    value: value('path', 'path'),
  }),
  flag('fileName', ['--file-name'], 'Logical source file name used in diagnostics.', {
    category: 'input',
    missingValueMessage: 'kovo: compile --file-name requires a name.\n',
    value: value('string', 'name'),
  }),
  flag('artifactFileName', ['--artifact-file-name'], 'Logical generated route artifact name.', {
    category: 'output',
    missingValueMessage: 'kovo: compile route --artifact-file-name requires a name.\n',
    value: value('string', 'name'),
  }),
  flag('check', ['--check'], 'Verify current output instead of writing.', { category: 'posture' }),
  flag('fixpoint', ['--fixpoint'], 'Assert the lowered component is a fixpoint.', {
    category: 'posture',
  }),
  flag('renderEquivalence', ['--render-equivalence'], 'Assert authored/lowered render parity.', {
    category: 'posture',
  }),
  flag('registryFacts', ['--registry-facts'], 'Read component registry facts from JSON.', {
    category: 'input',
    missingValueMessage: 'kovo: compile component --registry-facts requires a JSON path.\n',
    value: value('path', 'json'),
  }),
  flag('queryShapeFacts', ['--query-shape-facts'], 'Read query-shape facts from JSON.', {
    category: 'input',
    missingValueMessage: 'kovo: compile component --query-shape-facts requires a JSON path.\n',
    value: value('path', 'json'),
  }),
  flag('factsOut', ['--facts-out'], 'Write compiler-derived facts as JSON.', {
    category: 'output',
    missingValueMessage: 'kovo: compile --facts-out requires a JSON path.\n',
    value: value('path', 'json'),
  }),
  flag('emitClientFiles', ['--emit-client-files'], 'Emit/check component client artifacts.', {
    category: 'output',
  }),
  flag('allowDiagnostic', ['--allow-diagnostic'], 'Allow one registered diagnostic code.', {
    category: 'posture',
    missingValueMessage: 'kovo: compile component --allow-diagnostic requires a code.\n',
    repeatable: true,
    value: value('string', 'code'),
  }),
  flag('rewrite', ['--rewrite'], 'Rewrite one route component import.', {
    category: 'input',
    missingValueMessage: 'kovo: compile route --rewrite requires Local=specifier.\n',
    repeatable: true,
    value: value('string', 'Local=specifier'),
  }),
  flag('entry', ['--entry'], 'Source entry used for component-prefix discovery.', {
    category: 'input',
    missingValueMessage: 'kovo: compile package-css --entry requires a source path.\n',
    value: value('path', 'source.ts'),
  }),
] as const;

/**
 * @internal Complete semantic command AST. Its 14 capability commands are
 * intentionally grouped into daily/build, inspect/security, and agent/operator.
 */
export const KOVO_COMMAND_SCHEMA = deepFreezeSemanticSchema([
  {
    aliases: [],
    async: true,
    category: 'daily-build',
    compilerRealm: 'unlocked',
    examples: ['kovo add button', 'kovo add button card --out src/components/ui'],
    exits,
    name: 'add',
    options: [
      flag('out', ['--out'], 'Destination for copied component source.', {
        category: 'output',
        missingValueMessage: 'kovo: add --out requires a directory.\n',
        value: value('path', 'dir', { default: 'src/components/ui' }),
      }),
    ],
    order: 10,
    processLifecycle: 'one-shot',
    referenceUsage: 'inline',
    resultProtocol: 'kovo-add/v1',
    summary: 'Copy public @kovojs/ui component source into an application.',
    usage: [
      {
        id: 'components',
        tokens: [
          argument(
            'components',
            value('enum', 'component', {
              usage: 'label',
              values: KOVO_ADD_COMPONENT_NAMES,
            }),
            {
              description: 'One or more component catalog names.',
              invalidValueMessage: `kovo: unknown component {value}. available: ${KOVO_ADD_COMPONENT_NAMES.join(', ')}.\n`,
              invalidValueUsage: 'omit',
              repeatable: true,
            },
          ),
          option('out'),
        ],
      },
    ],
  },
  {
    aliases: [],
    category: 'inspect-security',
    compilerRealm: 'unlocked',
    examples: ['kovo audit', 'kovo audit --fail-on-findings graph.json'],
    exits,
    name: 'audit',
    options: [
      flag('failOnFindings', ['--fail-on-findings'], 'Exit 1 when the audit finds issues.', {
        category: 'posture',
      }),
    ],
    order: 20,
    processLifecycle: 'one-shot',
    referenceUsage: 'inline',
    resultProtocol: 'kovo-audit/v1',
    summary: 'Run security and access audits over an app graph.',
    usage: [
      {
        id: 'audit',
        tokens: [
          option('failOnFindings'),
          argument('graph', value('path', 'graph.json'), {
            required: false,
            usageErrorPrefix: 'kovo',
          }),
        ],
      },
    ],
  },
  {
    aliases: [],
    async: true,
    category: 'daily-build',
    compilerRealm: 'locked-before-dispatch',
    examples: ['kovo build ./src/app.tsx --out dist', 'kovo build ./src/app.tsx --check'],
    exits,
    name: 'build',
    options: [
      flag('out', ['--out'], 'Output directory for production artifacts.', {
        category: 'output',
        missingValueMessage: 'kovo: build --out requires a directory.\n',
        value: value('path', 'dir', { default: 'dist' }),
      }),
      flag('preset', ['--preset'], 'Select the deployment preset.', {
        category: 'posture',
        invalidValueMessage: 'kovo: unsupported build preset {value}.\n',
        missingValueMessage: 'kovo: build --preset requires a preset name.\n',
        value: value('enum', 'name', { values: ['node', 'vercel', 'cloudflare'] }),
      }),
      flag('check', ['--check'], 'Run every preflight without promoting output.', {
        category: 'posture',
      }),
      flag('cache', ['--no-cache'], 'Disable build analysis caches.', {
        booleanValue: false,
        category: 'advanced',
        defaultBoolean: true,
      }),
      diagnosticFormatOption,
    ],
    order: 30,
    processLifecycle: 'one-shot',
    referenceUsage: 'inline',
    resultProtocol: 'kovo-build/v1',
    summary: 'Prove and build an authored Kovo app for deployment.',
    usage: [
      {
        id: 'build',
        tokens: [
          argument('appModule', value('path', 'app-module'), {
            missingValueMessage: 'kovo: build requires an app module path.\n',
            unexpectedValueMessage: 'kovo: build accepts one app module path.\n',
          }),
          option('out'),
          option('preset'),
          option('check'),
          option('cache'),
          option('format'),
        ],
      },
    ],
  },
  {
    aliases: [],
    category: 'inspect-security',
    compilerRealm: 'unlocked',
    examples: [
      'kovo check',
      'kovo check coverage graph.json',
      'kovo check env deployment.json',
      'kovo check advisories .kovo/graph.json',
    ],
    exits: exitsWithUnknown,
    name: 'check',
    options: checkOptions,
    order: 40,
    processLifecycle: 'one-shot',
    referenceUsage: 'inline',
    resultProtocol: 'kovo-check/v1',
    summary: 'Run consistency, security, environment, and advisory verification.',
    usageErrorPrefix: 'kovo',
    usage: [
      {
        id: 'graph',
        tokens: [
          argument(
            'family',
            value('enum', 'optimistic|coverage|endpoint-posture|sources-sinks', {
              values: ['optimistic', 'coverage', 'endpoint-posture', 'sources-sinks'],
            }),
            {
              description: 'Select one focused graph-verification family.',
              invalidValueMessage:
                'kovo: unsupported check family {value}. expected env, optimistic, coverage, endpoint-posture, or sources-sinks.\n',
              invalidValueUsage: 'omit',
              required: false,
            },
          ),
          argument('graph', value('path', 'graph.json'), { required: false }),
          option('format'),
        ],
      },
      {
        id: 'environment',
        summary: 'Probe the deployment assume-guarantee contract.',
        tokens: [
          literal('env', 'Probe deployment environment obligations.'),
          argument('deployment', value('path', 'deployment.json'), { required: false }),
          option('format'),
        ],
      },
      {
        async: true,
        id: 'advisories',
        summary: 'Authenticate and match the signed Kovo advisory feed.',
        tokens: [
          literal('advisories', 'Check authenticated Kovo security advisories.'),
          argument('graph', value('path', 'graph.json'), { required: false }),
          option('feed'),
          option('attestation'),
          option('state'),
          option('severityFloor'),
          option('format'),
        ],
      },
    ],
  },
  {
    aliases: [],
    async: true,
    category: 'agent-operator',
    compilerRealm: 'unlocked',
    examples: [
      'kovo compile component src/cart.tsx --out dist/cart.tsx --check',
      'kovo compile route src/app.tsx --out dist/app.kovo-route.tsx',
      'kovo compile package-css @kovojs/ui --entry src/app.ts --out dist/ui.css',
    ],
    exits,
    name: 'compile',
    options: compileOptions,
    order: 50,
    processLifecycle: 'one-shot',
    referenceUsage: 'multiline',
    resultProtocol: 'kovo-compile/v1',
    summary: 'Emit compiler-owned artifacts without importing compiler internals.',
    usage: [
      {
        id: 'component',
        tokens: [
          literal('component', 'Lower one authored component.'),
          argument('source', value('path', 'source.tsx'), {
            missingValueMessage: 'kovo: compile component requires a source path.\n',
            unexpectedValueMessage: 'kovo: compile component accepts one source path.\n',
          }),
          option('out', true, 'artifact.tsx'),
          option('fileName'),
          option('check'),
          option('fixpoint'),
          option('renderEquivalence'),
          option('registryFacts'),
          option('queryShapeFacts'),
          option('factsOut'),
          option('emitClientFiles'),
          option('allowDiagnostic'),
        ],
      },
      {
        id: 'route',
        tokens: [
          literal('route', 'Lower one authored route.'),
          argument('source', value('path', 'source.tsx'), {
            missingValueMessage: 'kovo: compile route requires a source path.\n',
            unexpectedValueMessage: 'kovo: compile route accepts one source path.\n',
          }),
          option('out', true, 'artifact.tsx'),
          option('fileName'),
          option('artifactFileName'),
          option('rewrite'),
          option('factsOut'),
          option('check'),
        ],
      },
      {
        id: 'graph',
        tokens: [
          literal('graph', 'Compile a graph input artifact.'),
          argument('input', value('path', 'input.json'), {
            missingValueMessage: 'kovo: compile graph requires an input path.\n',
            unexpectedValueMessage: 'kovo: compile graph accepts one input path.\n',
          }),
          option('out', true, 'graph.json'),
          option('check'),
        ],
      },
      {
        id: 'mutation-inputs',
        tokens: [
          literal('mutation-inputs', 'Extract mutation-input facts.'),
          argument('source', value('path', 'source.ts'), {
            missingValueMessage: 'kovo: compile mutation-inputs requires a source path.\n',
            unexpectedValueMessage: 'kovo: compile mutation-inputs accepts one source path.\n',
          }),
          option('out', true, 'facts.json'),
          option('fileName'),
          option('check'),
        ],
      },
      {
        id: 'drizzle-static',
        tokens: [
          literal('drizzle-static', 'Derive static Drizzle facts.'),
          argument('input', value('path', 'input.json'), {
            missingValueMessage: 'kovo: compile drizzle-static requires an input path.\n',
            unexpectedValueMessage: 'kovo: compile drizzle-static accepts one input path.\n',
          }),
          option('out', true, 'facts.json'),
          option('check'),
        ],
      },
      {
        id: 'drizzle-optimistic',
        tokens: [
          literal('drizzle-optimistic', 'Derive a Drizzle optimistic transform.'),
          argument('input', value('path', 'input.json'), {
            missingValueMessage: 'kovo: compile drizzle-optimistic requires an input path.\n',
            unexpectedValueMessage: 'kovo: compile drizzle-optimistic accepts one input path.\n',
          }),
          option('out', true, 'artifact.ts'),
          option('factsOut'),
          option('check'),
        ],
      },
      {
        id: 'package-css',
        tokens: [
          literal('package-css', 'Extract CSS for a public component package.'),
          argument('package', value('string', 'package'), {
            missingValueMessage: 'kovo: compile package-css requires a package name.\n',
            unexpectedValueMessage: 'kovo: compile package-css accepts one package name.\n',
          }),
          option('out', true, 'file.css'),
          option('entry'),
          option('check'),
        ],
      },
    ],
  },
  {
    aliases: [],
    async: true,
    category: 'agent-operator',
    compilerRealm: 'locked-before-dispatch',
    examples: ['kovo db provision --schema src/schema.ts', 'kovo db check --driver pglite'],
    exits,
    name: 'db',
    options: [
      flag('schema', ['--schema'], 'Schema module path.', {
        category: 'input',
        missingValueMessage: 'kovo: db --schema requires a module path.\n',
        value: value('path', 'module', { default: 'src/schema.ts' }),
      }),
      flag('migrations', ['--migrations'], 'Directory of reviewed SQL migrations.', {
        category: 'input',
        missingValueMessage: 'kovo: db --migrations requires a directory.\n',
        value: value('path', 'dir', { default: 'migrations' }),
      }),
      flag('driver', ['--driver'], 'Select the database driver.', {
        category: 'posture',
        invalidValueMessage: 'kovo: unsupported db driver {value}.\n',
        missingValueMessage: 'kovo: db --driver requires pglite, pg, or node-postgres.\n',
        value: value('enum', 'pglite|pg|node-postgres', {
          values: ['pglite', 'pg', 'node-postgres'],
        }),
      }),
      flag('databaseUrl', ['--database-url'], 'Least-privilege runtime database URL.', {
        category: 'posture',
        missingValueMessage: 'kovo: db --database-url requires a URL.\n',
        value: value('url', 'url'),
      }),
      flag('adminDatabaseUrl', ['--admin-database-url'], 'Privileged setup/check URL.', {
        category: 'posture',
        missingValueMessage: 'kovo: db --admin-database-url requires a URL.\n',
        value: value('url', 'url'),
      }),
      flag('systemDatabaseUrl', ['--system-database-url'], 'Least-privilege system/check URL.', {
        category: 'posture',
        missingValueMessage: 'kovo: db --system-database-url requires a URL.\n',
        value: value('url', 'url'),
      }),
      flag('dataDir', ['--data-dir'], 'PGlite development data directory.', {
        category: 'input',
        missingValueMessage: 'kovo: db --data-dir requires a directory.\n',
        value: value('path', 'dir'),
      }),
      flag('readerRole', ['--reader-role'], 'Reader database role.', {
        category: 'posture',
        missingValueMessage: 'kovo: db --reader-role requires a role name.\n',
        value: value('string', 'role'),
      }),
      flag('writerRole', ['--writer-role'], 'Writer database role.', {
        category: 'posture',
        missingValueMessage: 'kovo: db --writer-role requires a role name.\n',
        value: value('string', 'role'),
      }),
    ],
    order: 60,
    processLifecycle: 'one-shot',
    referenceUsage: 'inline',
    resultProtocol: 'kovo-db/v1',
    summary: 'Provision, migrate, generate, or verify a Kovo database.',
    usage: [
      {
        id: 'db',
        tokens: [
          argument(
            'action',
            value('enum', 'provision|migrate|generate|check', {
              values: ['provision', 'migrate', 'generate', 'check'],
            }),
            {
              description: 'Select the database lifecycle action.',
              invalidValueMessage: 'kovo: db requires provision, migrate, generate, or check.\n',
              missingValueMessage: 'kovo: db requires provision, migrate, generate, or check.\n',
              unexpectedValueMessage: 'kovo: db accepts one action.\n',
            },
          ),
          option('schema'),
          option('migrations'),
          option('driver'),
          option('databaseUrl'),
          option('adminDatabaseUrl'),
          option('systemDatabaseUrl'),
          option('dataDir'),
          option('readerRole'),
          option('writerRole'),
        ],
      },
    ],
  },
  {
    aliases: [],
    async: true,
    category: 'daily-build',
    compilerRealm: 'locked-before-dispatch',
    examples: ['kovo dev ./src/app.tsx', 'kovo dev ./src/app.tsx --port 4173 --strict-port'],
    exits,
    name: 'dev',
    options: [
      flag('root', ['--root'], 'Project root.', {
        category: 'input',
        missingValueMessage: 'kovo: dev --root requires a directory.\n',
        value: value('path', 'dir', { default: '.' }),
      }),
      flag('config', ['--config'], 'Restricted authored client-plugin config.', {
        category: 'input',
        missingValueMessage: 'kovo: dev --config requires a file.\n',
        value: value('path', 'file'),
      }),
      flag('host', ['--host'], 'Vite listen host.', {
        category: 'posture',
        missingValueMessage: 'kovo: dev --host requires a host.\n',
        value: value('string', 'host'),
      }),
      flag('port', ['--port'], 'Vite listen port.', {
        category: 'posture',
        invalidValueMessage: 'kovo: dev --port must be an integer from 0 through 65535.\n',
        missingValueMessage: 'kovo: dev --port requires a port.\n',
        value: value('integer', 'port', { maximum: 65_535, minimum: 0 }),
      }),
      flag('strictPort', ['--strict-port'], 'Fail instead of selecting another occupied port.', {
        category: 'posture',
      }),
      flag('mode', ['--mode'], 'Vite mode.', {
        category: 'posture',
        missingValueMessage: 'kovo: dev --mode requires a mode.\n',
        value: value('string', 'mode', { default: 'development' }),
      }),
      flag('debug', ['--debug'], 'Show verbose Vite development logs.', {
        category: 'advanced',
      }),
    ],
    order: 70,
    processLifecycle: 'long-lived',
    referenceUsage: 'inline',
    resultProtocol: null,
    summary: 'Start the bootstrap-first Kovo development server.',
    usage: [
      {
        id: 'dev',
        tokens: [
          argument('appModule', value('path', 'app-module'), {
            missingValueMessage: 'kovo: dev requires an app module path.\n',
            unexpectedValueMessage: 'kovo: dev accepts one app module path.\n',
          }),
          option('root'),
          option('config'),
          option('host'),
          option('port'),
          option('strictPort'),
          option('mode'),
          option('debug'),
        ],
      },
    ],
  },
  {
    aliases: [],
    async: true,
    category: 'agent-operator',
    compilerRealm: 'unlocked',
    examples: [
      'kovo docs quickstart',
      'kovo docs "authenticated mutation" --limit 3 --format json',
    ],
    exits,
    name: 'docs',
    options: [
      flag('limit', ['--limit'], 'Maximum number of authenticated local results.', {
        category: 'selection',
        invalidValueMessage: 'kovo: docs --limit must be an integer from 1 through 8.\n',
        missingValueMessage: 'kovo: docs --limit requires an integer from 1 through 8.\n',
        value: value('integer', 'count', { default: 5, maximum: 8, minimum: 1 }),
      }),
      flag('format', ['--format'], 'Select human or machine-readable output.', {
        category: 'output',
        invalidValueMessage: 'kovo: docs --format requires human or json.\n',
        missingValueMessage: 'kovo: docs --format requires human or json.\n',
        value: value('enum', 'human|json', { default: 'human', values: ['human', 'json'] }),
      }),
    ],
    order: 75,
    processLifecycle: 'one-shot',
    referenceUsage: 'inline',
    resultProtocol: 'kovo-docs/v1',
    summary: 'Search the exact version-matched local Kovo documentation snapshot.',
    usage: [
      {
        id: 'docs',
        tokens: [
          argument('task', value('string', 'task'), {
            missingValueMessage: 'kovo: docs requires a task.\n',
            unexpectedValueMessage: 'kovo: docs accepts one task.\n',
          }),
          option('limit'),
          option('format'),
        ],
      },
    ],
  },
  {
    aliases: [],
    category: 'inspect-security',
    compilerRealm: 'unlocked',
    examples: [
      'kovo explain component Cart graph.json',
      'kovo explain --capabilities',
      'kovo explain --access --fail-on-findings',
    ],
    exits,
    name: 'explain',
    options: explainOptions,
    order: 80,
    processLifecycle: 'one-shot',
    referenceUsage: 'multiline',
    resultProtocol: 'kovo-explain/v1',
    summary: 'Render stable proof facts for a subject or security review.',
    usageErrorPrefix: 'kovo',
    usage: [
      {
        id: 'target',
        optionRequiresArgument: [
          { argument: 'kind', option: 'optimistic', values: ['mutation'] },
          { argument: 'kind', option: 'layouts', values: ['page'] },
        ],
        tokens: [
          argument(
            'kind',
            value('enum', 'component|mutation|query|page|context|task', {
              values: ['component', 'mutation', 'query', 'page', 'context', 'task'],
            }),
            { description: 'Select a graph subject kind.' },
          ),
          argument('target', value('string', 'target')),
          option('optimistic'),
          option('layouts'),
          argument('graph', value('path', 'graph.json'), { required: false }),
          option('format'),
        ],
      },
      {
        id: 'document',
        tokens: [
          literal('document', 'Explain the framework-owned document shell.'),
          argument('graph', value('path', 'graph.json'), { required: false }),
          option('format'),
        ],
      },
      {
        id: 'sources-sinks',
        tokens: [
          option('sourcesSinks', true),
          argument('graph', value('path', 'graph.json'), { required: false }),
          option('format'),
        ],
      },
      {
        id: 'tasks',
        tokens: [
          option('tasks', true),
          argument('graph', value('path', 'graph.json'), { required: false }),
          option('format'),
        ],
      },
      {
        id: 'agent',
        tokens: [
          option('agent', true),
          argument('graph', value('path', 'graph.json'), { required: false }),
          option('format'),
        ],
      },
      {
        id: 'grants',
        tokens: [
          option('grants', true),
          argument('graph', value('path', 'graph.json'), { required: false }),
          option('format'),
        ],
      },
      {
        id: 'endpoints',
        tokens: [
          option('endpoints', true),
          argument('graph', value('path', 'graph.json'), { required: false }),
          option('format'),
        ],
      },
      {
        id: 'revealed',
        tokens: [
          option('revealed', true),
          argument('graph', value('path', 'graph.json'), { required: false }),
          option('format'),
        ],
      },
      {
        id: 'trust',
        tokens: [
          option('trust', true),
          argument('graph', value('path', 'graph.json'), { required: false }),
          option('format'),
        ],
      },
      {
        id: 'capabilities',
        tokens: [
          option('capabilities', true),
          argument('graph', value('path', 'graph.json'), { required: false }),
          option('format'),
        ],
      },
      {
        id: 'cookies',
        tokens: [
          option('cookies', true),
          argument('graph', value('path', 'graph.json'), { required: false }),
          option('format'),
        ],
      },
      {
        id: 'authorization',
        tokens: [
          option('authorization', true),
          argument('graph', value('path', 'graph.json'), { required: false }),
          option('format'),
        ],
      },
      {
        id: 'access',
        tokens: [
          option('access', true),
          option('failOnFindings'),
          argument('graph', value('path', 'graph.json'), { required: false }),
          option('format'),
        ],
      },
      {
        id: 'unguarded',
        tokens: [
          option('unguarded', true),
          option('failOnFindings'),
          argument('graph', value('path', 'graph.json'), { required: false }),
          option('format'),
        ],
      },
      {
        id: 'unscoped',
        tokens: [
          option('unscoped', true),
          option('failOnFindings'),
          argument('graph', value('path', 'graph.json'), { required: false }),
          option('format'),
        ],
      },
      {
        id: 'auth-lifecycle',
        tokens: [option('authLifecycle', true), option('format')],
      },
      {
        id: 'model-boundaries',
        tokens: [option('modelBoundaries', true), option('format')],
      },
      {
        async: true,
        id: 'attest',
        tokens: [
          option('attest', true),
          option('artifact', true),
          option('trustAnchor', true),
          option('escapeReviews'),
          option('escapeCensusReviews'),
          option('format'),
        ],
      },
    ],
  },
  {
    aliases: [],
    async: true,
    category: 'daily-build',
    compilerRealm: 'locked-before-dispatch',
    examples: ['kovo export ./src/app.ts --out dist'],
    exits,
    name: 'export',
    options: [
      flag('vite', ['--vite'], 'Load the app through Vite SSR.', { category: 'posture' }),
      flag('root', ['--root'], 'Project root for Vite loading.', {
        category: 'input',
        missingValueMessage: 'kovo: export --root requires a directory.\n',
        value: value('path', 'dir'),
      }),
      flag('out', ['--out'], 'Static export output directory.', {
        category: 'output',
        missingValueMessage: 'kovo: export --out requires a directory.\n',
        value: value('path', 'dir', { default: 'dist' }),
      }),
      flag('origin', ['--origin'], 'Absolute canonical origin.', {
        category: 'posture',
        missingValueMessage: 'kovo: export --origin requires a URL.\n',
        value: value('url', 'url'),
      }),
      flag('manifest', ['--manifest'], 'Vite manifest to copy assets from.', {
        category: 'input',
        missingValueMessage: 'kovo: export --manifest requires a file.\n',
        value: value('path', 'file'),
      }),
      flag('dist', ['--dist'], 'Vite output directory containing manifest assets.', {
        category: 'input',
        missingValueMessage: 'kovo: export --dist requires a directory.\n',
        value: value('path', 'dir'),
      }),
      flag('assetBase', ['--asset-base'], 'URL path prefix for exported assets.', {
        category: 'output',
        missingValueMessage: 'kovo: export --asset-base requires a URL path.\n',
        value: value('string', 'path'),
      }),
      flag('skipNonExportable', ['--skip-non-exportable'], 'Skip non-exportable routes.', {
        category: 'posture',
      }),
    ],
    order: 90,
    processLifecycle: 'one-shot',
    referenceUsage: 'inline',
    resultProtocol: 'kovo-export/v1',
    summary: 'Export a Kovo app as static hosting output.',
    usage: [
      {
        id: 'export',
        tokens: [
          argument('appModule', value('path', 'app-module')),
          option('vite'),
          option('root'),
          option('out'),
          option('origin'),
          optionGroup([
            { kind: 'option', option: 'manifest', required: true },
            { kind: 'option', option: 'dist', required: true },
          ]),
          option('assetBase'),
          option('skipNonExportable'),
        ],
      },
    ],
  },
  {
    aliases: [],
    async: true,
    category: 'agent-operator',
    compilerRealm: 'locked-before-dispatch',
    examples: ['kovo fix src/components/cart.tsx', 'kovo fix --cost-report'],
    exits,
    name: 'fix',
    options: [
      flag('check', ['--check'], 'Report safe rewrites without writing.', {
        category: 'posture',
      }),
      flag('costReport', ['--cost-report'], 'Measure safe-vs-escape edit cost.', {
        category: 'selection',
      }),
    ],
    order: 100,
    processLifecycle: 'one-shot',
    referenceUsage: 'inline',
    resultProtocol: null,
    summary: 'Apply only compiler-proven safe TSX/JSX rewrites.',
    usage: [
      {
        id: 'source',
        tokens: [argument('source', value('path', 'source.tsx|source.jsx')), option('check')],
      },
      { id: 'cost-report', tokens: [option('costReport', true)] },
    ],
  },
  {
    aliases: [],
    category: 'inspect-security',
    compilerRealm: 'unlocked',
    examples: ['kovo incident scope advisory.json --events security-events.json'],
    exits,
    name: 'incident',
    options: [
      flag('events', ['--events'], 'Bounded security-event export to inspect.', {
        category: 'input',
        missingValueMessage: 'kovo: incident --events requires a security-event export path.\n',
        value: value('path', 'security-events.json'),
      }),
    ],
    order: 110,
    processLifecycle: 'one-shot',
    referenceUsage: 'inline',
    resultProtocol: 'kovo-incident-scope/v1',
    summary: 'Scope an advisory over a tamper-evident security-event export.',
    usage: [
      {
        id: 'scope',
        tokens: [
          literal('scope', 'Evaluate the finite advisory decision-site predicate.'),
          argument('advisory', value('path', 'advisory.json')),
          option('events', true),
        ],
      },
    ],
  },
  {
    aliases: [],
    async: true,
    category: 'agent-operator',
    compilerRealm: 'unlocked',
    examples: ['kovo mcp'],
    exits,
    name: 'mcp',
    options: [],
    order: 120,
    processLifecycle: 'long-lived',
    referenceUsage: 'inline',
    resultProtocol: 'kovo-mcp/v1',
    summary: 'Serve the finite Kovo MCP protocol over stdio.',
    usage: [{ id: 'mcp', tokens: [] }],
  },
  {
    aliases: [],
    async: true,
    category: 'agent-operator',
    compilerRealm: 'unlocked',
    examples: ['kovo update-docs'],
    exits,
    name: 'update-docs',
    options: [],
    order: 130,
    processLifecycle: 'one-shot',
    referenceUsage: 'inline',
    resultProtocol: 'kovo-update-docs/v1',
    summary: 'Refresh version-matched agent-readable Kovo documentation.',
    usage: [{ id: 'update-docs', tokens: [] }],
  },
] as const satisfies readonly KovoCommandSchemaEntry[]);

const capabilityAndMetaCommandNames = [
  ...KOVO_COMMAND_SCHEMA.map((entry) => entry.name),
  'completion',
  'help',
  'version',
] as const;

/**
 * @internal Complete CLI AST, including global aliases and meta-command
 * validation. Help, version, completion, capability parsing, and references
 * project from this object.
 */
export const KOVO_CLI_SCHEMA = deepFreezeSemanticSchema({
  commands: KOVO_COMMAND_SCHEMA,
  globalOptions: [
    flag('help', ['--help', '-h'], 'Show generated help.'),
    flag('version', ['--version', '-V'], 'Show the installed CLI version.'),
  ],
  metaCommands: [
    {
      aliases: [],
      examples: ['kovo help', 'kovo help build'],
      name: 'help',
      options: [],
      summary: 'Show generated root or command help.',
      usage: [
        {
          id: 'help',
          tokens: [
            argument(
              'command',
              value('enum', 'command', { values: capabilityAndMetaCommandNames }),
              { required: false },
            ),
          ],
        },
      ],
    },
    {
      aliases: [],
      examples: ['kovo version'],
      name: 'version',
      options: [],
      summary: 'Show the installed CLI version.',
      usage: [{ id: 'version', tokens: [] }],
    },
    {
      aliases: [],
      examples: ['kovo completion bash'],
      name: 'completion',
      options: [],
      summary: 'Generate a shell completion program.',
      usage: [
        {
          id: 'completion',
          tokens: [
            argument('shell', value('enum', 'bash|fish|zsh', { values: ['bash', 'fish', 'zsh'] }), {
              invalidValueMessage: 'kovo: completion requires bash, zsh, or fish.\n',
              missingValueMessage: 'kovo: completion requires bash, zsh, or fish.\n',
            }),
          ],
        },
      ],
    },
  ],
  name: 'kovo',
} as const satisfies {
  readonly commands: readonly KovoCommandSchemaEntry[];
  readonly globalOptions: readonly KovoCommandOptionSchema[];
  readonly metaCommands: readonly KovoMetaCommandSchemaEntry[];
  readonly name: 'kovo';
});

/** @internal One literal capability command name. */
export type KovoCommandName = (typeof KOVO_COMMAND_SCHEMA)[number]['name'];

/** @internal One literal framework-owned meta-command name. */
export type KovoMetaCommandName = (typeof KOVO_CLI_SCHEMA.metaCommands)[number]['name'];

/** @internal One concrete semantic command node. */
export type KovoCommandEntry = (typeof KOVO_COMMAND_SCHEMA)[number];

/** @internal Commands whose handlers return promises. */
export type KovoAsyncCommandName = Extract<KovoCommandEntry, { async: true }>['name'];

/** @internal Commands whose handlers are synchronous. */
export type KovoSyncCommandName = Exclude<KovoCommandEntry, { async: true }>['name'];

/** @internal Result classes whose numeric status is owned by the command schema. */
export type KovoCommandExitClass = 'finding' | 'success' | 'unknown' | 'usage';

/** @internal Resolve one process exit code through the named command's schema. */
export function kovoCommandExitCode(
  name: KovoCommandName,
  outcome: KovoCommandExitClass,
): 0 | 1 | 2 {
  const entry = KOVO_COMMAND_SCHEMA.find((candidate) => candidate.name === name);
  if (entry === undefined) throw new TypeError(`Missing Kovo command schema for ${name}.`);
  if (outcome === 'unknown') {
    if (!('unknown' in entry.exits) || entry.exits.unknown !== 2) {
      throw new TypeError(`Kovo command ${name} does not admit an UNKNOWN result.`);
    }
    return entry.exits.unknown;
  }
  return entry.exits[outcome];
}

/** @internal Resolve the schema-owned result protocol for one command. */
export function kovoCommandResultProtocol(name: KovoCommandName): string | null {
  return KOVO_COMMAND_SCHEMA.find((entry) => entry.name === name)?.resultProtocol ?? null;
}

/** @internal Resolve a required command protocol and fail on a schema contradiction. */
export function requireKovoCommandResultProtocol(name: KovoCommandName): string {
  const protocol = kovoCommandResultProtocol(name);
  if (protocol === null) {
    throw new TypeError(`Kovo command ${name} does not declare a result protocol.`);
  }
  return protocol;
}
