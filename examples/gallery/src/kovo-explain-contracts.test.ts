import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  kovoExplainField,
  kovoExplainRecords,
  parseKovoExplainOutput,
} from '@kovojs/conformance-fixtures/kovo-explain-fixtures';
import { main } from '@kovojs/cli/internal';
import { describe, expect, it, vi } from 'vitest';

import { galleryKovoExplainCases, galleryKovoExplainGraph } from './kovo-explain-contracts.js';

const galleryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('gallery kovo explain component contracts', () => {
  it('prints package-prefix provenance for representative primitive families', () => {
    const tempDir = resolve(galleryRoot, '.tmp-kovo-explain-contracts');
    const graphPath = resolve(tempDir, 'graph.json');
    mkdirSync(tempDir, { recursive: true });

    try {
      writeFileSync(graphPath, `${JSON.stringify(galleryKovoExplainGraph, null, 2)}\n`);

      for (const contract of galleryKovoExplainCases) {
        const output = captureStdout(() => {
          expect(main(['explain', 'component', contract.target, graphPath])).toBe(0);
        });
        const parsed = parseKovoExplainOutput(output);

        expect(parsed.subject, contract.title).toBe(contract.expectedSubject);
        expect(kovoExplainField(output, 'provenance'), contract.title).toBe(
          'package=@kovojs/headless-ui prefix=kovo- effective-prefix=kovo- source=package-prefix-fact',
        );
        expect(kovoExplainField(output, 'fragments'), contract.title).toBe(contract.target);
        expect(kovoExplainRecords(output, 'HANDLER').map(recordEvent), contract.title).toEqual(
          contract.expectedHandlers,
        );
        expect(kovoExplainRecords(output, 'MERGE').map(recordAttr), contract.title).toEqual(
          contract.expectedMergeAttrs,
        );
      }
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});

function captureStdout(run: () => void): string {
  let output = '';
  const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });

  try {
    run();
  } finally {
    stdoutWrite.mockRestore();
  }

  return output;
}

function recordEvent(record: string): string {
  return record.slice(0, record.indexOf(' '));
}

function recordAttr(record: string): string {
  const attr = record.split(/\s+/).find((field) => field.startsWith('attr='));
  if (attr === undefined) throw new Error(`Missing attr= field in kovo explain record: ${record}`);
  return attr.slice('attr='.length);
}
