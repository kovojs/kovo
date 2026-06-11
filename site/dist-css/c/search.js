/**
 * ⌘K search island (plan W8). An ordinary Jiso handler module: nothing here
 * runs until the loader imports it on first interaction (SPEC §4.4, §7 L1).
 * The index is fetched once, on open — zero JS, zero network before that.
 */

let indexPromise;
let shortcutsBound = false;

function loadIndex() {
  indexPromise ??= fetch('/search-index.json').then((response) => response.json());
  return indexPromise;
}

function dialog() {
  return document.getElementById('site-search');
}

function bindShortcuts() {
  if (shortcutsBound) return;
  shortcutsBound = true;
  addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      open(event);
    }
  });
}

function score(entry, terms) {
  let total = 0;
  const title = entry.title.toLowerCase();
  const text = entry.text.toLowerCase();
  for (const term of terms) {
    if (title.includes(term)) total += 10;
    else if (text.includes(term)) total += 1;
    else return 0;
  }
  return total;
}

function renderResults(element, entries) {
  element.innerHTML = entries
    .map(
      (entry) =>
        `<li><a href="${entry.url}"><span class="result-section">${entry.section}</span><br>${entry.title}</a></li>`,
    )
    .join('');
}

export function open(event) {
  event.preventDefault?.();
  bindShortcuts();
  const element = dialog();
  if (!element) return;
  element.showModal();
  element.querySelector('input')?.focus();
  void loadIndex();
}

export async function query(event) {
  const terms = event.target.value.toLowerCase().split(/\s+/).filter(Boolean);
  const results = document.getElementById('site-search-results');
  if (!results) return;
  if (terms.length === 0) {
    results.innerHTML = '';
    return;
  }
  const index = await loadIndex();
  const matches = index
    .map((entry) => ({ entry, rank: score(entry, terms) }))
    .filter((match) => match.rank > 0)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 12)
    .map((match) => match.entry);
  renderResults(results, matches);
}
