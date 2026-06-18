/** @jsxImportSource @kovojs/server */
import { interactiveGalleryDemos } from './interactive-docs.generated-fixtures.js';

export {
  interactiveGalleryDemos,
  type InteractiveGalleryDemo,
  type InteractiveGalleryDemoName,
} from './interactive-docs.generated-fixtures.js';

export async function renderInteractiveGalleryRoute(): Promise<string> {
  const renderedDemos = await Promise.all(
    interactiveGalleryDemos.map(async (demo) => ({
      demo,
      rendered: await demo.render(),
    })),
  );

  return (
    <main data-gallery-route="/gallery/interactive">
      <h1>Interactive Gallery</h1>
      <p data-demo-summary="compiled">
        Stateful examples below are app-authored TSX compiled through Kovo into checked-in server
        artifacts and generated client modules.
      </p>
      <nav aria-label="Interactive demos">
        {interactiveGalleryDemos.map((demo) => (
          <a href={`#${demo.name}`}>{demo.title}</a>
        ))}
      </nav>
      {renderedDemos.map(({ demo, rendered }) => (
        <section data-gallery-interactive-route={demo.name} id={demo.name}>
          <h2>{demo.title}</h2>
          {rendered}
        </section>
      ))}
    </main>
  );
}
