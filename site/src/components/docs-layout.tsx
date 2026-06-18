/** @jsxImportSource @kovojs/server */
import { escapeHtml } from '@kovojs/server/internal/html';
import * as style from '@kovojs/style';

import { SECTION_INTROS } from '../content.js';
import type { DocsRouteContent, DocsRoutePageData, SectionIndexInput } from '../route-data.js';
import {
  ApiSidebar,
  DocsSidebar,
  PrevNext,
  SiteFooter,
  SiteHeader,
  renderToc,
  type ClientHrefs,
} from './chrome.js';
import { ExampleSplit } from './example-split.js';
import { GalleryPage } from './gallery.js';

// The docs page shell: header + sidebar + article + on-this-page rail + footer,
// composed at render time (SPEC §4.5). The mobile sidebar is an L0 disclosure -
// zero JavaScript. Markdown prose arrives as a pre-rendered HTML string and is
// spliced in as a verbatim child (the server JSX runtime inserts child strings
// as written), keeping prose at the route boundary while chrome stays TSX.

const docsLayoutStyles = style.create(
  {
    docsShell: {
      display: 'flex',
      gap: '3rem',
      margin: '0 auto',
      maxWidth: '80rem',
      padding: '3rem 1.5rem',
      '@media (max-width: 63.999rem)': {
        padding: '3rem 1rem',
      },
    },
    main: {
      flex: 1,
      minWidth: 0,
    },
    mobileBody: {
      paddingTop: '1.1rem',
    },
    mobileMenu: {
      borderColor: 'var(--edge)',
      borderStyle: 'solid',
      borderWidth: 1,
      display: 'none',
      fontSize: '0.84rem',
      marginBottom: '2rem',
      padding: '0.8rem 1rem',
      '@media (max-width: 63.999rem)': {
        display: 'block',
      },
    },
    mobileSummary: {
      color: 'var(--dim)',
      cursor: 'pointer',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.7rem',
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
    },
    sectionCard: {
      background: 'var(--panel)',
      borderColor: 'var(--edge)',
      borderStyle: 'solid',
      borderWidth: 1,
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      padding: '1.15rem 1.3rem 1.25rem',
      textDecoration: 'none',
      transition: 'border-color 0.15s',
      ':hover': {
        borderColor: 'var(--teal)',
      },
    },
    sectionCardDescription: {
      color: 'var(--dim)',
      fontSize: '0.86rem',
      lineHeight: 1.6,
      marginTop: '0.5rem',
    },
    sectionCardRead: {
      color: 'var(--teal)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.64rem',
      letterSpacing: '0.16em',
      marginTop: 'auto',
      paddingTop: '0.9rem',
      textTransform: 'uppercase',
    },
    sectionCardTitle: {
      color: 'var(--ink)',
      fontSize: '1rem',
      fontWeight: 650,
      letterSpacing: '-0.01em',
      margin: 0,
    },
    sectionGrid: {
      display: 'grid',
      gap: '0.9rem',
      gridTemplateColumns: 'repeat(2, 1fr)',
      listStyle: 'none',
      margin: 0,
      padding: 0,
      '@media (max-width: 48rem)': {
        gridTemplateColumns: '1fr',
      },
    },
    sectionHead: {
      marginBottom: '2.4rem',
      maxWidth: '44rem',
    },
    sectionHeadIntro: {
      color: 'var(--dim)',
      fontSize: '1.05rem',
      lineHeight: 1.65,
      marginTop: '0.9rem',
    },
    sectionHeadTitle: {
      fontSize: '2.3rem',
      fontWeight: 750,
      letterSpacing: '-0.025em',
      lineHeight: 1.12,
      margin: 0,
    },
    sectionMonoTitle: {
      fontFamily: 'var(--font-mono)',
      fontSize: '0.92rem',
    },
    sectionNumber: {
      color: 'var(--teal)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.72rem',
      fontWeight: 600,
      letterSpacing: '0.12em',
      marginBottom: '0.6rem',
    },
    sidebarRail: {
      display: 'block',
      '@media (max-width: 63.999rem)': {
        display: 'none',
      },
    },
    tocRail: {
      flexShrink: 0,
      width: '14rem',
      '@media (max-width: 79.999rem)': {
        display: 'none',
      },
    },
  },
  { namespace: 'site-docs-layout', source: 'site/src/components/docs-layout.tsx' },
);

export const docsLayoutStyleCss = style.emitAtomicCss(
  Object.values(docsLayoutStyles).flatMap((entry) => entry.__rules ?? []),
);

export type { DocsRouteContent, DocsRoutePageData, SectionIndexInput };

/** TSX route page for docs-chrome pages. Markdown/API prose remains the single
 * route-boundary HTML input; all surrounding route composition is authored TSX. */
export function DocsRoutePage({
  clients,
  page,
}: {
  clients: ClientHrefs;
  page: DocsRoutePageData;
}): string {
  const { activePath, apiSidebar, content, eyebrow, groups, headings = [], next, prev } = page;
  const sidebar = DocsSidebar.definition.render({ activePath, groups });
  const toc = apiSidebar ? ApiSidebar.definition.render({ apiSidebar }) : renderToc(headings);

  return (
    <div data-docs-route-page>
      {SiteHeader.definition.render({ activePath, clients })}
      <div style={docsLayoutStyles.docsShell}>
        <aside style={docsLayoutStyles.sidebarRail}>{sidebar}</aside>
        <main style={docsLayoutStyles.main}>
          <details style={docsLayoutStyles.mobileMenu}>
            <summary style={docsLayoutStyles.mobileSummary}>Menu</summary>
            <div style={docsLayoutStyles.mobileBody}>{sidebar}</div>
          </details>
          {eyebrow ? <p class="eyebrow">{escapeHtml(eyebrow)}</p> : ''}
          <DocsRouteContentView content={content} />
          {prev || next ? PrevNext.definition.render({ prev, next }) : ''}
        </main>
        <aside style={docsLayoutStyles.tocRail}>{toc}</aside>
      </div>
      {SiteFooter.definition.render()}
    </div>
  );
}

function DocsRouteContentView({ content }: { content: DocsRouteContent }): string {
  if (content.kind === 'html') {
    return content.prose === false ? content.html : <article class="prose">{content.html}</article>;
  }
  if (content.kind === 'gallery') return <GalleryPage input={content.gallery} />;
  if (content.kind === 'example') return <ExampleSplit input={content.example} />;
  return <SectionIndex section={content.section} />;
}

/** Section landing pages: a card grid in the ledger style. */
export function SectionIndex({ section }: { section: SectionIndexInput }): string {
  const numbered = section.key === 'tutorial';
  return (
    <div data-section-index>
      <div style={docsLayoutStyles.sectionHead}>
        <h1 style={docsLayoutStyles.sectionHeadTitle}>{escapeHtml(section.title)}</h1>
        {SECTION_INTROS[section.key] ? (
          <p style={docsLayoutStyles.sectionHeadIntro}>
            {escapeHtml(SECTION_INTROS[section.key]!)}
          </p>
        ) : (
          ''
        )}
      </div>
      <ul style={docsLayoutStyles.sectionGrid}>
        {section.pages.map((page, index) => {
          const title = numbered ? page.title.replace(/^\d+\.\s*/, '') : page.title;
          return (
            <li>
              <a href={page.url} style={docsLayoutStyles.sectionCard}>
                {numbered ? (
                  <span style={docsLayoutStyles.sectionNumber}>
                    {String(index + 1).padStart(2, '0')}
                  </span>
                ) : (
                  ''
                )}
                <h2
                  style={[
                    docsLayoutStyles.sectionCardTitle,
                    section.key === 'api' ? docsLayoutStyles.sectionMonoTitle : null,
                  ]}
                >
                  {escapeHtml(title)}
                </h2>
                {page.description ? (
                  <p style={docsLayoutStyles.sectionCardDescription}>
                    {escapeHtml(page.description)}
                  </p>
                ) : (
                  ''
                )}
                <span style={docsLayoutStyles.sectionCardRead}>Read &rarr;</span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
