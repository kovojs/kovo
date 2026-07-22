import { Buffer as NativeBuffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  bundledKovoDocsMirrorFiles,
  defaultKovoRulesSource,
  renderKovoRulesBlock,
  replaceKovoRulesBlock,
} from '@kovojs/core/internal/agent-docs';
import { createFrameworkOutputFileSystemBoundary } from '@kovojs/core/internal/filesystem';

import type { KovoCheckResult } from '../shared.js';

export interface UpdateDocsOptions {
  cwd?: string;
  version?: string;
}

interface ResolvedDocs {
  files: Map<string, string>;
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
  // Agent instructions are executable authority for coding agents. Refresh only from the exact
  // versioned CLI package the user installed; accepting live website bytes here would create an
  // unpinned second software supply chain inside AGENTS.md.
  const resolved = bundledDocs(version);
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
        `OK source=installed-package files=${resolved.files.size}`,
        'OK refreshed from versioned CLI snapshot',
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

function bundledDocs(version: string): ResolvedDocs {
  return {
    files: new Map(bundledKovoDocsMirrorFiles({ version }).map((file) => [file.path, file.source])),
  };
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
