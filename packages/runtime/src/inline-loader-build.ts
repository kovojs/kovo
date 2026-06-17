import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import ts from 'typescript';

import { minifyInlineJavaScriptSource } from './inline-js-minifier.ts';

const inlineKovoLoaderModulePath = fileURLToPath(new URL('./inline-loader.ts', import.meta.url));
const inlineResponseApplySourcePath = fileURLToPath(
  new URL('./inline-response-apply.ts', import.meta.url),
);
const responseFragmentApplySourcePath = fileURLToPath(
  new URL('./response-fragment-apply.ts', import.meta.url),
);
const wireHtmlSourcePath = fileURLToPath(new URL('./wire-html.ts', import.meta.url));
const wireResponseScannerSourcePath = fileURLToPath(
  new URL('./wire-response-scanner.ts', import.meta.url),
);

const inlineHelperSpecs = {
  responseApply: {
    label: 'response apply',
    readableParityLabel: 'canonical response apply helper closure',
    minifiedParityLabel: 'canonical minified response apply helper closure',
    rootFunctionNames: ['applyInlineMutationResponseChunks'],
    sourceFileName: 'inline-response-apply.ts',
    sourcePath: inlineResponseApplySourcePath,
    sourcePaths: [responseFragmentApplySourcePath, inlineResponseApplySourcePath],
  },
  wireParser: {
    label: 'wire parser',
    readableParityLabel: 'canonical wire parser helper closure',
    minifiedParityLabel: 'canonical minified wire parser helper closure',
    rootFunctionNames: ['readInlineMutationResponseBodyChunks'],
    sourceFileName: 'wire-response-scanner.ts',
    sourcePath: wireResponseScannerSourcePath,
    sourcePaths: [wireHtmlSourcePath, wireResponseScannerSourcePath],
  },
} as const;

type InlineHelperSpec = (typeof inlineHelperSpecs)[keyof typeof inlineHelperSpecs];

export const inlineKovoLoaderGzipByteBudget = 4096;

export const inlineWireParserReadableSource = readInlineWireParserReadableSource();
export const inlineResponseApplyReadableSource = readInlineResponseApplyReadableSource();

export const inlineKovoLoaderInstallerReadableSource =
  buildInlineKovoLoaderInstallerReadableSource();

export function buildInlineKovoLoaderInstallerReadableSource(
  wireParserReadableSource = inlineWireParserReadableSource,
  responseApplyReadableSource = inlineResponseApplyReadableSource,
): string {
  return String.raw`
/* SPEC.md §4.4: this is the always-loaded bootstrap source. */
function installInlineKovoLoader(im) {
  // SPEC.md §4.4: delegate (capture phase) every on:* event the document uses.
  // focus/blur have no bubble phase but DO run a capture phase at ancestors, so
  // capture-phase delegation reaches them; pointerenter/pointerleave never run a
  // capture phase at ancestors, so they are synthesized below from pointerover/out.
  const events = [
    'click', 'submit', 'input', 'change', 'keydown', 'keyup',
    'contextmenu', 'paste', 'cancel', 'beforetoggle', 'animationend', 'scroll', 'focus', 'blur',
    'pointerdown', 'pointermove', 'pointerup',
  ];
  const doc = document;
  let ic = 0;
  const ci = () =>
    crypto.randomUUID?.() ||
    'i_' + Date.now().toString(36) + '_' + (ic += 1).toString(36);
  const rh = (el) => el.closest?.('[kovo-state]') ?? el;
  const rs = (el) => {
    try {
      return JSON.parse(rh(el)?.getAttribute('kovo-state') ?? '{}');
    } catch {
      return {};
    }
  };
  const qa = (root, selector) =>
    root.querySelectorAll ? [...root.querySelectorAll(selector)] : [];
  const vp = (val, path) =>
    path.split('.').reduce((cur, seg) => {
      const key = seg.endsWith('?') ? seg.slice(0, -1) : seg;
      return typeof cur === 'object' && cur !== null ? cur[key] : undefined;
    }, val);
  const fb = (val) =>
    val == null ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val);
  const sh = (el, host) =>
    el === host || !el.closest || el.closest('[kovo-state]') === host;
  const ba = (el) =>
    [...(el.attributes || [])].filter(
      (attr) => attr.name.startsWith('data-bind:') && attr.value,
    );
  const wa = (el, name, val) => {
    if ((name === 'checked' || name === 'indeterminate') && val === false) val = null;
    if (val == null) el.removeAttribute?.(name);
    else el.setAttribute?.(name, fb(val));
    if (name === 'value' && el.value !== undefined) {
      if (val != null) el.value = fb(val);
      else if (el.localName != 'progress') el.value = '';
    }
    if ((name === 'scrollLeft' || name === 'scrollleft') && el.scrollLeft !== undefined) {
      el.scrollLeft = Number(val) || 0;
    }
    if ((name === 'scrollTop' || name === 'scrolltop') && el.scrollTop !== undefined) {
      el.scrollTop = Number(val) || 0;
    }
    if (name === 'checked' && el.checked !== undefined) el.checked = val != null;
    if (name === 'indeterminate' && el.indeterminate !== undefined) {
      el.indeterminate = val != null;
    }
  };
  const ws = (el, path, bt, state, root = 'state') => {
    if (!path?.startsWith(root + '.')) return;
    const val = vp(state, path.slice(root.length + 1));
    if (bt) {
      wa(el, bt, val);
    } else if (el.value !== undefined) {
      el.value = fb(val);
    } else {
      el.textContent = fb(val);
    }
  };
  const wd = async (el, ref, bt, state) => {
    const hi = ref.lastIndexOf('#');
    if (hi <= 0 || hi === ref.length - 1) return;
    const mod = await im(ref.slice(0, hi));
    const derive = mod[ref.slice(hi + 1)];
    const val = derive?.run?.(state);
    if (bt) {
      wa(el, bt, val);
    } else if (el.value !== undefined) {
      el.value = fb(val);
    } else {
      el.textContent = fb(val);
    }
  };
  const as = async (host, state) => {
    const hb = host.getAttribute?.('data-bind');
    if (hb?.includes('#')) await wd(host, hb, undefined, state);
    else ws(host, hb, undefined, state);
    for (const el of qa(host, '[data-bind]')) {
      if (sh(el, host)) {
        const binding = el.getAttribute('data-bind');
        if (binding?.includes('#')) {
          await wd(el, binding, undefined, state);
        } else {
          ws(el, binding, undefined, state);
        }
      }
    }
    for (const el of [host, ...qa(host, '*')]) {
      if (!sh(el, host)) continue;
      for (const attr of ba(el)) {
        if (attr.value.includes('#')) {
          await wd(
            el,
            attr.value,
            attr.name.slice('data-bind:'.length),
            state,
          );
          continue;
        }
        ws(
          el,
          attr.value,
          attr.name.slice('data-bind:'.length),
          state,
        );
      }
    }
  };
  const rd = (val) =>
    (val ?? '')
      .split(/[\s,]+/)
      .map((dep) => dep.trim())
      .filter(Boolean);
  const rt = () => [
    ...new Set(
      [...doc.querySelectorAll('[kovo-deps]')]
        .map((el) => {
          const deps = rd(el.getAttribute('kovo-deps'));
          const target =
            el.getAttribute('kovo-fragment-target') ?? el.id ?? el.getAttribute('kovo-c');
          return target && (deps.length ? target + '=' + deps.join(' ') : target);
        })
        .filter(Boolean)
    )
  ];
  // SPEC.md §9.1 + security finding M10: fragment targets round-trip un-escaped
  // wire data into CSS selectors, so a malformed target containing quote/bracket
  // characters throws a SyntaxError that would abort the whole apply pass. Guard
  // the lookups so a malformed selector degrades to "no target found" instead of
  // throwing.
  const ft = (target) => {
    try {
      return (
        doc.querySelector('[kovo-c="' + target + '"]') ??
        doc.getElementById(target) ??
        doc.querySelector('[kovo-fragment-target="' + target + '"]')
      );
    } catch {
      return;
    }
  };
  const hs = (el) => ((el = el.closest('[kovo-c]') || el).a ||= new AbortController()).signal;
  for (const el of qa(
    doc,
    'input[type="checkbox"][aria-checked="mixed"],input[type="checkbox"][data-state="indeterminate"]',
  )) {
    if (el.indeterminate !== undefined) el.indeterminate = true;
  }
  ${wireParserReadableSource}
  ${responseApplyReadableSource}
  const dq = (type, init) => {
    dispatchEvent(new CustomEvent(type, init));
  };
  const ab = (body) => {
    const chunks = readInlineMutationResponseBodyChunks(body);
    dq('kovo:query', {
      detail: {
        ['quer' + 'ies']: chunks.queries,
      },
    });
    for (const x of chunks.fragments) {
      if (x.mode === 'append') continue;
      const e = ft(x.target);
      if (e) for (const y of qa(e, '[kovo-c]')) {
        if (x.html.includes(y.getAttribute('kovo-c'))) continue;
        y.a?.abort();
      }
    }
    applyInlineMutationResponseChunks(chunks, { findFragmentTarget: ft });
  };
  const fsb = (form) => {
    if (typeof form.submit === 'function') {
      form.submit();
      return;
    }
    form.setAttribute?.('data-error-code', 'NETWORK_ERROR');
    form.setAttribute?.('kovo-error', '');
  };
  const sef = (event, form) => {
    event.preventDefault();
    fetch(form.action, {
      body: new FormData(form, event.submitter),
      headers: {
        Accept: 'text/vnd.kovo.fragment+html',
        'Kovo-Fragment': 'true',
        'Kovo-Idem': ci(),
        'Kovo-Targets': rt().join('; '),
      },
      keepalive: true,
      method: (form.method || 'post').toUpperCase(),
    })
      .then((response) => response.text())
      .then(ab)
      .catch(() => fsb(form));
  };
  const rp = (el) =>
    (el.getAttribute('kovo-param-types') || '').split(/[\s,]+/).reduce((types, entry) => {
      const [name, type] = entry.split(':');
      if (name) types[name] = type;
      return types;
    }, {},);
  const dispatch = async (event) => {
    if (event.type === 'submit') {
      const form = event.target?.closest?.('form[enhance],form[data-enhance],form[data-mutation]',);
      if (form) {
        sef(event, form);
        return;
      }
    }
    const el = event.target?.closest?.('[on\\:' + event.type + ']');
    const refs = el?.getAttribute('on:' + event.type);
    if (!el || !refs) return;
    const params = {};
    const pt = rp(el);
    const state = rs(el);
    const st = rh(el);
    const context = { params, state, signal: hs(el) };
    for (const attr of el.attributes || []) {
      if (!attr.name.startsWith('data-p-')) continue;
      const name = attr.name
        .slice('data-p-'.length)
        .replace(/-([a-z0-9])/g, (_match, char) => char.toUpperCase());
      const type = pt[name];
      const val = attr.value;
      params[name] = type === 'number' ? Number(val) : type === 'boolean' ? val === 'true' : val;
    }
    for (const ref of refs.split(/\s+/).filter(Boolean)) {
      const hi = ref.lastIndexOf('#');
      if (hi <= 0 || hi === ref.length - 1) throw Error('Invalid handler reference: ' + ref);
      const mod = await im(ref.slice(0, hi));
      const fn = mod[ref.slice(hi + 1)];
      if (typeof fn !== 'function') throw Error('Handler export not found: ' + ref);
      await fn(event, context);
    }
    st?.setAttribute?.('kovo-state', JSON.stringify(state));
    if (st) await as(st, state);
  };
  const trigger = (type, target) => {
    void dispatch({ target, type });
  };
  for (const event of events) addEventListener(event, dispatch, { capture: true });
  // SPEC.md §4.4: synthesize delegated pointerenter/pointerleave from the bubbling
  // pointerover/pointerout pair, firing only when the pointer crosses the on:* element's
  // boundary (relatedTarget outside it) so child movement does not re-fire enter/leave.
  const crossing = (overType, enterType) =>
    addEventListener(
      overType,
      (event) => {
        const el = event.target?.closest?.('[on\\:' + enterType + ']');
        if (!el || el.contains?.(event.relatedTarget)) return;
        void dispatch({ relatedTarget: event.relatedTarget, target: el, type: enterType });
      },
      { capture: true },
    );
  crossing('pointerover', 'pointerenter');
  crossing('pointerout', 'pointerleave');
  // SPEC.md §4.7: declared triggers are legible in body markup, while the default
  // document emits the loader in <head>. Defer the scan one task so the parser can
  // continue into the body; event delegation above is installed immediately.
  setTimeout(() => {
    doc.querySelectorAll('[on\\:load]').forEach((el) => trigger('load', el));
    doc
      .querySelectorAll('[on\\:idle]')
      .forEach((el) => (globalThis.requestIdleCallback || setTimeout)(() => trigger('idle', el)),);
    if (globalThis.IntersectionObserver) {
      const observer = new IntersectionObserver((entries) =>
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          observer.unobserve(entry.target);
          trigger('visible', entry.target);
        }),
      );
      doc.querySelectorAll('[on\\:visible]').forEach((el) => observer.observe(el));
    }
  });
}
`;
}

export function buildInlineKovoLoaderInstallerSource(
  source = inlineKovoLoaderInstallerReadableSource,
): string {
  assertDefaultInlineKovoLoaderInstallerHelperParity(source);
  const installerInput =
    source === inlineKovoLoaderInstallerReadableSource
      ? compactInlineKovoLoaderInstallerLocalNames(source)
      : source;
  const installerSource = minifyInlineJavaScriptSource(installerInput);
  assertDefaultMinifiedInlineKovoLoaderInstallerHelperParity(source, installerSource);
  return installerSource;
}

export interface EmitInlineKovoLoaderModuleOptions {
  check?: boolean;
  source?: string;
  targetPath?: string;
}

export interface EmitInlineKovoLoaderModuleResult {
  changed: boolean;
  source: string;
  targetPath: string;
}

export function buildInlineKovoLoaderModuleSource(
  source = inlineKovoLoaderInstallerReadableSource,
): string {
  const installerSource = buildInlineKovoLoaderInstallerSource(source);
  assertInlineKovoLoaderGzipBudget(installerSource, 'Generated inline Kovo loader module');

  const moduleSource = `${[
    '// @ts-nocheck',
    '// Generated from the SPEC.md §4.4 readable inline bootstrap by inline-loader-build.ts.',
    "import type { ImportHandlerModule } from './handlers.js';",
    '',
    '// SPEC.md §4.4 keeps the always-loaded loader under a 4KB gzip budget; this',
    '// literal is the pre-minified bootstrap shipped in document shells.',
    '/** @internal */',
    `export const inlineKovoLoaderInstallerSource = ${inlineJavaScriptTemplateLiteral(
      installerSource,
    )};`,
    '',
    '// prettier-ignore',
    'const inlineKovoLoaderInstaller = (',
    `  ${installerSource}`,
    ') as (',
    '    importModule: ImportHandlerModule,',
    '  ) => void;',
    '',
    '/** @internal */',
    'export function installInlineKovoLoader(importModule: ImportHandlerModule): void {',
    '  inlineKovoLoaderInstaller(importModule);',
    '}',
    '',
    '/** @internal */',
    'export function createInlineKovoLoaderSource(',
    "  importModuleExpression = '(url)=>import(url)',",
    '): string {',
    '  const expression = importModuleExpression.trim();',
    '  if (!expression) {',
    "    throw new Error('Inline Kovo loader import expression cannot be empty.');",
    '  }',
    '',
    '  return `(${inlineKovoLoaderInstallerSource})(${expression});`;',
    '}',
    '',
    '/** @internal */',
    'export const kovoLoaderSource = createInlineKovoLoaderSource();',
  ].join('\n')}\n`;
  assertInlineKovoLoaderModuleArtifactParity(moduleSource, 'Generated inline Kovo loader module');

  return moduleSource;
}

export function assertInlineKovoLoaderGzipBudget(
  installerSource: string,
  label = 'Inline Kovo loader',
): void {
  const bytes = gzipSync(createInlineKovoLoaderBootstrapSource(installerSource)).byteLength;
  if (bytes <= inlineKovoLoaderGzipByteBudget) return;

  throw new Error(
    `${label} exceeds SPEC.md §4.4 gzip budget: ${bytes} bytes > ${inlineKovoLoaderGzipByteBudget} bytes.`,
  );
}

function readInlineWireParserReadableSource(): string {
  return readInlineHelperReadableSource(inlineHelperSpecs.wireParser);
}

function readInlineResponseApplyReadableSource(): string {
  return readInlineHelperReadableSource(inlineHelperSpecs.responseApply);
}

export function extractInlineWireParserReadableSource(
  source: string,
  rootFunctionNames: readonly string[] = inlineHelperSpecs.wireParser.rootFunctionNames,
): string {
  return extractInlineHelperReadableSourceForSpec(inlineHelperSpecs.wireParser, source, {
    rootFunctionNames,
  });
}

export function extractInlineResponseApplyReadableSource(
  source: string,
  rootFunctionNames: readonly string[] = inlineHelperSpecs.responseApply.rootFunctionNames,
): string {
  return extractInlineHelperReadableSourceForSpec(inlineHelperSpecs.responseApply, source, {
    rootFunctionNames,
  });
}

interface ExtractInlineHelperReadableSourceOptions {
  label: string;
  rootFunctionNames: readonly string[];
  source: string;
  sourceFileName: string;
}

function readInlineHelperReadableSource(spec: InlineHelperSpec): string {
  return extractInlineHelperReadableSourceForSpec(spec, readInlineHelperCanonicalSource(spec));
}

function readInlineHelperCanonicalSource(spec: InlineHelperSpec): string {
  return spec.sourcePaths.map((sourcePath) => readFileSync(sourcePath, 'utf8')).join('\n');
}

function extractInlineHelperReadableSourceForSpec(
  spec: InlineHelperSpec,
  source: string,
  options: { rootFunctionNames?: readonly string[] } = {},
): string {
  return extractInlineHelperReadableSource({
    label: spec.label,
    rootFunctionNames: options.rootFunctionNames ?? spec.rootFunctionNames,
    source,
    sourceFileName: spec.sourceFileName,
  });
}

function extractInlineHelperReadableSource({
  label,
  rootFunctionNames,
  source,
  sourceFileName,
}: ExtractInlineHelperReadableSourceOptions): string {
  const sourceFile = ts.createSourceFile(
    sourceFileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declarations = new Map<string, ts.FunctionDeclaration>();
  const unsupportedTopLevelBindings = collectUnsupportedInlineHelperTopLevelBindings(sourceFile);

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      declarations.set(statement.name.text, statement);
    }
  }

  const missing = rootFunctionNames.filter((name) => !declarations.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Inline Kovo loader ${label} source is missing helper(s): ${missing.join(', ')}`,
    );
  }

  const included = collectInlineHelperDependencyClosure(
    label,
    sourceFile,
    declarations,
    unsupportedTopLevelBindings,
    rootFunctionNames,
  );
  const helperSource = [...included]
    .map((name) => declarations.get(name))
    .filter((declaration): declaration is ts.FunctionDeclaration => declaration !== undefined)
    .map((declaration) => declaration.getText(sourceFile).replace(/^export\s+function/, 'function'))
    .join('\n\n');
  const transpiled = ts.transpileModule(helperSource, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ESNext,
    },
  }).outputText;

  return transpiled.replace(/^"use strict";\s*/, '').trim();
}

export function assertInlineKovoLoaderInstallerWireParserParity(
  installerSource: string,
  wireParserSource: string = readInlineHelperCanonicalSource(inlineHelperSpecs.wireParser),
): void {
  assertInlineKovoLoaderInstallerHelperParity(
    inlineHelperSpecs.wireParser,
    installerSource,
    wireParserSource,
  );
}

export function assertMinifiedInlineKovoLoaderInstallerWireParserParity(
  installerSource: string,
  wireParserSource: string = readInlineHelperCanonicalSource(inlineHelperSpecs.wireParser),
): void {
  assertMinifiedInlineKovoLoaderInstallerHelperParity(
    inlineHelperSpecs.wireParser,
    installerSource,
    wireParserSource,
  );
}

export function assertInlineKovoLoaderInstallerResponseApplyParity(
  installerSource: string,
  responseApplySource: string = readInlineHelperCanonicalSource(inlineHelperSpecs.responseApply),
): void {
  assertInlineKovoLoaderInstallerHelperParity(
    inlineHelperSpecs.responseApply,
    installerSource,
    responseApplySource,
  );
}

export function assertMinifiedInlineKovoLoaderInstallerResponseApplyParity(
  installerSource: string,
  responseApplySource: string = readInlineHelperCanonicalSource(inlineHelperSpecs.responseApply),
): void {
  assertMinifiedInlineKovoLoaderInstallerHelperParity(
    inlineHelperSpecs.responseApply,
    installerSource,
    responseApplySource,
  );
}

function assertInlineKovoLoaderInstallerHelperParity(
  spec: InlineHelperSpec,
  installerSource: string,
  helperSource: string,
): void {
  assertInlineKovoLoaderInstallerHelperContains(
    installerSource,
    extractInlineHelperReadableSourceForSpec(spec, helperSource),
    spec.readableParityLabel,
    'readable',
  );
}

function assertMinifiedInlineKovoLoaderInstallerHelperParity(
  spec: InlineHelperSpec,
  installerSource: string,
  helperSource: string,
): void {
  const expectedSource = extractInlineHelperReadableSourceForSpec(spec, helperSource);
  const expected = minifyInlineJavaScriptSource(expectedSource);
  const compactExpected = minifyInlineJavaScriptSource(
    compactInlineKovoLoaderInstallerLocalNames(expectedSource),
  );

  if (
    countSubstring(installerSource, expected) === 1 ||
    countSubstring(installerSource, compactExpected) === 1
  ) {
    return;
  }

  throw new Error(
    `Inline Kovo loader minified source must embed the ${spec.minifiedParityLabel} exactly once; found 0.`,
  );
}

function compactInlineKovoLoaderInstallerLocalNames(source: string): string {
  // SPEC.md §4.4: the generated bootstrap has a hard 4KB gzip ceiling. Keep
  // source modules readable, then compact only closure-local helper names before
  // the parse-checked minifier runs.
  const replacements = new Map([
    ['readMutationResponseBodyCore', 'rb'],
    ['readMutationResponseElementChunks', 'rc'],
    ['readFragmentChunksFromElements', 'rfs'],
    ['readFragmentElementChunk', 'rf'],
    ['readElementChunks', 're'],
    ['matchingElementEnd', 'me'],
    ['escapeRegExp', 'er'],
    ['readAttribute', 'ra'],
    ['unescapeHtml', 'uh'],
    ['tagClose', 'tc'],
    ['openingEnd', 'oe'],
    ['closingTag', 'ct'],
    ['elementTag', 'et'],
    ['closeStart', 'cs'],
    ['queryOptions', 'qo'],
    ['queries', 'qs'],
    ['fragmentOptions', 'fo'],
    ['onMalformedQuery', 'oq'],
    ['onMalformedFragment', 'of'],
    ['onMalformed', 'om'],
    ['element', 'el'],
    ['current', 'cur'],
    ['segment', 'seg'],
    ['attribute', 'attr'],
    ['response', 'res'],
    // Installer-local helper names (not referenced by the parity-checked helper
    // closures); compacting them reclaims gzip headroom for the M10 selector
    // guard within the SPEC.md §4.4 4KB ceiling.
    ['dispatch', 'dp'],
    ['trigger', 'tg'],
    ['crossing', 'cr'],
    ['enterType', 'en'],
    ['overType', 'ov'],
    ['selector', 'sl'],
    ['component', 'cp'],
    ['island', 'is'],
    ['existing', 'ex'],
    ['controller', 'ac'],
    ['nextHtml', 'nh'],
  ]);
  let compacted = source;

  for (const [from, to] of replacements) {
    compacted = compacted.replaceAll(new RegExp(`\\b${from}\\b`, 'g'), to);
  }

  return compacted;
}

function assertInlineKovoLoaderInstallerHelperContains(
  installerSource: string,
  expected: string,
  parityLabel: string,
  sourceKind: 'minified' | 'readable',
): void {
  const count = countSubstring(installerSource, expected);

  if (count !== 1) {
    throw new Error(
      `Inline Kovo loader ${sourceKind} source must embed the ${parityLabel} exactly once; found ${count}.`,
    );
  }
}

function assertDefaultInlineKovoLoaderInstallerHelperParity(source: string): void {
  if (source !== inlineKovoLoaderInstallerReadableSource) return;
  for (const spec of Object.values(inlineHelperSpecs)) {
    assertInlineKovoLoaderInstallerHelperParity(
      spec,
      source,
      readInlineHelperCanonicalSource(spec),
    );
  }
}

function assertDefaultMinifiedInlineKovoLoaderInstallerHelperParity(
  readableSource: string,
  installerSource: string,
): void {
  if (readableSource !== inlineKovoLoaderInstallerReadableSource) return;
  for (const spec of Object.values(inlineHelperSpecs)) {
    assertMinifiedInlineKovoLoaderInstallerHelperParity(
      spec,
      installerSource,
      readInlineHelperCanonicalSource(spec),
    );
  }
}

function countSubstring(source: string, expected: string): number {
  if (!expected) return 0;

  let count = 0;
  let offset = 0;
  while (offset < source.length) {
    const index = source.indexOf(expected, offset);
    if (index === -1) return count;

    count += 1;
    offset = index + expected.length;
  }

  return count;
}

function collectInlineHelperDependencyClosure(
  label: string,
  sourceFile: ts.SourceFile,
  declarations: ReadonlyMap<string, ts.FunctionDeclaration>,
  unsupportedTopLevelBindings: ReadonlySet<string>,
  rootFunctionNames: readonly string[],
): Set<string> {
  const included = new Set<string>();
  const visiting = new Set<string>();

  const include = (name: string): void => {
    if (included.has(name)) return;
    if (visiting.has(name)) return;

    const declaration = declarations.get(name);
    if (!declaration) {
      throw new Error(`Inline Kovo loader ${label} source is missing helper: ${name}`);
    }

    visiting.add(name);
    for (const dependency of collectInlineHelperFunctionDependencies(
      label,
      sourceFile,
      declaration,
      declarations,
      unsupportedTopLevelBindings,
    )) {
      include(dependency);
    }
    included.add(name);
    visiting.delete(name);
  };

  for (const name of rootFunctionNames) include(name);
  return included;
}

function collectInlineHelperFunctionDependencies(
  label: string,
  sourceFile: ts.SourceFile,
  declaration: ts.FunctionDeclaration,
  declarations: ReadonlyMap<string, ts.FunctionDeclaration>,
  unsupportedTopLevelBindings: ReadonlySet<string>,
): Set<string> {
  const dependencies = new Set<string>();
  const ownName = declaration.name?.text;
  const isLocallyBound = (name: string, scopes: readonly ReadonlySet<string>[]): boolean =>
    scopes.some((scope) => scope.has(name));

  const visit = (node: ts.Node, scopes: readonly ReadonlySet<string>[]): void => {
    if (node === declaration.name) return;

    if (isFunctionLikeWithBody(node)) {
      visitFunctionLike(node, scopes);
      return;
    }

    if (ts.isBlock(node)) {
      visitBlock(node, scopes);
      return;
    }

    if (ts.isParameter(node)) {
      visitBindingName(node.name, scopes);
      if (node.initializer) visit(node.initializer, scopes);
      return;
    }

    if (ts.isVariableDeclaration(node)) {
      visitBindingName(node.name, scopes);
      if (node.initializer) visit(node.initializer, scopes);
      return;
    }

    if (ts.isBindingElement(node)) {
      if (node.propertyName && ts.isComputedPropertyName(node.propertyName)) {
        visit(node.propertyName.expression, scopes);
      }
      if (node.initializer) visit(node.initializer, scopes);
      return;
    }

    if (ts.isPropertyAccessExpression(node)) {
      visit(node.expression, scopes);
      return;
    }

    if (ts.isPropertyAssignment(node)) {
      if (ts.isComputedPropertyName(node.name)) visit(node.name.expression, scopes);
      visit(node.initializer, scopes);
      return;
    }

    if (ts.isIdentifier(node)) {
      const name = node.text;
      const local = isLocallyBound(name, scopes);
      if (name !== ownName && declarations.has(name) && !local) dependencies.add(name);
      if (unsupportedTopLevelBindings.has(name) && !declarations.has(name) && !local) {
        throw new Error(
          `Inline Kovo loader ${label} helper ${ownName ?? '<anonymous>'} references top-level binding ${name}, but inline extraction only supports self-contained top-level function declarations.`,
        );
      }
    }

    ts.forEachChild(node, (child) => visit(child, scopes));
  };

  const visitFunctionLike = (
    functionNode: ts.SignatureDeclarationBase & { body?: ts.ConciseBody },
    parentScopes: readonly ReadonlySet<string>[],
  ): void => {
    const functionScope = new Set<string>();
    if (
      (ts.isFunctionDeclaration(functionNode) || ts.isFunctionExpression(functionNode)) &&
      functionNode.name
    ) {
      functionScope.add(functionNode.name.text);
    }
    for (const parameter of functionNode.parameters) {
      addInlineHelperBindingName(parameter.name, functionScope);
    }

    const functionScopes = [functionScope, ...parentScopes];
    for (const parameter of functionNode.parameters) {
      visitBindingName(parameter.name, functionScopes);
      if (parameter.initializer) visit(parameter.initializer, functionScopes);
    }

    if (!functionNode.body) return;
    if (ts.isBlock(functionNode.body)) {
      visitBlock(functionNode.body, functionScopes);
      return;
    }
    visit(functionNode.body, functionScopes);
  };

  const visitBindingName = (
    name: ts.BindingName | ts.Identifier,
    scopes: readonly ReadonlySet<string>[],
  ): void => {
    if (ts.isIdentifier(name)) return;
    for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) continue;
      if (element.propertyName && ts.isComputedPropertyName(element.propertyName)) {
        visit(element.propertyName.expression, scopes);
      }
      visitBindingName(element.name, scopes);
      if (element.initializer) visit(element.initializer, scopes);
    }
  };

  const visitBlock = (block: ts.Block, parentScopes: readonly ReadonlySet<string>[]): void => {
    const blockScope = new Set<string>();
    collectInlineHelperStatementBindings(block.statements, blockScope);
    const blockScopes = [blockScope, ...parentScopes];
    for (const statement of block.statements) {
      visit(statement, blockScopes);
    }
  };

  visitFunctionLike(declaration, []);
  return dependencies;
}

function isFunctionLikeWithBody(
  node: ts.Node,
): node is ts.SignatureDeclarationBase & { body?: ts.ConciseBody } {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function collectInlineHelperStatementBindings(
  statements: ts.NodeArray<ts.Statement>,
  bindings: Set<string>,
): void {
  for (const statement of statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      bindings.add(statement.name.text);
      continue;
    }
    if (ts.isClassDeclaration(statement) && statement.name) {
      bindings.add(statement.name.text);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        addInlineHelperBindingName(declaration.name, bindings);
      }
    }
  }
}

function addInlineHelperBindingName(
  name: ts.BindingName | ts.Identifier,
  bindings: Set<string>,
): void {
  if (ts.isIdentifier(name)) {
    bindings.add(name.text);
    return;
  }

  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    addInlineHelperBindingName(element.name, bindings);
  }
}

function collectUnsupportedInlineHelperTopLevelBindings(sourceFile: ts.SourceFile): Set<string> {
  const bindings = new Set<string>();

  const addImportClauseBindings = (clause: ts.ImportClause): void => {
    if (clause.name) bindings.add(clause.name.text);
    if (!clause.namedBindings) return;
    if (ts.isNamespaceImport(clause.namedBindings)) {
      bindings.add(clause.namedBindings.name.text);
      return;
    }
    for (const specifier of clause.namedBindings.elements) {
      bindings.add(specifier.name.text);
    }
  };

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause) {
      addImportClauseBindings(statement.importClause);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        addInlineHelperBindingName(declaration.name, bindings);
      }
      continue;
    }
    if (ts.isClassDeclaration(statement) && statement.name) {
      bindings.add(statement.name.text);
      continue;
    }
    if (ts.isEnumDeclaration(statement)) {
      bindings.add(statement.name.text);
    }
  }

  return bindings;
}

export function assertInlineKovoLoaderModuleArtifactParity(
  moduleSource: string,
  label = 'Inline Kovo loader module',
): void {
  const sourceFile = parseInlineKovoLoaderModuleSource(moduleSource, label);
  let installerLiteralSource: string | undefined;
  let installerFunctionSource: string | undefined;

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (node.name.text === 'inlineKovoLoaderInstallerSource') {
        installerLiteralSource = readInlineInstallerSourceLiteral(node.initializer);
      }
      if (node.name.text === 'inlineKovoLoaderInstaller') {
        const expression = unwrapInlineInstallerExpression(node.initializer);
        if (ts.isFunctionExpression(expression)) {
          installerFunctionSource = expression.getText(sourceFile);
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (installerLiteralSource === undefined) {
    throw new Error(`${label} is missing inlineKovoLoaderInstallerSource.`);
  }
  if (installerFunctionSource === undefined) {
    throw new Error(`${label} is missing inlineKovoLoaderInstaller function artifact.`);
  }
  if (installerLiteralSource !== installerFunctionSource) {
    throw new Error(
      `${label} embedded installer artifacts drifted: inlineKovoLoaderInstallerSource does not match inlineKovoLoaderInstaller.`,
    );
  }
  assertInlineKovoLoaderGzipBudget(installerLiteralSource, label);
}

function parseInlineKovoLoaderModuleSource(moduleSource: string, label: string): ts.SourceFile {
  const sourceFile = ts.createSourceFile(
    'inline-loader.ts',
    moduleSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const [diagnostic] =
    (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics ?? [];
  if (diagnostic) {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    throw new Error(`${label} is invalid TypeScript: ${message}`);
  }

  return sourceFile;
}

function readInlineInstallerSourceLiteral(expression: ts.Expression): string | undefined {
  const unwrapped = unwrapInlineInstallerExpression(expression);
  if (ts.isNoSubstitutionTemplateLiteral(unwrapped) || ts.isStringLiteral(unwrapped)) {
    return unwrapped.text;
  }

  return undefined;
}

function unwrapInlineInstallerExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

export function emitInlineKovoLoaderModule(
  options: EmitInlineKovoLoaderModuleOptions = {},
): EmitInlineKovoLoaderModuleResult {
  const targetPath = options.targetPath ?? inlineKovoLoaderModulePath;
  const source =
    options.source === undefined
      ? buildInlineKovoLoaderModuleSource()
      : buildInlineKovoLoaderModuleSource(options.source);
  const current = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : undefined;
  const changed = current !== source;

  if (options.check) {
    if (current !== undefined) {
      assertInlineKovoLoaderModuleArtifactParity(current, targetPath);
    }
    if (changed) {
      throw new Error(
        `Inline Kovo loader module is stale: ${targetPath}. Run pnpm --filter @kovojs/runtime run build:inline-loader.`,
      );
    }
    return { changed, source, targetPath };
  }

  if (changed) writeFileSync(targetPath, source, 'utf8');

  return { changed, source, targetPath };
}

function inlineJavaScriptTemplateLiteral(value: string): string {
  return `\`${value.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${')}\``;
}

function createInlineKovoLoaderBootstrapSource(
  installerSource: string,
  importModuleExpression = '(url)=>import(url)',
): string {
  return `(${installerSource})(${importModuleExpression});`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = emitInlineKovoLoaderModule({ check: process.argv.includes('--check') });

  if (!process.argv.includes('--check')) {
    console.log(
      `${result.changed ? 'Wrote' : 'Unchanged'} ${result.targetPath} from inline-loader-build.ts.`,
    );
  }
}
