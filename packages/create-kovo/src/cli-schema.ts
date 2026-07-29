export type CreateKovoDialect = 'postgres' | 'sqlite';

export interface CreateKovoCliOptions {
  disableGit?: boolean;
  dialect?: CreateKovoDialect;
  experimentalSqlite?: boolean;
  name?: string;
  targetDirectory: string;
}

export function readCreateKovoCliOptions(args: readonly string[]): CreateKovoCliOptions {
  let disableGit: boolean | undefined;
  let experimentalSqlite: boolean | undefined;
  let targetDirectory: string | undefined;
  let name: string | undefined;
  let dialect: CreateKovoDialect | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === '--name') {
      name = readRequiredOptionValue(args, index, '--name');
      index += 1;
      continue;
    }

    if (arg.startsWith('--name=')) {
      name = arg.slice('--name='.length);
      if (!name) throw new Error('Missing value for --name.');
      continue;
    }

    if (arg === '--dialect') {
      dialect = parseDialectOption(readRequiredOptionValue(args, index, '--dialect'));
      index += 1;
      continue;
    }

    if (arg === '--sqlite') {
      dialect = 'sqlite';
      continue;
    }

    if (arg === '--disable-git') {
      disableGit = true;
      continue;
    }

    if (arg === '--experimental-sqlite') {
      experimentalSqlite = true;
      continue;
    }

    if (arg === '--postgres') {
      dialect = 'postgres';
      continue;
    }

    if (arg.startsWith('--dialect=')) {
      dialect = parseDialectOption(arg.slice('--dialect='.length));
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
    ...(disableGit === undefined ? {} : { disableGit }),
    ...(dialect === undefined ? {} : { dialect }),
    ...(experimentalSqlite === undefined ? {} : { experimentalSqlite }),
    ...(name === undefined ? {} : { name }),
    targetDirectory,
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
    'SQLite scaffold is experimental and single-principal/local-dev only; it does not provide Kovo authorization/confidentiality guarantees. Set KOVO_EXPERIMENTAL_SQLITE=1 or pass --experimental-sqlite to scaffold it.',
  );
}

function readRequiredOptionValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for ${option}.`);
  }
  return value;
}

function parseDialectOption(value: string | undefined): CreateKovoDialect {
  if (value === 'postgres' || value === 'sqlite') return value;

  throw new Error(`Unsupported dialect: ${value ?? '<missing>'}.`);
}
