/* oxlint-disable typescript/unbound-method -- Boot-captured controls are invoked through pinned Reflect.apply. */
import { Buffer as NativeBuffer } from 'node:buffer';
import { resolve } from 'node:path';

import { renderKovoRulesBlock, replaceKovoRulesBlock } from '@kovojs/core/internal/agent-docs';
import {
  createFrameworkFileSystemBoundary,
  createFrameworkOutputFileSystemBoundary,
} from '@kovojs/core/internal/filesystem';

import { readInstalledAgentDocsSnapshot } from '../docs-snapshot.js';
import { installAgentDocsSnapshot } from '../docs-store.js';
import { requireKovoCommandResultProtocol } from '../command-schema.js';
import { readCliPackageVersion } from '../package-version.js';
import type { CliProcessResult } from '../shared.js';

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
): Promise<CliProcessResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  try {
    const output = createFrameworkOutputFileSystemBoundary(cwd);
    const fileSystem = await createFrameworkFileSystemBoundary(cwd);
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
    // Validate the bounded, identity-checked durable document before any snapshot write.
    await fileSystem.updateDurableFile('AGENTS.md', (current) => {
      replaceKovoRulesBlock(current === undefined ? '' : utf8Text(current), rulesBlock);
      return undefined;
    });
    const installed = await installAgentDocsSnapshot({
      beforeSelect: async () => {
        // Recompute under the exclusive durable-file lock so a concurrent legitimate edit is
        // retained and a concurrent malformed-marker edit prevents snapshot selection.
        await fileSystem.updateDurableFile('AGENTS.md', (current) =>
          replaceKovoRulesBlock(current === undefined ? '' : utf8Text(current), rulesBlock),
        );
      },
      cwd,
      fileSystem,
      output,
      snapshot,
    });

    return {
      exitCode: 0,
      output: [
        requireKovoCommandResultProtocol('update-docs'),
        `OK source=installed-package version=${snapshot.version} files=${installed.files}`,
        `OK snapshot=${installed.snapshotDigest} current=${installed.pointerPath}`,
        '',
      ].join('\n'),
    };
  } catch (error) {
    return {
      exitCode: 2,
      output: `${requireKovoCommandResultProtocol('update-docs')}\nERROR ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    };
  }
}

function utf8Text(bytes: Uint8Array): string {
  const buffer = nativeReflectApply(nativeBufferFrom, NativeBuffer, [bytes]) as Buffer;
  return nativeReflectApply(nativeBufferToString, buffer, ['utf8']) as string;
}
