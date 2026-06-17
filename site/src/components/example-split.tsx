/** @jsxImportSource @kovojs/server */
import { escapeHtml } from '@kovojs/server';

// Two-pane example page (ported from scripts/examples.mjs renderExampleSplit): a
// sandboxed <iframe> running the example's static export on the left, and a
// zero-JS tabbed source viewer on the right. Tabs are CSS-only (radio inputs +
// `:checked` sibling rules), so the page works with JavaScript disabled — the
// docs degradation contract (SPEC §8). `files` carry pre-highlighted code windows
// (rendered through the shared markdown/Shiki pipeline by the caller); their
// `html` is spliced in as a verbatim child string (the server JSX runtime inserts
// child strings as written).

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

/** Render the example split view as a render-time composition. Returns the page
 * body string consumed by docRoute(..., { prose: false }). */
export function renderExampleSplit({
  appHref,
  blurb,
  files,
  idBase,
  title,
}: ExampleSplitInput): string {
  // CSS-only tab activation: the checked radio reveals its matching panel and
  // highlights its label. We emit the per-index selector rules in a <style> block
  // because they reference dynamic ids.
  const tabRules = files
    .map((_, index) => `#${idBase}-${index}:checked~.example-panels>[data-index="${index}"]`)
    .join(',');
  const labelRules = files
    .map((_, index) => `#${idBase}-${index}:checked~.example-tablist>[for="${idBase}-${index}"]`)
    .join(',');
  const tabStyle = `${tabRules}{display:block}${labelRules}{color:var(--ink);border-bottom-color:var(--teal)}`;

  return (
    <div class="example-page">
      <header class="example-head">
        <p class="eyebrow">Examples</p>
        <h1>{escapeHtml(title)}</h1>
        <p>{escapeHtml(blurb)}</p>
      </header>
      <style>{tabStyle}</style>
      <div class="example-split">
        <section class="example-live" aria-label={`${title} running app`}>
          <div class="example-bar">
            <span class="example-bar-title">Live app</span>
            {appHref ? (
              <a class="example-open" href={appHref} target="_blank" rel="noopener">
                Open in new tab &#8599;
              </a>
            ) : (
              ''
            )}
          </div>
          {appHref ? (
            <iframe
              class="example-frame"
              src={appHref}
              title={`${title} running app`}
              loading="lazy"
              sandbox="allow-scripts allow-same-origin"
            ></iframe>
          ) : (
            <div class="example-frame example-frame-empty">
              <p>Dynamic demo service not configured for this static build.</p>
            </div>
          )}
        </section>
        <section class="example-source" aria-label={`${title} source code`}>
          {files.map((_, index) => (
            <input
              type="radio"
              name={idBase}
              id={`${idBase}-${index}`}
              class="example-tab-input"
              checked={index === 0 ? true : undefined}
            />
          ))}
          <div class="example-tablist" role="tablist">
            {files.map((file, index) => (
              <label for={`${idBase}-${index}`} class="example-tab" title={file.name}>
                {escapeHtml(file.name.split('/').pop()!)}
              </label>
            ))}
          </div>
          <div class="example-panels">
            {files.map((file, index) => (
              <div class="example-panel" data-index={index}>
                {file.html}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
