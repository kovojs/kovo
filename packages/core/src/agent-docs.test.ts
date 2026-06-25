import { describe, expect, it } from 'vitest';

import {
  bundledKovoRulesSource,
  kovoRulesBeginMarker,
  kovoRulesEndMarker,
  renderKovoRulesBlock,
  replaceKovoRulesBlock,
} from './internal/agent-docs.js';

describe('agent docs rules block', () => {
  it('renders the concise command and local docs table of contents', () => {
    const block = renderKovoRulesBlock({ version: '1.2.3' });

    expect(block).toContain(kovoRulesBeginMarker);
    expect(block).toContain('<!-- kovo-rules-version: 1.2.3 -->');
    expect(block).toContain('<!-- kovo-rules-source: ./.kovo/docs/kovo-rules.md -->');
    expect(block).toContain('`kovo check`');
    expect(block).toContain('`kovo explain <target>`');
    expect(block).toContain('`kovo update-docs`');
    expect(block).toContain('Read the local docs below');
    expect(block).toContain('- Spec: `./.kovo/docs/spec.md`');
    expect(block).toContain('### Getting Started');
    expect(block).toContain('- Why Kovo?: `./.kovo/docs/docs/why-kovo.md`');
    expect(block).toContain('### Tutorial');
    expect(block).toContain('- 8. Wrap-up & deploy: `./.kovo/docs/tutorial/08-wrap-up.md`');
    expect(block).toContain('### Guides');
    expect(block).toContain('- Live queries: `./.kovo/docs/guides/live-queries.md`');
    expect(block).toContain('### API Reference');
    expect(block).toContain('- @kovojs/cli: `./.kovo/docs/api/cli.md`');
    expect(block).toContain('### Reference');
    expect(block).toContain('- Diagnostics: `./.kovo/docs/reference/diagnostics.md`');
    expect(block).not.toContain('./.kovo/docs/llms.txt');
    expect(block).not.toContain('./.kovo/docs/llms-full.txt');
    expect(block).toContain(kovoRulesEndMarker);
  });

  it('replaces exactly one generated block while preserving app instructions', () => {
    const oldBlock = renderKovoRulesBlock({ rulesSource: '# Old', version: '0.1.0' }).trimEnd();
    const nextBlock = renderKovoRulesBlock({
      rulesSource: bundledKovoRulesSource(),
      version: '0.2.0',
    });
    const source = `# App Agents\n\nBefore.\n\n${oldBlock}\n\nAfter.\n`;

    expect(replaceKovoRulesBlock(source, nextBlock)).toBe(`# App Agents

Before.

${nextBlock.trimEnd()}

After.
`);
  });

  it('inserts a block into AGENTS.md when markers are missing', () => {
    const block = renderKovoRulesBlock({ version: '1.0.0' });

    expect(replaceKovoRulesBlock('# App Agents\n', block)).toBe(`# App Agents

${block}`);
  });

  it('rejects malformed or duplicate marker pairs', () => {
    const block = renderKovoRulesBlock({ version: '1.0.0' });

    expect(() => replaceKovoRulesBlock(`${kovoRulesBeginMarker}\n`, block)).toThrow(
      'Expected exactly one',
    );
    expect(() =>
      replaceKovoRulesBlock(
        `${kovoRulesBeginMarker}\n${kovoRulesEndMarker}\n${kovoRulesBeginMarker}\n${kovoRulesEndMarker}\n`,
        block,
      ),
    ).toThrow('Expected exactly one');
    expect(() =>
      replaceKovoRulesBlock(`${kovoRulesEndMarker}\n${kovoRulesBeginMarker}\n`, block),
    ).toThrow('appears before');
  });
});
