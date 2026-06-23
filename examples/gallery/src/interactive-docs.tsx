/** @jsxImportSource @kovojs/server */
import { trustedHtml } from '@kovojs/browser';

import { interactiveGalleryDemos } from './interactive-docs-demos.js';

export {
  interactiveGalleryDemos,
  type InteractiveGalleryDemo,
  type InteractiveGalleryDemoName,
} from './interactive-docs-demos.js';

export async function renderInteractiveGalleryRoute(): Promise<string> {
  const renderedDemos = await Promise.all(
    interactiveGalleryDemos.map(async (demo) => ({
      demo,
      rendered: await demo.render(),
    })),
  );

  return renderedValueToHtml(
    <main data-gallery-route="/gallery/interactive">
      <h1>Interactive Gallery</h1>
      <p data-demo-summary="compiled">
        Stateful examples below are app-authored TSX compiled through Kovo into emitted server and
        client modules.
      </p>
      <nav aria-label="Interactive demos">
        {interactiveGalleryDemos.map((demo) => (
          <a href={`#${demo.name}`}>{demo.title}</a>
        ))}
      </nav>
      {renderedDemos.map(({ demo, rendered }) => (
        <section data-gallery-interactive-route={demo.name} id={demo.name}>
          <h2>{demo.title}</h2>
          {trustedHtml(renderedValueToHtml(rendered))}
        </section>
      ))}
    </main>,
  );
}

function renderedValueToHtml(value: unknown): string {
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return `${value}`;
  if (typeof value === 'object' && typeof (value as { html?: unknown }).html === 'string') {
    return (value as { html: string }).html;
  }

  return JSON.stringify(value) ?? '';
}
