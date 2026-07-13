import { createRenderedFragmentHtml } from '@kovojs/core/internal/sink-policy';
import { expect, it } from 'vitest';

import { DomMorphTarget } from './morph.js';
import { applyHtmlResponseFragments } from './response-fragment-apply.js';

const COUNT = 6_000;

function keyedRows(count: number, reverse = false): string {
  let html = '';
  for (let index = 0; index < count; index += 1) {
    const key = reverse ? count - index - 1 : index;
    html += `<article kovo-key="k${key}"></article>`;
  }
  return html;
}

it('keeps keyed prepend work within the SPEC section 6.6 resource floor', () => {
  const current = keyedRows(COUNT);
  const incoming = keyedRows(COUNT, true);
  const container = document.createElement('div');
  container.innerHTML = current;
  document.body.append(container);

  const started = performance.now();
  new DomMorphTarget(container).prependHtml(incoming);
  const elapsed = performance.now() - started;

  expect(container.children).toHaveLength(COUNT);
  container.remove();
  // The prior nested key scan took roughly quadratic time (128 ms at 2,000 rows in Firefox).
  expect(elapsed).toBeLessThan(750);
});

it('keeps keyed replacement work within the SPEC section 6.6 resource floor', () => {
  const container = document.createElement('section');
  container.innerHTML = keyedRows(COUNT);
  document.body.append(container);

  const started = performance.now();
  new DomMorphTarget(container).replaceWithHtml(`<section>${keyedRows(COUNT, true)}</section>`);
  const elapsed = performance.now() - started;

  expect(container.children).toHaveLength(COUNT);
  container.remove();
  // The prior nested key scan took 254 ms at only 2,000 rows in Firefox.
  expect(elapsed).toBeLessThan(750);
});

it('keeps extracted inline prepend deduplication within the same resource floor', () => {
  const container = document.createElement('div');
  container.innerHTML = keyedRows(COUNT);
  document.body.append(container);

  const started = performance.now();
  applyHtmlResponseFragments(
    [
      {
        html: createRenderedFragmentHtml(keyedRows(COUNT, true)),
        mode: 'prepend',
        target: 'timeline',
      },
    ],
    () => container,
  );
  const elapsed = performance.now() - started;

  expect(container.children).toHaveLength(COUNT);
  container.remove();
  expect(elapsed).toBeLessThan(750);
});
