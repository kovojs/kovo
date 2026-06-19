import { describe, expect, it } from 'vitest';

import { galleryComponentCatalog } from '../../examples/gallery/src/component-catalog.js';
import { buildLlmsFull, buildLlmsIndex } from '../scripts/llms.mjs';

import { buildGalleryLlmsSection } from './gallery-llms.js';

const ORIGIN = 'https://kovo.sh';

describe('gallery llms section', () => {
  it('produces one page per catalog component with mirror + live url', () => {
    const section = buildGalleryLlmsSection(ORIGIN);
    expect(section.title).toBe('Gallery');
    expect(section.pages).toHaveLength(galleryComponentCatalog.length);

    const accordion = section.pages.find((page) => page.title === 'Accordion');
    expect(accordion).toBeDefined();
    expect(accordion!.mirror).toBe('/gallery/accordion.md');
    expect(accordion!.url).toBe('/gallery/components/accordion/');
    expect(accordion!.description).toBe(galleryComponentCatalog[0]!.summary);
    // The mirror body carries the one-liner and a pointer to the live fixture page.
    expect(accordion!.source).toContain(galleryComponentCatalog[0]!.summary);
    expect(accordion!.source).toContain(`${ORIGIN}/gallery/components/accordion/`);
  });

  it('renders a Gallery section in the llms.txt index, linking each mirror', () => {
    const index = buildLlmsIndex([buildGalleryLlmsSection(ORIGIN)], { origin: ORIGIN });
    expect(index).toContain('## Gallery');
    expect(index).toContain(
      `- [Accordion](${ORIGIN}/gallery/accordion.md): ${galleryComponentCatalog[0]!.summary}`,
    );
    // check-links.mjs extracts each llms.txt link's path and requires a file under
    // dist/ — every gallery link must therefore be a .md mirror path, not the
    // live HTML route (which has no extension and would resolve to a directory).
    for (const entry of galleryComponentCatalog) {
      expect(index).toContain(`(${ORIGIN}/gallery/${entry.component}.md)`);
    }
  });

  it('includes each component body in the llms-full corpus', () => {
    const full = buildLlmsFull([buildGalleryLlmsSection(ORIGIN)], {
      origin: ORIGIN,
      renderBody: (page: { markdown: string }) => page.markdown,
    });
    expect(full).toContain('# Accordion');
    expect(full).toContain('URL: https://kovo.sh/gallery/components/accordion/');
    expect(full).toContain(galleryComponentCatalog[0]!.summary);
  });
});
