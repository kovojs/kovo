import { escapeAttribute } from '@kovojs/server/internal/html';
import type { DocumentTemplate } from '@kovojs/server';
import * as style from '@kovojs/style';

import { clientHrefs } from './client/modules.js';

// The app-wide document shell (SPEC §9.5). createApp() assembles `parts.head`
// (route meta, stylesheets, modulepreloads) and the inline 8KB loader (SPEC
// §4.4) for us; this template only adds what is path-independent and must run
// before first paint: the no-flash theme script, font preloads, and the global
// ⌘K search dialog island. Header/footer/sidebar are rendered per route inside
// parts.body so the active path stays exact.

// Apply `.dark` before first paint from localStorage('theme') ?? prefers-color
// so there is no light-mode flash; the header toggle (theme.js) only records an
// explicit choice afterward.
const THEME_SCRIPT = `(()=>{try{const t=localStorage.getItem('theme');const d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch{}})()`;

const FONT_PRELOADS = [
  '<link rel="preload" href="/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>',
  '<link rel="preload" href="/fonts/jetbrains-mono-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>',
].join('');

const searchStyles = style.create(
  {
    dialog: {
      background: 'var(--bg)',
      borderColor: 'var(--edge)',
      borderStyle: 'solid',
      borderWidth: 1,
      boxShadow: '0 24px 60px -12px rgb(0 0 0 / 0.5)',
      color: 'var(--ink)',
      margin: '10vh auto 0',
      maxHeight: '70vh',
      padding: 0,
      width: 'min(40rem, 92vw)',
      '::backdrop': {
        backdropFilter: 'blur(3px)',
        background: 'rgb(0 0 0 / 0.55)',
      },
    },
    input: {
      background: 'transparent',
      border: 'none',
      borderBottomColor: 'var(--edge)',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      color: 'var(--ink)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.95rem',
      outline: 'none',
      padding: '1rem 1.25rem',
      width: '100%',
      '::placeholder': {
        color: 'var(--faint)',
      },
    },
    results: {
      listStyle: 'none',
      margin: 0,
      maxHeight: '50vh',
      overflowY: 'auto',
      padding: '0.5rem',
      '[data-search-label], [data-search-empty]': {
        color: 'var(--faint)',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.64rem',
        letterSpacing: '0.12em',
        padding: '0.55rem 0.75rem 0.35rem',
        textTransform: 'uppercase',
      },
      '[data-search-empty]': {
        borderBottomColor: 'var(--edge-soft)',
        borderBottomStyle: 'solid',
        borderBottomWidth: 1,
        color: 'var(--dim)',
        marginBottom: '0.25rem',
        paddingBottom: '0.65rem',
        textTransform: 'none',
      },
      '[data-search-result-link]': {
        alignItems: 'center',
        color: 'var(--ink)',
        display: 'flex',
        gap: '0.7rem',
        padding: '0.55rem 0.75rem',
        textDecoration: 'none',
      },
      '[data-search-result-link]:hover': {
        background: 'var(--panel)',
      },
      '[data-active="true"] [data-search-result-link]': {
        background: 'var(--panel)',
      },
      '[data-result-kind]': {
        background: 'var(--panel)',
        borderColor: 'var(--edge)',
        borderStyle: 'solid',
        borderWidth: 1,
        color: 'var(--faint)',
        flexShrink: 0,
        fontFamily: 'var(--font-mono)',
        fontSize: '0.56rem',
        letterSpacing: '0.08em',
        padding: '0.12rem 0.4rem',
        textAlign: 'center',
        textTransform: 'uppercase',
        width: '3.4rem',
      },
      '[data-result-kind="function"]': {
        color: 'var(--teal)',
      },
      '[data-result-kind="api"], [data-result-kind="spec"]': {
        color: 'var(--purple)',
      },
      '[data-result-kind="app"], [data-result-kind="guide"], [data-result-kind="start"]': {
        color: 'var(--sky)',
      },
      '[data-result-body]': {
        display: 'flex',
        flexDirection: 'column',
        gap: '0.1rem',
        minWidth: 0,
      },
      '[data-result-title]': {
        fontFamily: 'var(--font-mono)',
        fontSize: '0.84rem',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      '[data-result-section]': {
        color: 'var(--faint)',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.62rem',
        letterSpacing: '0.1em',
      },
    },
  },
  { namespace: 'site-search-dialog', source: 'site/src/document-template.ts' },
);

export const searchDialogStyleCss = style.emitAtomicCss(
  Object.values(searchStyles).flatMap((entry) => entry.__rules ?? []),
);

const searchDialogClass = style.attrs(searchStyles.dialog).className;
const searchInputClass = style.attrs(searchStyles.input).className;
const searchResultsClass = style.attrs(searchStyles.results).className;

const SEARCH_DEFAULT_RESULTS = [
  ['start', 'Quickstart', 'Getting Started', '/docs/quickstart/'],
  ['guide', 'Tutorial', 'Build the app', '/tutorial/'],
  ['api', 'API Reference', 'Packages and symbols', '/api/'],
  ['app', 'Examples', 'Runnable apps', '/examples/'],
  ['spec', 'Specification', 'Normative behavior', '/spec/'],
]
  .map(
    ([kind, title, section, url], index) =>
      `<li${index === 0 ? ' data-active="true"' : ''}><a href="${url}" data-search-result-link${index === 0 ? ' aria-current="true"' : ''}><span data-result-kind="${kind}">${kind}</span><span data-result-body><span data-result-title>${title}</span><span data-result-section>${section}</span></span></a></li>`,
  )
  .join('');

const SEARCH_DIALOG = `<dialog id="site-search" class="${searchDialogClass}" aria-label="Search documentation"><input type="search" class="${searchInputClass}" placeholder="Search docs&hellip;" on:input="${clientHrefs.search}#query" on:keydown="${clientHrefs.search}#navigate" kovo-state="{}"><ul class="${searchResultsClass}" id="site-search-results"><li data-search-label>Suggested</li>${SEARCH_DEFAULT_RESULTS}</ul></dialog>`;

// ⌘K / Ctrl-K opens the search dialog. This must be an always-present inline
// listener, not part of the lazy search island: the island only loads on first
// interaction, so a keyboard shortcut that lived inside it could never fire on a
// cold page. Opening focuses the input; the first keystroke then lazy-loads the
// search module via the input's delegated on:input handler (the index/search
// logic stays L1-lazy, SPEC §4.4/§7 L1). Esc is handled natively by <dialog>.
const SEARCH_HOTKEY = `(()=>{addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&!e.altKey&&(e.key==='k'||e.key==='K')){e.preventDefault();const d=document.getElementById('site-search');if(d&&!d.open){d.showModal();const i=d.querySelector('input');if(i)i.focus();}}})})()`;

// The API symbol rail is page content, but its behavior must survive enhanced
// navigation (SPEC §8) because scripts inserted by DOM morphing do not execute.
// Install one document-level observer and re-bind it after Kovo swaps pages.
const API_NAV_SCRIPT = `(()=>{let observer,setActive;const all=(selector,root=document)=>Array.from(root.querySelectorAll(selector));const decode=(value)=>{try{return decodeURIComponent(value)}catch{return value}};const targetFor=(hash)=>{const raw=hash.slice(1);const decoded=decode(raw);return document.getElementById(decoded)||document.getElementById(raw)||document.getElementsByName(decoded)[0]||document.getElementsByName(raw)[0]};const stickyOffset=()=>document.querySelector('[data-site-bar]')?.getBoundingClientRect().bottom||0;const scrollHash=(hash)=>{const target=targetFor(hash);if(!target)return false;const rect=target.getBoundingClientRect();scrollTo(scrollX,scrollY+rect.top-stickyOffset());return true};function init(){observer?.disconnect();observer=undefined;const nav=document.querySelector('[data-api-nav]');if(!nav){setActive=undefined;return}const links={};all('a[href^="#"]',nav).forEach((link)=>{const raw=link.getAttribute('href').slice(1);links[raw]=link;links[decode(raw)]=link});let current;function set(id){if(!id||id===current)return;links[current]?.removeAttribute('data-active');const link=links[id]||links[decode(id)];if(link){link.setAttribute('data-active','true');for(let parent=link.parentElement;parent&&parent!==nav.parentElement;parent=parent.parentElement){if(parent.tagName==='DETAILS')parent.open=true}link.scrollIntoView({block:'nearest'})}current=id}setActive=set;function syncHash(){if(!location.hash)return false;const raw=location.hash.slice(1);const id=decode(raw);if(links[id]||links[raw]){set(id);return true}return false}const headings=all('.prose h2[id],.prose h3[id],.prose h4[id]');if(!syncHash()&&headings[0])set(headings[0].id);if(!headings.length||!('IntersectionObserver'in window))return;observer=new IntersectionObserver((entries)=>{entries.forEach((entry)=>{if(entry.isIntersecting)set(entry.target.id)})},{rootMargin:'-72px 0px -75% 0px'});headings.forEach((heading)=>observer.observe(heading))}addEventListener('click',(event)=>{if(event.defaultPrevented||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;const link=event.target?.closest?.('[data-api-nav] a[href^="#"]');if(!link)return;const hash=link.getAttribute('href');if(!hash||!scrollHash(hash))return;event.preventDefault();history.pushState(null,'',hash);setActive?.(decode(hash.slice(1)))},{capture:true});addEventListener('kovo:navigate',()=>setTimeout(init));addEventListener('hashchange',()=>setTimeout(()=>{scrollHash(location.hash);init()}));if(document.readyState==='loading')addEventListener('DOMContentLoaded',init,{once:true});else init()})()`;

export const siteDocumentTemplate: DocumentTemplate = ({ parts }) =>
  [
    '<!doctype html>',
    `<html lang="${escapeAttribute(parts.lang)}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<script>${THEME_SCRIPT}</script>`,
    `<script>${SEARCH_HOTKEY}</script>`,
    `<script>${API_NAV_SCRIPT}</script>`,
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
