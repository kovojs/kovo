import { resolve } from 'node:path';

import { readInstalledAgentDocsSnapshot } from '../docs-snapshot.js';
import { searchInstalledAgentDocs } from '../docs-store.js';
import { readCliPackageVersion } from '../package-version.js';
import type { CliProcessResult } from '../shared.js';

export interface DocsCommandOptions {
  cwd?: string;
  format?: 'human' | 'json';
  limit?: number;
  task: string;
  version?: string;
}

interface DocsResultRecord {
  excerpt: string;
  path: string;
  sha256: `sha256:${string}`;
  snapshotDigest: `sha256:${string}`;
  version: string;
}

/** @internal Retrieve a bounded result from the exact docs snapshot selected by update-docs. */
export async function runDocsCommand(options: DocsCommandOptions): Promise<CliProcessResult> {
  try {
    const version = options.version ?? readCliPackageVersion();
    const expectedSnapshot = readInstalledAgentDocsSnapshot({ expectedVersion: version });
    const results = await searchInstalledAgentDocs({
      cwd: resolve(options.cwd ?? process.cwd()),
      expectedSnapshot,
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      task: options.task,
    });
    const records: readonly DocsResultRecord[] = results;
    return {
      exitCode: 0,
      output:
        options.format === 'json'
          ? `${JSON.stringify({ results: records, version: 'kovo-docs/v1' })}\n`
          : renderHumanDocsResults(records),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.format === 'json') {
      return {
        exitCode: 2,
        output: `${JSON.stringify({ error: { message }, version: 'kovo-docs/v1' })}\n`,
      };
    }
    return { exitCode: 2, output: `kovo-docs/v1\nERROR ${message}\n` };
  }
}

function renderHumanDocsResults(results: readonly DocsResultRecord[]): string {
  if (results.length === 0) return 'kovo-docs/v1\nNO_MATCH\n';
  return [
    'kovo-docs/v1',
    `snapshot=${results[0]!.snapshotDigest} version=${results[0]!.version} results=${results.length}`,
    ...results.flatMap((result) => [
      '',
      `## ${result.path}`,
      `digest=${result.sha256}`,
      result.excerpt.trimEnd(),
    ]),
    '',
  ].join('\n');
}
