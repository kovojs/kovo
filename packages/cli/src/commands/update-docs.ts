/* oxlint-disable typescript/unbound-method -- Boot-captured controls are invoked through pinned Reflect.apply. */
import { Buffer as NativeBuffer } from 'node:buffer';
import { resolve } from 'node:path';

import { renderKovoRulesBlock, replaceKovoRulesBlock } from '@kovojs/core/internal/agent-docs';
import { createFrameworkOutputFileSystemBoundary } from '@kovojs/core/internal/filesystem';

import { readInstalledAgentDocsSnapshot } from '../docs-snapshot.js';
import { installAgentDocsSnapshot } from '../docs-store.js';
import { readCliPackageVersion } from '../package-version.js';
import type { KovoCheckResult } from '../shared.js';

export interface UpdateDocsOptions {
  cwd?: string;
  version?: string;
}

const nativeBufferFrom = NativeBuffer.from;
const nativeBufferToString = NativeBuffer.prototype.toString;
const nativeReflectApply = Reflect.apply;

/** @internal Execute the CLI-only `kovo update-docs` command. */
export async function runUpdateDocsCommand(
  options: UpdateDocsOptions = {},
): Promise<KovoCheckResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  try {
    const output = createFrameworkOutputFileSystemBoundary(cwd);
    const version = options.version ?? readCliPackageVersion();
    // Agent instructions are executable authority for coding agents. Authenticate only the exact
    // versioned snapshot beside the executing CLI; mutable website bytes are never an input.
    const snapshot = readInstalledAgentDocsSnapshot({ expectedVersion: version });
    const kovoRules = snapshot.files.find((file) => file.path === 'kovo-rules.md');
    if (kovoRules === undefined) {
      throw new TypeError('authenticated docs snapshot is missing kovo-rules.md');
    }
    const digestDirectory = `.kovo/docs/snapshots/${snapshot.snapshotDigest.slice(
      'sha256:'.length,
    )}`;
    const rulesBlock = renderKovoRulesBlock({
      rulesSource: kovoRules.content,
      source: `./${digestDirectory}/kovo-rules.md`,
      version,
    });
    const agentsBytes = await output.fileBytes('AGENTS.md');
    const currentAgents = agentsBytes === undefined ? '' : utf8Text(agentsBytes);
    // Validate marker structure before any snapshot write. The companion AGENTS.md update then
    // runs after every immutable file is digest-proved but before current.json selects the corpus.
    const nextAgents = replaceKovoRulesBlock(currentAgents, rulesBlock);
    const installed = await installAgentDocsSnapshot({
      beforeSelect: async () => {
        await output.writeFile('AGENTS.md', nextAgents);
      },
      cwd,
      output,
      snapshot,
    });

    return {
      exitCode: 0,
      output: [
        'kovo-update-docs/v1',
        `OK source=installed-package version=${snapshot.version} files=${installed.files}`,
        `OK snapshot=${installed.snapshotDigest} current=${installed.pointerPath}`,
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

function utf8Text(bytes: Uint8Array): string {
  const buffer = nativeReflectApply(nativeBufferFrom, NativeBuffer, [bytes]) as Buffer;
  return nativeReflectApply(nativeBufferToString, buffer, ['utf8']) as string;
}
