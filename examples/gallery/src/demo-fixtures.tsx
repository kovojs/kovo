/** @jsxImportSource @jiso/server */
import {
  dialogCloseAttributes,
  dialogContentAttributes,
  dialogRootAttributes,
  dialogTriggerAttributes,
  progressRootAttributes,
  toggleRootAttributes,
} from '@jiso/headless-ui/primitives';

export type GalleryPrimitive = 'dialog' | 'progress' | 'toggle';

export interface GalleryRoute {
  component: GalleryPrimitive;
  path: `/components/${GalleryPrimitive}`;
  render(): string;
  title: string;
}

export interface GalleryFixture {
  component: GalleryPrimitive;
  html: string;
  path: GalleryRoute['path'];
  title: string;
}

export const galleryRoutes: readonly GalleryRoute[] = Object.freeze([
  {
    component: 'dialog',
    path: '/components/dialog',
    render: () => DialogDemo(),
    title: 'Dialog',
  },
  {
    component: 'toggle',
    path: '/components/toggle',
    render: () => ToggleDemo(),
    title: 'Toggle',
  },
  {
    component: 'progress',
    path: '/components/progress',
    render: () => ProgressDemo(),
    title: 'Progress',
  },
]);

export function galleryFixtures(): readonly GalleryFixture[] {
  return galleryRoutes.map((route) => ({
    component: route.component,
    html: renderGalleryRoute(route),
    path: route.path,
    title: route.title,
  }));
}

export function renderGalleryRoute(route: GalleryRoute): string {
  return (
    <main data-gallery-route={route.path}>
      <nav aria-label="Components">
        {galleryRoutes.map((candidate) => (
          <a
            aria-current={candidate.path === route.path ? 'page' : undefined}
            href={candidate.path}
          >
            {candidate.title}
          </a>
        ))}
      </nav>
      <h1>{route.title}</h1>
      {route.render()}
    </main>
  );
}

export function DialogDemo(): string {
  const root = dialogRootAttributes({ open: true });
  const trigger = dialogTriggerAttributes({
    contentId: 'gallery-dialog-content',
    open: false,
  });
  const content = dialogContentAttributes({
    contentId: 'gallery-dialog-content',
    descriptionId: 'gallery-dialog-description',
    open: true,
    titleId: 'gallery-dialog-title',
  });
  const close = dialogCloseAttributes({
    contentId: 'gallery-dialog-content',
    open: true,
  });

  return (
    <section {...root} data-gallery-demo="dialog">
      <p data-demo-summary="no-js">
        Native dialog invoker commands keep the open and close controls meaningful without client
        JavaScript.
      </p>
      <button {...trigger}>Open preview</button>
      <dialog {...content}>
        <h2 id="gallery-dialog-title">Publish gallery changes</h2>
        <p id="gallery-dialog-description">Review the demo route before publishing.</p>
        <button {...close}>Close</button>
      </dialog>
      {renderBehaviorContract({
        changeReasons:
          'trigger-click, close-click, cancel-event, native-beforetoggle, programmatic',
        dataState: 'open, closed',
        keyboard: 'Escape closes the native dialog',
      })}
    </section>
  );
}

export function ToggleDemo(): string {
  const pressed = toggleRootAttributes({ pressed: true });
  const idle = toggleRootAttributes({ pressed: false });
  const disabled = toggleRootAttributes({ disabled: true, pressed: false });

  return (
    <section data-gallery-demo="toggle">
      <p data-demo-summary="no-js">
        Toggle renders a native button with aria-pressed, so the state is inspectable in HTML.
      </p>
      <div role="group" aria-label="Toggle states">
        <button {...pressed} data-fixture-state="pressed">
          Saved
        </button>
        <button {...idle} data-fixture-state="idle">
          Save view
        </button>
        <button {...disabled} data-fixture-state="disabled">
          Disabled
        </button>
      </div>
      {renderBehaviorContract({
        changeReasons: 'trigger-click, programmatic',
        dataState: 'pressed, off, disabled',
        keyboard: 'Space or Enter activates the native button',
      })}
    </section>
  );
}

export function ProgressDemo(): string {
  const loading = progressRootAttributes({
    max: 100,
    value: 42,
    valueText: '42 of 100 tasks complete',
  });
  const complete = progressRootAttributes({ max: 100, value: 100 });
  const indeterminate = progressRootAttributes({ max: 100, value: null });

  return (
    <section data-gallery-demo="progress">
      <p data-demo-summary="no-js">
        Progress uses the native progress element for determinate and indeterminate states.
      </p>
      <progress {...loading}>42%</progress>
      <progress {...complete}>100%</progress>
      <progress {...indeterminate}>Loading</progress>
      {renderBehaviorContract({
        changeReasons: 'value comes from app state',
        dataState: 'loading, complete, indeterminate',
        keyboard: 'No custom keyboard handling',
      })}
    </section>
  );
}

function renderBehaviorContract(props: {
  changeReasons: string;
  dataState: string;
  keyboard: string;
}): string {
  // G1 fixtures intentionally expose the SPEC.md §4.6 behavior surface as
  // HTML so later G2/G3/G5 gates can assert against the same rendered demos.
  return (
    <table data-gallery-contract>
      <tbody>
        <tr>
          <th scope="row">data-state</th>
          <td>{props.dataState}</td>
        </tr>
        <tr>
          <th scope="row">keyboard</th>
          <td>{props.keyboard}</td>
        </tr>
        <tr>
          <th scope="row">change reasons</th>
          <td>{props.changeReasons}</td>
        </tr>
      </tbody>
    </table>
  );
}
