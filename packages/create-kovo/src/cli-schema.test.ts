import { describe, expect, it } from 'vitest';

import {
  CREATE_KOVO_CREATOR_SCHEMA,
  assertCreateKovoSqliteScaffoldAllowed,
  creatorChoiceValues,
  readCreateKovoCliOptions,
} from './cli-schema.js';

describe('create-kovo command schema', () => {
  it('parses the public target, dialect, name, and Git options', () => {
    expect(
      readCreateKovoCliOptions(['my-app', '--name', 'acme-app', '--postgres', '--disable-git']),
    ).toEqual({
      dialect: 'postgres',
      disableGit: true,
      name: 'acme-app',
      targetDirectory: 'my-app',
    });
  });

  it('fails closed on removed, malformed, and extra arguments', () => {
    expect(() => readCreateKovoCliOptions(['my-app', '--template', 'app'])).toThrow(
      'Unknown option: --template',
    );
    expect(() => readCreateKovoCliOptions(['my-app', '--dialect', 'mysql'])).toThrow(
      'Unsupported value for --dialect: mysql',
    );
    expect(() => readCreateKovoCliOptions(['one', 'two'])).toThrow('Unexpected argument: two');
  });

  it('derives install, Git, deployment, and retention choices from one schema', () => {
    expect(
      readCreateKovoCliOptions([
        'my-app',
        '--install=auto',
        '--no-git',
        '--deployment',
        'vercel',
        '--retention=retained-24h',
        '--yes',
      ]),
    ).toEqual({
      deploymentTarget: 'vercel',
      disableGit: true,
      install: 'auto',
      retention: 'retained-24h',
      targetDirectory: 'my-app',
      yes: true,
    });
    expect(creatorChoiceValues('dialect')).toEqual(['postgres', 'sqlite']);
    expect(creatorChoiceValues('deploymentTarget')).toEqual(['node', 'vercel', 'cloudflare']);
    expect(CREATE_KOVO_CREATOR_SCHEMA.install.interactiveDefault).toBe('auto');
    expect(CREATE_KOVO_CREATOR_SCHEMA.install.nonInteractiveDefault).toBe('never');
  });

  it('rejects conflicting or repeated choices instead of silently taking the last flag', () => {
    expect(() => readCreateKovoCliOptions(['my-app', '--postgres', '--sqlite'])).toThrow(
      'Option --dialect may be specified only once.',
    );
    expect(() => readCreateKovoCliOptions(['my-app', '--install', '--no-install'])).toThrow(
      'Option --install may be specified only once.',
    );
    expect(() => readCreateKovoCliOptions(['my-app', '--git', '--disable-git'])).toThrow(
      'Option --git may be specified only once.',
    );
  });

  it('requires the explicit SQLite preview posture independently of ambient CI state', () => {
    const options = readCreateKovoCliOptions(['my-app', '--sqlite']);
    expect(() =>
      assertCreateKovoSqliteScaffoldAllowed(options, {
        experimentalSqliteEnvironment: false,
      }),
    ).toThrow('SQLite scaffold is experimental');

    expect(() =>
      assertCreateKovoSqliteScaffoldAllowed(
        readCreateKovoCliOptions(['my-app', '--sqlite', '--experimental-sqlite']),
        { experimentalSqliteEnvironment: false },
      ),
    ).not.toThrow();
  });
});
