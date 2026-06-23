import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { kovoCheck, kovoExplain, main } from './index.js';
import {
  frameworkSourceSinkInventory,
  sourcesSinksArtifactPath,
  sourcesSinksArtifactVersion,
} from './sources-sinks.js';

describe('source/sink inventory', () => {
  it('accounts for the initial required sink families', () => {
    const sinks = new Set(frameworkSourceSinkInventory().map((entry) => entry.sink));

    expect([...sinks].sort()).toEqual([
      'auth.data-access',
      'dynamic.import.process',
      'file.storage.static-export',
      'html.dom.output',
      'http.header.cookie',
      'ingress.endpoint.webhook',
      'sql.executable',
      'transport.query.live.broadcast',
      'url.navigation.selector',
    ]);
  });

  it('prints stable explain text with the required Phase 1 fields', () => {
    expect(kovoExplain({}, { sourcesSinks: true })).toMatchObject({
      exitCode: 0,
      output: expect.stringContaining(
        [
          'kovo-explain/v1',
          'SOURCES-SINKS',
          'ITEM source=server-render|client-query|client-state|template-stamp|style-extraction sink=html.dom.output context=html.text+attribute+url+script-json+style+srcdoc trust=untrusted-unless-branded guard=contextual-encoding+url-scheme-allowlist:http|https|mailto|tel|ftp schema=compiler-output-context-facts:urlAttrs=href|src|action|formaction|poster|background|cite|data|ping|xlink:href runtimeGuard=server-renderer+browser-output-helpers-drop-unsafe-url-attrs diagnostic=KV236 escapeHatch=trustedHtml|trustedUrl specAnchor=SPEC.md#4.8;SPEC.md#5.2 testEvidence=packages/compiler/src/output-context-security.test.ts,packages/browser/src/security-output.test.ts',
        ].join('\n'),
      ),
    });
  });

  it('writes deterministic JSON from the check command', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-sources-sinks-'));
    const previous = process.cwd();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      process.chdir(root);

      expect(main(['check', 'sources-sinks'])).toBe(0);

      const artifact = JSON.parse(
        readFileSync(join(root, sourcesSinksArtifactPath), 'utf8'),
      ) as Record<string, unknown>;
      expect(artifact.version).toBe(sourcesSinksArtifactVersion);
      expect(artifact.generatedBy).toBe('kovo sources-sinks inventory');
      const entries = artifact.entries as unknown[];
      expect(entries.length).toBe(frameworkSourceSinkInventory().length);
      expect(entries[0]).toMatchObject({
        context: expect.any(String),
        diagnostic: expect.any(String),
        escapeHatch: expect.any(String),
        guard: expect.any(String),
        runtimeGuard: expect.any(String),
        schema: expect.any(String),
        sink: 'html.dom.output',
        source: expect.any(String),
        specAnchor: expect.any(String),
        testEvidence: expect.any(Array),
        trust: expect.any(String),
      });
      expect(stdout).toHaveBeenCalledWith(
        expect.stringContaining('kovo-check/v1\nSOURCES-SINKS\n'),
      );
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      process.chdir(previous);
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('exposes the same inventory through kovo check', () => {
    expect(kovoCheck({}, { family: 'sources-sinks' })).toMatchObject({
      exitCode: 0,
      output: expect.stringContaining('CHECK families=9 entries=9 drift-tokens=17'),
    });
  });
});
