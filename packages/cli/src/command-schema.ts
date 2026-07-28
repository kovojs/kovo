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

/** @internal A value accepted by a positional argument or option. */
export interface KovoCommandValueSchema {
  readonly default?: string;
  readonly kind: KovoCommandValueKind;
  readonly label: string;
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
  readonly category?: 'advanced' | 'input' | 'output' | 'posture' | 'selection';
  readonly description: string;
  readonly flags: readonly [`--${string}`, ...string[]];
  readonly id: string;
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
      readonly kind: 'argument';
      readonly name: string;
      readonly repeatable?: boolean;
      readonly required: boolean;
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
  readonly id: string;
  readonly summary?: string;
  readonly tokens: readonly KovoCommandUsageToken[];
}

/** @internal One complete command node in the semantic AST. */
export interface KovoCommandSchemaEntry {
  readonly aliases: readonly string[];
  readonly async?: true;
  readonly category: KovoCommandCategory;
  readonly examples: readonly string[];
  readonly exits: KovoCommandExitBehavior;
  readonly name: string;
  readonly options: readonly KovoCommandOptionSchema[];
  readonly order: number;
  readonly referenceUsage: 'inline' | 'multiline';
  readonly resultProtocol: string | null;
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

function value(
  kind: KovoCommandValueKind,
  label: string,
  options: {
    readonly default?: string;
    readonly values?: readonly string[];
  } = {},
): KovoCommandValueSchema {
  return { kind, label, ...options };
}

function argument(
  name: string,
  schema: KovoCommandValueSchema,
  options: {
    readonly description?: string;
    readonly repeatable?: boolean;
    readonly required?: boolean;
  } = {},
): KovoCommandUsageToken {
  return {
    kind: 'argument',
    name,
    required: options.required ?? true,
    value: schema,
    ...(options.description === undefined ? {} : { description: options.description }),
    ...(options.repeatable === undefined ? {} : { repeatable: options.repeatable }),
  };
}

function literal(value: string, description?: string): KovoCommandUsageToken {
  return {
    kind: 'literal',
    value,
    ...(description === undefined ? {} : { description }),
  };
}

function option(option: string, required = false, valueLabel?: string): KovoCommandUsageToken {
  return {
    kind: 'option',
    option,
    ...(required ? { required: true } : {}),
    ...(valueLabel === undefined ? {} : { valueLabel }),
  };
}

function optionGroup(
  tokens: readonly {
    readonly kind: 'option';
    readonly option: string;
    readonly required?: boolean;
    readonly valueLabel?: string;
  }[],
  required = false,
): KovoCommandUsageToken {
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
    missingValueMessage: 'kovo: check advisories --severity-floor requires a severity.\n',
    value: value('enum', 'low|moderate|high|critical', {
      default: 'high',
      values: ['low', 'moderate', 'high', 'critical'],
    }),
  }),
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
 * @internal Complete semantic command AST. Its 13 capability commands are
 * intentionally grouped into daily/build, inspect/security, and agent/operator.
 */
export const KOVO_COMMAND_SCHEMA = [
  {
    aliases: [],
    async: true,
    category: 'daily-build',
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
    referenceUsage: 'inline',
    resultProtocol: 'kovo-add/v1',
    summary: 'Copy public @kovojs/ui component source into an application.',
    usage: [
      {
        id: 'components',
        tokens: [
          argument('components', value('enum', 'component'), {
            description: 'One or more component catalog names.',
            repeatable: true,
          }),
          option('out'),
        ],
      },
    ],
  },
  {
    aliases: [],
    category: 'inspect-security',
    examples: ['kovo audit', 'kovo audit --fail-on-findings graph.json'],
    exits,
    name: 'audit',
    options: [
      flag('failOnFindings', ['--fail-on-findings'], 'Exit 1 when the audit finds issues.', {
        category: 'posture',
      }),
    ],
    order: 20,
    referenceUsage: 'inline',
    resultProtocol: 'kovo-audit/v1',
    summary: 'Run security and access audits over an app graph.',
    usage: [
      {
        id: 'audit',
        tokens: [
          option('failOnFindings'),
          argument('graph', value('path', 'graph.json'), { required: false }),
        ],
      },
    ],
  },
  {
    aliases: [],
    async: true,
    category: 'daily-build',
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
        missingValueMessage: 'kovo: build --preset requires a preset name.\n',
        value: value('enum', 'name', { values: ['node', 'vercel', 'cloudflare'] }),
      }),
      flag('check', ['--check'], 'Run every preflight without promoting output.', {
        category: 'posture',
      }),
      flag('cache', ['--no-cache'], 'Disable build analysis caches.', {
        booleanValue: false,
        category: 'advanced',
      }),
    ],
    order: 30,
    referenceUsage: 'inline',
    resultProtocol: 'kovo-build/v1',
    summary: 'Prove and build an authored Kovo app for deployment.',
    usage: [
      {
        id: 'build',
        tokens: [
          argument('appModule', value('path', 'app-module')),
          option('out'),
          option('preset'),
          option('check'),
          option('cache'),
        ],
      },
    ],
  },
  {
    aliases: [],
    category: 'inspect-security',
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
    referenceUsage: 'inline',
    resultProtocol: 'kovo-check/v1',
    summary: 'Run consistency, security, environment, and advisory verification.',
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
              required: false,
            },
          ),
          argument('graph', value('path', 'graph.json'), { required: false }),
        ],
      },
      {
        id: 'environment',
        summary: 'Probe the deployment assume-guarantee contract.',
        tokens: [
          literal('env', 'Probe deployment environment obligations.'),
          argument('deployment', value('path', 'deployment.json'), { required: false }),
        ],
      },
      {
        id: 'advisories',
        summary: 'Authenticate and match the signed Kovo advisory feed.',
        tokens: [
          literal('advisories', 'Check authenticated Kovo security advisories.'),
          argument('graph', value('path', 'graph.json'), { required: false }),
          option('feed'),
          option('attestation'),
          option('state'),
          option('severityFloor'),
        ],
      },
    ],
  },
  {
    aliases: [],
    async: true,
    category: 'agent-operator',
    examples: [
      'kovo compile component src/cart.tsx --out dist/cart.tsx --check',
      'kovo compile route src/app.tsx --out dist/app.kovo-route.tsx',
      'kovo compile package-css @kovojs/ui --entry src/app.ts --out dist/ui.css',
    ],
    exits,
    name: 'compile',
    options: compileOptions,
    order: 50,
    referenceUsage: 'multiline',
    resultProtocol: 'kovo-compile/v1',
    summary: 'Emit compiler-owned artifacts without importing compiler internals.',
    usage: [
      {
        id: 'component',
        tokens: [
          literal('component', 'Lower one authored component.'),
          argument('source', value('path', 'source.tsx')),
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
          argument('source', value('path', 'source.tsx')),
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
          argument('input', value('path', 'input.json')),
          option('out', true, 'graph.json'),
          option('check'),
        ],
      },
      {
        id: 'mutation-inputs',
        tokens: [
          literal('mutation-inputs', 'Extract mutation-input facts.'),
          argument('source', value('path', 'source.ts')),
          option('out', true, 'facts.json'),
          option('fileName'),
          option('check'),
        ],
      },
      {
        id: 'drizzle-static',
        tokens: [
          literal('drizzle-static', 'Derive static Drizzle facts.'),
          argument('input', value('path', 'input.json')),
          option('out', true, 'facts.json'),
          option('check'),
        ],
      },
      {
        id: 'drizzle-optimistic',
        tokens: [
          literal('drizzle-optimistic', 'Derive a Drizzle optimistic transform.'),
          argument('input', value('path', 'input.json')),
          option('out', true, 'artifact.ts'),
          option('factsOut'),
          option('check'),
        ],
      },
      {
        id: 'package-css',
        tokens: [
          literal('package-css', 'Extract CSS for a public component package.'),
          argument('package', value('string', 'package')),
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
        value: value('string', 'role', { default: 'kovo_reader' }),
      }),
      flag('writerRole', ['--writer-role'], 'Writer database role.', {
        category: 'posture',
        missingValueMessage: 'kovo: db --writer-role requires a role name.\n',
        value: value('string', 'role', { default: 'kovo_writer' }),
      }),
    ],
    order: 60,
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
            { description: 'Select the database lifecycle action.' },
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
        missingValueMessage: 'kovo: dev --port requires a port.\n',
        value: value('integer', 'port'),
      }),
      flag('strictPort', ['--strict-port'], 'Fail instead of selecting another occupied port.', {
        category: 'posture',
      }),
      flag('mode', ['--mode'], 'Vite mode.', {
        category: 'posture',
        missingValueMessage: 'kovo: dev --mode requires a mode.\n',
        value: value('string', 'mode', { default: 'development' }),
      }),
    ],
    order: 70,
    referenceUsage: 'inline',
    resultProtocol: null,
    summary: 'Start the bootstrap-first Kovo development server.',
    usage: [
      {
        id: 'dev',
        tokens: [
          argument('appModule', value('path', 'app-module')),
          option('root'),
          option('config'),
          option('host'),
          option('port'),
          option('strictPort'),
          option('mode'),
        ],
      },
    ],
  },
  {
    aliases: [],
    category: 'inspect-security',
    examples: [
      'kovo explain component Cart graph.json',
      'kovo explain --capabilities',
      'kovo explain --access --fail-on-findings',
    ],
    exits,
    name: 'explain',
    options: explainOptions,
    order: 80,
    referenceUsage: 'multiline',
    resultProtocol: 'kovo-explain/v1',
    summary: 'Render stable proof facts for a subject or security review.',
    usage: [
      {
        id: 'target',
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
        ],
      },
      {
        id: 'document',
        tokens: [
          literal('document', 'Explain the framework-owned document shell.'),
          argument('graph', value('path', 'graph.json'), { required: false }),
        ],
      },
      ...[
        ['sources-sinks', 'sourcesSinks'],
        ['tasks', 'tasks'],
        ['agent', 'agent'],
        ['grants', 'grants'],
        ['endpoints', 'endpoints'],
        ['revealed', 'revealed'],
        ['trust', 'trust'],
        ['capabilities', 'capabilities'],
        ['cookies', 'cookies'],
        ['authorization', 'authorization'],
        ['access', 'access'],
        ['unguarded', 'unguarded'],
        ['unscoped', 'unscoped'],
      ].map(([id, optionId]) => ({
        id: id!,
        tokens: [
          option(optionId!, true),
          ...(id === 'access' || id === 'unguarded' || id === 'unscoped'
            ? [option('failOnFindings')]
            : []),
          argument('graph', value('path', 'graph.json'), { required: false }),
        ],
      })),
      { id: 'auth-lifecycle', tokens: [option('authLifecycle', true)] },
      { id: 'model-boundaries', tokens: [option('modelBoundaries', true)] },
      {
        id: 'attest',
        tokens: [
          option('attest', true),
          option('artifact', true),
          option('trustAnchor', true),
          option('escapeReviews'),
          option('escapeCensusReviews'),
        ],
      },
    ],
  },
  {
    aliases: [],
    async: true,
    category: 'daily-build',
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
        value: value('string', 'path', { default: '/' }),
      }),
      flag('skipNonExportable', ['--skip-non-exportable'], 'Skip non-exportable routes.', {
        category: 'posture',
      }),
    ],
    order: 90,
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
    examples: ['kovo mcp'],
    exits,
    name: 'mcp',
    options: [],
    order: 120,
    referenceUsage: 'inline',
    resultProtocol: 'kovo-mcp/v1',
    summary: 'Serve the finite Kovo MCP protocol over stdio.',
    usage: [{ id: 'mcp', tokens: [] }],
  },
  {
    aliases: [],
    async: true,
    category: 'agent-operator',
    examples: ['kovo update-docs'],
    exits,
    name: 'update-docs',
    options: [],
    order: 130,
    referenceUsage: 'inline',
    resultProtocol: 'kovo-update-docs/v1',
    summary: 'Refresh version-matched agent-readable Kovo documentation.',
    usage: [{ id: 'update-docs', tokens: [] }],
  },
] as const satisfies readonly KovoCommandSchemaEntry[];

/** @internal One literal capability command name. */
export type KovoCommandName = (typeof KOVO_COMMAND_SCHEMA)[number]['name'];

/** @internal One concrete semantic command node. */
export type KovoCommandEntry = (typeof KOVO_COMMAND_SCHEMA)[number];

/** @internal Commands whose handlers return promises. */
export type KovoAsyncCommandName = Extract<KovoCommandEntry, { async: true }>['name'];

/** @internal Commands whose handlers are synchronous. */
export type KovoSyncCommandName = Exclude<KovoCommandEntry, { async: true }>['name'];

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
