import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  bundledKovoDocsMirrorFiles,
  defaultKovoRulesSource,
  kovoDocsMirrorRemotes,
  renderKovoRulesBlock,
  replaceKovoRulesBlock,
} from '@kovojs/core/internal/agent-docs';

import type { KovoCheckResult } from '../shared.js';

export interface UpdateDocsOptions {
  cwd?: string;
  fetchImpl?: typeof fetch;
  version?: string;
}

interface ResolvedDocs {
  files: Map<string, string>;
  source: 'bundled' | 'fetched';
}

export async function runUpdateDocsCommand(
  options: UpdateDocsOptions = {},
): Promise<KovoCheckResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const version = options.version ?? readCliPackageVersion();
  const resolved = await resolveDocs(options.fetchImpl ?? globalThis.fetch, version);
  const kovoRulesSource =
    resolved.files.get('kovo-rules.md') ??
    bundledKovoDocsMirrorFiles({ version }).find((file) => file.path === 'kovo-rules.md')?.source ??
    '';
  const rulesBlock = renderKovoRulesBlock({
    rulesSource: kovoRulesSource,
    source: defaultKovoRulesSource,
    version,
  });

  try {
    const agentsPath = join(cwd, 'AGENTS.md');
    const currentAgents = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : '';
    writeTextFile(agentsPath, replaceKovoRulesBlock(currentAgents, rulesBlock));

    for (const [path, source] of resolved.files) {
      writeTextFile(join(cwd, '.kovo/docs', path), source);
    }

    return {
      exitCode: 0,
      output: [
        'kovo-update-docs/v1',
        `OK source=${resolved.source} files=${resolved.files.size}`,
        resolved.source === 'bundled'
          ? 'WARN fetch failed; used bundled docs snapshot'
          : 'OK fetched latest docs',
        '',
      ].join('\n'),
    };
  } catch (error) {
    return {
      exitCode: 1,
      output: `kovo-update-docs/v1\nERROR ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    };
  }
}

async function resolveDocs(
  fetchImpl: typeof fetch | undefined,
  version: string,
): Promise<ResolvedDocs> {
  if (!fetchImpl) return bundledDocs(version);

  try {
    const fetched = new Map<string, string>();
    for (const remote of kovoDocsMirrorRemotes) {
      const response = await fetchImpl(remote.url);
      if (!response.ok) throw new Error(`GET ${remote.url} returned ${response.status}`);
      fetched.set(remote.path, await response.text());
    }
    fetched.set('metadata.json', metadataSource(version, 'fetched'));
    return { files: fetched, source: 'fetched' };
  } catch {
    return bundledDocs(version);
  }
}

function bundledDocs(version: string): ResolvedDocs {
  return {
    files: new Map(
      bundledKovoDocsMirrorFiles({ source: 'bundled', version }).map((file) => [
        file.path,
        file.source,
      ]),
    ),
    source: 'bundled',
  };
}

function metadataSource(version: string, source: 'bundled' | 'fetched'): string {
  return `${JSON.stringify(
    {
      docs: [...kovoDocsMirrorRemotes],
      generatedBy: 'kovo update-docs',
      source,
      version,
    },
    null,
    2,
  )}\n`;
}

function writeTextFile(path: string, source: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source, 'utf8');
}

function readCliPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version?: string;
  };
  if (!pkg.version) throw new Error('@kovojs/cli package.json is missing version');
  return pkg.version;
}
