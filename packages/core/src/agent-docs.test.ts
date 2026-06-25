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
