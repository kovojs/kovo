/** @jsxImportSource @kovojs/server */
import { escapeHtml } from '@kovojs/server/internal/html';
import * as style from '@kovojs/style';

// Two-pane example page (ported from scripts/examples.mjs renderExampleSplit): a
// sandboxed <iframe> running the example's static export on the left, and a
// zero-JS tabbed source viewer on the right. Tabs are CSS-only (radio inputs +
// `:checked` sibling rules), so the page works with JavaScript disabled — the
// docs degradation contract (SPEC §8). `files` carry pre-highlighted code windows
// (rendered through the shared markdown/Shiki pipeline by the caller); their
// `html` is spliced in as a verbatim child string (the server JSX runtime inserts
// child strings as written).

const exampleSplitStyles = style.create(
  {
    bar: {
      alignItems: 'center',
      background: 'var(--panel)',
      borderBottomColor: 'var(--edge)',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      display: 'flex',
      justifyContent: 'space-between',
      padding: '0.5rem 0.75rem',
    },
    barTitle: {
      color: 'var(--dim)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.68rem',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
    },
    frame: {
      background: '#fff',
      border: 0,
      display: 'block',
      height: '100%',
      minHeight: '30rem',
      width: '100%',
    },
    frameEmpty: {
      alignItems: 'center',
      background: 'var(--panel)',
      color: 'var(--dim)',
      display: 'flex',
      fontSize: '0.9rem',
      justifyContent: 'center',
      padding: '2rem',
      textAlign: 'center',
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
      maxWidth: '48rem',
    },
    headTitle: {
      fontSize: '2.2rem',
      fontWeight: 750,
      letterSpacing: '-0.025em',
      lineHeight: 1.12,
      margin: 0,
    },
    openLink: {
      color: 'var(--teal)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.68rem',
      textDecoration: 'none',
      ':hover': {
        textDecoration: 'underline',
      },
    },
    page: {
      maxWidth: '72rem',
    },
    panel: {
      display: 'none',
      maxHeight: '34rem',
      overflow: 'auto',
      '[data-example-panel] .code-window': {
        border: 0,
        margin: 0,
      },
    },
    shell: {
      borderColor: 'var(--edge)',
      borderStyle: 'solid',
      borderWidth: 1,
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
    },
    split: {
      display: 'grid',
      gap: '1.25rem',
      gridTemplateColumns: '1fr',
      '@media (min-width: 64rem)': {
        gridTemplateColumns: '1fr 1fr',
      },
    },
    tab: {
      borderBottomColor: 'transparent',
      borderBottomStyle: 'solid',
      borderBottomWidth: 2,
      color: 'var(--dim)',
      cursor: 'pointer',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.68rem',
      padding: '0.5rem 0.7rem',
      ':hover': {
        color: 'var(--ink)',
      },
    },
    tabInput: {
      height: 0,
      opacity: 0,
      pointerEvents: 'none',
      position: 'absolute',
      width: 0,
    },
    tablist: {
      background: 'var(--panel)',
      borderBottomColor: 'var(--edge)',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      display: 'flex',
      flexWrap: 'wrap',
    },
  },
  { namespace: 'site-example-split', source: 'site/src/components/example-split.tsx' },
);

export const exampleSplitStyleCss = style.emitAtomicCss(
  Object.values(exampleSplitStyles).flatMap((entry) => entry.__rules ?? []),
);

export interface ExampleSourceFile {
  /** Pre-rendered code-window HTML for this source file. */
  html: string;
  /** Authored path relative to the example dir, e.g. `src/queries.ts`. */
  name: string;
}

export interface ExampleSplitInput {
  /** Static docs-host base or configured dynamic service URL, when available. */
  appHref?: string | undefined;
  blurb: string;
  files: ExampleSourceFile[];
  /** Unique radio-group/id prefix for this page's tabs. */
  idBase: string;
  title: string;
}

/** Example split route page content. */
export function ExampleSplit({ input }: { input: ExampleSplitInput }): string {
  const { appHref, blurb, files, idBase, title } = input;
  // CSS-only tab activation: the checked radio reveals its matching panel and
  // highlights its label. We emit the per-index selector rules in a <style> block
  // because they reference dynamic ids.
  const tabRules = files
    .map((_, index) => `#${idBase}-${index}:checked~[data-example-panels]>[data-index="${index}"]`)
    .join(',');
  const labelRules = files
    .map(
      (_, index) => `#${idBase}-${index}:checked~[data-example-tablist]>[for="${idBase}-${index}"]`,
    )
    .join(',');
  const tabStyle = `${tabRules}{display:block}${labelRules}{color:var(--ink);border-bottom-color:var(--teal)}`;

  return (
    <div style={exampleSplitStyles.page}>
      <header style={exampleSplitStyles.head}>
        <p style={exampleSplitStyles.headEyebrow}>Examples</p>
        <h1 style={exampleSplitStyles.headTitle}>{escapeHtml(title)}</h1>
        <p style={exampleSplitStyles.headBlurb}>{escapeHtml(blurb)}</p>
      </header>
      <style>{tabStyle}</style>
      <div style={exampleSplitStyles.split}>
        <section style={exampleSplitStyles.shell} aria-label={`${title} running app`}>
          <div style={exampleSplitStyles.bar}>
            <span style={exampleSplitStyles.barTitle}>Live app</span>
            {appHref ? (
              <a style={exampleSplitStyles.openLink} href={appHref} target="_blank" rel="noopener">
                Open in new tab &#8599;
              </a>
            ) : (
              ''
            )}
          </div>
          {appHref ? (
            <iframe
              style={exampleSplitStyles.frame}
              src={appHref}
              title={`${title} running app`}
              loading="lazy"
              sandbox="allow-scripts allow-same-origin"
            ></iframe>
          ) : (
            <div style={[exampleSplitStyles.frame, exampleSplitStyles.frameEmpty]}>
              <p>Dynamic demo service not configured for this static build.</p>
            </div>
          )}
        </section>
        <section style={exampleSplitStyles.shell} aria-label={`${title} source code`}>
          {files.map((_, index) => (
            <input
              type="radio"
              name={idBase}
              id={`${idBase}-${index}`}
              style={exampleSplitStyles.tabInput}
              checked={index === 0 ? true : undefined}
            />
          ))}
          <div style={exampleSplitStyles.tablist} data-example-tablist role="tablist">
            {files.map((file, index) => (
              <label
                for={`${idBase}-${index}`}
                style={exampleSplitStyles.tab}
                data-example-tab
                title={file.name}
              >
                {escapeHtml(file.name.split('/').pop()!)}
              </label>
            ))}
          </div>
          <div data-example-panels>
            {files.map((file, index) => (
              <div style={exampleSplitStyles.panel} data-index={index} data-example-panel>
                {file.html}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
