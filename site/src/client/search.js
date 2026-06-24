/**
 * ⌘K search island (plan W8). An ordinary Kovo handler module: nothing here
 * runs until the loader imports it on first interaction (SPEC §4.4, §7 L1).
 * The index is fetched once, on open — zero JS, zero network before that.
 *
 * The ⌘K keyboard shortcut itself is NOT bound here — it lives as an always-on
 * inline listener in the document shell (document-template.tsx), because this
 * module only loads on first interaction and a shortcut inside it could never
 * fire on a cold page. This module owns opening via the header button and the
 * search query/render once a keystroke has lazy-loaded it.
 */

let indexPromise;
let queryVersion = 0;
let selectedIndex = -1;

const DEFAULT_ENTRIES = [
  { kind: 'start', section: 'Getting Started', title: 'Quickstart', url: '/docs/quickstart/' },
  { kind: 'guide', section: 'Build the app', title: 'Tutorial', url: '/tutorial/' },
  { kind: 'api', section: 'Packages and symbols', title: 'API Reference', url: '/api/' },
  { kind: 'app', section: 'Runnable apps', title: 'Examples', url: '/examples/' },
  { kind: 'spec', section: 'Normative behavior', title: 'Specification', url: '/spec/' },
];

function loadIndex() {
  indexPromise ??= fetch('/search-index.json').then((response) => response.json());
  return indexPromise;
}

function dialog() {
  return document.getElementById('site-search');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Rank a result against the query terms. Title (symbol/page name) matches
 * dominate; an exact title match floats to the top; symbol entries (which carry
 * a `kind`) get a small boost so searching an export name lands on the symbol,
 * not the package page. Every term must match somewhere. */
function score(entry, terms) {
  let total = entry.kind ? 2 : 0;
  const title = entry.title.toLowerCase();
  const text = entry.text.toLowerCase();
  for (const term of terms) {
    if (title === term) total += 50;
    else if (title.startsWith(term)) total += 20;
    else if (title.includes(term)) total += 10;
    else if (text.includes(term)) total += 1;
    else return 0;
  }
  return total;
}

/** A result row: kind/section badge, the symbol-or-page title, and the section
 * path. API-symbol rows deep-link straight to the symbol anchor. */
function resultRow(entry, active = false) {
  const badge = entry.kind ? entry.kind : 'page';
  return `<li${active ? ' data-active="true"' : ''}><a href="${escapeHtml(entry.url)}" data-search-result-link${active ? ' aria-current="true"' : ''}><span data-result-kind="${escapeHtml(badge)}">${escapeHtml(badge)}</span><span data-result-body><span data-result-title>${escapeHtml(entry.title)}</span><span data-result-section>${escapeHtml(entry.section)}</span></span></a></li>`;
}

function renderResults(element, entries, options = {}) {
  selectedIndex = entries.length > 0 ? 0 : -1;
  const label = options.label ? `<li data-search-label>${escapeHtml(options.label)}</li>` : '';
  element.innerHTML = `${label}${entries
    .map((entry, index) => resultRow(entry, index === selectedIndex))
    .join('')}`;
}

function renderDefaultResults(element) {
  renderResults(element, DEFAULT_ENTRIES, { label: 'Suggested' });
}

function renderNoResults(element) {
  element.innerHTML = [
    '<li data-search-empty>No matching docs found.</li>',
    '<li data-search-label>Suggested</li>',
    ...DEFAULT_ENTRIES.map((entry) => resultRow(entry)),
  ].join('');
  selectedIndex = 0;
  setSelectedIndex(0);
}

function resultItems() {
  return [...(document.getElementById('site-search-results')?.querySelectorAll('li') ?? [])].filter(
    (item) => item.querySelector('a'),
  );
}

function setSelectedIndex(nextIndex) {
  const items = resultItems();
  if (items.length === 0) {
    selectedIndex = -1;
    return;
  }

  selectedIndex = (nextIndex + items.length) % items.length;
  for (const [index, item] of items.entries()) {
    const active = index === selectedIndex;
    const link = item.querySelector('a');
    if (active) {
      item.setAttribute('data-active', 'true');
      link?.setAttribute('aria-current', 'true');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.removeAttribute('data-active');
      link?.removeAttribute('aria-current');
    }
  }
}

export function open(event) {
  event.preventDefault?.();
  const element = dialog();
  if (!element) return;
  if (!element.open) element.showModal();
  element.querySelector('input')?.focus();
  const results = document.getElementById('site-search-results');
  if (results && results.children.length === 0) renderDefaultResults(results);
  void loadIndex();
}

export async function query(event) {
  const version = (queryVersion += 1);
  const terms = event.target.value.toLowerCase().split(/\s+/).filter(Boolean);
  const results = document.getElementById('site-search-results');
  if (!results) return;
  if (terms.length === 0) {
    renderDefaultResults(results);
    return;
  }
  const index = await loadIndex();
  if (version !== queryVersion) return;
  const matches = index
    .map((entry) => ({ entry, rank: score(entry, terms) }))
    .filter((match) => match.rank > 0)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 12)
    .map((match) => match.entry);
  if (matches.length === 0) {
    renderNoResults(results);
    return;
  }
  renderResults(results, matches);
}

export function navigate(event) {
  const items = resultItems();
  if (items.length === 0) return;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    setSelectedIndex(selectedIndex + 1);
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    setSelectedIndex(selectedIndex - 1);
    return;
  }

  if (event.key === 'Enter') {
    const link = items[selectedIndex < 0 ? 0 : selectedIndex]?.querySelector('a');
    if (!link) return;
    event.preventDefault();
    window.location.href = link.href;
  }
}
