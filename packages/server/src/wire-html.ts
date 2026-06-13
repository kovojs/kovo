import { escapeAttribute, escapeHtml, escapeScriptJson } from './html.js';
import { renderStylesheetLinks, type StylesheetAsset } from './hints.js';

export interface QueryWireRenderOptions {
  key?: string | undefined;
  name: string;
  value: unknown;
  version?: number | string | undefined;
}

export interface QueryScriptRenderOptions {
  key?: string | undefined;
  name: string;
  value: unknown;
}

export interface FragmentWireRenderOptions {
  errorBoundary?: string | undefined;
  html: string;
  mode?: 'append' | 'replace' | undefined;
  priority?: number | string | undefined;
  stylesheets?: readonly (string | StylesheetAsset)[] | undefined;
  target: string;
}

export function renderQueryWireHtml(options: QueryWireRenderOptions): string {
  const keyAttribute = options.key === undefined ? '' : ` key="${escapeAttribute(options.key)}"`;
  const versionAttribute =
    options.version === undefined ? '' : ` version="${escapeAttribute(String(options.version))}"`;

  return `<fw-query name="${escapeAttribute(options.name)}"${keyAttribute}${versionAttribute}>${escapeHtml(JSON.stringify(options.value))}</fw-query>`;
}

export function renderQueryScript(options: QueryScriptRenderOptions): string {
  const keyAttribute = options.key === undefined ? '' : ` key="${escapeAttribute(options.key)}"`;

  return `<script type="application/json" fw-query="${escapeAttribute(options.name)}"${keyAttribute}>${escapeScriptJson(JSON.stringify(options.value))}</script>`;
}

export function renderFragmentWireHtml(options: FragmentWireRenderOptions): string {
  const modeAttribute = options.mode === 'append' ? ' mode="append"' : '';
  const priorityAttribute =
    options.priority === undefined
      ? ''
      : ` priority="${escapeAttribute(String(options.priority))}"`;
  const errorBoundaryAttribute =
    options.errorBoundary === undefined
      ? ''
      : ` error-boundary="${escapeAttribute(options.errorBoundary)}"`;

  const html = `${renderStylesheetLinks(options.stylesheets ?? [])}${options.html}`;

  return `<fw-fragment target="${escapeAttribute(options.target)}"${modeAttribute}${priorityAttribute}${errorBoundaryAttribute}>${html}</fw-fragment>`;
}
