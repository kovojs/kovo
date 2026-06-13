import { describe, expect, it } from 'vitest';

import {
  markdownBoldSectionHeadings,
  markdownCanonicalSpecRuleTitle,
  markdownCanonicalSpecRuleTitles,
  markdownFields,
  markdownLeadingTitle,
  markdownNumberedListItems,
  markdownNumberedListTitles,
  normativeDocsGateFact,
  markdownSection,
  markdownTableRows,
  normalizeMarkdownCell,
} from './markdown-fixtures.js';

describe('@jiso/test markdown fixture seam', () => {
  it('normalizes markdown cells without making fw-check parse inline markup', () => {
    expect(normalizeMarkdownCell(' **Local rule** with `code` \n spacing ')).toBe(
      'Local rule with code spacing',
    );
  });

  it('returns a heading-bounded section by normalized heading text', () => {
    const markdown = [
      '# Spec',
      'intro',
      '## **Required Gates**',
      '| Gate | Status |',
      '| --- | --- |',
      '| build | passed |',
      '### Nested',
      'kept',
      '## Next',
      'outside',
    ].join('\n');

    expect(markdownSection(markdown, 'Required Gates')).toBe(
      ['| Gate | Status |', '| --- | --- |', '| build | passed |', '### Nested', 'kept'].join('\n'),
    );
    expect(() => markdownSection(markdown, 'Missing')).toThrow('Markdown contains heading Missing');
  });

  it('extracts normalized numbered list items, titles, and leading titles', () => {
    const markdown = [
      '1. **Legibility is load-bearing.** Explanation.',
      '2. `Local code` must not require global knowledge.',
    ].join('\n');

    expect(markdownNumberedListItems(markdown)).toEqual([
      'Legibility is load-bearing. Explanation.',
      'Local code must not require global knowledge.',
    ]);
    expect(markdownNumberedListTitles(markdown)).toEqual([
      'Legibility is load-bearing',
      'Local code must not require global knowledge',
    ]);
    expect(markdownLeadingTitle('**Platform behavior emission.** Details')).toBe(
      'Platform behavior emission',
    );
  });

  it('canonicalizes SPEC rule titles used by documentation gates', () => {
    expect(
      markdownCanonicalSpecRuleTitles([
        'Local code must not require global knowledge',
        'One-to-one file mapping',
        'Platform behavior emission',
        '`Teaching errors`',
      ]),
    ).toEqual([
      'No global knowledge at local sites',
      '1:1 file mapping',
      'Platform-behavior emission',
      'Teaching errors',
    ]);
    expect(markdownCanonicalSpecRuleTitle('Source-derived names')).toBe('Source-derived names');
  });

  it('extracts bold numbered section headings used by SPEC open-area gates', () => {
    expect(
      markdownBoldSectionHeadings(
        [
          '**13.1 CSS:** details',
          'body text',
          '**13.2 Lists at scale.** more details',
          '**Not numbered:** ignored',
        ].join('\n'),
      ),
    ).toEqual([
      { number: '13.1', title: 'CSS' },
      { number: '13.2', title: 'Lists at scale' },
    ]);
  });

  it('extracts front-matter style fields with wrapped continuation lines', () => {
    const fields = markdownFields(
      [
        'Status: protocol ready;',
        '  recruitment pending',
        '- ignored list item',
        'Required participants: five outside developers',
      ].join('\n'),
    );

    expect(Object.fromEntries(fields)).toEqual({
      'Required participants': 'five outside developers',
      Status: 'protocol ready; recruitment pending',
    });
  });

  it('extracts normalized markdown table rows', () => {
    expect(
      markdownTableRows(
        [
          '| SPEC 16 criterion | Current evidence artifact |',
          '| --- | --- |',
          '| `16.5 Coverage` | **Commerce matrix** |',
        ].join('\n'),
      ),
    ).toEqual([
      {
        'Current evidence artifact': 'Commerce matrix',
        'SPEC 16 criterion': '16.5 Coverage',
      },
    ]);
    expect(() => markdownTableRows('no table')).toThrow('Markdown section contains a table');
  });

  it('projects normative docs and generated CSS behavior as a structured gate fact', () => {
    const calls: string[] = [];

    expect(
      normativeDocsGateFact({
        assertRenderEquivalence(result) {
          calls.push(`render:${result.handlerExports.join(',')}`);
        },
        collectCssAssetManifest(_result, options) {
          return {
            stylesheets: [
              {
                fragmentTargets: ['doc-card'],
                href: `${options.baseHref}components/docs/doc-card.css`,
              },
            ],
          };
        },
        compileComponentModule({ fileName, source }) {
          calls.push(`compile:${fileName}:${source.includes('doc-card')}`);
          return {
            files: [
              {
                kind: 'css',
                source: '@scope (doc-card) to (:scope [fw-c]) {\n.title { color: teal; }',
              },
            ],
            handlerExports: ['DocCard$choose'],
          };
        },
        compilerRules: [
          '1. **Source-derived names.** Names remain derived.',
          '2. **One-to-one file mapping.** Files remain mapped.',
        ].join('\n'),
        constitution: [
          '1. **Legibility is load-bearing.**',
          '2. **Local code must not require global knowledge.**',
        ].join('\n'),
        spec: [
          '## 2. The Constitution (Design Tests)',
          '| # | Test |',
          '| --- | --- |',
          '| 1 | **Legibility is load-bearing.** details |',
          '| 2 | **Local code must not require global knowledge.** details |',
          '## 5.2 Hard rules (normative)',
          '1. **Source-derived names.** Names remain derived.',
          '2. **One-to-one file mapping.** Files remain mapped.',
          '3. **Registry atomicity.** Pending.',
          '## 13. Open Design Areas (named, not hand-waved)',
          '**13.1 CSS:** details',
        ].join('\n'),
      }),
    ).toEqual({
      compilerRuleItemsMatchTitles: true,
      compilerRuleTitles: ['Source-derived names', '1:1 file mapping'],
      constitutionRuleTitles: [
        'Legibility is load-bearing',
        'Local code must not require global knowledge',
      ],
      constitutionTableNumbers: ['1', '2'],
      constitutionTableRuleTitles: [
        'Legibility is load-bearing',
        'No global knowledge at local sites',
      ],
      cssContractHeadings: [{ number: '13.1', title: 'CSS' }],
      cssScopeRules: [
        {
          limit: ':scope [fw-c]',
          raw: '@scope (doc-card) to (:scope [fw-c]) {',
          scope: 'doc-card',
        },
      ],
      cssStylesheet: {
        fragmentTargets: ['doc-card'],
        href: '/_jiso/components/docs/doc-card.css',
      },
      handlerExports: ['DocCard$choose'],
      hardRuleTitlesCovered: ['Source-derived names', '1:1 file mapping'],
      renderEquivalenceAsserted: true,
    });
    expect(calls).toEqual(['compile:components/docs/doc-card.tsx:true', 'render:DocCard$choose']);
  });
});
