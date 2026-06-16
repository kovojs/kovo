/** @jsxImportSource @kovojs/server */
import { escapeHtml } from '@kovojs/server';

// Gallery page chrome (SPEC §4.5): the eyebrow header, the component switcher
// nav, and the demo body. Composed at render time as TSX; the demo markup
// (the compiled interactive demo or the static styled fixture) arrives as a
// pre-rendered HTML string and is spliced in verbatim, the same way the docs
// layout splices markdown prose. See scripts/build.mjs renderGalleryPage for
// the reference rendering this ports.

export interface GalleryRouteView {
  /** Route path under /gallery, e.g. `/components/button`. */
  path: string;
  title: string;
}

export interface GalleryPageInput {
  /** The active component route. */
  route: GalleryRouteView;
  /** All component routes, for the switcher nav. */
  routes: readonly GalleryRouteView[];
  /** Whether the active page renders a live compiled demo (vs static fixture). */
  interactive: boolean;
  /** The demo body markup (interactive demo or static fixture), already href-rewritten. */
  demoHtml: string;
}

function galleryUrl(routePath: string): string {
  return `/gallery${routePath}/`;
}

/** Render the gallery component page body as a verbatim HTML string. */
export function renderGalleryPage(input: GalleryPageInput): string {
  const { demoHtml, interactive, route, routes } = input;
  const blurb = interactive
    ? `Live compiled demo for the ${escapeHtml(route.title)} component contract.`
    : `Static fixture output for the ${escapeHtml(route.title)} component contract.`;

  return (
    <div class="gallery-page">
      <header class="gallery-head">
        <p class="eyebrow">Gallery</p>
        <h1>{escapeHtml(route.title)}</h1>
        <p>{blurb}</p>
      </header>
      <nav class="gallery-nav" aria-label="Gallery components">
        {routes.map((candidate) => (
          <a
            href={galleryUrl(candidate.path)}
            aria-current={candidate.path === route.path ? 'page' : undefined}
          >
            {escapeHtml(candidate.title)}
          </a>
        ))}
      </nav>
      <div class="gallery-demo">{demoHtml}</div>
    </div>
  );
}
