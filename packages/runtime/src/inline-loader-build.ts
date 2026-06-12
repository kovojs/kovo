import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const inlineJisoLoaderInstallerReadableSource = String.raw`
/* SPEC.md §4.4: this is the always-loaded bootstrap source. */
function installInlineJisoLoader(importModule) {
  const events = ['click', 'submit', 'input', 'change'];
  const doc = document;
  let idemCounter = 0;
  const createInlineIdem = () =>
    crypto.randomUUID?.() ??
    'idem_' + Date.now().toString(36) + '_' + (idemCounter += 1).toString(36);
  const readStateHost = (element) => element.closest?.('[fw-state]') ?? element;
  const readState = (element) => {
    try {
      return JSON.parse(readStateHost(element)?.getAttribute('fw-state') ?? '{}');
    } catch {
      return {};
    }
  };
  const readDeps = (value) =>
    (value ?? '')
      .split(/[\s,]+/)
      .map((dep) => dep.trim())
      .filter(Boolean);
  const readTargets = () => [
    ...new Set(
      [...doc.querySelectorAll('[fw-deps]')]
        .map((element) => {
          const deps = readDeps(element.getAttribute('fw-deps'));
          const target = element.getAttribute('fw-fragment-target') ?? element.id;
          return target && (deps.length > 0 ? target + '=' + deps.join(' ') : target);
        })
        .filter(Boolean)
    )
  ];
  const findFragmentTarget = (target) =>
    doc.getElementById(target) ?? doc.querySelector('[fw-fragment-target="' + target + '"]');
  const applyFragment = (fragment) => {
    const target = fragment.getAttribute('target');
    const element = target && findFragmentTarget(target);
    if (!element) return;
    if (fragment.getAttribute('mode') === 'append') {
      element.insertAdjacentHTML('beforeend', fragment.innerHTML);
    } else {
      element.innerHTML = fragment.innerHTML;
    }
  };
  const applyResponseBody = (body) => {
    const parsed = new DOMParser().parseFromString(body, 'text/html');
    parsed.querySelectorAll('fw-query').forEach((query) => {
      dispatchEvent(
        new CustomEvent('jiso:query', {
          detail: {
            body: query.textContent,
            key: query.getAttribute('key') ?? undefined,
            name: query.getAttribute('name'),
          },
        }),
      );
    });
    parsed.querySelectorAll('fw-fragment').forEach(applyFragment);
  };
  const fallbackSubmit = (form) => {
    if (typeof form.submit === 'function') {
      form.submit();
      return;
    }
    form.setAttribute?.('data-error-code', 'NETWORK_ERROR');
    form.setAttribute?.('fw-error', '');
  };
  const submitEnhancedForm = (event, form) => {
    event.preventDefault();
    fetch(form.action, {
      body: new FormData(form),
      headers: {
        Accept: 'text/vnd.jiso.fragment+html',
        'FW-Fragment': 'true',
        'FW-Idem': createInlineIdem(),
        'FW-Targets': readTargets().join('; '),
      },
      keepalive: true,
      method: (form.method || 'post').toUpperCase(),
    })
      .then((response) => response.text())
      .then(applyResponseBody)
      .catch(() => fallbackSubmit(form));
  };
  const readParamTypes = (element) =>
    (element.getAttribute('fw-param-types') || '').split(/[\s,]+/).reduce((types, entry) => {
      const [name, type] = entry.split(':');
      if (name) types[name] = type;
      return types;
    }, {},);
  const dispatch = async (event) => {
    if (event.type === 'submit') {
      const form = event.target?.closest?.('form[enhance],form[data-enhance],form[data-mutation]',);
      if (form) {
        submitEnhancedForm(event, form);
        return;
      }
    }
    const element = event.target?.closest?.('[on\\:' + event.type + ']');
    const refs = element?.getAttribute('on:' + event.type);
    if (!element || !refs) return;
    const params = {};
    const paramTypes = readParamTypes(element);
    const state = readState(element);
    const stateHost = readStateHost(element);
    const context = { params, state, signal: new AbortController().signal };
    for (const attribute of element.attributes || []) {
      if (!attribute.name.startsWith('data-p-')) continue;
      const name = attribute.name
        .slice('data-p-'.length)
        .replace(/-([a-z0-9])/g, (_match, char) => char.toUpperCase());
      const type = paramTypes[name];
      const value = attribute.value;
      params[name] = type === 'number' ? Number(value) : type === 'boolean' ? value === 'true' : value;
    }
    for (const ref of refs.split(/\s+/).filter(Boolean)) {
      const hashIndex = ref.lastIndexOf('#');
      if (hashIndex <= 0 || hashIndex === ref.length - 1) throw Error('Invalid handler reference: ' + ref);
      const mod = await importModule(ref.slice(0, hashIndex));
      const fn = mod[ref.slice(hashIndex + 1)];
      if (typeof fn !== 'function') throw Error('Handler export not found: ' + ref);
      await fn(event, context);
    }
    stateHost?.setAttribute?.('fw-state', JSON.stringify(state));
  };
  const trigger = (type, target) => {
    void dispatch({ target, type });
  };
  for (const event of events) addEventListener(event, dispatch, { capture: true });
  doc.querySelectorAll('[on\\:load]').forEach((element) => trigger('load', element));
  doc
    .querySelectorAll('[on\\:idle]')
    .forEach((element) => (globalThis.requestIdleCallback || setTimeout)(() => trigger('idle', element)),);
  if (globalThis.IntersectionObserver) {
    const observer = new IntersectionObserver((entries) =>
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        trigger('visible', entry.target);
      }),
    );
    doc.querySelectorAll('[on\\:visible]').forEach((element) => observer.observe(element));
  }
}
`;

export function buildInlineJisoLoaderInstallerSource(
  source = inlineJisoLoaderInstallerReadableSource,
): string {
  return minifyInlineJavaScriptSource(source);
}

export interface EmitInlineJisoLoaderModuleOptions {
  check?: boolean;
  source?: string;
  targetPath?: string;
}

export interface EmitInlineJisoLoaderModuleResult {
  changed: boolean;
  source: string;
  targetPath: string;
}

const inlineJisoLoaderModulePath = fileURLToPath(new URL('./inline-loader.ts', import.meta.url));

export function buildInlineJisoLoaderModuleSource(
  source = inlineJisoLoaderInstallerReadableSource,
): string {
  const installerSource = buildInlineJisoLoaderInstallerSource(source);

  return `${[
    "import type { ImportHandlerModule } from './handlers.js';",
    '',
    'export type InlineImportHandlerModule = ImportHandlerModule;',
    '',
    '// SPEC.md §4.4 keeps the always-loaded loader under a 4KB gzip budget; this',
    '// literal is the pre-minified bootstrap shipped in document shells.',
    `export const inlineJisoLoaderInstallerSource = ${inlineJavaScriptTemplateLiteral(
      installerSource,
    )};`,
    '',
    'function readInlineJisoLoaderInstaller(): (importModule: InlineImportHandlerModule) => void {',
    '  return (0, eval)(`(${inlineJisoLoaderInstallerSource})`) as (',
    '    importModule: InlineImportHandlerModule,',
    '  ) => void;',
    '}',
    '',
    'export function installInlineJisoLoader(importModule: InlineImportHandlerModule): void {',
    '  readInlineJisoLoaderInstaller()(importModule);',
    '}',
    '',
    'export function createInlineJisoLoaderSource(',
    "  importModuleExpression = '(url)=>import(url)',",
    '): string {',
    '  const expression = importModuleExpression.trim();',
    '  if (!expression) {',
    "    throw new Error('Inline Jiso loader import expression cannot be empty.');",
    '  }',
    '',
    '  return `(${inlineJisoLoaderInstallerSource})(${expression});`;',
    '}',
    '',
    'export const jisoLoaderSource = createInlineJisoLoaderSource();',
  ].join('\n')}\n`;
}

export function emitInlineJisoLoaderModule(
  options: EmitInlineJisoLoaderModuleOptions = {},
): EmitInlineJisoLoaderModuleResult {
  const targetPath = options.targetPath ?? inlineJisoLoaderModulePath;
  const source =
    options.source === undefined
      ? buildInlineJisoLoaderModuleSource()
      : buildInlineJisoLoaderModuleSource(options.source);
  const current = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : undefined;
  const changed = current !== source;

  if (options.check) {
    if (changed) {
      throw new Error(
        `Inline Jiso loader module is stale: ${targetPath}. Run pnpm --filter @jiso/runtime run build:inline-loader.`,
      );
    }
    return { changed, source, targetPath };
  }

  if (changed) writeFileSync(targetPath, source, 'utf8');

  return { changed, source, targetPath };
}

function minifyInlineJavaScriptSource(source: string): string {
  let output = '';
  let previousToken: MinifiedToken | undefined;
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    source,
  );

  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    const token = { kind, text: scanner.getTokenText() };
    if (isTemplateSubstitutionToken(token.kind)) {
      throw new Error(
        'Inline Jiso loader source cannot use template interpolation; keep the bootstrap literal-safe.',
      );
    }
    if (previousToken && needsTokenSeparator(previousToken, token)) output += ' ';
    output += token.text;
    previousToken = token;
  }

  return output;
}

interface MinifiedToken {
  kind: ts.SyntaxKind;
  text: string;
}

function needsTokenSeparator(previousToken: MinifiedToken, nextToken: MinifiedToken): boolean {
  if (isWordLikeToken(previousToken.kind) && isWordLikeToken(nextToken.kind)) return true;
  if (
    (previousToken.kind === ts.SyntaxKind.PlusToken ||
      previousToken.kind === ts.SyntaxKind.MinusToken) &&
    previousToken.kind === nextToken.kind
  ) {
    return true;
  }
  return (
    previousToken.kind === ts.SyntaxKind.SlashToken && nextToken.kind === ts.SyntaxKind.SlashToken
  );
}

function isWordLikeToken(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.Identifier ||
    kind === ts.SyntaxKind.PrivateIdentifier ||
    kind === ts.SyntaxKind.NumericLiteral ||
    kind === ts.SyntaxKind.BigIntLiteral ||
    (kind >= ts.SyntaxKind.FirstKeyword && kind <= ts.SyntaxKind.LastKeyword)
  );
}

function isTemplateSubstitutionToken(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.TemplateHead ||
    kind === ts.SyntaxKind.TemplateMiddle ||
    kind === ts.SyntaxKind.TemplateTail
  );
}

function inlineJavaScriptTemplateLiteral(value: string): string {
  return `\`${value.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${')}\``;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = emitInlineJisoLoaderModule({ check: process.argv.includes('--check') });

  if (!process.argv.includes('--check')) {
    console.log(
      `${result.changed ? 'Wrote' : 'Unchanged'} ${result.targetPath} from inline-loader-build.ts.`,
    );
  }
}
