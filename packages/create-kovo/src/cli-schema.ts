export type CreateKovoDeploymentTarget = 'cloudflare' | 'node' | 'vercel';
export type CreateKovoDialect = 'postgres' | 'sqlite';
export type CreateKovoInstallChoice = 'auto' | 'never';
export type CreateKovoRetentionPosture = 'retained-24h' | 'unconfigured';

export interface CreateKovoChoice<Value extends string> {
  description: string;
  label: string;
  value: Value;
}

export interface CreateKovoCreatorField<Value extends string = string> {
  choices?: readonly CreateKovoChoice<Value>[];
  description: string;
  flags: readonly string[];
  interactiveDefault: Value;
  label: string;
  nonInteractiveDefault: Value;
}

export interface CreateKovoCreatorSchema {
  deploymentTarget: CreateKovoCreatorField<CreateKovoDeploymentTarget>;
  dialect: CreateKovoCreatorField<CreateKovoDialect>;
  git: CreateKovoCreatorField<'initialize' | 'skip'>;
  install: CreateKovoCreatorField<CreateKovoInstallChoice>;
  name: CreateKovoCreatorField;
  retention: CreateKovoCreatorField<CreateKovoRetentionPosture>;
}

/**
 * One semantic source for create-kovo's prompts, flags, help choices, and deterministic defaults.
 *
 * Explicit target-directory invocations preserve the bin's established no-install posture unless
 * `--install` is passed. Interactive use defaults to installation because the person is present to
 * observe lifecycle-policy or network failures. Both paths remain pnpm-only for technical preview.
 */
export const CREATE_KOVO_CREATOR_SCHEMA = {
  name: {
    description: 'Package name written to package.json.',
    flags: ['--name'],
    interactiveDefault: 'kovo-app',
    label: 'App name',
    nonInteractiveDefault: '',
  },
  dialect: {
    choices: [
      {
        description: 'Secure-data starter with embedded PGlite development and Postgres deploy.',
        label: 'Postgres / PGlite dev',
        value: 'postgres',
      },
      {
        description:
          'Experimental single-principal local development; no authorization/confidentiality guarantee.',
        label: 'SQLite (experimental)',
        value: 'sqlite',
      },
    ],
    description: 'Database starter.',
    flags: ['--dialect', '--postgres', '--sqlite'],
    interactiveDefault: 'postgres',
    label: 'Database',
    nonInteractiveDefault: 'postgres',
  },
  install: {
    choices: [
      {
        description: 'Run the policy-pinned pnpm install after the atomic scaffold write.',
        label: 'Install dependencies',
        value: 'auto',
      },
      {
        description: 'Write files only and print the exact install command.',
        label: 'Skip installation',
        value: 'never',
      },
    ],
    description: 'Dependency installation after scaffolding.',
    flags: ['--install', '--no-install'],
    interactiveDefault: 'auto',
    label: 'Install',
    nonInteractiveDefault: 'never',
  },
  git: {
    choices: [
      {
        description: 'Initialize Git unless the target already belongs to a parent repository.',
        label: 'Initialize Git',
        value: 'initialize',
      },
      {
        description: 'Leave version-control setup to the caller.',
        label: 'Skip Git',
        value: 'skip',
      },
    ],
    description: 'Git repository initialization.',
    flags: ['--git', '--no-git', '--disable-git'],
    interactiveDefault: 'initialize',
    label: 'Git',
    nonInteractiveDefault: 'initialize',
  },
  deploymentTarget: {
    choices: [
      {
        description: 'Standalone Node server and Dockerfile.',
        label: 'Node',
        value: 'node',
      },
      {
        description: 'Vercel Build Output API.',
        label: 'Vercel',
        value: 'vercel',
      },
      {
        description: 'Cloudflare Worker with nodejs_compat.',
        label: 'Cloudflare',
        value: 'cloudflare',
      },
    ],
    description: 'Deployment preset emitted into kovo.config.ts.',
    flags: ['--deployment'],
    interactiveDefault: 'node',
    label: 'Deployment',
    nonInteractiveDefault: 'node',
  },
  retention: {
    choices: [
      {
        description:
          'Keep the build fail-closed until the serving layer can prove the SPEC §14 floor.',
        label: 'Not configured yet',
        value: 'unconfigured',
      },
      {
        description:
          'Assert prior immutable modules and prior-token query reads remain available for 24 hours.',
        label: 'Retained for 24h',
        value: 'retained-24h',
      },
    ],
    description: 'Deploy-skew retention posture emitted into kovo.config.ts.',
    flags: ['--retention'],
    interactiveDefault: 'unconfigured',
    label: 'Retention',
    nonInteractiveDefault: 'unconfigured',
  },
} as const satisfies CreateKovoCreatorSchema;

export interface CreateKovoCliOptions {
  deploymentTarget?: CreateKovoDeploymentTarget;
  disableGit?: boolean;
  dialect?: CreateKovoDialect;
  experimentalSqlite?: boolean;
  install?: CreateKovoInstallChoice;
  name?: string;
  retention?: CreateKovoRetentionPosture;
  targetDirectory: string;
  yes?: boolean;
}

export function readCreateKovoCliOptions(args: readonly string[]): CreateKovoCliOptions {
  let deploymentTarget: CreateKovoDeploymentTarget | undefined;
  let disableGit: boolean | undefined;
  let experimentalSqlite: boolean | undefined;
  let install: CreateKovoInstallChoice | undefined;
  let retention: CreateKovoRetentionPosture | undefined;
  let targetDirectory: string | undefined;
  let name: string | undefined;
  let dialect: CreateKovoDialect | undefined;
  let yes: boolean | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === '--name') {
      name = assignOnce(name, readRequiredOptionValue(args, index, '--name'), '--name');
      index += 1;
      continue;
    }

    if (arg.startsWith('--name=')) {
      const value = arg.slice('--name='.length);
      if (!value) throw new Error('Missing value for --name.');
      name = assignOnce(name, value, '--name');
      continue;
    }

    if (arg === '--dialect') {
      dialect = assignOnce(
        dialect,
        parseChoiceOption(
          readRequiredOptionValue(args, index, '--dialect'),
          creatorChoiceValues('dialect'),
          '--dialect',
        ),
        '--dialect',
      );
      index += 1;
      continue;
    }

    if (arg === '--sqlite' || arg === '--postgres') {
      dialect = assignOnce(dialect, arg === '--sqlite' ? 'sqlite' : 'postgres', '--dialect');
      continue;
    }

    if (arg === '--disable-git' || arg === '--no-git' || arg === '--git') {
      disableGit = assignOnce(disableGit, arg !== '--git', '--git');
      continue;
    }

    if (arg === '--experimental-sqlite') {
      experimentalSqlite = assignOnce(experimentalSqlite, true, '--experimental-sqlite');
      continue;
    }

    if (arg === '--install' || arg === '--no-install') {
      install = assignOnce(install, arg === '--install' ? 'auto' : 'never', '--install');
      continue;
    }

    if (arg.startsWith('--install=')) {
      install = assignOnce(
        install,
        parseChoiceOption(
          arg.slice('--install='.length),
          creatorChoiceValues('install'),
          '--install',
        ),
        '--install',
      );
      continue;
    }

    if (arg === '--deployment') {
      deploymentTarget = assignOnce(
        deploymentTarget,
        parseChoiceOption(
          readRequiredOptionValue(args, index, '--deployment'),
          creatorChoiceValues('deploymentTarget'),
          '--deployment',
        ),
        '--deployment',
      );
      index += 1;
      continue;
    }

    if (arg.startsWith('--deployment=')) {
      deploymentTarget = assignOnce(
        deploymentTarget,
        parseChoiceOption(
          arg.slice('--deployment='.length),
          creatorChoiceValues('deploymentTarget'),
          '--deployment',
        ),
        '--deployment',
      );
      continue;
    }

    if (arg === '--retention') {
      retention = assignOnce(
        retention,
        parseChoiceOption(
          readRequiredOptionValue(args, index, '--retention'),
          creatorChoiceValues('retention'),
          '--retention',
        ),
        '--retention',
      );
      index += 1;
      continue;
    }

    if (arg.startsWith('--retention=')) {
      retention = assignOnce(
        retention,
        parseChoiceOption(
          arg.slice('--retention='.length),
          creatorChoiceValues('retention'),
          '--retention',
        ),
        '--retention',
      );
      continue;
    }

    if (arg === '--yes') {
      yes = assignOnce(yes, true, '--yes');
      continue;
    }

    if (arg.startsWith('--dialect=')) {
      dialect = assignOnce(
        dialect,
        parseChoiceOption(
          arg.slice('--dialect='.length),
          creatorChoiceValues('dialect'),
          '--dialect',
        ),
        '--dialect',
      );
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (targetDirectory) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    targetDirectory = arg;
  }

  if (!targetDirectory) {
    throw new Error('Missing target directory.');
  }

  return {
    ...(deploymentTarget === undefined ? {} : { deploymentTarget }),
    ...(disableGit === undefined ? {} : { disableGit }),
    ...(dialect === undefined ? {} : { dialect }),
    ...(experimentalSqlite === undefined ? {} : { experimentalSqlite }),
    ...(install === undefined ? {} : { install }),
    ...(name === undefined ? {} : { name }),
    ...(retention === undefined ? {} : { retention }),
    targetDirectory,
    ...(yes === undefined ? {} : { yes }),
  };
}

export function assertCreateKovoSqliteScaffoldAllowed(
  options: CreateKovoCliOptions,
  {
    experimentalSqliteEnvironment = process.env.KOVO_EXPERIMENTAL_SQLITE === '1',
  }: { experimentalSqliteEnvironment?: boolean } = {},
): void {
  if (options.dialect !== 'sqlite') return;
  if (options.experimentalSqlite || experimentalSqliteEnvironment) return;

  throw new Error(
    'SQLite scaffold is experimental and single-principal/local-dev only; it does not provide Kovo authorization/confidentiality guarantees. Pass --experimental-sqlite with --sqlite (or set KOVO_EXPERIMENTAL_SQLITE=1) before create-kovo writes the target directory.',
  );
}

export function creatorChoiceValues<Key extends keyof CreateKovoCreatorSchema>(
  key: Key,
): readonly NonNullable<CreateKovoCreatorSchema[Key]['choices']>[number]['value'][] {
  return (CREATE_KOVO_CREATOR_SCHEMA[key].choices ?? []).map((choice) => choice.value);
}

function readRequiredOptionValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for ${option}.`);
  }
  return value;
}

function parseChoiceOption<Value extends string>(
  value: string | undefined,
  choices: readonly Value[],
  option: string,
): Value {
  if (value !== undefined && choices.includes(value as Value)) return value as Value;
  throw new Error(
    `Unsupported value for ${option}: ${value ?? '<missing>'}. Expected ${choices.join(' or ')}.`,
  );
}

function assignOnce<Value>(current: Value | undefined, next: Value, option: string): Value {
  if (current !== undefined) {
    throw new Error(`Option ${option} may be specified only once.`);
  }
  return next;
}
