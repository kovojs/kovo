import { describe, expect, it } from 'vitest';

import {
  assertInlineKovoLoaderInstallerResponseApplyParity,
  assertMinifiedInlineKovoLoaderInstallerResponseApplyParity,
  buildInlineKovoLoaderInstallerReadableSource,
  buildInlineKovoLoaderInstallerSource,
  extractInlineResponseApplyReadableSource,
  inlineResponseApplyReadableSource,
  inlineWireParserReadableSource,
} from './inline-loader-build.js';

// SPEC.md §4.4/§9.1: inline fragment application is generated from a single
// runtime-owned apply helper closure that is extracted, closure-checked, and
// minified before embedding. Query binding application and modular parity
// behavior lives in sibling inline-loader-response-apply-runtime.test.ts.
describe('inline loader response apply source', () => {
  it('generates readable inline loader source around the canonical response apply helper', () => {
    const alternateReadableApply = [
      'function applyInlineMutationResponseChunks(chunks, options) {',
      '  return applyHtmlResponseFragments(chunks.fragments, options.findFragmentTarget);',
      '}',
      'function applyHtmlResponseFragments(fragments, findFragmentTarget) {',
      '  return fragments.map((fragment) => findFragmentTarget(fragment.target));',
      '}',
    ].join('\n');

    const defaultReadable = buildInlineKovoLoaderInstallerReadableSource();
    const alternateReadable = buildInlineKovoLoaderInstallerReadableSource(
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
    expect(inlineResponseApplyReadableSource).toContain('function p(');
    expect(inlineResponseApplyReadableSource).toContain('function d(');
    expect(inlineResponseApplyReadableSource).toContain('function m(');
    expect(inlineResponseApplyReadableSource).toContain('function u(');
    expect(inlineResponseApplyReadableSource).not.toContain('function applyResponseFragment(');
    expect(inlineResponseApplyReadableSource).not.toContain(
      'function dispatchInlineMutationQueries(',
    );
    expect(inlineResponseApplyReadableSource).not.toContain('element.innerHTML = html');
    expect(inlineResponseApplyReadableSource).toContain(
      'return p(chunks.fragments, (target) => options.findFragmentTarget(target));',
    );
    expect(inlineResponseApplyReadableSource).not.toContain('export function');
    expect(alternateReadable).toContain(alternateReadableApply);
    expect(alternateReadable).not.toContain(inlineResponseApplyReadableSource);
    expect(alternateReadable).toContain(
      'applyInlineMutationResponseChunks(chunks, {',
    );
  });

  it('extracts and checks readable and minified inline response apply embeds', () => {
    const canonicalApply = [
      'export function applyInlineMutationResponseChunks(chunks, options) {',
      '  dispatchInlineMutationQueries(chunks.queries, options);',
      '  return applyHtmlResponseFragments(chunks.fragments, (target) => options.findFragmentTarget(target));',
      '}',
      'function dispatchInlineMutationQueries(queries, options) {',
      '  options.dispatchQueryEvent("kovo:query", {',
      '    detail: {',
      '      queries: queries.map((query) => ({ attrs: query.attrs, content: query.content })),',
      '    },',
      '  });',
      '}',
      'function applyResponseFragments(fragments, options) {',
      '  const applied = [];',
      '  for (const fragment of fragments) {',
      '    if (applyResponseFragment(fragment, options)) applied.push(fragment.target);',
      '  }',
      '  return applied;',
      '}',
      'function applyHtmlResponseFragments(fragments, findFragmentTarget) {',
      '  return applyResponseFragments(fragments, {',
      '    appendFragment: appendHtmlResponseFragment,',
      '    findFragmentTarget,',
      '    replaceFragment: replaceHtmlResponseFragment,',
      '  });',
      '}',
      'function applyResponseFragment(fragment, options) {',
      '  const element = options.findFragmentTarget(fragment.target);',
      '  if (!element) return false;',
      '  if (fragment.mode === "append") {',
      '    options.appendFragment(element, fragment.html);',
      '  } else {',
      '    options.replaceFragment(element, fragment.html);',
      '  }',
      '  return true;',
      '}',
      'function appendHtmlResponseFragment(element, html) {',
      '  element.insertAdjacentHTML("beforeend", html);',
      '}',
      'function replaceHtmlResponseFragment(element, html) {',
      '  element.innerHTML = html;',
      '}',
    ].join('\n');
    const canonicalReadable = extractInlineResponseApplyReadableSource(canonicalApply);
    const readableInstaller = buildInlineKovoLoaderInstallerReadableSource(
      inlineWireParserReadableSource,
      canonicalReadable,
    );
    const minifiedInstaller = buildInlineKovoLoaderInstallerSource(readableInstaller);

    expect(canonicalReadable).toMatch(
      /^function dispatchInlineMutationQueries\(queries, options\).*function applyInlineMutationResponseChunks\(chunks, options\)/s,
    );
    expect(canonicalReadable).toContain('function dispatchInlineMutationQueries(queries, options)');
    expect(canonicalReadable).toContain('options.dispatchQueryEvent("kovo:query", {');
    expect(canonicalReadable).toContain(
      'return applyHtmlResponseFragments(chunks.fragments, (target) => options.findFragmentTarget(target));',
    );
    expect(() =>
      assertInlineKovoLoaderInstallerResponseApplyParity(readableInstaller, canonicalApply),
    ).not.toThrow();
    expect(() =>
      assertMinifiedInlineKovoLoaderInstallerResponseApplyParity(minifiedInstaller, canonicalApply),
    ).not.toThrow();
    expect(() =>
      assertInlineKovoLoaderInstallerResponseApplyParity(
        readableInstaller.replace(
          'options.replaceFragment(element, fragment.html);',
          'options.appendFragment(element, fragment.html);',
        ),
        canonicalApply,
      ),
    ).toThrow('canonical response apply helper closure exactly once; found 0');
    expect(() =>
      assertMinifiedInlineKovoLoaderInstallerResponseApplyParity(
        minifiedInstaller.replace(
          'options.replaceFragment(element,fragment.html)',
          'options.appendFragment(element,fragment.html)',
        ),
        canonicalApply,
      ),
    ).toThrow('canonical minified response apply helper closure exactly once; found 0');
  });

  it('includes response apply dependencies from destructured computed keys and defaults', () => {
    const source = [
      'export function applyInlineMutationResponseChunks({ fragments = defaultFragments(), [readQueryKey()]: queries = defaultQueries() }, options) {',
      '  dispatchInlineMutationQueries(queries, options);',
      '  const { [readTargetKey()]: findFragmentTarget = options.findFragmentTarget } = options;',
      '  return applyHtmlResponseFragments(fragments, (target) => findFragmentTarget(target));',
      '}',
      'function readQueryKey() {',
      '  return "queries";',
      '}',
      'function readTargetKey() {',
      '  return "findFragmentTarget";',
      '}',
      'function defaultFragments() {',
      '  return [];',
      '}',
      'function defaultQueries() {',
      '  return [];',
      '}',
      'function dispatchInlineMutationQueries(queries, options) {',
      '  options.dispatchQueryEvent("kovo:query", { detail: { queries } });',
      '}',
      'function applyHtmlResponseFragments(fragments, findFragmentTarget) {',
      '  return fragments.map((fragment) => findFragmentTarget(fragment.target));',
      '}',
    ].join('\n');

    const extracted = extractInlineResponseApplyReadableSource(source);

    expect(extracted).toContain('function readQueryKey()');
    expect(extracted).toContain('function readTargetKey()');
    expect(extracted).toContain('function defaultFragments()');
    expect(extracted).toContain('function defaultQueries()');
    expect(extracted).toMatch(/function dispatchInlineMutationQueries.*function readTargetKey/s);
    expect(extracted).toMatch(/function readTargetKey\(\).*function applyHtmlResponseFragments/s);
    expect(extracted).toContain('[readQueryKey()]');
    expect(extracted).toContain('[readTargetKey()]');
    expect(extracted).toContain('fragments = defaultFragments()');
    expect(extracted).toContain('queries = defaultQueries()');
  });

  it('keeps freshly minified response apply source compact before parity execution', () => {
    // SPEC.md §4.4/§9.1: minification cannot fork the inline mutation response
    // scanner or the batched `kovo:query` event handoff used by runtime query apply.
    const minifiedSource = buildInlineKovoLoaderInstallerSource();

    expect(minifiedSource).toBe(minifiedSource.trim());
    expect(minifiedSource).not.toMatch(/\n|\s{2,}/);
  });

  it('rejects inline response apply helpers that reach outside the function closure', () => {
    // SPEC.md §4.4/§9.1: response apply extraction follows the same closed
    // helper rule as parser extraction, so minified inline apply cannot grow
    // hidden module-level dependencies.
    const topLevelHelperSource = [
      'const applyTarget = (target, html) => { target.innerHTML = html; };',
      'export function applyInlineMutationResponseChunks(chunks, options) {',
      '  options.dispatchQueryEvent("kovo:query", { detail: { queries: chunks.queries } });',
      '  chunks.fragments.forEach((fragment) => applyInlineFragment(fragment, options.findFragmentTarget));',
      '}',
      'function applyInlineFragment(fragment, findFragmentTarget) {',
      '  const element = findFragmentTarget(fragment.target);',
      '  if (element) applyTarget(element, fragment.html);',
      '}',
    ].join('\n');
    const importedHelperSource = [
      'import { applyResponseFragments } from "./inline-response-apply.js";',
      'export function applyInlineMutationResponseChunks(chunks, options) {',
      '  return applyResponseFragments(chunks.fragments, options);',
      '}',
    ].join('\n');
    const parameterInitializerSource = [
      'const defaultChunks = () => ({ fragments: [], queries: [] });',
      'export function applyInlineMutationResponseChunks(chunks = defaultChunks(), options) {',
      '  options.dispatchQueries(chunks.queries);',
      '}',
    ].join('\n');

    expect(() => extractInlineResponseApplyReadableSource(topLevelHelperSource)).toThrow(
      'references top-level binding applyTarget',
    );
    expect(() => extractInlineResponseApplyReadableSource(importedHelperSource)).toThrow(
      'references top-level binding applyResponseFragments',
    );
    expect(() => extractInlineResponseApplyReadableSource(parameterInitializerSource)).toThrow(
      'references top-level binding defaultChunks',
    );
  });

  it('allows local response-apply bindings to shadow unsupported top-level names', () => {
    // SPEC.md §4.4/§9.1: response apply extraction must fail closed on module
    // dependencies while still accepting self-contained local helpers.
    const source = [
      'import { applyResponseFragments } from "./inline-response-apply.js";',
      'const applyTarget = (target, html) => { target.innerHTML = html; };',
      'export function applyInlineMutationResponseChunks(chunks, options) {',
      '  const applyResponseFragments = (fragments) => fragments.map((fragment) => fragment.target);',
      '  options.dispatchQueryEvent("kovo:query", { detail: { queries: chunks.queries } });',
      '  return applyResponseFragments(chunks.fragments).map((target) =>',
      '    applyInlineFragment(target, options.findFragmentTarget),',
      '  );',
      '}',
      'function applyInlineFragment(target, findFragmentTarget) {',
      '  const applyTarget = (element, html) => { element.innerHTML = html; };',
      '  const element = findFragmentTarget(target);',
      '  if (element) applyTarget(element, target);',
      '  return target;',
      '}',
    ].join('\n');

    const extracted = extractInlineResponseApplyReadableSource(source);

    expect(extracted).toContain(
      'const applyResponseFragments = (fragments) => fragments.map((fragment) => fragment.target);',
    );
    expect(extracted).toContain(
      'const applyTarget = (element, html) => { element.innerHTML = html; };',
    );
    expect(extracted).not.toContain('import { applyResponseFragments }');
    expect(extracted).not.toContain('const applyTarget = (target, html)');
  });
});
