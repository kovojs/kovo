import { describe, expect, it, vi } from 'vitest';

import {
  assertInlineJisoLoaderInstallerResponseApplyParity,
  assertMinifiedInlineJisoLoaderInstallerResponseApplyParity,
  buildInlineJisoLoaderInstallerReadableSource,
  buildInlineJisoLoaderInstallerSource,
  extractInlineResponseApplyReadableSource,
  inlineResponseApplyReadableSource,
  inlineWireParserReadableSource,
} from './inline-loader-build.js';
import { expectInlineResponseApplyParity } from './inline-loader-response-apply-fixture.js';
import { inlineSourceInstallCases } from './inline-loader-test-utils.js';
import { applyInlineMutationResponseChunks } from './inline-response-apply.js';

describe('inline loader response apply source', () => {
  it('generates readable inline loader source around the canonical response apply helper', () => {
    // SPEC.md §4.4/§9.1: inline query-event handoff and fragment application
    // are generated from the runtime-owned apply helper closure, while parser
    // extraction remains owned by the parser parity suite.
    const alternateReadableApply = [
      'function applyInlineMutationResponseChunks(chunks, options) {',
      '  options.dispatchQueries(chunks.queries);',
      '  chunks.fragments.forEach((fragment) => applyInlineFragment(fragment, options.findFragmentTarget));',
      '}',
      'function applyInlineFragment(fragment, findFragmentTarget) {',
      '  const element = findFragmentTarget(fragment.target);',
      '  if (element) element.innerHTML = fragment.html;',
      '}',
    ].join('\n');

    const defaultReadable = buildInlineJisoLoaderInstallerReadableSource();
    const alternateReadable = buildInlineJisoLoaderInstallerReadableSource(
      inlineWireParserReadableSource,
      alternateReadableApply,
    );

    expect(defaultReadable).toContain(inlineResponseApplyReadableSource);
    expect(inlineResponseApplyReadableSource).toContain(
      'function applyInlineMutationResponseChunks(',
    );
    expect(inlineResponseApplyReadableSource).not.toContain(
      'function applyInlineMutationResponseBody(',
    );
    expect(inlineResponseApplyReadableSource).toContain('function applyResponseFragment(');
    expect(inlineResponseApplyReadableSource).toContain('function appendInlineFragment(');
    expect(inlineResponseApplyReadableSource).toContain('function replaceInlineFragment(');
    expect(inlineResponseApplyReadableSource).not.toContain('export function');
    expect(alternateReadable).toContain(alternateReadableApply);
    expect(alternateReadable).not.toContain(inlineResponseApplyReadableSource);
    expect(alternateReadable).toContain(
      'applyInlineMutationResponseChunks(readInlineMutationResponseBodyChunks(body), {',
    );
  });

  it('extracts and checks readable and minified inline response apply embeds', () => {
    // SPEC.md §4.4/§9.1: inline query-event and fragment application is owned
    // by a canonical runtime helper closure before minification, not by a
    // second hand-written apply function inside the generated bootstrap.
    const canonicalApply = [
      'export function applyInlineMutationResponseChunks(chunks, options) {',
      '  options.dispatchQueries(chunks.queries);',
      '  chunks.fragments.forEach((fragment) => applyInlineFragment(fragment, options.findFragmentTarget));',
      '}',
      'function applyInlineFragment(fragment, findFragmentTarget) {',
      '  const element = findFragmentTarget(fragment.target);',
      '  if (!element) return;',
      '  if (fragment.mode === "append") {',
      '    element.insertAdjacentHTML("beforeend", fragment.html);',
      '  } else {',
      '    element.innerHTML = fragment.html;',
      '  }',
      '}',
    ].join('\n');
    const canonicalReadable = extractInlineResponseApplyReadableSource(canonicalApply);
    const readableInstaller = buildInlineJisoLoaderInstallerReadableSource(
      inlineWireParserReadableSource,
      canonicalReadable,
    );
    const minifiedInstaller = buildInlineJisoLoaderInstallerSource(readableInstaller);

    expect(canonicalReadable).toMatch(
      /^function applyInlineFragment\(fragment, findFragmentTarget\).*function applyInlineMutationResponseChunks\(chunks, options\)/s,
    );
    expect(() =>
      assertInlineJisoLoaderInstallerResponseApplyParity(readableInstaller, canonicalApply),
    ).not.toThrow();
    expect(() =>
      assertMinifiedInlineJisoLoaderInstallerResponseApplyParity(minifiedInstaller, canonicalApply),
    ).not.toThrow();
    expect(() =>
      assertInlineJisoLoaderInstallerResponseApplyParity(
        readableInstaller.replace(
          'element.innerHTML = fragment.html;',
          'element.textContent = fragment.html;',
        ),
        canonicalApply,
      ),
    ).toThrow('canonical response apply helper closure exactly once; found 0');
    expect(() =>
      assertMinifiedInlineJisoLoaderInstallerResponseApplyParity(
        minifiedInstaller.replace(
          'element.innerHTML=fragment.html',
          'element.textContent=fragment.html',
        ),
        canonicalApply,
      ),
    ).toThrow('canonical minified response apply helper closure exactly once; found 0');
  });

  it.each(inlineSourceInstallCases)(
    'keeps inline response application in parity with the modular DOM apply path through %s',
    async (_name, installSource) => {
      await expectInlineResponseApplyParity(installSource, { expect, vi });
    },
  );

  it('keeps freshly minified response apply source compact before parity execution', () => {
    // SPEC.md §4.4/§9.1: minification cannot fork the inline mutation response
    // scanner or the batched `jiso:query` event handoff used by runtime query apply.
    const minifiedSource = buildInlineJisoLoaderInstallerSource();

    expect(minifiedSource).toBe(minifiedSource.trim());
    expect(minifiedSource).not.toMatch(/\n|\s{2,}/);
  });

  it('applies decoded inline query events and fragments through the runtime-owned helper', () => {
    // SPEC.md §4.4/§9.1: the helper extracted into the inline loader owns the
    // tiny response apply step that bridges raw query chunks to modular query
    // event hydration and applies fragment patches.
    const dispatched: unknown[] = [];
    const targets = new Map([
      [
        'replace-target',
        {
          html: '',
          innerHTML: '',
          insertAdjacentHTML(_position: 'beforeend', html: string) {
            this.html += html;
          },
        },
      ],
      [
        'append-target',
        {
          html: '<li>existing</li>',
          innerHTML: '',
          insertAdjacentHTML(_position: 'beforeend', html: string) {
            this.html += html;
          },
        },
      ],
    ]);

    applyInlineMutationResponseChunks(
      {
        fragments: [
          { html: '<p>replace</p>', target: 'replace-target' },
          { html: '<li>new</li>', mode: 'append', target: 'append-target' },
        ],
        queries: [{ attrs: ' name="cart"', content: 'decoded query', end: 0, start: 0 }],
      },
      {
        dispatchQueries(queries) {
          dispatched.push([...queries]);
        },
        findFragmentTarget(target) {
          return targets.get(target) ?? null;
        },
      },
    );

    expect(dispatched).toEqual([
      [{ attrs: ' name="cart"', content: 'decoded query', end: 0, start: 0 }],
    ]);
    expect(targets.get('replace-target')?.innerHTML).toBe('<p>replace</p>');
    expect(targets.get('append-target')?.html).toBe('<li>existing</li><li>new</li>');
  });
});
