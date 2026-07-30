import { describe, expect, it } from 'vitest';

import {
  committedGeneratedArtifactGenerators,
  runGeneratedArtifactChecks,
} from './check-generated-artifacts.mjs';
import { assertGeneratedArtifactText } from './generated-artifact-check.mjs';

describe('committed generated artifact freshness gate', () => {
  it('routes every committed generator through one normal gate', () => {
    const commands = [];
    expect(
      runGeneratedArtifactChecks({
        cwd: '/unused',
        execute(command) {
          commands.push(command);
          return { error: undefined, signal: null, status: 0, stderr: '', stdout: '' };
        },
      }),
    ).toBe(0);
    expect(commands).toHaveLength(committedGeneratedArtifactGenerators().length);
    expect(committedGeneratedArtifactGenerators()).toContain('cli-semantic-command-request');
    expect(committedGeneratedArtifactGenerators()).toContain('browser-inline-loader');
    expect(commands).toContainEqual([
      'pnpm',
      '--filter',
      '@kovojs/browser',
      'run',
      'check:inline-loader',
    ]);
  });

  it('fails when any registered generator check fails', () => {
    expect(() =>
      runGeneratedArtifactChecks({
        cwd: '/unused',
        execute() {
          return { error: undefined, signal: null, status: 1, stderr: '', stdout: '' };
        },
      }),
    ).toThrow(/failed with status 1/u);
  });

  it('rejects a one-byte stale generated output', () => {
    expect(() =>
      assertGeneratedArtifactText({
        actual: 'export type Request = never;\n',
        expected: 'export type Request = unknown;\n',
        label: 'Generated CLI semantic command request',
        regenerate: '`pnpm generate:cli-command-request`',
      }),
    ).toThrow(/is stale/u);
  });
});
