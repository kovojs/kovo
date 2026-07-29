import { describe, expect, it } from 'vitest';

import { assertCreateKovoSqliteScaffoldAllowed, readCreateKovoCliOptions } from './cli-schema.js';

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
      'Unsupported dialect: mysql',
    );
    expect(() => readCreateKovoCliOptions(['one', 'two'])).toThrow('Unexpected argument: two');
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
