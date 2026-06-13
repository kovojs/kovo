import { describe, expect, it } from 'vitest';

import {
  assertInlineJisoLoaderInstallerResponseApplyParity,
  assertInlineJisoLoaderInstallerWireParserParity,
  assertMinifiedInlineJisoLoaderInstallerResponseApplyParity,
  assertMinifiedInlineJisoLoaderInstallerWireParserParity,
  buildInlineJisoLoaderInstallerReadableSource,
  buildInlineJisoLoaderInstallerSource,
  extractInlineResponseApplyReadableSource,
  extractInlineWireParserReadableSource,
  inlineJisoLoaderInstallerReadableSource,
  inlineResponseApplyReadableSource,
  inlineWireParserReadableSource,
} from './inline-loader-build.js';

describe('inline loader parser parity', () => {
  it('generates readable inline loader source around canonical parser and apply helpers', () => {
    // SPEC.md §4.4/§9.1: the inline bootstrap scans the same query/fragment
    // chunks as the modular runtime, so readable source is generated from the
    // extracted parser helper closure instead of carrying a hand-copied parser.
    const alternateReadableParser = [
      'function readInlineMutationResponseBodyChunks(body) {',
      '  const chunks = readMutationResponseElementChunks(body);',
      '  return { fragments: chunks.fragments.map(readFragmentElementChunk), queries: chunks.queries };',
      '}',
      'function readAttribute(attrs, name) {',
      '  return attrs + ":" + name;',
      '}',
      'function readFragmentElementChunk(fragment) {',
      '  return { html: fragment.content, target: readAttribute(fragment.attrs, "target") };',
      '}',
      'function readElementChunks(body) {',
      '  return [{ attrs: readAttribute(body, "target"), content: body }];',
      '}',
      'function readMutationResponseElementChunks(body) {',
      '  return { fragments: readElementChunks(body, "fw-fragment"), queries: readElementChunks(body, "fw-query") };',
      '}',
    ].join('\n');
    const alternateReadableApply = [
      'function applyInlineMutationResponseBody(body, options) {',
      '  return applyInlineMutationResponseChunks(options.readBody(body), options);',
      '}',
      'function applyInlineMutationResponseChunks(chunks, options) {',
      '  chunks.queries.forEach(options.dispatchQuery);',
      '  chunks.fragments.forEach((fragment) => applyInlineFragment(fragment, options.findFragmentTarget));',
      '}',
      'function applyInlineFragment(fragment, findFragmentTarget) {',
      '  const element = findFragmentTarget(fragment.target);',
      '  if (element) element.innerHTML = fragment.html;',
      '}',
    ].join('\n');

    const defaultReadable = buildInlineJisoLoaderInstallerReadableSource();
    const alternateReadable = buildInlineJisoLoaderInstallerReadableSource(
      alternateReadableParser,
      alternateReadableApply,
    );

    expect(defaultReadable).toBe(inlineJisoLoaderInstallerReadableSource);
    expect(defaultReadable).toContain(inlineWireParserReadableSource);
    expect(defaultReadable).toContain(inlineResponseApplyReadableSource);
    expect(inlineWireParserReadableSource).toContain('function readElementChunks(');
    expect(inlineWireParserReadableSource).toContain('function readFragmentChunksFromElements(');
    expect(inlineWireParserReadableSource).toContain(
      'function readInlineMutationResponseBodyChunks(',
    );
    expect(inlineWireParserReadableSource).toContain('function readMutationResponseElementChunks(');
    expect(inlineWireParserReadableSource).not.toContain('export function');
    expect(inlineResponseApplyReadableSource).toContain(
      'function applyInlineMutationResponseBody(',
    );
    expect(inlineResponseApplyReadableSource).toContain(
      'function applyInlineMutationResponseChunks(',
    );
    expect(inlineResponseApplyReadableSource).toContain('function applyInlineFragment(');
    expect(inlineResponseApplyReadableSource).not.toContain('export function');
    expect(alternateReadable).toContain(alternateReadableParser);
    expect(alternateReadable).toContain(alternateReadableApply);
    expect(alternateReadable).not.toContain(inlineWireParserReadableSource);
    expect(alternateReadable).not.toContain(inlineResponseApplyReadableSource);
    expect(alternateReadable).toContain('readInlineMutationResponseBodyChunks(body)');
    expect(alternateReadable).toContain('applyInlineMutationResponseBody(body, {');
    expect(alternateReadable).toContain('readBody: readInlineMutationResponseBodyChunks');
  });

  it('extracts the inline wire parser dependency closure from the modular parser', () => {
    // SPEC.md §4.4/§9.1: parser helper extraction follows function dependencies
    // from the modular runtime parser and excludes unrelated helpers.
    const source = [
      'export function readElementChunks(body) {',
      '  return matchingElementEnd(body) + readAttribute("", "target");',
      '}',
      'function matchingElementEnd(body) {',
      '  return tagClose(body) + escapeRegExp(body);',
      '}',
      'function tagClose(source) {',
      '  return source.length;',
      '}',
      'function escapeRegExp(value) {',
      '  return value.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");',
      '}',
      'export function readAttribute(attrs, name) {',
      '  return unescapeHtml(attrs + name);',
      '}',
      'export function readFragmentElementChunk(fragment) {',
      '  return { html: fragment.content, target: readAttribute(fragment.attrs, "target") };',
      '}',
      'function readFragmentChunksFromElements(chunks) {',
      '  return chunks.map(readFragmentElementChunk);',
      '}',
      'export function readMutationResponseElementChunks(body) {',
      '  return { fragments: readElementChunks(body, "fw-fragment"), queries: readElementChunks(body, "fw-query") };',
      '}',
      'export function readInlineMutationResponseBodyChunks(body) {',
      '  const chunks = readMutationResponseElementChunks(body);',
      '  return { fragments: readFragmentChunksFromElements(chunks.fragments), queries: chunks.queries };',
      '}',
      'function unescapeHtml(value) {',
      '  return value.replaceAll("&amp;", "&");',
      '}',
      'function unusedHelper() {',
      '  return "unused";',
      '}',
    ].join('\n');

    const extracted = extractInlineWireParserReadableSource(source);

    expect(extracted).toMatch(
      /^function tagClose\(source\).*function escapeRegExp\(value\).*function matchingElementEnd\(body\).*function unescapeHtml\(value\).*function readAttribute\(attrs, name\).*function readElementChunks\(body\).*function readMutationResponseElementChunks\(body\)/s,
    );
    expect(extracted).toContain('function readFragmentElementChunk(fragment)');
    expect(extracted).toContain('function readFragmentChunksFromElements(chunks)');
    expect(extracted).toContain('function readInlineMutationResponseBodyChunks(body)');
    expect(extracted).not.toContain('unusedHelper');
    expect(extracted).not.toContain('export function');
  });

  it('includes inline parser dependencies from default parameter initializers', () => {
    // SPEC.md §4.4/§9.1: generated inline parser helpers must be a closed
    // function set even when canonical parser defaults call helper functions.
    const source = [
      'export function readElementChunks(body, tagName = defaultTagName()) {',
      '  return [{ attrs: readAttribute(body, "target"), content: tagName }];',
      '}',
      'function defaultTagName() {',
      '  return "fw-fragment";',
      '}',
      'export function readAttribute(attrs, name) {',
      '  return attrs + name;',
      '}',
      'export function readFragmentElementChunk(fragment) {',
      '  return { html: fragment.content, target: readAttribute(fragment.attrs, "target") };',
      '}',
      'function readFragmentChunksFromElements(chunks = defaultChunks()) {',
      '  return chunks.map(readFragmentElementChunk);',
      '}',
      'function defaultChunks() {',
      '  return [];',
      '}',
      'export function readMutationResponseElementChunks(body) {',
      '  return { fragments: readElementChunks(body), queries: readElementChunks(body, "fw-query") };',
      '}',
      'export function readInlineMutationResponseBodyChunks(body) {',
      '  const chunks = readMutationResponseElementChunks(body);',
      '  return { fragments: readFragmentChunksFromElements(chunks.fragments), queries: chunks.queries };',
      '}',
    ].join('\n');

    const extracted = extractInlineWireParserReadableSource(source);

    expect(extracted).toContain('function defaultTagName()');
    expect(extracted).toContain('function defaultChunks()');
    expect(extracted).toMatch(
      /function defaultTagName\(\).*function readAttribute\(attrs, name\).*function readElementChunks\(body, tagName = defaultTagName\(\)\)/s,
    );
    expect(extracted).toMatch(
      /function defaultChunks\(\).*function readFragmentElementChunk\(fragment\).*function readFragmentChunksFromElements\(chunks = defaultChunks\(\)\)/s,
    );
  });

  it('checks readable and minified inline parser embeds against the modular parser', () => {
    // SPEC.md §4.4/§9.1: inline response scanning is allowed to be tiny, but
    // build-time checks must keep it byte-tied to the modular wire parser.
    const canonicalParser = [
      'export function readElementChunks(body) {',
      '  return readAttribute("", "target") + body;',
      '}',
      'export function readAttribute(attrs, name) {',
      '  return attrs + name;',
      '}',
      'export function readFragmentElementChunk(fragment) {',
      '  return { html: fragment.content, target: readAttribute(fragment.attrs, "target") };',
      '}',
      'export function readMutationResponseElementChunks(body) {',
      '  return { fragments: readElementChunks(body, "fw-fragment"), queries: readElementChunks(body, "fw-query") };',
      '}',
      'export function readInlineMutationResponseBodyChunks(body) {',
      '  const chunks = readMutationResponseElementChunks(body);',
      '  return { fragments: chunks.fragments.map(readFragmentElementChunk), queries: chunks.queries };',
      '}',
    ].join('\n');
    const canonicalReadable = extractInlineWireParserReadableSource(canonicalParser);
    const readableInstaller = buildInlineJisoLoaderInstallerReadableSource(canonicalReadable);
    const minifiedInstaller = buildInlineJisoLoaderInstallerSource(readableInstaller);

    expect(() =>
      assertInlineJisoLoaderInstallerWireParserParity(readableInstaller, canonicalParser),
    ).not.toThrow();
    expect(() =>
      assertMinifiedInlineJisoLoaderInstallerWireParserParity(minifiedInstaller, canonicalParser),
    ).not.toThrow();
    expect(() =>
      assertInlineJisoLoaderInstallerWireParserParity(
        readableInstaller.replace('return attrs + name;', 'return name + attrs;'),
        canonicalParser,
      ),
    ).toThrow('canonical wire parser helper closure exactly once; found 0');
    expect(() =>
      assertMinifiedInlineJisoLoaderInstallerWireParserParity(
        minifiedInstaller.replace('return attrs+name', 'return name+attrs'),
        canonicalParser,
      ),
    ).toThrow('canonical minified wire parser helper closure exactly once; found 0');
  });

  it('extracts and checks readable and minified inline response apply embeds', () => {
    // SPEC.md §4.4/§9.1: inline query-event and fragment application is owned
    // by a canonical runtime helper closure before minification, not by a
    // second hand-written apply function inside the generated bootstrap.
    const canonicalApply = [
      'export function applyInlineMutationResponseBody(body, options) {',
      '  return applyInlineMutationResponseChunks(options.readBody(body), options);',
      '}',
      'function applyInlineMutationResponseChunks(chunks, options) {',
      '  chunks.queries.forEach(options.dispatchQuery);',
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
      /^function applyInlineFragment\(fragment, findFragmentTarget\).*function applyInlineMutationResponseChunks\(chunks, options\).*function applyInlineMutationResponseBody\(body, options\)/s,
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

  it('rejects inline wire parser helpers that reach outside the function closure', () => {
    // SPEC.md §4.4: the inline parser extractor is intentionally narrow; new
    // helper dependencies must be self-contained before they enter the bootstrap.
    const functionLocalSource = [
      'const hiddenHelper = (value) => value;',
      'export function readElementChunks(body) {',
      '  return hiddenHelper(body);',
      '}',
      'export function readAttribute(attrs) {',
      '  return attrs;',
      '}',
      'export function readFragmentElementChunk(fragment) {',
      '  return { html: fragment.content, target: readAttribute(fragment.attrs, "target") };',
      '}',
      'export function readMutationResponseElementChunks(body) {',
      '  return readElementChunks(body);',
      '}',
      'export function readInlineMutationResponseBodyChunks(body) {',
      '  return readMutationResponseElementChunks(body);',
      '}',
    ].join('\n');
    const importedHelperSource = [
      'import { parseJsonValue } from "./json.js";',
      'export function readElementChunks(body) {',
      '  return readAttribute("", "target") + body;',
      '}',
      'export function readAttribute(attrs) {',
      '  return parseJsonValue(attrs).value;',
      '}',
      'export function readFragmentElementChunk(fragment) {',
      '  return { html: fragment.content, target: readAttribute(fragment.attrs, "target") };',
      '}',
      'export function readMutationResponseElementChunks(body) {',
      '  return readElementChunks(body);',
      '}',
      'export function readInlineMutationResponseBodyChunks(body) {',
      '  return readMutationResponseElementChunks(body);',
      '}',
    ].join('\n');
    const topLevelValueSource = [
      'const attributePattern = /target/;',
      'export function readElementChunks(body) {',
      '  return readAttribute("", "target") + body;',
      '}',
      'export function readAttribute(attrs) {',
      '  return attributePattern.test(attrs) ? attrs : null;',
      '}',
      'export function readFragmentElementChunk(fragment) {',
      '  return { html: fragment.content, target: readAttribute(fragment.attrs, "target") };',
      '}',
      'export function readMutationResponseElementChunks(body) {',
      '  return readElementChunks(body);',
      '}',
      'export function readInlineMutationResponseBodyChunks(body) {',
      '  return readMutationResponseElementChunks(body);',
      '}',
    ].join('\n');
    const parameterInitializerSource = [
      'const defaultTagName = () => "fw-fragment";',
      'export function readElementChunks(body, tagName = defaultTagName()) {',
      '  return readAttribute("", tagName) + body;',
      '}',
      'export function readAttribute(attrs) {',
      '  return attrs;',
      '}',
      'export function readFragmentElementChunk(fragment) {',
      '  return { html: fragment.content, target: readAttribute(fragment.attrs, "target") };',
      '}',
      'export function readMutationResponseElementChunks(body) {',
      '  return readElementChunks(body);',
      '}',
      'export function readInlineMutationResponseBodyChunks(body) {',
      '  return readMutationResponseElementChunks(body);',
      '}',
    ].join('\n');

    expect(() => extractInlineWireParserReadableSource(functionLocalSource)).toThrow(
      'references top-level binding hiddenHelper',
    );
    expect(() => extractInlineWireParserReadableSource(importedHelperSource)).toThrow(
      'references top-level binding parseJsonValue',
    );
    expect(() => extractInlineWireParserReadableSource(topLevelValueSource)).toThrow(
      'references top-level binding attributePattern',
    );
    expect(() => extractInlineWireParserReadableSource(parameterInitializerSource)).toThrow(
      'references top-level binding defaultTagName',
    );
  });
});
