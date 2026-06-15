// v1-cleanup item 1: kept whole intentionally (below the split threshold).
// This is the canonical inline-loader parser/apply parity surface — its
// assertions pin that the generated inline bootstrap stays byte-identical to the
// canonical wire-parser/response-apply helpers (SPEC.md §4.4). Splitting would
// scatter a single coherent parity contract across files.
import { describe, expect, it } from 'vitest';

import {
  assertInlineJisoLoaderInstallerWireParserParity,
  assertMinifiedInlineJisoLoaderInstallerWireParserParity,
  buildInlineJisoLoaderInstallerReadableSource,
  buildInlineJisoLoaderInstallerSource,
  extractInlineWireParserReadableSource,
  inlineJisoLoaderInstallerReadableSource,
  inlineWireParserReadableSource,
} from './inline-loader-build.js';

describe('inline loader parser parity', () => {
  it('generates readable inline loader source around the canonical parser helper', () => {
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

    const defaultReadable = buildInlineJisoLoaderInstallerReadableSource();
    const alternateReadable = buildInlineJisoLoaderInstallerReadableSource(alternateReadableParser);

    expect(defaultReadable).toBe(inlineJisoLoaderInstallerReadableSource);
    expect(defaultReadable).toContain(inlineWireParserReadableSource);
    expect(inlineWireParserReadableSource).toContain('function readElementChunks(');
    expect(inlineWireParserReadableSource).toContain('function readFragmentChunksFromElements(');
    expect(inlineWireParserReadableSource).toContain(
      'function readInlineMutationResponseBodyChunks(',
    );
    expect(inlineWireParserReadableSource).toContain('function readMutationResponseElementChunks(');
    expect(inlineWireParserReadableSource).not.toContain('export function');
    expect(alternateReadable).toContain(alternateReadableParser);
    expect(alternateReadable).not.toContain(inlineWireParserReadableSource);
    expect(alternateReadable).toContain('readInlineMutationResponseBodyChunks(body)');
    expect(alternateReadable).toContain(
      'applyInlineMutationResponseChunks(readInlineMutationResponseBodyChunks(body), {',
    );
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

  it('includes inline parser dependencies from destructured computed keys and defaults', () => {
    // SPEC.md §4.4/§9.1: parser helper extraction must close over helper
    // calls hidden in binding patterns before the readable source is minified
    // into the always-loaded bootstrap.
    const source = [
      'export function readElementChunks(body, { [readDefaultTagName()]: tagName = readDefaultTagName() } = {}) {',
      '  const { [readDefaultAttrName()]: attrs = readDefaultAttrs() } = { target: body };',
      '  return [{ attrs: readAttribute(attrs, "target"), content: tagName }];',
      '}',
      'function readDefaultTagName() {',
      '  return "fw-fragment";',
      '}',
      'function readDefaultAttrName() {',
      '  return "target";',
      '}',
      'function readDefaultAttrs() {',
      '  return "";',
      '}',
      'export function readAttribute(attrs, name) {',
      '  return attrs + name;',
      '}',
      'export function readFragmentElementChunk(fragment) {',
      '  return { html: fragment.content, target: readAttribute(fragment.attrs, "target") };',
      '}',
      'function readFragmentChunksFromElements(chunks) {',
      '  return chunks.map(readFragmentElementChunk);',
      '}',
      'export function readMutationResponseElementChunks(body) {',
      '  return { fragments: readElementChunks(body), queries: readElementChunks(body, { "fw-query": "fw-query" }) };',
      '}',
      'export function readInlineMutationResponseBodyChunks(body) {',
      '  const chunks = readMutationResponseElementChunks(body);',
      '  return { fragments: readFragmentChunksFromElements(chunks.fragments), queries: chunks.queries };',
      '}',
    ].join('\n');

    const extracted = extractInlineWireParserReadableSource(source);

    expect(extracted).toMatch(
      /function readDefaultTagName\(\).*function readDefaultAttrName\(\).*function readDefaultAttrs\(\).*function readAttribute\(attrs, name\).*function readElementChunks/s,
    );
    expect(extracted).toContain('[readDefaultTagName()]');
    expect(extracted).toContain('[readDefaultAttrName()]');
    expect(extracted).toContain('attrs = readDefaultAttrs()');
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

  it('checks generated inline parser embeds through the default canonical helper source', () => {
    // SPEC.md §4.4/§9.1: the default parity assertions must use the same
    // scanner plus shared HTML helper closure as the generated inline loader.
    const readableInstaller = buildInlineJisoLoaderInstallerReadableSource();
    const minifiedInstaller = buildInlineJisoLoaderInstallerSource(readableInstaller);

    expect(() => assertInlineJisoLoaderInstallerWireParserParity(readableInstaller)).not.toThrow();
    expect(() =>
      assertMinifiedInlineJisoLoaderInstallerWireParserParity(minifiedInstaller),
    ).not.toThrow();
    expect(() =>
      assertInlineJisoLoaderInstallerWireParserParity(
        readableInstaller.replace(
          'function unescapeHtml(value) {\n',
          'function unescapeHtml(value) {\n    value = String(value);\n',
        ),
      ),
    ).toThrow('canonical wire parser helper closure exactly once; found 0');
    expect(() =>
      assertMinifiedInlineJisoLoaderInstallerWireParserParity(
        minifiedInstaller.replace('function uh(value){', 'function uh(value){value=String(value);'),
      ),
    ).toThrow('canonical minified wire parser helper closure exactly once; found 0');
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

  it('allows local helper bindings to shadow unsupported top-level parser names', () => {
    // SPEC.md §4.4: inline parser extraction rejects module-level state but
    // must not confuse local parameter or variable bindings for hidden imports.
    const source = [
      'import { parseJsonValue } from "./json.js";',
      'const attributePattern = /target/;',
      'export function readElementChunks(body) {',
      '  const parseJsonValue = (value) => value;',
      '  return [{ attrs: parseJsonValue(body), content: body }];',
      '}',
      'export function readAttribute(attrs, name) {',
      '  const attributePattern = { test: (value) => value.includes(name) };',
      '  return attributePattern.test(attrs) ? attrs : "";',
      '}',
      'export function readFragmentElementChunk(fragment) {',
      '  return { html: fragment.content, target: readAttribute(fragment.attrs, "target") };',
      '}',
      'function readFragmentChunksFromElements(chunks) {',
      '  return chunks.map(readFragmentElementChunk);',
      '}',
      'export function readMutationResponseElementChunks(body) {',
      '  return { fragments: readElementChunks(body), queries: readElementChunks(body) };',
      '}',
      'export function readInlineMutationResponseBodyChunks(body) {',
      '  const chunks = readMutationResponseElementChunks(body);',
      '  return { fragments: readFragmentChunksFromElements(chunks.fragments), queries: chunks.queries };',
      '}',
    ].join('\n');

    const extracted = extractInlineWireParserReadableSource(source);

    expect(extracted).toContain('const parseJsonValue = (value) => value;');
    expect(extracted).toContain('const attributePattern = {');
    expect(extracted).not.toContain('import { parseJsonValue }');
    expect(extracted).not.toContain('const attributePattern = /target/;');
  });
});
