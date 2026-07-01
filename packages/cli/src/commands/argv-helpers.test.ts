import { describe, expect, it } from 'vitest';

import { parseBuildArgs, parseExportArgs } from './build-export.js';
import { parseCompileArgs } from './compile.js';

describe('command argv helper integration', () => {
  it('parses build/export value flags with equals syntax', () => {
    expect(parseBuildArgs(['src/app.tsx', '--out=dist-prod', '--preset=node'])).toEqual({
      ok: true,
      options: {
        appModulePath: 'src/app.tsx',
        cache: true,
        check: false,
        outDir: 'dist-prod',
        preset: 'node',
      },
    });

    expect(parseExportArgs(['src/app.tsx', '--origin=https://example.test'])).toEqual({
      ok: true,
      options: {
        appModulePath: 'src/app.tsx',
        origin: 'https://example.test',
        outDir: 'dist',
      },
    });
  });

  it('uses shared missing-value, unknown-option, and single-positional errors', () => {
    expect(parseBuildArgs(['src/app.tsx', '--out'])).toEqual({
      message: 'kovo: build --out requires a directory.\n',
      ok: false,
    });
    expect(parseExportArgs(['src/app.tsx', '--vite=false'])).toEqual({
      message: expect.stringContaining('kovo: unknown export option "--vite=false".'),
      ok: false,
    });
    expect(parseBuildArgs(['one.tsx', 'two.tsx'])).toEqual({
      message: expect.stringContaining('kovo: build accepts one app module path.'),
      ok: false,
    });
  });

  it('shares compile subcommand positional validation', () => {
    expect(parseCompileArgs(['graph', 'graph.json', 'extra.json', '--out=out.json'])).toEqual({
      message: expect.stringContaining('kovo: compile graph accepts one input path.'),
      ok: false,
    });
    expect(parseCompileArgs(['package-css', '--out=styles.css'])).toEqual({
      message: expect.stringContaining('kovo: compile package-css requires a package name.'),
      ok: false,
    });
  });
});
