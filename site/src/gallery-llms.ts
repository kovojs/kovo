import { galleryComponentCatalog } from '../../examples/gallery/src/component-catalog.js';

import type { DocSection } from './content.js';

// Synthetic Components section for the agent layer. The component pages are a
// route family of rendered fixtures (no markdown source), so without this they are
// invisible to llms.txt / llms-full.txt. Each page carries the authored one-liner
// from component-catalog.ts; its .md mirror adds a pointer to the live fixture page
// (which renders the styled component, interactive demo, and behavior-contract
// table). The returned value is shaped like a content DocSection so it flows
// straight into buildLlmsIndex / buildLlmsFull and the aux.ts mirror loop alongside
// the markdown sections.

/** Build the Components DocSection for the agent layer. `origin` is the absolute
 * site origin used in the live-page pointer embedded in each mirror body. */
export function buildGalleryLlmsSection(origin: string): DocSection {
  const pages = galleryComponentCatalog.map((entry) => {
    const url = `/components/${entry.component}/`;
    const body = [
      entry.summary,
      '',
      `Rendered Kovo component fixture. The live page shows the styled component (and its interactive demo, where one exists) with its behavior-contract table: ${origin}${url}`,
    ].join('\n');
    return {
      description: entry.summary,
      markdown: body,
      mirror: `/components/${entry.component}.md`,
      source: body,
      title: entry.title,
      url,
    };
  });
  return { key: 'components', pages, title: 'Components' } as unknown as DocSection;
}
