/** @jsxImportSource @kovojs/server */
import { trustedHtml } from '@kovojs/browser';
import { escapeHtml } from '@kovojs/server/internal/html';
import * as style from '@kovojs/style';

// Gallery page chrome (SPEC §4.5): the eyebrow header, the component switcher
// nav, and the demo body. Composed at render time as TSX; the demo markup
// (the compiled interactive demo or the static styled fixture) arrives as a
// pre-rendered HTML string and is spliced in through Kovo's raw-HTML sink, the same way the docs
// layout splices markdown prose. See scripts/build.mjs renderGalleryPage for
// the reference rendering this ports.

const galleryStyles = style.create(
  {
    demo: {
      background: 'var(--bg)',
      borderColor: 'var(--edge)',
      borderStyle: 'solid',
      borderWidth: 1,
      // Component fixtures can be wider than a phone; scroll inside the frame
      // rather than stretching the page.
      overflowX: 'auto',
      padding: '1.25rem',
      '[data-gallery-demo-shell] [data-gallery-demo]': {
        display: 'grid',
        gap: '1rem',
      },
      '[data-gallery-demo-shell] [data-demo-summary]': {
        color: 'var(--dim)',
        margin: 0,
      },
      '[data-gallery-demo-shell] [data-ui-demo]': {
        alignItems: 'center',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.75rem',
      },
      '[data-gallery-demo-shell] [data-gallery-contract]': {
        borderCollapse: 'collapse',
        display: 'block',
        fontSize: '0.82rem',
        overflowX: 'auto',
        width: '100%',
      },
      '[data-gallery-demo-shell] [data-gallery-contract] th': {
        color: 'var(--faint)',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.64rem',
        fontWeight: 600,
        letterSpacing: '0.14em',
        padding: '0.45rem 1rem 0.45rem 0',
        textAlign: 'left',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      },
      '[data-gallery-demo-shell] [data-gallery-contract] td': {
        borderTopColor: 'var(--edge-soft)',
        borderTopStyle: 'solid',
        borderTopWidth: 1,
        color: 'var(--dim)',
        padding: '0.45rem 0',
      },
    },
    detail: {
      borderTopColor: 'var(--edge-soft)',
      borderTopStyle: 'solid',
      borderTopWidth: 1,
      display: 'grid',
      gap: '1rem',
      marginTop: '1.4rem',
      paddingTop: '1.4rem',
    },
    detailGrid: {
      display: 'grid',
      gap: '1rem',
      gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
    },
    detailHeading: {
      fontSize: '1rem',
      fontWeight: 700,
      marginBlock: '0 0.45rem',
    },
    detailList: {
      color: 'var(--dim)',
      lineHeight: 1.65,
      marginBlock: 0,
      paddingInlineStart: '1.2rem',
    },
    detailText: {
      color: 'var(--dim)',
      lineHeight: 1.65,
      margin: 0,
    },
    inlineCode: {
      backgroundColor: 'var(--panel)',
      borderColor: 'var(--edge-soft)',
      borderStyle: 'solid',
      borderWidth: 1,
      color: 'var(--ink)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.78rem',
      paddingBlock: '0.08rem',
      paddingInline: '0.28rem',
    },
    head: {
      marginBottom: '1.6rem',
    },
    headEyebrow: {
      color: 'var(--teal)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.68rem',
      letterSpacing: '0.22em',
      marginBottom: '0.9rem',
      textTransform: 'uppercase',
    },
    headBlurb: {
      color: 'var(--dim)',
      lineHeight: 1.65,
      marginTop: '0.8rem',
    },
    headTitle: {
      fontSize: '2.2rem',
      fontWeight: 750,
      letterSpacing: '-0.025em',
      lineHeight: 1.12,
      margin: 0,
    },
    nav: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '0.45rem',
      marginBottom: '1.5rem',
    },
    navLink: {
      borderColor: 'var(--edge)',
      borderStyle: 'solid',
      borderWidth: 1,
      color: 'var(--dim)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.68rem',
      letterSpacing: '0.08em',
      padding: '0.36rem 0.55rem',
      textDecoration: 'none',
      textTransform: 'uppercase',
      ':hover': {
        borderColor: 'var(--faint)',
        color: 'var(--ink)',
      },
    },
    navLinkCurrent: {
      borderColor: 'var(--teal)',
      color: 'var(--teal)',
    },
    page: {
      maxWidth: '54rem',
    },
  },
  { namespace: 'site-gallery', source: 'site/src/components/gallery.tsx' },
);

export interface GalleryRouteView {
  /** Route path under /gallery, e.g. `/components/button`. */
  path: string;
  title: string;
}

export interface GalleryPageInput {
  /** Component slug, e.g. `button`; also the public @kovojs/ui subpath. */
  component: string;
  /** The active component route. */
  route: GalleryRouteView;
  /** All component routes, for the switcher nav. */
  routes: readonly GalleryRouteView[];
  /** Whether the active page renders a live compiled demo (vs static fixture). */
  interactive: boolean;
  /** The demo body markup (interactive demo or static fixture), already href-rewritten. */
  demoHtml: string;
  /** Source locations backing the page, shown so readers can jump from demo to authored code. */
  source: {
    fixture: string;
    interactiveDemo?: string | undefined;
    packageSource: string;
  };
  /** Authored one-line summary from the gallery catalog. */
  summary: string;
}

function galleryUrl(routePath: string): string {
  return `${routePath}/`;
}

/** Gallery component route page content. */
export function GalleryPage({ input }: { input: GalleryPageInput }): string {
  const { component, demoHtml, interactive, route, routes, source, summary } = input;
  const blurb = interactive
    ? `Live compiled demo for the ${escapeHtml(route.title)} component contract.`
    : `Static fixture output for the ${escapeHtml(route.title)} component contract.`;
  const importPath = `@kovojs/ui/${component}`;

  return (
    <div style={galleryStyles.page}>
      <header style={galleryStyles.head}>
        <p style={galleryStyles.headEyebrow}>Components</p>
        <h1 style={galleryStyles.headTitle}>{escapeHtml(route.title)}</h1>
        <p style={galleryStyles.headBlurb}>{blurb}</p>
      </header>
      <nav style={galleryStyles.nav} aria-label="Components">
        {routes.map((candidate) => (
          <a
            href={galleryUrl(candidate.path)}
            aria-current={candidate.path === route.path ? 'page' : undefined}
            style={[
              galleryStyles.navLink,
              candidate.path === route.path ? galleryStyles.navLinkCurrent : null,
            ]}
          >
            {escapeHtml(candidate.title)}
          </a>
        ))}
      </nav>
      <div style={galleryStyles.demo} data-gallery-demo-shell rawHtml={trustedHtml(demoHtml)} />
      <section style={galleryStyles.detail} aria-label={`${escapeHtml(route.title)} usage`}>
        <div>
          <h2 style={galleryStyles.detailHeading}>Usage</h2>
          <p style={galleryStyles.detailText}>{escapeHtml(summary || blurb)}</p>
          <ul style={galleryStyles.detailList}>
            <li>
              Import the versioned component from{' '}
              <code style={galleryStyles.inlineCode}>{escapeHtml(importPath)}</code>.
            </li>
            <li>
              Copy the source into your app with{' '}
              <code style={galleryStyles.inlineCode}>{`kovo add ${escapeHtml(component)}`}</code>{' '}
              when product code should own the implementation.
            </li>
          </ul>
        </div>
        <div style={galleryStyles.detailGrid}>
          <div>
            <h2 style={galleryStyles.detailHeading}>Source</h2>
            <ul style={galleryStyles.detailList}>
              <li>
                Package source:{' '}
                <code style={galleryStyles.inlineCode}>{escapeHtml(source.packageSource)}</code>
              </li>
              <li>
                Gallery fixture:{' '}
                <code style={galleryStyles.inlineCode}>{escapeHtml(source.fixture)}</code>
              </li>
              {source.interactiveDemo ? (
                <li>
                  Interactive demo:{' '}
                  <code style={galleryStyles.inlineCode}>{escapeHtml(source.interactiveDemo)}</code>
                </li>
              ) : null}
            </ul>
          </div>
          <div>
            <h2 style={galleryStyles.detailHeading}>Behavior contract</h2>
            <p style={galleryStyles.detailText}>
              The rendered fixture above includes the component contract table. Interactive pages
              compile the authored TSX demo and then lift the same contract table from the static
              fixture, so the visible behavior and documented ARIA/data-state surface stay together.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
