/** @jsxImportSource @kovojs/server */
import { trustedHtml } from '@kovojs/browser';
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
  sidebarGroupsForPath,
  type ClientHrefs,
} from './chrome.js';
import { ExampleSplit } from './example-split.js';
import { GalleryPage } from './gallery.js';

// The docs page shell: header + sidebar + article + on-this-page rail + footer,
// composed at render time (SPEC §4.5). The mobile sidebar is an L0 disclosure -
// zero JavaScript. Markdown prose arrives as a pre-rendered HTML string and is
// spliced in through Kovo's explicit raw-HTML sink, keeping prose at the route
// boundary while chrome stays TSX.

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
    pageEyebrow: {
      color: 'var(--teal)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.68rem',
      letterSpacing: '0.22em',
      marginBottom: '0.9rem',
      textTransform: 'uppercase',
    },
    prose: {
      color: 'var(--ink)',
      fontSize: '1rem',
      lineHeight: 1.75,
      maxWidth: '46rem',
    },
    specBanner: {
      borderColor: 'color-mix(in srgb, var(--amber) 45%, transparent)',
      borderLeftColor: 'var(--amber)',
      borderLeftStyle: 'solid',
      borderLeftWidth: 2,
      borderStyle: 'solid',
      borderWidth: 1,
      color: 'var(--dim)',
      fontSize: '0.86rem',
      lineHeight: 1.6,
      marginBottom: '2.5rem',
      maxWidth: '48rem',
      padding: '0.8rem 1.1rem',
    },
    specBannerLink: {
      color: 'var(--amber)',
    },
    mobileBody: {
      paddingTop: '1.1rem',
    },
    // In-article sidebar disclosure: shown by default (mobile), hidden once the
    // left rail appears at 64rem. Mobile-first so the default has no competing
    // media rule at narrow widths (see the rails note below).
    mobileMenu: {
      borderColor: 'var(--edge)',
      borderStyle: 'solid',
      borderWidth: 1,
      display: 'block',
      fontSize: '0.84rem',
      marginBottom: '2rem',
      padding: '0.8rem 1rem',
      '@media (min-width: 64rem)': {
        display: 'none',
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
      // Mobile-first single column, widening to two from 48rem up. (A base
      // two-column value with a max-width override is unreliable: the atomic
      // CSS can emit the base after the media rule, so it wins at every width.)
      gridTemplateColumns: '1fr',
      listStyle: 'none',
      margin: 0,
      padding: 0,
      '@media (min-width: 48rem)': {
        gridTemplateColumns: 'repeat(2, 1fr)',
      },
    },
    sectionGroup: {
      marginTop: '2.35rem',
    },
    sectionGroupTitle: {
      borderBottomColor: 'var(--edge)',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      color: 'var(--ink)',
      fontSize: '1.05rem',
      fontWeight: 720,
      letterSpacing: '-0.01em',
      margin: '0 0 1rem',
      paddingBottom: '0.55rem',
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
    // Mobile-first: rails are hidden by default and only appear at wider
    // breakpoints. A default-visible element with a max-width hide is unreliable
    // here — the atomic CSS can order the base `display` after the media rule,
    // so it wins at every width and the rail never collapses on mobile.
    sidebarRail: {
      display: 'none',
      '@media (min-width: 64rem)': {
        display: 'block',
      },
    },
    tocRail: {
      display: 'none',
      flexShrink: 0,
      width: '14rem',
      '@media (min-width: 80rem)': {
        display: 'block',
      },
    },
  },
  { namespace: 'site-docs-layout', source: 'site/src/components/docs-layout.tsx' },
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
  // Show only the sidebar family for this page: the learning path (Getting
  // Started + Tutorial + Guides) together, or Components/Examples/reference
  // together — so the rail stays scoped to what the reader is browsing.
  const sidebarGroups = sidebarGroupsForPath(groups, activePath);
  const desktopSidebar = DocsSidebar.definition.render({
    activePath,
    groups: sidebarGroups,
    mode: 'desktop',
  });
  const mobileSidebar = DocsSidebar.definition.render({
    activePath,
    groups: sidebarGroups,
    mode: 'mobile',
  });
  const toc = apiSidebar ? ApiSidebar.definition.render({ apiSidebar }) : renderToc(headings);

  return (
    <div data-docs-route-page>
      {SiteHeader.definition.render({ activePath, clients })}
      <div style={docsLayoutStyles.docsShell}>
        <aside style={docsLayoutStyles.sidebarRail}>{desktopSidebar}</aside>
        <main style={docsLayoutStyles.main}>
          <details style={docsLayoutStyles.mobileMenu}>
            <summary style={docsLayoutStyles.mobileSummary}>Menu</summary>
            <div style={docsLayoutStyles.mobileBody}>{mobileSidebar}</div>
          </details>
          {eyebrow ? <p style={docsLayoutStyles.pageEyebrow}>{escapeHtml(eyebrow)}</p> : ''}
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
    return content.prose === false ? (
      <div rawHtml={trustedHtml(content.html)} />
    ) : (
      <article style={docsLayoutStyles.prose} data-prose rawHtml={trustedHtml(content.html)} />
    );
  }
  if (content.kind === 'spec') {
    return (
      <div>
        <p style={docsLayoutStyles.specBanner}>
          This is the normative specification, rendered verbatim from{' '}
          <a
            href="https://github.com/kovojs/kovo/blob/main/SPEC.md"
            rel="external"
            style={docsLayoutStyles.specBannerLink}
          >
            SPEC.md
          </a>{' '}
          at build time. The docs explain; the spec decides.
        </p>
        <article style={docsLayoutStyles.prose} data-prose rawHtml={trustedHtml(content.html)} />
      </div>
    );
  }
  if (content.kind === 'gallery') return <GalleryPage input={content.gallery} />;
  if (content.kind === 'example') return <ExampleSplit input={content.example} />;
  return <SectionIndex section={content.section} />;
}

/** Section landing pages: a card grid in the ledger style. */
export function SectionIndex({ section }: { section: SectionIndexInput }): string {
  const numbered = section.key === 'tutorial';
  const groups = section.groups ?? [{ pages: section.pages, title: section.title }];
  return (
    <div data-section-index>
      <div style={docsLayoutStyles.sectionHead}>
        <h1 style={docsLayoutStyles.sectionHeadTitle}>{section.title}</h1>
        {SECTION_INTROS[section.key] ? (
          <p style={docsLayoutStyles.sectionHeadIntro}>
            {SECTION_INTROS[section.key]!}
          </p>
        ) : (
          ''
        )}
      </div>
      {groups.map((group, groupIndex) => (
        <section style={groupIndex === 0 ? null : docsLayoutStyles.sectionGroup}>
          {section.groups ? (
            <h2 style={docsLayoutStyles.sectionGroupTitle}>{group.title}</h2>
          ) : (
            ''
          )}
          <ul style={docsLayoutStyles.sectionGrid}>
            {group.pages.map((page, index) => {
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
                    {section.groups ? (
                      <h3
                        style={[
                          docsLayoutStyles.sectionCardTitle,
                          section.key === 'api' ? docsLayoutStyles.sectionMonoTitle : null,
                        ]}
                      >
                        {title}
                      </h3>
                    ) : (
                      <h2
                        style={[
                          docsLayoutStyles.sectionCardTitle,
                          section.key === 'api' ? docsLayoutStyles.sectionMonoTitle : null,
                        ]}
                      >
                        {title}
                      </h2>
                    )}
                    {page.description ? (
                      <p style={docsLayoutStyles.sectionCardDescription}>{page.description}</p>
                    ) : (
                      ''
                    )}
                    <span style={docsLayoutStyles.sectionCardRead}>Read &rarr;</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
