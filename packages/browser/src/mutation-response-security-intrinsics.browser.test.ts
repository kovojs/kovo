import { afterEach, describe, expect, it } from 'vitest';

import { applyMutationResponseBodyToRuntime } from './apply-mutation-response.js';
import { installInlineKovoLoader } from './inline-loader.js';
import { DomMorphRoot } from './morph.js';
import { createQueryStore } from './query-store.js';

const nativeElementReplaceWith = Element.prototype.replaceWith;
const nativeElementSetAttribute = Element.prototype.setAttribute;
const nativeNodeAppendChild = Node.prototype.appendChild;

afterEach(() => {
  Element.prototype.replaceWith = nativeElementReplaceWith;
  document.body.replaceChildren();
  delete (globalThis as { __kovo_morph_commit_xss?: number }).__kovo_morph_commit_xss;
});

function installOneShotReplaceWithXss(target: string): void {
  Element.prototype.replaceWith = function poisonedReplaceWith(...nodes: (Node | string)[]): void {
    const next = nodes[0];
    if (
      this.getAttribute('kovo-fragment-target') === target &&
      next instanceof Element &&
      next.tagName === 'SECTION'
    ) {
      Element.prototype.replaceWith = nativeElementReplaceWith;
      const image = document.createElement('img');
      Reflect.apply(nativeElementSetAttribute, image, [
        'onerror',
        'globalThis.__kovo_morph_commit_xss=1',
      ]);
      Reflect.apply(nativeElementSetAttribute, image, ['src', 'data:image/png;base64,!']);
      Reflect.apply(nativeNodeAppendChild, next, [image]);
    }
    return Reflect.apply(nativeElementReplaceWith, this, nodes);
  };
}

async function expectNoCommitSubstitution(target: string): Promise<void> {
  const fragment = document.querySelector(`[kovo-fragment-target="${target}"]`);
  expect(fragment?.querySelector('img')).toBeNull();
  expect(fragment?.querySelector('[data-server-safe]')?.textContent).toBe('safe');
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(
    (globalThis as { __kovo_morph_commit_xss?: number }).__kovo_morph_commit_xss,
  ).toBeUndefined();
}

describe('mutation response security intrinsics', () => {
  it('pins the modular morph commit after sanitizing server fragment bytes', async () => {
    // C108 / SPEC §6.6 rule 5 and §9.1: a late replacement of the final DOM
    // commit method cannot mutate an already-sanitized server node into XSS.
    document.body.innerHTML = '<main kovo-fragment-target="modular-victim"><p>old</p></main>';
    installOneShotReplaceWithXss('modular-victim');

    applyMutationResponseBodyToRuntime({
      body: '<kovo-fragment target="modular-victim"><section kovo-fragment-target="modular-victim"><span data-server-safe>safe</span></section></kovo-fragment>',
      root: new DomMorphRoot(document),
      store: createQueryStore(),
    });

    expect(document.querySelector('[kovo-fragment-target="modular-victim"]')?.tagName).toBe(
      'SECTION',
    );
    await expectNoCommitSubstitution('modular-victim');
  });

  it('pins the generated inline-loader morph commit after sanitizing server fragment bytes', async () => {
    // SPEC §5.2/§6.6: the generated artifact must consume the same captured
    // native commit as the readable source; generated code is never hand-edited.
    document.body.innerHTML = '<main kovo-fragment-target="inline-victim"><p>old</p></main>';
    installInlineKovoLoader(async () => ({}));
    installOneShotReplaceWithXss('inline-victim');

    (globalThis as { __kovo_a?: (body: string) => void }).__kovo_a?.(
      '<kovo-fragment target="inline-victim"><section kovo-fragment-target="inline-victim"><span data-server-safe>safe</span></section></kovo-fragment>',
    );

    expect(document.querySelector('[kovo-fragment-target="inline-victim"]')?.tagName).toBe(
      'SECTION',
    );
    await expectNoCommitSubstitution('inline-victim');
  });
});
