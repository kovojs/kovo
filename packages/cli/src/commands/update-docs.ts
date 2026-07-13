import { Buffer as NativeBuffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  bundledKovoDocsMirrorFiles,
  defaultKovoRulesSource,
  kovoDocsMirrorRemotes,
  renderKovoRulesBlock,
  replaceKovoRulesBlock,
} from '@kovojs/core/internal/agent-docs';
import { createFrameworkOutputFileSystemBoundary } from '@kovojs/core/internal/filesystem';

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

const nativeBufferFrom = NativeBuffer.from;
const nativeBufferToString = NativeBuffer.prototype.toString;
const nativeReflectApply = Reflect.apply;

/** @internal Execute the CLI-only `kovo update-docs` command. */
export async function runUpdateDocsCommand(
  options: UpdateDocsOptions = {},
): Promise<KovoCheckResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const output = createFrameworkOutputFileSystemBoundary(cwd);
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
    const agentsBytes = await output.fileBytes('AGENTS.md');
    const currentAgents = agentsBytes === undefined ? '' : utf8Text(agentsBytes);
    await output.writeFile('AGENTS.md', replaceKovoRulesBlock(currentAgents, rulesBlock));

    for (const [path, source] of resolved.files) {
      await output.writeFile(`.kovo/docs/${path}`, source);
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

function utf8Text(bytes: Uint8Array): string {
  const buffer = nativeReflectApply(nativeBufferFrom, NativeBuffer, [bytes]) as Buffer;
  return nativeReflectApply(nativeBufferToString, buffer, ['utf8']) as string;
}

function readCliPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version?: string;
  };
  if (!pkg.version) throw new Error('@kovojs/cli package.json is missing version');
  return pkg.version;
}
