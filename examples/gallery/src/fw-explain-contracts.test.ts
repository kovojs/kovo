import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fwExplainField,
  fwExplainRecords,
  parseFwExplainOutput,
} from '@jiso/test/fw-explain-fixtures';
import { main } from 'fw';
import { describe, expect, it, vi } from 'vitest';

import { galleryFwExplainCases, galleryFwExplainGraph } from './fw-explain-contracts.js';

const galleryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('gallery fw explain component contracts', () => {
  it('prints package-prefix provenance for representative primitive families', () => {
    const tempDir = resolve(galleryRoot, '.tmp-fw-explain-contracts');
    const graphPath = resolve(tempDir, 'graph.json');
    mkdirSync(tempDir, { recursive: true });

    try {
      writeFileSync(graphPath, `${JSON.stringify(galleryFwExplainGraph, null, 2)}\n`);

      for (const contract of galleryFwExplainCases) {
        const output = captureStdout(() => {
          expect(main(['explain', 'component', contract.target, graphPath])).toBe(0);
        });
        const parsed = parseFwExplainOutput(output);

        expect(parsed.subject, contract.title).toBe(contract.expectedSubject);
        expect(fwExplainField(output, 'provenance'), contract.title).toBe(
          'package=@jiso/headless-ui prefix=jiso- effective-prefix=jiso- source=package-prefix-fact',
        );
        expect(fwExplainField(output, 'fragments'), contract.title).toBe(contract.target);
        expect(fwExplainRecords(output, 'HANDLER').map(recordEvent), contract.title).toEqual(
          contract.expectedHandlers,
        );
        expect(fwExplainRecords(output, 'MERGE').map(recordAttr), contract.title).toEqual(
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
  if (attr === undefined) throw new Error(`Missing attr= field in fw explain record: ${record}`);
  return attr.slice('attr='.length);
}
