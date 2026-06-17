import { describe, expect, it } from 'vitest';

import {
  markdownBoldSectionHeadings,
  markdownCanonicalSpecRuleTitle,
  markdownCanonicalSpecRuleTitles,
  markdownFields,
  markdownLeadingTitle,
  legibilityStudyGateFact,
  markdownNumberedListItems,
  markdownNumberedListTitles,
  normativeDocsGateFact,
  prelaunchChecklistGateFact,
  markdownSection,
  markdownTableRows,
  normalizeMarkdownCell,
  v1AcceptanceLedgerGateFact,
} from './markdown-fixtures.js';

describe('@kovojs/test markdown fixture seam', () => {
  it('normalizes markdown cells without making kovo-check parse inline markup', () => {
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
                source: '@scope (doc-card) to (:scope [kovo-c]) {\n.title { color: teal; }',
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
        openDesignAreas: [
          '# Open Design Areas',
          '- [ ] **13.1 CSS.** details',
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
          '4. **TSX-only authoring.** Source only.',
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
          limit: ':scope [kovo-c]',
          raw: '@scope (doc-card) to (:scope [kovo-c]) {',
          scope: 'doc-card',
        },
      ],
      cssStylesheet: {
        fragmentTargets: ['doc-card'],
        href: '/_kovo/components/docs/doc-card.css',
      },
      handlerExports: ['DocCard$choose'],
      hardRuleTitlesCovered: [
        'Source-derived names',
        '1:1 file mapping',
        'Registry atomicity',
        'TSX-only authoring',
      ],
      renderEquivalenceAsserted: true,
    });
    expect(calls).toEqual(['compile:components/docs/doc-card.tsx:true', 'render:DocCard$choose']);
  });

  it('projects the v1 acceptance ledger without caller-side table stitching', () => {
    expect(
      v1AcceptanceLedgerGateFact({
        ledger: [
          '# v1 Acceptance',
          '## Required Gates',
          '| v1 acceptance criterion | Status | Current evidence artifact |',
          '| --- | --- | --- |',
          '| 16.1 Framework | passed | build output |',
          '| 16.2 Legibility | pending external study | study ledger |',
          '| Pre-launch | pending external checks | checklist |',
          '## Acceptance Command Set',
          '| Command | Commit | Result |',
          '| --- | --- | --- |',
          '| pnpm run acceptance | abc1234 | passed |',
          '| pnpm run acceptance | TBD at freeze run | pending |',
          '## Dated Ledger Audit',
          '| Area | Status |',
          '| --- | --- |',
          '| Local integration acceptance | passed local run |',
          '| Outside legibility study | pending external study |',
          '| Pre-launch external checks | pending external checks |',
          '## Final Clean-Checkout Checklist',
          '| Check | Status |',
          '| --- | --- |',
          '| build | pending |',
          '| kovo-check | pending |',
        ].join('\n'),
        rule: [
          '# v1 Acceptance Rule',
          '## Required Gates',
          '| Criterion | Required evidence | Current evidence artifact |',
          '| --- | --- | --- |',
          '| 16.1 Framework | built | output |',
          '| 16.2 Legibility | studied | ledger |',
          '| Pre-launch | checked | checklist |',
        ].join('\n'),
      }),
    ).toMatchObject({
      auditStatuses: {
        'Local integration acceptance': 'passed local run',
        'Outside legibility study': 'pending external study',
        'Pre-launch external checks': 'pending external checks',
      },
      cleanCheckoutStatuses: ['pending', 'pending'],
      externalAuditPendingCount: 2,
      gateCriteria: ['16.1 Framework', '16.2 Legibility', 'Pre-launch'],
      gateCriteriaMatchRule: true,
      gateEvidenceArtifacts: {
        '16.1 Framework': 'build output',
        '16.2 Legibility': 'study ledger',
        'Pre-launch': 'checklist',
      },
      gateStatuses: {
        '16.1 Framework': 'passed',
        '16.2 Legibility': 'pending external study',
        'Pre-launch': 'pending external checks',
      },
      localAcceptanceAuditPending: false,
      localAcceptanceAuditRunCount: 1,
      passedAcceptanceRunCount: 1,
      pendingFreezeRunCount: 1,
      runFacts: [
        { command: 'pnpm run acceptance', commit: 'abc1234', result: 'passed' },
        { command: 'pnpm run acceptance', commit: 'TBD at freeze run', result: 'pending' },
      ],
      ruleGateCriteria: ['16.1 Framework', '16.2 Legibility', 'Pre-launch'],
    });
  });

  it('projects the legibility study packet readiness without caller-side table stitching', () => {
    expect(
      legibilityStudyGateFact(
        [
          '# Study',
          'Status: protocol ready; recruitment pending',
          'Required participants: five outside developers',
          'Passing criterion: every task under 60 seconds',
          '## Tasks',
          '| Task |',
          '| --- |',
          '| Button behavior |',
          '| Island data |',
          '## Results Ledger',
          '| Participant | Date | Commit | Result |',
          '| --- | --- | --- | --- |',
          '| pending-1 | TBD | TBD | pending |',
          '| pending-2 | TBD | TBD | pending |',
          '## Dated Study Readiness Ledger',
          '| Reviewer | Status |',
          '| --- | --- |',
          '| Codex | pending |',
          '## Local Session Checklist',
          '| Step | Local check | Evidence to retain outside repo if private |',
          '| --- | --- | --- |',
          '| 1 | Run local build | transcript |',
          '| 2 | Record answer | notes |',
          '## Issues Ledger',
          '| Issue | Status |',
          '| --- | --- |',
          '| Recruitment | pending |',
        ].join('\n'),
      ),
    ).toEqual({
      issueStatuses: ['pending'],
      localSessionEvidenceComplete: true,
      localSessionSteps: ['1', '2'],
      passingCriterion: 'every task under 60 seconds',
      readinessStatuses: ['pending'],
      requiredParticipants: 'five outside developers',
      resultFacts: [
        { commit: 'TBD', date: 'TBD', participant: 'pending-1', result: 'pending' },
        { commit: 'TBD', date: 'TBD', participant: 'pending-2', result: 'pending' },
      ],
      status: 'protocol ready; recruitment pending',
      taskNames: ['Button behavior', 'Island data'],
    });
  });

  it('projects prelaunch checklist readiness without caller-side ledger stitching', () => {
    expect(
      prelaunchChecklistGateFact(
        [
          '# Checklist',
          '## Required Checks',
          '| Check | Status |',
          '| --- | --- |',
          '| Trademark screen | pending |',
          '| Domain | pending |',
          '| npm scope | pending |',
          '| Linguistic screen | pending |',
          '## Dated Audit Ledger',
          '| Reviewer | Status |',
          '| --- | --- |',
          '| Codex | packet ready; external evidence pending |',
          '## Runnable Local Checklist',
          '| Check | Status |',
          '| --- | --- |',
          '| npm | pending |',
          '| domain | pending |',
          '## Domain Evidence Ledger',
          '| Domain | Date | Reviewer | Status |',
          '| --- | --- | --- | --- |',
          '| kovo.sh | 2026-06-12 | TBD | pending |',
          '## Linguistic Evidence Ledger',
          '| Markets or languages | Date | Reviewer | Status |',
          '| --- | --- | --- | --- |',
          '| TBD | 2026-06-12 | TBD | pending |',
          '## npm Scope Evidence Ledger',
          '| Scope | Date | Reviewer | Status |',
          '| --- | --- | --- | --- |',
          '| @kovojs | 2026-06-12 | TBD | pending |',
          '## Trademark Evidence Ledger',
          '| Sources | Date | Reviewer | Status |',
          '| --- | --- | --- | --- |',
          '| TBD | 2026-06-12 | TBD | pending |',
        ].join('\n'),
      ),
    ).toMatchObject({
      auditReadyCount: 1,
      auditStatuses: { Codex: 'packet ready; external evidence pending' },
      domain: 'kovo.sh',
      evidenceReviewFacts: {
        Domain: { date: '2026-06-12', reviewer: 'TBD', status: 'pending' },
        'Linguistic screen': { date: '2026-06-12', reviewer: 'TBD', status: 'pending' },
        'Trademark screen': { date: '2026-06-12', reviewer: 'TBD', status: 'pending' },
        'npm scope': { date: '2026-06-12', reviewer: 'TBD', status: 'pending' },
      },
      evidenceStatuses: ['pending', 'pending', 'pending', 'pending'],
      linguisticMarkets: 'TBD',
      requiredChecks: ['Trademark screen', 'Domain', 'npm scope', 'Linguistic screen'],
      requiredStatuses: {
        Domain: 'pending',
        'Linguistic screen': 'pending',
        'Trademark screen': 'pending',
        'npm scope': 'pending',
      },
      runnableStatuses: ['pending', 'pending'],
      scope: '@kovojs',
      trademarkSources: 'TBD',
    });
  });
});
