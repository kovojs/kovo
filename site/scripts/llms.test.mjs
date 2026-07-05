import { describe, expect, it } from 'vitest';

import { buildLlmsFull, buildLlmsIndex, buildLlmsTier } from './llms.mjs';

const ORIGIN = 'https://kovo.test';
const VERSION = '@kovojs 1.2.3 (abc123)';

const sections = [
  {
    key: 'getting-started',
    title: 'Getting Started',
    pages: [
      {
        description: 'Start here.',
        markdown: '# Quickstart\n\nRun it.',
        mirror: '/getting-started/quickstart.md',
        title: 'Quickstart',
        url: '/getting-started/quickstart/',
      },
    ],
  },
  {
    key: 'api',
    title: 'API',
    pages: [
      {
        description: 'API surface.',
        markdown: '# @kovojs/server\n\nExports.',
        mirror: '/api/server.md',
        title: '@kovojs/server',
        url: '/api/server/',
      },
    ],
  },
];

describe('llms artifacts', () => {
  it('stamps llms.txt and lists context-sized tiers with byte sizes', () => {
    const guidesTier = buildLlmsTier([sections[0]], {
      origin: ORIGIN,
      renderBody: (page) => page.markdown,
      title: 'Guides',
      version: VERSION,
    });

    const index = buildLlmsIndex(sections, {
      origin: ORIGIN,
      tiers: [
        {
          bytes: Buffer.byteLength(guidesTier, 'utf8'),
          path: '/llms-guides.txt',
          title: 'Guides',
        },
      ],
      version: VERSION,
    });

    expect(index).toContain(`Version: ${VERSION}`);
    expect(index).toContain(
      `- [Guides](${ORIGIN}/llms-guides.txt) — ${Buffer.byteLength(guidesTier, 'utf8')} bytes`,
    );
    expect(index).toContain(`- [Quickstart](${ORIGIN}/getting-started/quickstart.md)`);
  });

  it('renders a tier without the specification or unrelated sections', () => {
    const tier = buildLlmsTier([sections[0]], {
      origin: ORIGIN,
      renderBody: (page) => page.markdown,
      title: 'Guides',
      version: VERSION,
    });

    expect(tier).toContain('# Kovo — Guides');
    expect(tier).toContain(`Version: ${VERSION}`);
    expect(tier).toContain('URL: https://kovo.test/getting-started/quickstart/');
    expect(tier).not.toContain('Kovo Specification');
    expect(tier).not.toContain('@kovojs/server');
  });

  it('stamps llms-full from caller input instead of reading git in the builder', () => {
    const full = buildLlmsFull(sections, {
      origin: ORIGIN,
      renderBody: (page) => page.markdown,
      spec: { body: '# SPEC\n\nNormative.', title: 'Kovo Specification', url: '/spec/' },
      version: VERSION,
    });

    expect(full).toContain(`Version: ${VERSION}`);
    expect(full).toContain('URL: https://kovo.test/spec/');
    expect(full).toContain('# SPEC');
  });
});
