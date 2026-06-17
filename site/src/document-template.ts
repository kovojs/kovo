import { escapeAttribute } from '@kovojs/server';
import type { DocumentTemplate } from '@kovojs/server/app-shell/core';

import { clientHrefs } from './client/modules.js';

// The app-wide document shell (SPEC §9.5). createApp() assembles `parts.head`
// (route meta, stylesheets, modulepreloads) and the inline 4KB loader (SPEC
// §4.4) for us; this template only adds what is path-independent and must run
// before first paint: the no-flash theme script, font preloads, and the global
// ⌘K search dialog island. Header/footer/sidebar are rendered per route inside
// parts.body so the active path stays exact.

// Apply `.dark` before first paint from localStorage('theme') ?? prefers-color
// so there is no light-mode flash; the header toggle (theme.js) only records an
// explicit choice afterward.
const THEME_SCRIPT = `(()=>{try{const t=localStorage.getItem('theme');if(t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch{}})()`;

const FONT_PRELOADS = [
  '<link rel="preload" href="/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>',
  '<link rel="preload" href="/fonts/jetbrains-mono-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>',
].join('');

const SEARCH_DIALOG = `<dialog id="site-search" class="search-dialog" aria-label="Search documentation"><input type="search" class="search-input" placeholder="Search docs&hellip;" on:input="${clientHrefs.search}#query" kovo-state="{}"><ul class="search-results" id="site-search-results"></ul></dialog>`;

// ⌘K / Ctrl-K opens the search dialog. This must be an always-present inline
// listener, not part of the lazy search island: the island only loads on first
// interaction, so a keyboard shortcut that lived inside it could never fire on a
// cold page. Opening focuses the input; the first keystroke then lazy-loads the
// search module via the input's delegated on:input handler (the index/search
// logic stays L1-lazy, SPEC §4.4/§7 L1). Esc is handled natively by <dialog>.
const SEARCH_HOTKEY = `(()=>{addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&!e.altKey&&(e.key==='k'||e.key==='K')){e.preventDefault();const d=document.getElementById('site-search');if(d&&!d.open){d.showModal();const i=d.querySelector('input');if(i)i.focus();}}})})()`;

export const siteDocumentTemplate: DocumentTemplate = ({ parts }) =>
  [
    '<!doctype html>',
    `<html lang="${escapeAttribute(parts.lang)}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<script>${THEME_SCRIPT}</script>`,
    `<script>${SEARCH_HOTKEY}</script>`,
    FONT_PRELOADS,
    parts.head,
    parts.queryScripts.join(''),
    '</head>',
    '<body>',
    parts.body,
    SEARCH_DIALOG,
    '</body>',
    '</html>',
  ].join('');
