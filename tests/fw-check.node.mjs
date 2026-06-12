import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';

import { missingBuildMessage } from '../scripts/fw-check.mjs';
import { parseWireResponses } from './wire-transcript.mjs';
import {
  fwCheck,
  fwExplain,
  handleFwMcpRequest,
  mainAsync,
  runMcpFallbackStdio,
} from '../dist/cli/src/index.mjs';
import {
  assertFixpoint,
  assertRenderEquivalence,
  collectCssAssetManifest,
  collectMinifierReservedNames,
  compileComponentModule,
  deriveAppGraph,
  deriveRegistryFactsFromGraph,
  emitQueryPlanBootstrapModule,
  jisoVitePlugin,
  queryShapesFromFacts,
} from '../dist/compiler/src/index.mjs';
import { diagnosticDefinitions } from '../dist/core/src/index.mjs';
import {
  applyMutationResponseToDom,
  applyCompiledQueryUpdatePlan,
  applyDeferredStreamResponseToDom,
  createQueryStore,
  derive,
  installPagehideOptimismCleanup,
  installJisoLoader,
  jisoLoaderSource,
  morphStructuralTree,
  OptimisticRebaser,
  readElementParams,
  refetchQueries,
  stampPendingQueries,
  submitEnhancedMutation,
  submitOptimisticEnhancedMutation,
} from '../dist/runtime/src/index.mjs';
import { createDbVerifier, createJisoTestHarness } from '../dist/test/src/index.mjs';
import {
  createApp,
  csrfField,
  csrfToken,
  domain,
  errorBoundary,
  guards,
  i18n,
  metaFromQuery,
  mutation,
  notFound,
  query,
  renderDeferredStream,
  renderQueryEndpointResponse,
  renderQueryRegistryEndpointResponse,
  renderDocument,
  renderDocumentQueryScript,
  renderMutationResponse,
  renderMutationEndpointResponse,
  renderPageHints,
  renderQueryScript,
  runMutation,
  runQuery,
  runRoutePage,
  renderRoutePageResponse,
  route as serverRoute,
  session,
  s,
  stylesheetsForTargets,
  t,
  exportStaticApp,
} from '../dist/server/src/index.mjs';
import { fragmentTarget, href, Link, redirect, route } from '../dist/core/src/index.mjs';

const generatedWireBodies = {
  'defer-stream.http': [
    `<!doctype html>
<html><body><main><product-page fw-deps="product:p1"><fw-defer target="reviews:p1" state="pending"></fw-defer><fw-defer target="recommendations:p1" state="pending"></fw-defer></product-page></main>

--jiso-boundary
<fw-query name="reviews" key="product:p1">{"items":[{"id":"r1","rating":5}]}</fw-query>
<fw-query name="recommendations" key="product:p1">{"items":[{"id":"rec-1"}]}</fw-query>
<fw-fragment target="reviews:p1" priority="5"><link rel="stylesheet" href="/assets/reviews.css"><section fw-c="reviews" fw-deps="product:p1"><article fw-key="r1">5</article></section></fw-fragment>
<fw-fragment target="recommendations:p1"><section fw-c="recommendations" fw-deps="product:p1"><article fw-key="rec-1">Beans</article></section></fw-fragment>
--jiso-boundary--
</body></html>
`,
  ],
  'enhanced-mutation.http': [
    `<fw-query name="cart" key="cart:c1" version="7">{"count":1,"items":[{"productId":"p1","qty":1,"unitPrice":1499}]}</fw-query>
<fw-fragment target="cart-badge"><cart-badge fw-deps="cart"><button commandfor="cart-drawer" command="show-modal"><span data-bind="cart.count">1</span></button></cart-badge></fw-fragment>
<fw-fragment target="recommendations"><section fw-c="recommendations" fw-deps="product:p1"></section></fw-fragment>
`,
  ],
  'no-js-post-redirect-get.http': [
    '',
    `<!doctype html>
<html><body><script type="application/json" fw-query="cart">{"count":1,"items":[{"productId":"p1","qty":1,"unitPrice":1499}]}</script><cart-badge fw-deps="cart"><span data-bind="cart.count">1</span></cart-badge></body></html>
`,
  ],
  'typed-read.http': ['<fw-query name="product:p1">{"name":"Mug","stock":4}</fw-query>\n'],
  'validation-422-fragment.http': [
    `<fw-fragment target="product-form:p1"><form fw-c="product-form" aria-invalid="true"><output role="alert" data-error-code="OUT_OF_STOCK">Only 5 left.</output><input name="productId" value="p1"><input name="quantity" value="99"></form></fw-fragment>
`,
  ],
};

const readWireFixture = async (name) =>
  readFile(new URL(`../fixtures/wire/${name}`, import.meta.url), 'utf8');

const readProjectFile = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const execFileAsync = promisify(execFile);

const parseWireTranscript = (body) => {
  const [titleBlock, rest] = body.split('\n>>> REQUEST\n');
  assert.ok(titleBlock?.startsWith('### '), 'wire fixture starts with a scenario title');
  assert.ok(rest, 'wire fixture includes a request transcript');

  const [requestBlock, responseBlock] = rest.split('\n<<< RESPONSE\n');
  assert.ok(requestBlock, 'wire fixture includes a request block');
  assert.ok(responseBlock, 'wire fixture includes a response block');

  return {
    request: parseHttpBlock(requestBlock),
    response: parseHttpBlock(responseBlock),
    title: titleBlock.slice('### '.length).trim(),
  };
};

const parseHttpBlock = (block) => {
  const [head = '', ...bodyLines] = block.trimEnd().split('\n\n');
  const [startLine = '', ...headerLines] = head.split('\n');
  return {
    body: bodyLines.join('\n\n'),
    headers: Object.fromEntries(
      headerLines.map((line) => {
        const index = line.indexOf(':');
        assert.notEqual(index, -1, `HTTP header contains a colon: ${line}`);
        return [line.slice(0, index), line.slice(index + 1).trim()];
      }),
    ),
    startLine,
  };
};

const explainValue = (output, prefix) => {
  const line = output.split('\n').find((item) => item.startsWith(prefix));
  assert.ok(line, `explain output includes ${prefix}`);
  return line.slice(prefix.length);
};

const explainLines = (output, prefix) =>
  output
    .split('\n')
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length));

const explainSummary = (output, prefix) => {
  const [summary] = explainLines(output, prefix);
  assert.ok(summary, `explain output includes ${prefix}`);
  return Object.fromEntries(
    summary.split(/\s+/).map((entry) => {
      const [key, value] = entry.split('=');
      assert.ok(key && value !== undefined, `summary entry is key=value: ${entry}`);
      return [key, value];
    }),
  );
};

const explainUpdateTargets = (output) =>
  explainValue(output, 'updates: ')
    .split(/\s*;\s*/)
    .filter(Boolean);

const runCliCommand = async (args) => {
  let stdout = '';
  let stderr = '';
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  process.stdout.write = function writeStdout(chunk) {
    stdout += String(chunk);
    return true;
  };
  process.stderr.write = function writeStderr(chunk) {
    stderr += String(chunk);
    return true;
  };

  try {
    const exitCode = await mainAsync(args);
    return { exitCode, stderr, stdout };
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
};

const listProjectFiles = async (dir, predicate) => {
  const entries = await readdir(new URL(`../${dir}`, import.meta.url), { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = `${dir}/${entry.name}`;

    if (entry.isDirectory()) {
      files.push(...(await listProjectFiles(path, predicate)));
    } else if (predicate(path)) {
      files.push(path);
    }
  }

  return files;
};

const collectForbiddenBrowserArchitecture = (ts, fileName, source) => {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const violations = [];
  const nodeName = (node) =>
    ts.isIdentifier(node)
      ? node.text
      : ts.isPropertyAccessExpression(node)
        ? node.name.text
        : undefined;
  const isStringValue = (node, value) =>
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === value;
  const record = (node, label) => {
    const { character, line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    violations.push(`${fileName}:${line + 1}:${character + 1} ${label}`);
  };

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callName = nodeName(node.expression);
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        callName === 'define' &&
        nodeName(node.expression.expression) === 'customElements'
      ) {
        record(node, 'customElements.define');
      }
      if (callName === 'attachShadow') {
        record(node, 'attachShadow');
      }
      if (callName === 'addEventListener' && isStringValue(node.arguments[0], 'unload')) {
        record(node, 'addEventListener unload');
      }
      if (callName === 'createBrowserRouter' || callName === 'hydrateRoot') {
        record(node, callName);
      }
    }

    if (
      (ts.isPropertyAccessExpression(node) && node.name.text === 'onunload') ||
      (ts.isJsxAttribute(node) && node.name.text === 'onunload')
    ) {
      record(node, 'onunload');
    }

    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      node.tagName.text === 'script'
    ) {
      for (const property of node.attributes.properties) {
        if (
          ts.isJsxAttribute(property) &&
          property.name.text === 'type' &&
          property.initializer &&
          ts.isStringLiteral(property.initializer) &&
          property.initializer.text.toLowerCase() === 'importmap'
        ) {
          record(property, 'importmap script');
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
};

const parseWorkflowSteps = (source) => {
  const steps = [];

  for (const line of source.split('\n')) {
    const match = /^\s*-\s+(run|uses):\s*(.+?)\s*$/.exec(line);
    if (match) {
      steps.push({ [match[1]]: match[2] });
    }
  }

  return steps;
};

const parsePnpmRunScript = (command) => {
  const match = /^pnpm run ([\w:-]+)$/.exec(command);
  return match?.[1];
};

const parsePnpmRunScripts = (command) => {
  assert.equal(typeof command, 'string', 'pnpm run script list is present');
  return command.split(' && ').map((entry) => {
    const scriptName = parsePnpmRunScript(entry);
    assert.ok(scriptName, `pnpm run script entry is structured: ${entry}`);
    return scriptName;
  });
};

const parseVpRunCommand = (command) => {
  const match = /^vp run ([\w-]+)$/.exec(command);
  return match?.[1];
};

const parseRequiredVpTask = (scriptName, packageJson) => {
  const command = packageJson.scripts?.[scriptName];
  assert.equal(typeof command, 'string', `${scriptName} script exists`);
  const taskName = parseVpRunCommand(command);
  assert.ok(taskName, `${scriptName} delegates to a Vite+ task`);
  return taskName;
};

const parseVitestTaskCommand = (command) => {
  assert.equal(typeof command, 'string', 'Vitest task command is present');
  const parts = command.split(/\s+/);
  assert.equal(parts[0], 'vitest');
  assert.equal(parts.includes('--run'), true);
  const configIndex = parts.indexOf('--config');
  assert.notEqual(configIndex, -1);
  assert.ok(parts[configIndex + 1], 'Vitest task names a config file');
  return { configPath: parts[configIndex + 1] };
};

const parseNodeTaskCommand = (command) => {
  assert.equal(typeof command, 'string', 'Node task command is present');
  const match = /^node ([^\s]+)$/.exec(command);
  assert.ok(match, 'Node task runs a single module entrypoint');
  return { modulePath: match[1] };
};

const parsePnpmFilterTestCommands = (command) => {
  assert.equal(typeof command, 'string', 'pnpm filter task command is present');
  return parseCommandSequence(command).map(({ args, executable, raw }) => {
    assert.equal(executable, 'pnpm');
    assert.equal(args.length, 3, `pnpm filter test command has three args: ${raw}`);
    assert.equal(args[0], '--filter');
    assert.equal(args[2], 'test');
    assert.notEqual(args[1].length, 0);
    return { argv: [executable, ...args], packageName: args[1], script: 'test' };
  });
};

const parseCommandSequence = (command) => {
  assert.equal(typeof command, 'string', 'task command is present');
  return command.split(' && ').map((raw) => {
    const parts = raw.split(/\s+/).filter(Boolean);
    assert.notEqual(parts.length, 0, `task command entry is not empty: ${raw}`);
    assert.equal(
      parts.every((part) => /^[./:@\w-]+$/.test(part)),
      true,
      `task command avoids shell syntax: ${raw}`,
    );
    return { args: parts.slice(1), executable: parts[0], raw };
  });
};

const runCommandSequenceSync = (command, options) =>
  parseCommandSequence(command)
    .map(({ args, executable }) => execFileSync(executable, args, options))
    .join('');

const isLowerHex = (value) =>
  value.length > 0 && [...value].every((char) => '0123456789abcdef'.includes(char));

const parseFwExportOutput = (output) => {
  const lines = output.trimEnd().split('\n');
  assert.equal(lines[0], 'fw-export/v1');
  const htmlLines = [];
  const errorLines = [];
  let summary;

  for (const line of lines.slice(1)) {
    if (line.startsWith('HTML ')) {
      const [kind, path, statusEntry, bytesEntry] = line.split(' ');
      const [statusKey, statusValue] = statusEntry?.split('=') ?? [];
      const [bytesKey, bytesValue] = bytesEntry?.split('=') ?? [];
      assert.equal(kind, 'HTML');
      assert.equal(statusKey, 'status');
      assert.equal(bytesKey, 'bytes');
      htmlLines.push({ bytes: Number(bytesValue), path, status: Number(statusValue) });
      continue;
    }

    if (line.startsWith('ERROR ')) {
      const [, code, routeEntry, ...messageParts] = line.split(' ');
      const [routeKey, route] = routeEntry?.split('=') ?? [];
      assert.equal(routeKey, 'route');
      errorLines.push({ code, message: messageParts.join(' '), route });
      continue;
    }

    if (line.startsWith('SUMMARY ')) {
      summary = Object.fromEntries(
        line
          .slice('SUMMARY '.length)
          .split(' ')
          .map((entry) => {
            const [key, value] = entry.split('=');
            assert.ok(key && value !== undefined, `fw export summary entry is key=value: ${entry}`);
            return [key, value];
          }),
      );
      continue;
    }

    if (errorLines.length > 0) {
      errorLines[errorLines.length - 1].message += `\n${line}`;
    }
  }

  return { errors: errorLines, html: htmlLines, summary, version: lines[0] };
};

const assertOrderedIncludes = (items, before, after) => {
  const beforeIndex = items.indexOf(before);
  const afterIndex = items.indexOf(after);
  assert.notEqual(beforeIndex, -1, `${before} is present`);
  assert.notEqual(afterIndex, -1, `${after} is present`);
  assert.ok(beforeIndex < afterIndex, `${before} precedes ${after}`);
};

const parseCssSourceDirectives = (source) =>
  source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('@source '))
    .map((line) => line.slice('@source '.length).replace(/;$/, ''));

const parseHtmlElements = (source) => {
  const elements = [];
  const tagPattern = /<([a-zA-Z][\w:-]*)([^>]*)>/g;
  const attributePattern = /([a-zA-Z_:][\w:.-]*)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

  for (const tagMatch of source.matchAll(tagPattern)) {
    const [, tagName, attributesSource] = tagMatch;
    const attributes = {};

    for (const attributeMatch of attributesSource.matchAll(attributePattern)) {
      const [, name, doubleQuotedValue, singleQuotedValue, bareValue] = attributeMatch;
      attributes[name] = doubleQuotedValue ?? singleQuotedValue ?? bareValue ?? true;
    }

    elements.push({ attributes, tagName });
  }

  return elements;
};

const parseHtmlElementBlocks = (source, tagName) => {
  const blocks = [];
  const openNeedle = `<${tagName}`;
  const closeNeedle = `</${tagName}>`;
  let cursor = 0;

  while (cursor < source.length) {
    const openStart = source.indexOf(openNeedle, cursor);
    if (openStart === -1) break;

    const openEnd = source.indexOf('>', openStart);
    assert.notEqual(openEnd, -1, `${tagName} opening tag is closed`);

    const closeStart = source.indexOf(closeNeedle, openEnd + 1);
    assert.notEqual(closeStart, -1, `${tagName} closing tag is present`);

    const [element] = parseHtmlElements(source.slice(openStart, openEnd + 1));
    assert.ok(element, `${tagName} opening tag parses as an HTML element`);
    blocks.push({
      attributes: element.attributes,
      innerHTML: source.slice(openEnd + 1, closeStart),
      tagName: element.tagName,
    });
    cursor = closeStart + closeNeedle.length;
  }

  return blocks;
};

const parseDocumentRegions = (source) => {
  const htmlBlocks = parseHtmlElementBlocks(source, 'html');
  const headBlocks = parseHtmlElementBlocks(source, 'head');
  const bodyBlocks = parseHtmlElementBlocks(source, 'body');

  assert.equal(htmlBlocks.length, 1, 'document has one html root');
  assert.equal(headBlocks.length, 1, 'document has one head region');
  assert.equal(bodyBlocks.length, 1, 'document has one body region');

  return {
    body: bodyBlocks[0].innerHTML,
    head: headBlocks[0].innerHTML,
    html: htmlBlocks[0].innerHTML,
  };
};

const assertHtmlMainMarker = (source, marker, message) => {
  assert.equal(
    parseHtmlElements(source).find((element) => element.tagName === 'main')?.attributes[
      'data-fw-check-export'
    ],
    marker,
    message,
  );
};

const parseProjectSite = (site) => {
  const separator = site.lastIndexOf(':');
  assert.notEqual(separator, -1, `site includes a line number: ${site}`);
  const line = Number(site.slice(separator + 1));
  assert.equal(Number.isInteger(line) && line > 0, true, `site line is positive: ${site}`);
  return { line, path: site.slice(0, separator) };
};

const normalizeMarkdownCell = (value) =>
  value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

const markdownSection = (source, heading) => {
  const lines = source.split('\n');
  const headingLineIndex = lines.findIndex((line) => {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    return match && normalizeMarkdownCell(match[2]) === heading;
  });
  assert.notEqual(headingLineIndex, -1, `markdown contains heading ${heading}`);
  const level = /^(#{1,6})/.exec(lines[headingLineIndex])[1].length;
  const endIndex = lines.findIndex((line, index) => {
    if (index <= headingLineIndex) return false;
    const match = /^(#{1,6})\s+/.exec(line);
    return match && match[1].length <= level;
  });

  return lines.slice(headingLineIndex + 1, endIndex === -1 ? undefined : endIndex).join('\n');
};

const parseMarkdownNumberedList = (source) =>
  source
    .split('\n')
    .map((line) => /^\s*\d+\.\s+(.+)$/.exec(line))
    .filter(Boolean)
    .map((match) => normalizeMarkdownCell(match[1]));

const numberedListTitles = (source) =>
  parseMarkdownNumberedList(source).map((item) => normalizeMarkdownCell(item.split('.')[0]));

const markdownLeadingTitle = (value) =>
  normalizeMarkdownCell(value.replaceAll('**', '').split('.')[0]);

const canonicalDocRuleTitle = (title) =>
  title
    .replace('Local code must not require global knowledge', 'No global knowledge at local sites')
    .replace('One-to-one file mapping', '1:1 file mapping')
    .replace('Platform behavior emission', 'Platform-behavior emission');

const parseMarkdownFields = (source) => {
  const fields = new Map();
  let currentField;

  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    const match = /^([A-Z][A-Za-z ]+):\s+(.+)$/.exec(trimmed);
    if (match) {
      currentField = match[1];
      fields.set(currentField, normalizeMarkdownCell(match[2]));
      continue;
    }

    if (
      currentField &&
      trimmed &&
      !trimmed.startsWith('#') &&
      !trimmed.startsWith('|') &&
      !trimmed.startsWith('-') &&
      !trimmed.startsWith('```')
    ) {
      fields.set(currentField, normalizeMarkdownCell(`${fields.get(currentField)} ${trimmed}`));
      continue;
    }

    currentField = undefined;
  }

  return fields;
};

const parseMarkdownTable = (source) => {
  const lines = source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && line.endsWith('|'));
  assert.ok(lines.length >= 2, 'markdown section contains a table');
  const header = lines[0]
    .slice(1, -1)
    .split('|')
    .map((cell) => normalizeMarkdownCell(cell));
  const rows = [];

  for (const line of lines.slice(2)) {
    const values = line
      .slice(1, -1)
      .split('|')
      .map((cell) => normalizeMarkdownCell(cell));
    rows.push(Object.fromEntries(header.map((name, index) => [name, values[index] ?? ''])));
  }

  return rows;
};

class GateMorphTarget {
  constructor(html = '') {
    this.html = html;
  }

  appendHtml(html) {
    this.html += html;
  }

  readHtml() {
    return this.html;
  }

  replaceWithHtml(html) {
    this.html = html;
  }
}

class GateQueryElement {
  constructor(attributes, options = {}) {
    this.attributes = Object.entries(attributes).map(([name, value]) => ({ name, value }));
    this.textContent = options.textContent ?? null;
    if (options.value !== undefined) this.value = options.value;
  }

  getAttribute(name) {
    return this.attributes.find((attribute) => attribute.name === name)?.value ?? null;
  }

  matches(selector) {
    const exactAttribute = /^\[([^=\]]+)="([^"]*)"\]$/.exec(selector);
    if (exactAttribute) return this.getAttribute(exactAttribute[1]) === exactAttribute[2];

    const presentAttribute = /^\[([^=\]]+)\]$/.exec(selector);
    return presentAttribute ? this.getAttribute(presentAttribute[1]) !== null : false;
  }

  removeAttribute(name) {
    this.attributes = this.attributes.filter((attribute) => attribute.name !== name);
  }

  setAttribute(name, value) {
    const existing = this.attributes.find((attribute) => attribute.name === name);
    if (existing) {
      existing.value = value;
      return;
    }
    this.attributes.push({ name, value });
  }
}

class GateTemplateStampHost extends GateQueryElement {
  items = [];

  reconcileTemplateStamp(items) {
    this.items = items.map((item) => ({ ...item }));
    this.textContent = items.map((item) => item.html).join('');
  }
}

class GateMorphRoot {
  constructor() {
    this.bindings = [];
    this.elements = [];
    this.targets = new Map();
  }

  findFragmentTarget(target) {
    return this.targets.get(target) ?? null;
  }

  querySelectorAll(selector) {
    if (selector === '[data-bind]') {
      return this.bindings.filter((element) => element.getAttribute('data-bind') !== null);
    }
    if (selector === '*') return [...this.bindings, ...this.elements];

    return [...this.bindings, ...this.elements].filter((element) => element.matches(selector));
  }
}

const executeGeneratedClientModule = (source, context = {}) => {
  const exports = {};
  const moduleSource = source
    .replace(/import\s+\{([^}]+)\}\s+from\s+['"]@jiso\/runtime['"];\n?/g, (_match, names) => {
      const bindings = names
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
        .join(', ');
      return `const { ${bindings} } = runtime;\n`;
    })
    .replace(/export const ([A-Za-z_$][\w$]*)/g, 'const $1 = exports.$1');

  runInNewContext(moduleSource, {
    ...context,
    exports,
    runtime: {
      applyCompiledQueryUpdatePlan,
      derive,
      handler: (callback) => (event, ctx) => callback(event, ctx),
    },
  });

  return exports;
};

const executeGeneratedServerRenderSource = (source) => {
  const exports = {};
  const moduleSource = source.replace(
    /export function ([A-Za-z_$][\w$]*)/g,
    'exports.$1 = function $1',
  );

  runInNewContext(moduleSource, { exports });

  return exports.renderSource();
};

const executeTypeScriptModuleSource = async (source) => {
  const ts = await import('typescript');
  const module = { exports: {} };
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  runInNewContext(compiled, {
    exports: module.exports,
    module,
    require(specifier) {
      assert.fail(`unexpected generated TypeScript runtime import ${specifier}`);
    },
  });
  return module.exports;
};

const assertTypeScriptProgramHasNoDiagnostics = async (files) => {
  const ts = await import('typescript');
  const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));
  const compilerOptions = {
    allowImportingTsExtensions: true,
    baseUrl: workspaceRoot,
    exactOptionalPropertyTypes: true,
    ignoreDeprecations: '6.0',
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    paths: {
      '@jiso/core': ['dist/core/src/index.d.mts'],
    },
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2024,
    types: ['node'],
  };
  const defaultHost = ts.createCompilerHost(compilerOptions, true);
  const virtualFiles = new Map(Object.entries(files));
  const host = {
    ...defaultHost,
    fileExists(fileName) {
      return virtualFiles.has(fileName) || defaultHost.fileExists(fileName);
    },
    getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) {
      const sourceText = virtualFiles.get(fileName);
      if (sourceText !== undefined) {
        return ts.createSourceFile(fileName, sourceText, languageVersion, true);
      }
      return defaultHost.getSourceFile(
        fileName,
        languageVersion,
        onError,
        shouldCreateNewSourceFile,
      );
    },
    readFile(fileName) {
      return virtualFiles.get(fileName) ?? defaultHost.readFile(fileName);
    },
  };
  const program = ts.createProgram([...virtualFiles.keys()], compilerOptions, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);

  assert.deepEqual(
    diagnostics.map((diagnostic) => {
      const position =
        diagnostic.file && diagnostic.start !== undefined
          ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
          : undefined;
      const site = position
        ? `${diagnostic.file.fileName}:${position.line + 1}:${position.character + 1}`
        : diagnostic.file?.fileName;
      return [diagnostic.code, site, ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')]
        .filter(Boolean)
        .join(' ');
    }),
    [],
  );
};

const typeScriptInterfaceMemberTypes = async (fileName, source, interfaceName) => {
  const ts = await import('typescript');
  const compilerOptions = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2024,
  };
  const defaultHost = ts.createCompilerHost(compilerOptions, true);
  const host = {
    ...defaultHost,
    fileExists(candidate) {
      return candidate === fileName || defaultHost.fileExists(candidate);
    },
    getSourceFile(candidate, languageVersion) {
      if (candidate === fileName) {
        return ts.createSourceFile(candidate, source, languageVersion, true);
      }
      return defaultHost.getSourceFile(candidate, languageVersion);
    },
    readFile(candidate) {
      return candidate === fileName ? source : defaultHost.readFile(candidate);
    },
  };
  const program = ts.createProgram([fileName], compilerOptions, host);
  const sourceFile = program.getSourceFile(fileName);
  assert.ok(sourceFile, `TypeScript parsed ${fileName}`);
  const interfaceNode = sourceFile.statements.find(
    (statement) => ts.isInterfaceDeclaration(statement) && statement.name.text === interfaceName,
  );
  assert.ok(interfaceNode, `TypeScript registry exports interface ${interfaceName}`);
  const checker = program.getTypeChecker();

  return Object.fromEntries(
    checker
      .getTypeAtLocation(interfaceNode)
      .getProperties()
      .map((symbol) => [
        symbol.name,
        checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, interfaceNode)),
      ])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
};

const loadVitePlusConfig = async (configPath = 'vite.config.ts') => {
  const ts = await import('typescript');
  const module = { exports: {} };
  const compiled = ts.transpileModule(await readProjectFile(configPath), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  runInNewContext(compiled, {
    exports: module.exports,
    module,
    require(specifier) {
      if (specifier === 'vite-plus') {
        return { defineConfig: (config) => config };
      }
      if (specifier === '@tailwindcss/vite') {
        const tailwindcss = () => ({ name: 'tailwindcss-test-stub' });
        tailwindcss.default = tailwindcss;
        tailwindcss.__esModule = true;
        return tailwindcss;
      }
      assert.fail(`unexpected Vite+ config import ${specifier}`);
    },
  });

  return jsonClone(module.exports.default);
};

const jsonClone = (value) => JSON.parse(JSON.stringify(value));

const executeGeneratedBootstrapModule = (source, planModules) => {
  const calls = [];
  const deferredApplications = [];
  const exports = {};
  const store = createQueryStore();
  const documentRoot = new GateMorphRoot();
  const moduleSource = source
    .replace(
      /import\s+\{ applyDeferredStreamResponseToDom, createQueryStore, installJisoLoader \}\s+from\s+['"]@jiso\/runtime['"];\n?/,
      'const { applyDeferredStreamResponseToDom, createQueryStore, installJisoLoader } = runtime;\n',
    )
    .replace(
      /import\s+\{ ([A-Za-z_$][\w$]*) \}\s+from\s+['"]([^'"]+)['"];\n?/g,
      (_match, exportName, importPath) =>
        `const { ${exportName} } = planModules[${JSON.stringify(importPath)}];\n`,
    )
    .replace(/export function ([A-Za-z_$][\w$]*)/g, 'exports.$1 = function $1');

  runInNewContext(moduleSource, {
    document: documentRoot,
    exports,
    fetch() {},
    planModules,
    runtime: {
      applyDeferredStreamResponseToDom(options) {
        deferredApplications.push(options);
        return applyDeferredStreamResponseToDom(options);
      },
      createQueryStore() {
        return store;
      },
      installJisoLoader(options) {
        calls.push(options);
      },
    },
  });

  return { calls, deferredApplications, documentRoot, exports, store };
};

const executeStarterClientTemplate = async (source) => {
  const ts = await import('typescript');
  const appendCalls = [];
  const deferredApplications = [];
  const fetchCalls = [];
  const loaderInstalls = [];
  const queryStore = { kind: 'starter-query-store' };
  const module = { exports: {} };
  const fragmentById = {
    'cart-badge': {
      innerHTML: '<cart-badge>0</cart-badge>',
      insertAdjacentHTML(position, html) {
        appendCalls.push([position, html]);
      },
    },
  };
  const documentRoot = {
    getElementById(id) {
      return fragmentById[id] ?? null;
    },
    querySelector(selector) {
      return selector === '[fw-fragment-target="cart-list"]'
        ? {
            innerHTML: '<ul></ul>',
            insertAdjacentHTML(position, html) {
              appendCalls.push([position, html]);
            },
          }
        : null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const runtime = {
    applyDeferredStreamResponseToDom(options) {
      deferredApplications.push(options);
      return { applied: true };
    },
    createQueryStore() {
      return queryStore;
    },
    installJisoLoader(options) {
      loaderInstalls.push(options);
    },
  };
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  runInNewContext(compiled, {
    CSS: { escape: (value) => value },
    document: documentRoot,
    exports: module.exports,
    fetch(url, options) {
      fetchCalls.push([url, options]);
      return { ok: true };
    },
    module,
    require(specifier) {
      if (specifier === '@jiso/runtime') return runtime;
      assert.fail(`unexpected starter client import ${specifier}`);
    },
  });

  return {
    appendCalls,
    deferredApplications,
    documentRoot,
    exports: module.exports,
    fetchCalls,
    loaderInstalls,
    queryStore,
  };
};

const runGraphAssertionsTemplateScript = async () => {
  const fakeBin = await mkdtemp(join(tmpdir(), 'jiso-fake-fw-'));
  const fakeFw = join(fakeBin, 'fw');
  const fakeFwSource = `#!/usr/bin/env node
const outputs = new Map([
  [
    JSON.stringify(['explain', 'query', 'cart', 'graph.json']),
    'fw-explain/v1\\nQUERY cart\\nreads: cart\\nconsumers: component:CartBadge,component:CartPanel,page:/cart\\ninvalidated-by: cart/add\\ndomain-writes: cart.addItem\\n',
  ],
  [
    JSON.stringify(['explain', 'mutation', 'cart/add', '--optimistic', 'graph.json']),
    'fw-explain/v1\\nMUTATION cart/add\\nguards: authed\\nsession: starterSession\\ninput-fields: productId,quantity\\nwrites: cart\\ninvalidates: cart\\nmanual-invalidates: -\\nupdates: cart->component:CartBadge,component:CartPanel,page:/cart\\nOPTIMISTIC cart await-fragment\\nOPTIMISTIC-SUMMARY total=1 hand-written=0 await-fragment=1 UNHANDLED=0\\n',
  ],
  [
    JSON.stringify(['explain', 'page', '/cart', 'graph.json']),
    'fw-explain/v1\\nPAGE /cart\\nprefetch: false\\nmeta: title=Jiso Starter Cart description=Starter cart backed by query data. image=-\\ni18n: en-US:cartTitle\\nmodulepreloads: -\\nstylesheets: /src/styles.css\\nqueries: cart\\nview-transitions: -\\n',
  ],
]);
const output = outputs.get(JSON.stringify(process.argv.slice(2)));
if (!output) {
  process.stderr.write(\`unexpected fw args: \${JSON.stringify(process.argv.slice(2))}\\n\`);
  process.exit(64);
}
process.stdout.write(output);
`;

  try {
    await writeFile(fakeFw, fakeFwSource, 'utf8');
    await chmod(fakeFw, 0o755);

    return execFileSync('node', ['scripts/graph-assertions.mjs'], {
      cwd: new URL('../packages/create-jiso/templates/', import.meta.url),
      encoding: 'utf8',
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ''}` },
    });
  } finally {
    await rm(fakeBin, { force: true, recursive: true });
  }
};

const runEmitGraphTemplateScript = async () => {
  const projectRoot = fileURLToPath(new URL('..', import.meta.url));
  const templateRoot = new URL('../packages/create-jiso/templates/', import.meta.url);
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'jiso-template-emit-graph-'));
  const compilerShimRoot = join(fixtureRoot, 'node_modules/@jiso/compiler');

  try {
    await cp(templateRoot, fixtureRoot, { recursive: true });
    await mkdir(compilerShimRoot, { recursive: true });
    await writeFile(
      join(compilerShimRoot, 'package.json'),
      JSON.stringify({ type: 'module', exports: './index.mjs' }),
      'utf8',
    );
    await writeFile(
      join(compilerShimRoot, 'index.mjs'),
      `export * from ${JSON.stringify(
        pathToFileURL(join(projectRoot, 'dist/compiler/src/index.mjs')).href,
      )};\n`,
      'utf8',
    );

    const output = execFileSync('node', ['scripts/emit-graph.mjs'], {
      cwd: fixtureRoot,
      encoding: 'utf8',
      env: { ...process.env, CI: '1' },
    });
    const graph = JSON.parse(await readFile(join(fixtureRoot, 'graph.json'), 'utf8'));

    return { graph, output };
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
};

const runTemplateViteTaskCommand = async (command) => {
  const projectRoot = fileURLToPath(new URL('..', import.meta.url));
  const templateRoot = new URL('../packages/create-jiso/templates/', import.meta.url);
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'jiso-template-task-'));
  const compilerShimRoot = join(fixtureRoot, 'node_modules/@jiso/compiler');
  const fakeBin = join(fixtureRoot, '.fake-bin');
  const fakeFw = join(fakeBin, 'fw');

  try {
    await cp(templateRoot, fixtureRoot, { recursive: true });
    await mkdir(compilerShimRoot, { recursive: true });
    await mkdir(fakeBin, { recursive: true });
    await writeFile(
      join(compilerShimRoot, 'package.json'),
      JSON.stringify({ type: 'module', exports: './index.mjs' }),
      'utf8',
    );
    await writeFile(
      join(compilerShimRoot, 'index.mjs'),
      `export * from ${JSON.stringify(
        pathToFileURL(join(projectRoot, 'dist/compiler/src/index.mjs')).href,
      )};\n`,
      'utf8',
    );
    await writeFile(
      fakeFw,
      `#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const graph = JSON.parse(readFileSync('graph.json', 'utf8'));

if (JSON.stringify(args) === JSON.stringify(['check', 'graph.json'])) {
  assert.deepEqual(graph.mutations.map((mutation) => mutation.key), ['cart/add']);
  process.stdout.write('fw-check/v1\\nOK\\n');
  process.exit(0);
}

const explainOutput = new Map([
  [
    JSON.stringify(['explain', 'query', 'cart', 'graph.json']),
    'fw-explain/v1\\nQUERY cart\\nreads: cart\\nconsumers: component:CartBadge,component:CartPanel,page:/cart\\ninvalidated-by: cart/add\\ndomain-writes: cart.addItem\\n',
  ],
  [
    JSON.stringify(['explain', 'mutation', 'cart/add', '--optimistic', 'graph.json']),
    'fw-explain/v1\\nMUTATION cart/add\\nguards: authed\\nsession: starterSession\\ninput-fields: productId,quantity\\nwrites: cart\\ninvalidates: cart\\nmanual-invalidates: -\\nupdates: cart->component:CartBadge,component:CartPanel,page:/cart\\nOPTIMISTIC cart await-fragment\\nOPTIMISTIC-SUMMARY total=1 hand-written=0 await-fragment=1 UNHANDLED=0\\n',
  ],
  [
    JSON.stringify(['explain', 'page', '/cart', 'graph.json']),
    'fw-explain/v1\\nPAGE /cart\\nprefetch: false\\nmeta: title=Jiso Starter Cart description=Starter cart backed by query data. image=-\\ni18n: en-US:cartTitle\\nmodulepreloads: -\\nstylesheets: /src/styles.css\\nqueries: cart\\nview-transitions: -\\n',
  ],
]);

const output = explainOutput.get(JSON.stringify(args));
if (output) {
  process.stdout.write(output);
  process.exit(0);
}

process.stderr.write(\`unexpected fw args: \${JSON.stringify(args)}\\n\`);
process.exit(64);
`,
      'utf8',
    );
    await chmod(fakeFw, 0o755);

    const output = runCommandSequenceSync(command, {
      cwd: fixtureRoot,
      encoding: 'utf8',
      env: { ...process.env, CI: '1', PATH: `${fakeBin}:${process.env.PATH ?? ''}` },
    });
    const graph = JSON.parse(await readFile(join(fixtureRoot, 'graph.json'), 'utf8'));

    return { graph, output };
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
};

const runPnpmFilterTaskCommand = async (command, expectedPackages) => {
  const fakeBin = await mkdtemp(join(tmpdir(), 'jiso-conformance-pnpm-'));
  const fakePnpm = join(fakeBin, 'pnpm');
  const observedPath = join(fakeBin, 'observed.jsonl');
  const packageScripts = Object.fromEntries(
    expectedPackages.map(({ manifest }) => [manifest.name, manifest.scripts ?? {}]),
  );
  const expectedPackageNames = expectedPackages
    .map(({ manifest }) => manifest.name)
    .toSorted((left, right) => left.localeCompare(right));

  try {
    await writeFile(
      fakePnpm,
      `#!/usr/bin/env node
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
const scriptsByPackage = JSON.parse(process.env.JISO_CONFORMANCE_PACKAGE_SCRIPTS ?? '{}');
assert.deepEqual(args.slice(0, 2), ['--filter', args[1]]);
assert.equal(args[2], 'test');
assert.equal(args.length, 3);
const packageName = args[1];
assert.equal(
  scriptsByPackage[packageName]?.test,
  'vitest --run src/index.test.ts',
  \`\${packageName} exposes the expected conformance test command\`,
);
appendFileSync(process.env.JISO_CONFORMANCE_OBSERVED, JSON.stringify({ packageName, script: args[2] }) + '\\n');
process.stdout.write(\`pnpm-filter-test \${packageName}\\n\`);
`,
      'utf8',
    );
    await chmod(fakePnpm, 0o755);

    const output = runCommandSequenceSync(command, {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      env: {
        ...process.env,
        JISO_CONFORMANCE_OBSERVED: observedPath,
        JISO_CONFORMANCE_PACKAGE_SCRIPTS: JSON.stringify(packageScripts),
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      },
    });
    const observed = (await readFile(observedPath, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    assert.deepEqual(
      observed
        .map((entry) => entry.packageName)
        .toSorted((left, right) => left.localeCompare(right)),
      expectedPackageNames,
      'conformance task executes every discovered conformance package test',
    );

    return { observed, output };
  } finally {
    await rm(fakeBin, { force: true, recursive: true });
  }
};

void test('fw-check wrapper explains the production build prerequisite', () => {
  assert.equal(
    missingBuildMessage('dist/missing-cli.mjs'),
    'fw-check requires dist/missing-cli.mjs. Run `vp run build` first.',
  );
});

void test('Phase 0 wire fixtures are present and explicit', async () => {
  const fixtureNames = await readdir(new URL('../fixtures/wire/', import.meta.url));

  assert.deepEqual(fixtureNames.filter((name) => name.endsWith('.http')).sort(), [
    'defer-stream.http',
    'enhanced-mutation.http',
    'no-js-post-redirect-get.http',
    'typed-read.http',
    'validation-422-fragment.http',
  ]);

  for (const name of fixtureNames.filter((entry) => entry.endsWith('.http'))) {
    const transcript = parseWireTranscript(await readWireFixture(name));
    assert.notEqual(transcript.title, '', `${name} names the scenario`);
    assert.notEqual(transcript.request.startLine, '', `${name} includes a request transcript`);
    assert.notEqual(transcript.response.startLine, '', `${name} includes a response transcript`);
  }

  for (const name of ['enhanced-mutation.http', 'validation-422-fragment.http']) {
    const transcript = parseWireTranscript(await readWireFixture(name));
    assert.equal(
      transcript.request.headers['FW-Fragment'],
      'true',
      `${name} declares enhanced fragment mode`,
    );
    assert.equal(
      transcript.request.headers.Accept,
      'text/vnd.jiso.fragment+html',
      `${name} requests fragment HTML`,
    );
  }
});

void test('Phase 0 wire fixture response bodies match generated contracts byte-for-byte', async () => {
  for (const [name, expectedBodies] of Object.entries(generatedWireBodies)) {
    const responses = parseWireResponses(await readWireFixture(name));

    assert.equal(responses.length, expectedBodies.length, `${name} response count`);

    for (const [index, expectedBody] of expectedBodies.entries()) {
      assert.equal(responses[index].body, expectedBody, `${name} response ${index + 1} body`);
    }
  }
});

void test('Phase 0 wire fixture responses keep stable protocol metadata', async () => {
  const fixtures = {
    'defer-stream.http': [
      {
        headers: {
          'content-type': 'text/html; charset=utf-8',
        },
        statusLine: 'HTTP/1.1 200 OK',
      },
    ],
    'enhanced-mutation.http': [
      {
        headers: {
          'content-type': 'text/vnd.jiso.fragment+html; charset=utf-8',
          'fw-changes': '[{"domain":"cart"}]',
          'fw-idem': 'idem_01HX',
        },
        statusLine: 'HTTP/1.1 200 OK',
      },
    ],
    'no-js-post-redirect-get.http': [
      {
        headers: {
          'cache-control': 'no-store',
          location: '/cart',
        },
        statusLine: 'HTTP/1.1 303 See Other',
      },
      {
        headers: {
          'content-type': 'text/html; charset=utf-8',
        },
        statusLine: 'HTTP/1.1 200 OK',
      },
    ],
    'typed-read.http': [
      {
        headers: {
          'content-type': 'text/html; charset=utf-8',
        },
        statusLine: 'HTTP/1.1 200 OK',
      },
    ],
    'validation-422-fragment.http': [
      {
        headers: {
          'content-type': 'text/vnd.jiso.fragment+html; charset=utf-8',
          'fw-idem': 'idem_01HY',
        },
        statusLine: 'HTTP/1.1 422 Unprocessable Content',
      },
    ],
  };

  for (const [name, expectedResponses] of Object.entries(fixtures)) {
    const responses = parseWireResponses(await readWireFixture(name));

    assert.equal(responses.length, expectedResponses.length, `${name} response count`);

    for (const [index, expected] of expectedResponses.entries()) {
      assert.equal(
        responses[index].statusLine,
        expected.statusLine,
        `${name} response ${index + 1} status`,
      );
      assert.deepEqual(
        responses[index].headersByName,
        expected.headers,
        `${name} response ${index + 1} headers`,
      );
    }
  }
});

void test('SSE remains a v2 backlog fixture, not a v1 wire contract', async () => {
  const fixtureNames = await readdir(new URL('../fixtures/wire/', import.meta.url));
  const wireResponses = await Promise.all(
    fixtureNames
      .filter((name) => name.endsWith('.http'))
      .map(async (name) => ({
        name,
        responses: parseWireResponses(await readWireFixture(name)),
      })),
  );

  assert.deepEqual(
    wireResponses.map(({ name, responses }) => ({
      contentTypes: responses.map((response) => response.headersByName['content-type'] ?? null),
      name,
    })),
    [
      { contentTypes: ['text/html; charset=utf-8'], name: 'defer-stream.http' },
      {
        contentTypes: ['text/vnd.jiso.fragment+html; charset=utf-8'],
        name: 'enhanced-mutation.http',
      },
      { contentTypes: [null, 'text/html; charset=utf-8'], name: 'no-js-post-redirect-get.http' },
      { contentTypes: ['text/html; charset=utf-8'], name: 'typed-read.http' },
      {
        contentTypes: ['text/vnd.jiso.fragment+html; charset=utf-8'],
        name: 'validation-422-fragment.http',
      },
    ],
  );
  assert.deepEqual(
    wireResponses.flatMap(({ name, responses }) =>
      responses
        .filter((response) => response.headersByName['content-type'] === 'text/event-stream')
        .map(() => name),
    ),
    [],
  );
});

void test('P10 constitution rejects forbidden browser architecture in framework code', async () => {
  const ts = await import('typescript');
  const sourcePaths = await listProjectFiles(
    'packages',
    (path) => path.endsWith('.ts') && path.includes('/src/') && !path.endsWith('.test.ts'),
  );
  const violations = [];

  for (const path of sourcePaths) {
    const source = await readProjectFile(path);
    violations.push(...collectForbiddenBrowserArchitecture(ts, path, source));
  }

  assert.deepEqual(violations, []);
});

void test('P10 commerce invalidation is expressed through graph facts', async () => {
  const commerceGraph = JSON.parse(
    await readProjectFile('examples/commerce/src/generated/graph.json'),
  );
  const cartAddExplain = fwExplain(commerceGraph, {
    kind: 'mutation',
    optimistic: true,
    target: 'cart/add',
  }).output;

  assert.deepEqual(
    commerceGraph.mutations.find((mutationFact) => mutationFact.key === 'cart/add'),
    {
      guards: ['authed', 'rateLimit:session'],
      invalidates: ['cart', 'product', 'order'],
      inputFields: ['productId', 'quantity'],
      key: 'cart/add',
      session: 'commerceSession',
      writes: ['cart', 'product', 'order'],
    },
  );
  assert.equal(explainValue(cartAddExplain, 'manual-invalidates: '), '-');
  assert.deepEqual(explainUpdateTargets(cartAddExplain), [
    'cart->component:CartBadge,page:/cart',
    'orderHistory->component:OrderHistory,page:/cart',
    'productGrid->component:ProductGrid,page:/cart',
  ]);
});

void test('P10 normative docs cover the constitution and compiler hard rules', async () => {
  const constitution = await readProjectFile('docs/constitution.md');
  const compilerRules = await readProjectFile('docs/compiler-hard-rules.md');
  const spec = await readProjectFile('SPEC.md');
  const constitutionRows = parseMarkdownTable(
    markdownSection(spec, '2. The Constitution (Design Tests)'),
  );
  const specHardRuleTitles = numberedListTitles(
    markdownSection(spec, '5.2 Hard rules (normative)'),
  ).map(canonicalDocRuleTitle);
  const compilerRuleTitles = numberedListTitles(compilerRules).map(canonicalDocRuleTitle);
  const compilerRuleItems = parseMarkdownNumberedList(compilerRules);
  const cssContractHeadings = markdownSection(spec, '13. Open Design Areas (named, not hand-waved)')
    .split('\n')
    .map((line) => /^\*\*(\d+\.\d+) (.+?)[.:]\*\*/.exec(line))
    .filter(Boolean)
    .map((match) => ({ number: match[1], title: match[2] }));
  const behaviorFixture = compileComponentModule({
    fileName: 'components/docs/doc-card.tsx',
    source: `
import { component } from '@jiso/core';

function choose() {}

export const DocCard = component('doc-card', {
  fragmentTarget: true,
  css: \`
    .title { color: teal; }
  \`,
  render: () => <doc-card><button onClick={choose}>Choose</button><span class="title">Ready</span></doc-card>,
});
`,
  });
  const cssSource = behaviorFixture.files.find((file) => file.kind === 'css')?.source ?? '';
  const cssManifest = collectCssAssetManifest(behaviorFixture, { baseHref: '/_jiso/' });

  assert.deepEqual(numberedListTitles(constitution), [
    'Legibility is load-bearing',
    'Local code must not require global knowledge',
    'Sugar must lower to authorable IR',
    'The wire is the documentation',
    'Server truth always wins',
  ]);
  assert.deepEqual(
    constitutionRows.map((row) => row['#']),
    ['1', '2', '3', '4', '5'],
  );
  assert.deepEqual(
    constitutionRows.map((row) => markdownLeadingTitle(row.Test)),
    numberedListTitles(constitution).map(canonicalDocRuleTitle),
  );
  assert.deepEqual(compilerRuleTitles, [
    'Source-derived names',
    '1:1 file mapping',
    'Fixpoint invariant',
    'Platform-behavior emission',
    'Teaching errors',
    'TSX-only authoring',
  ]);
  assert.deepEqual(
    compilerRuleTitles,
    specHardRuleTitles.filter((title) => title !== 'Registry atomicity'),
  );
  assert.equal(
    compilerRuleItems.length,
    compilerRuleTitles.length,
    'compiler hard rules expose one numbered item per parsed title',
  );
  assert.deepEqual(cssContractHeadings, [
    { number: '13.1', title: 'CSS' },
    { number: '13.2', title: 'Lists at scale' },
    { number: '13.3', title: 'Streaming details' },
    { number: '13.4', title: 'Persistent cross-navigation elements' },
    { number: '13.5', title: "Adopt-don't-invent list" },
  ]);
  assert.deepEqual(behaviorFixture.handlerExports, ['DocCard$choose']);
  assert.doesNotThrow(() => assertRenderEquivalence(behaviorFixture));
  assert.equal(cssManifest.stylesheets[0]?.href, '/_jiso/components/docs/doc-card.css');
  assert.deepEqual(cssManifest.stylesheets[0]?.fragmentTargets, ['doc-card']);
  assert.deepEqual(
    cssSource
      .split('\n')
      .filter((line) => line.includes('@scope'))
      .map((line) => line.trim()),
    ['@scope (doc-card) to (:scope [fw-c]) {'],
  );
});

void test('P10 legibility study packet is ready but not claimed complete', async () => {
  const study = await readProjectFile('docs/legibility-study.md');
  const fields = parseMarkdownFields(study);
  const tasks = parseMarkdownTable(markdownSection(study, 'Tasks'));
  const results = parseMarkdownTable(markdownSection(study, 'Results Ledger'));
  const readinessRows = parseMarkdownTable(markdownSection(study, 'Dated Study Readiness Ledger'));
  const localSessionChecks = parseMarkdownTable(markdownSection(study, 'Local Session Checklist'));
  const issues = parseMarkdownTable(markdownSection(study, 'Issues Ledger'));

  assert.equal(fields.get('Status'), 'protocol ready; recruitment, sessions, and results pending');
  assert.equal(
    fields.get('Required participants'),
    'five outside developers who have not worked on Jiso',
  );
  assert.equal(
    fields.get('Passing criterion'),
    'each participant answers every task from browser devtools artifacts alone in under 60 seconds',
  );
  assert.deepEqual(
    tasks.map((row) => row.Task),
    ['Button behavior', 'Island data', 'Mutation effects', 'Optimism', 'Failure path'],
  );
  assert.deepEqual(
    results.map((row) => row.Participant),
    ['pending-1', 'pending-2', 'pending-3', 'pending-4', 'pending-5'],
  );
  for (const row of results) {
    assert.equal(row.Date, 'TBD', `${row.Participant} is not dated as a completed study`);
    assert.equal(row.Commit, 'TBD', `${row.Participant} has no freeze-run commit`);
    assert.equal(row.Result, 'pending', `${row.Participant} remains pending`);
  }
  assert.equal(issues.length, 1);
  assert.equal(issues[0].Status, 'pending');
  assert.deepEqual(
    readinessRows.map((row) => row.Status),
    ['pending', 'pending'],
  );
  assert.deepEqual(
    localSessionChecks.map((row) => row.Step),
    ['1', '2', '3', '4', '5'],
  );
  assert.equal(
    localSessionChecks.every(
      (row) => row['Local check'].length > 0 && row['Evidence to retain outside repo if private'],
    ),
    true,
  );
});

void test('P10 v1 acceptance ledger tracks every freeze criterion', async () => {
  const ledger = await readProjectFile('docs/v1-acceptance.md');
  const spec = await readProjectFile('SPEC.md');
  const specCriteria = parseMarkdownNumberedList(
    markdownSection(spec, '16. Success Criteria (v1)'),
  ).map((item) => item.split(':')[0]);
  const gateRows = parseMarkdownTable(markdownSection(ledger, 'Required Gates'));
  const gatesByCriterion = new Map(gateRows.map((row) => [row['SPEC §16 criterion'], row]));
  const auditRows = parseMarkdownTable(markdownSection(ledger, 'Dated Ledger Audit'));
  const acceptanceRunRows = parseMarkdownTable(markdownSection(ledger, 'Acceptance Command Set'));
  const cleanCheckoutRows = parseMarkdownTable(
    markdownSection(ledger, 'Final Clean-Checkout Checklist'),
  );
  const auditStatuses = Object.fromEntries(auditRows.map((row) => [row.Area, row.Status]));

  assert.deepEqual(
    [...gatesByCriterion.keys()],
    specCriteria
      .map((criterion, index) => `16.${index + 1} ${criterion.replace(/ holds$/, '')}`)
      .concat('Pre-launch'),
  );
  assert.equal(
    gatesByCriterion.get('16.5 Coverage')['Current evidence artifact'],
    'Commerce matrix assertions in examples/commerce/src/app.test.ts and fw check optimistic output.',
  );
  assert.equal(
    gatesByCriterion.get('16.6 Navigation typed')['Current evidence artifact'],
    'Commerce route/link/redirect checks plus route-rename proof in packages/runtime/src/index.test.ts.',
  );
  assert.equal(
    gatesByCriterion.get('16.8 Update coverage')['Current evidence artifact'],
    'FW311/update-coverage graph assertions and fw check coverage output.',
  );
  assert.equal(gatesByCriterion.get('16.2 Legibility').Status, 'pending external study');
  assert.equal(gatesByCriterion.get('Pre-launch').Status, 'pending external checks');
  assert.deepEqual(
    acceptanceRunRows.map((row) => ({
      command: row.Command,
      commit: row.Commit,
      result: row.Result,
    })),
    [
      { command: 'pnpm run acceptance', commit: '5e693a7', result: 'passed' },
      { command: 'pnpm run acceptance', commit: '036e494', result: 'passed' },
      { command: 'pnpm run acceptance', commit: 'ec876f5', result: 'passed' },
      { command: 'pnpm run acceptance', commit: 'TBD at freeze run', result: 'pending' },
    ],
  );
  assert.deepEqual(
    {
      legibility: auditStatuses['Outside legibility study'],
      prelaunch: auditStatuses['Pre-launch external checks'],
      prelaunchHonesty: auditStatuses['Pre-launch ledger honesty'],
    },
    {
      legibility: 'pending external study',
      prelaunch: 'pending external checks',
      prelaunchHonesty: 'packet ready; external evidence pending',
    },
  );
  assert.ok(acceptanceRunRows.length >= 4);
  assert.equal(
    acceptanceRunRows.slice(0, -1).every((row) => row.Result === 'passed'),
    true,
  );
  assert.equal(
    acceptanceRunRows.filter(
      (row) => row.Result === 'pending' && row.Commit === 'TBD at freeze run',
    ).length,
    1,
  );
  assert.equal(
    auditRows.filter((row) => row.Status === 'passed local run').length,
    acceptanceRunRows.filter((row) => row.Result === 'passed').length,
    'each passed local acceptance row has a matching dated audit row',
  );
  assert.equal(
    auditRows.filter((row) => row.Status.startsWith('pending')).length,
    2,
    'only the external-evidence blockers are pending audit rows',
  );
  assert.equal(
    auditRows.some(
      (row) => row.Area === 'Local integration acceptance' && row.Status === 'pending',
    ),
    false,
    'the pending final clean-checkout run is not claimed as a dated audit row',
  );
  assert.deepEqual(
    cleanCheckoutRows.map((row) => row.Status),
    ['pending', 'pending', 'pending', 'pending', 'pending', 'pending'],
  );
});

void test('pre-launch checklist is tracked explicitly', async () => {
  const checklist = await readProjectFile('docs/prelaunch-checklist.md');
  const requiredChecks = parseMarkdownTable(markdownSection(checklist, 'Required Checks'));
  const auditRows = parseMarkdownTable(markdownSection(checklist, 'Dated Audit Ledger'));
  const runnableChecks = parseMarkdownTable(markdownSection(checklist, 'Runnable Local Checklist'));
  const evidenceLedgers = {
    Domain: parseMarkdownTable(markdownSection(checklist, 'Domain Evidence Ledger'))[0],
    'Linguistic screen': parseMarkdownTable(
      markdownSection(checklist, 'Linguistic Evidence Ledger'),
    )[0],
    'npm scope': parseMarkdownTable(markdownSection(checklist, 'npm Scope Evidence Ledger'))[0],
    'Trademark screen': parseMarkdownTable(
      markdownSection(checklist, 'Trademark Evidence Ledger'),
    )[0],
  };
  const auditStatuses = Object.fromEntries(auditRows.map((row) => [row.Reviewer, row.Status]));

  assert.deepEqual(
    requiredChecks.map((row) => row.Check),
    ['Trademark screen', 'Domain', 'npm scope', 'Linguistic screen'],
  );
  assert.deepEqual(
    Object.keys(evidenceLedgers).toSorted((left, right) => left.localeCompare(right)),
    requiredChecks.map((row) => row.Check).toSorted((left, right) => left.localeCompare(right)),
  );
  for (const row of requiredChecks) {
    assert.equal(row.Status, 'pending', `${row.Check} remains pending`);
    assert.ok(evidenceLedgers[row.Check], `${row.Check} has a dedicated evidence ledger row`);
  }
  assert.equal(evidenceLedgers.Domain.Domain, 'jiso.dev');
  assert.equal(evidenceLedgers['npm scope'].Scope, '@jiso');
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(evidenceLedgers).map(([check, row]) => [
        check,
        {
          date: row.Date,
          reviewer: row.Reviewer,
          status: row.Status,
        },
      ]),
    ),
    {
      Domain: { date: '2026-06-12', reviewer: 'TBD', status: 'pending' },
      'Linguistic screen': { date: '2026-06-12', reviewer: 'TBD', status: 'pending' },
      'Trademark screen': { date: '2026-06-12', reviewer: 'TBD', status: 'pending' },
      'npm scope': { date: '2026-06-12', reviewer: 'TBD', status: 'pending' },
    },
  );
  assert.deepEqual(
    {
      linguisticMarkets: evidenceLedgers['Linguistic screen']['Markets or languages'],
      trademarkSources: evidenceLedgers['Trademark screen'].Sources,
    },
    {
      linguisticMarkets: 'TBD',
      trademarkSources: 'TBD',
    },
  );
  assert.equal(auditStatuses.Codex, 'packet ready; external evidence pending');
  assert.deepEqual(
    runnableChecks.map((row) => row.Status),
    ['pending', 'pending', 'pending', 'pending'],
  );
  assert.deepEqual(
    Object.values(evidenceLedgers).map((row) => row.Status),
    ['pending', 'pending', 'pending', 'pending'],
  );
  assert.equal(
    auditRows.filter((row) => row.Status === 'packet ready; external evidence pending').length,
    1,
    'packet readiness is recorded separately from external completion',
  );
});

void test('S2 loader budget and inline enhanced form behavior are acceptance evidence', async () => {
  assert.ok(
    gzipSync(jisoLoaderSource).byteLength <= 4096,
    `inline loader gzip size ${gzipSync(jisoLoaderSource).byteLength} exceeds 4096 bytes`,
  );

  const listeners = new Map();
  const dispatched = [];
  const fragmentTarget = { innerHTML: '' };
  const appendCalls = [];
  const appendTarget = {
    insertAdjacentHTML(position, html) {
      appendCalls.push([position, html]);
    },
  };
  const formData = { kind: 'form-data' };
  const fetchCalls = [];
  const form = {
    action: '/_m/cart/add',
    method: 'post',
  };
  const depElements = [
    {
      id: 'cart-badge',
      getAttribute(name) {
        if (name === 'fw-deps') return 'cart';
        if (name === 'fw-fragment-target') return null;
        return null;
      },
    },
    {
      id: 'inventory-panel',
      getAttribute(name) {
        if (name === 'fw-deps') return 'inventory stock';
        if (name === 'fw-fragment-target') return 'inventory';
        return null;
      },
    },
  ];
  const parseAttributes = (source) =>
    Object.fromEntries(
      [...source.matchAll(/\s+([a-zA-Z:-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
    );
  const context = {
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
    DOMParser: class DOMParser {
      parseFromString(body) {
        const queryMatch = /<fw-query\b([^>]*)>([\s\S]*?)<\/fw-query>/.exec(body);
        const queryAttributes = parseAttributes(queryMatch?.[1] ?? '');
        const fragmentElements = [
          ...body.matchAll(/<fw-fragment\b([^>]*)>([\s\S]*?)<\/fw-fragment>/g),
        ].map((match) => {
          const attributes = parseAttributes(match[1] ?? '');
          return {
            getAttribute(name) {
              return attributes[name] ?? null;
            },
            innerHTML: match[2],
          };
        });

        return {
          querySelectorAll(selector) {
            if (selector === 'fw-query' && queryMatch) {
              return [
                {
                  getAttribute(name) {
                    return queryAttributes[name] ?? null;
                  },
                  textContent: queryMatch[2],
                },
              ];
            }
            if (selector === 'fw-fragment') return fragmentElements;
            return [];
          },
        };
      }
    },
    FormData: class FormData {
      constructor() {
        return formData;
      }
    },
    addEventListener(type, listener, options) {
      assert.notEqual(type, 'unload', 'inline loader must not register unload handlers');
      listeners.set(type, { listener, options });
    },
    attachShadow() {
      assert.fail('inline loader must not attach shadow roots');
    },
    crypto: {
      randomUUID() {
        return 'idem-inline';
      },
    },
    customElements: {
      define() {
        assert.fail('inline loader must not define custom elements');
      },
    },
    dispatchEvent(event) {
      dispatched.push(event);
      return true;
    },
    document: {
      getElementById(id) {
        return id === 'cart-badge' ? fragmentTarget : null;
      },
      querySelector(selector) {
        return selector === '[fw-fragment-target="cart-list"]' ? appendTarget : null;
      },
      querySelectorAll(selector) {
        if (selector === '[fw-deps]') return depElements;
        return [];
      },
      visibilityState: 'visible',
    },
    fetch: async (url, options) => {
      fetchCalls.push([url, options]);
      return {
        async text() {
          return [
            '<fw-query name="cart" key="cart:c1">{"count":1}</fw-query>',
            '<fw-fragment target="cart-badge"><cart-badge>1</cart-badge></fw-fragment>',
            '<fw-fragment target="cart-list" mode="append"><li>2</li></fw-fragment>',
          ].join('\n');
        },
      };
    },
    setTimeout,
  };

  runInNewContext(jisoLoaderSource, context);
  assert.deepEqual([...listeners.keys()], ['click', 'submit', 'input', 'change']);
  assert.equal(listeners.get('click')?.options.capture, true);
  listeners.get('submit')?.listener({
    preventDefault() {},
    target: {
      closest(selector) {
        return selector === 'form[enhance],form[data-enhance],form[data-mutation]' ? form : null;
      },
    },
    type: 'submit',
  });
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

  assert.equal(fetchCalls.length, 1);
  const [[fetchUrl, fetchOptions]] = fetchCalls;
  assert.equal(fetchUrl, '/_m/cart/add');
  assert.equal(fetchOptions.body, formData);
  assert.deepEqual(
    {
      headers: { ...fetchOptions.headers },
      keepalive: fetchOptions.keepalive,
      method: fetchOptions.method,
    },
    {
      headers: {
        Accept: 'text/vnd.jiso.fragment+html',
        'FW-Fragment': 'true',
        'FW-Idem': 'idem-inline',
        'FW-Targets': 'cart-badge=cart; inventory=inventory stock',
      },
      keepalive: true,
      method: 'POST',
    },
  );
  assert.deepEqual(
    dispatched.map((event) => ({ detail: { ...event.detail }, type: event.type })),
    [{ detail: { body: '{"count":1}', key: 'cart:c1', name: 'cart' }, type: 'jiso:query' }],
  );
  assert.equal(fragmentTarget.innerHTML, '<cart-badge>1</cart-badge>');
  assert.deepEqual(appendCalls, [['beforeend', '<li>2</li>']]);
});

void test('P2 loader smoke evidence is asserted through runtime behavior', async () => {
  const listeners = new Map();
  const rootElements = new Map();
  const root = {
    addEventListener(type, listener, options) {
      listeners.set(type, { listener, options });
    },
    removeEventListener(type, listener) {
      if (listeners.get(type)?.listener === listener) listeners.delete(type);
    },
    querySelectorAll(selector) {
      return rootElements.get(selector) ?? [];
    },
    visibilityState: 'visible',
  };
  const eventElement = (attributes) => ({
    attributes: Object.entries(attributes).map(([name, value]) => ({ name, value })),
    getAttribute(name) {
      return attributes[name] ?? null;
    },
    setAttribute(name, value) {
      attributes[name] = value;
    },
    closest(selector) {
      const trigger = selector.match(/^\[on\\:(.+)\]$/)?.[1];
      if (trigger && attributes[`on:${trigger}`] !== undefined) return this;
      if (selector === '[fw-state]' && attributes['fw-state'] !== undefined) return this;
      return null;
    },
  });
  const calls = [];
  const waitForCalls = async (count) => {
    for (let attempts = 0; attempts < 10 && calls.length < count; attempts += 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    }
    assert.equal(calls.length, count);
  };
  const handlers = {
    idle(_event, context) {
      calls.push(['idle', context.signal instanceof AbortSignal]);
    },
    load(_event, context) {
      calls.push(['load', context.signal instanceof AbortSignal]);
    },
    visible(_event, context) {
      calls.push(['visible', context.signal instanceof AbortSignal]);
    },
  };
  const loadElement = eventElement({ 'on:load': '/loader.js#load' });
  const idleElement = eventElement({ 'on:idle': '/loader.js#idle' });
  const visibleElement = eventElement({ 'on:visible': '/loader.js#visible' });
  const idleCallbacks = [];
  let visibleCallback;
  const observer = {
    observed: [],
    unobserved: [],
    observe(element) {
      this.observed.push(element);
    },
    unobserve(element) {
      this.unobserved.push(element);
    },
  };
  rootElements.set('[on\\:load]', [loadElement]);
  rootElements.set('[on\\:idle]', [idleElement]);
  rootElements.set('[on\\:visible]', [visibleElement]);
  let importCount = 0;

  const loader = installJisoLoader({
    importModule: async () => {
      importCount += 1;
      return handlers;
    },
    requestIdle(callback) {
      idleCallbacks.push(callback);
    },
    root,
    visibleObserver(callback) {
      visibleCallback = callback;
      return observer;
    },
  });

  assert.deepEqual(loader.events, ['click', 'submit', 'input', 'change']);
  assert.deepEqual([...listeners.keys()], ['click', 'submit', 'input', 'change']);
  assert.equal(listeners.get('click')?.options.capture, true);
  assert.equal(importCount, 0);
  await waitForCalls(1);
  assert.deepEqual(calls, [['load', true]]);

  idleCallbacks[0]();
  await waitForCalls(2);
  assert.deepEqual(calls, [
    ['load', true],
    ['idle', true],
  ]);

  assert.deepEqual(observer.observed, [visibleElement]);
  visibleCallback([{ isIntersecting: true, target: visibleElement }]);
  await waitForCalls(3);
  visibleCallback([{ isIntersecting: true, target: visibleElement }]);
  assert.deepEqual(calls, [
    ['load', true],
    ['idle', true],
    ['visible', true],
  ]);
  assert.deepEqual(observer.unobserved, [visibleElement]);

  const store = createQueryStore();
  const refetched = await refetchQueries({
    fetch: async (url, options) => {
      assert.equal(url, '/_q/cart');
      assert.deepEqual(options, {
        headers: {
          Accept: 'text/html',
          'FW-Fragment': 'true',
        },
        method: 'GET',
      });
      return {
        ok: true,
        status: 200,
        async text() {
          return '<fw-query name="cart">{"count":2}</fw-query>';
        },
      };
    },
    queries: ['cart'],
    queryStore: store,
  });
  assert.deepEqual(refetched, [{ fragments: [], queries: ['cart'] }]);
  assert.deepEqual(store.get('cart'), { count: 2 });

  let reconciledItems;
  const templateHost = {
    getAttribute() {
      return null;
    },
    reconcileTemplateStamp(items) {
      reconciledItems = items;
    },
  };
  const applied = applyCompiledQueryUpdatePlan(
    {
      querySelectorAll(selector) {
        return selector === '[data-list]' ? [templateHost] : [];
      },
    },
    'cart',
    { items: [{ id: 'p1', qty: 2 }] },
    {
      templateStamps: [
        {
          key: 'id',
          list: 'items',
          render: (item) => `<li>${item.id}:${item.qty}</li>`,
          selector: '[data-list]',
        },
      ],
    },
  );
  assert.deepEqual(applied.templateStamps, ['[data-list]']);
  assert.deepEqual(reconciledItems, [
    {
      html: '<li>p1:2</li>',
      index: 0,
      key: 'p1',
      value: { id: 'p1', qty: 2 },
    },
  ]);

  loader.dispose();
  assert.deepEqual([...listeners.keys()], []);
});

void test('P3 server renders initial query scripts for document-load hydration', async () => {
  const query = {
    key: 'cart:c1',
    name: 'cart',
    value: { html: '</script>' },
  };
  const queryScript =
    '<script type="application/json" fw-query="cart" key="cart:c1">{"html":"\\u003c/script>"}</script>';
  const document = renderDocument({
    body: '<main></main>',
    queries: [query],
  });
  const documentRegions = parseDocumentRegions(document.html);
  const documentElements = parseHtmlElements(document.html);
  const headQueryScripts = parseHtmlElementBlocks(documentRegions.head, 'script').filter(
    (script) => script.attributes['fw-query'] === 'cart',
  );
  const bodyElements = parseHtmlElements(documentRegions.body);
  const queryScriptElement = documentElements.find(
    (element) => element.tagName === 'script' && element.attributes['fw-query'] === 'cart',
  );

  assert.equal(renderQueryScript(query), queryScript);
  assert.equal(renderDocumentQueryScript(query), queryScript);
  assert.deepEqual(
    headQueryScripts.map((script) => ({
      attributes: script.attributes,
      innerHTML: script.innerHTML,
    })),
    [
      {
        attributes: {
          'fw-query': 'cart',
          key: 'cart:c1',
          type: 'application/json',
        },
        innerHTML: '{"html":"\\u003c/script>"}',
      },
    ],
  );
  assert.deepEqual(bodyElements, [{ attributes: {}, tagName: 'main' }]);
  assert.deepEqual(queryScriptElement?.attributes, {
    'fw-query': 'cart',
    key: 'cart:c1',
    type: 'application/json',
  });
  assert.equal(
    documentElements.some((element) => element.tagName === 'main'),
    true,
  );
});

void test('P2 page hints keep speculation rules opt-in and non-empty', async () => {
  assert.equal(renderPageHints({ prefetch: 'moderate', prerenderUrls: ['', ''] }).html, '');
  assert.equal(
    renderPageHints({
      prefetch: 'moderate',
      prerenderUrls: ['', '/products', '/products', '/cart'],
    }).html,
    '<script type="speculationrules">{"prerender":[{"eagerness":"moderate","urls":["/products","/cart"]}]}</script>',
  );
});

void test('P2 compiler merges view transition stamps into existing styles', async () => {
  const result = compileComponentModule({
    fileName: 'components/product-card.tsx',
    source: `
import { component } from '@jiso/core';

export const ProductCard = component('product-card', {
  render: () => <img style="opacity: .8" viewTransitionName="product-p1-image" src="/p1.png" />,
});
`,
  });
  const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';
  const registrySource = result.files.find((file) => file.kind === 'registry')?.source ?? '';

  assert.deepEqual(result.viewTransitions, [{ name: 'product-p1-image' }]);
  // SPEC §4.2: identity is emitted explicitly on native hosts (fw-c).
  const renderedElements = parseHtmlElements(executeGeneratedServerRenderSource(serverSource));
  const renderedImage = renderedElements.find((element) => element.tagName === 'img');
  assert.deepEqual(renderedImage?.attributes, {
    'fw-c': 'product-card',
    src: '/p1.png',
    style: 'opacity: .8; view-transition-name: product-p1-image',
  });
  assert.equal(
    renderedElements.filter((element) => Object.hasOwn(element.attributes, 'style')).length,
    1,
  );
  assert.equal(renderedImage?.attributes.viewTransitionName, undefined);
  assert.deepEqual(
    await typeScriptInterfaceMemberTypes(
      'view-transition-registry.ts',
      registrySource,
      'ViewTransitions',
    ),
    { 'product-p1-image': 'unknown' },
  );
});

void test('P1 compiler validates component-scoped IDREFs', async () => {
  assert.equal(
    diagnosticDefinitions.FW221.message,
    'IDREF references an id not present in component scope.',
  );
  assert.deepEqual(
    compileComponentModule({
      fileName: 'components/cart/cart-search.tsx',
      source: `
import { component } from '@jiso/core';

export const CartSearch = component('cart-search', {
  render: () => (
    <section>
      <label for="cart-query">Search</label>
      <input id="cart-query" aria-describedby="cart-help" />
      <p id="cart-help">Help</p>
    </section>
  ),
});
`,
    }).diagnostics,
    [],
  );
  assert.deepEqual(
    compileComponentModule({
      fileName: 'components/cart/cart-search.tsx',
      source: `
import { component } from '@jiso/core';

export const CartSearch = component('cart-search', {
  render: () => (
    <section>
      <label for="missing-label">Search</label>
      <input id="cart-query" aria-describedby="cart-help missing-help" />
      <p id="cart-help">Help</p>
      <button popovertarget="missing-popover">Filters</button>
    </section>
  ),
});
`,
    }).diagnostics,
    [
      {
        code: 'FW221',
        fileName: 'components/cart/cart-search.tsx',
        length: 19,
        message: `${diagnosticDefinitions.FW221.message} missing-label`,
        severity: 'error',
        start: { column: 14, line: 7 },
      },
      {
        code: 'FW221',
        fileName: 'components/cart/cart-search.tsx',
        length: 41,
        message: `${diagnosticDefinitions.FW221.message} missing-help`,
        severity: 'error',
        start: { column: 30, line: 8 },
      },
      {
        code: 'FW221',
        fileName: 'components/cart/cart-search.tsx',
        length: 31,
        message: `${diagnosticDefinitions.FW221.message} missing-popover`,
        severity: 'error',
        start: { column: 15, line: 10 },
      },
    ],
  );
});

void test('P1 compiler validates static id uniqueness', async () => {
  assert.equal(
    diagnosticDefinitions.FW224.message,
    'Static id appears in a repeatable component or duplicate page composition.',
  );
  assert.deepEqual(
    compileComponentModule({
      fileName: 'components/cart/cart-shell.tsx',
      source: `
import { component } from '@jiso/core';

export const CartShell = component('cart-shell', {
  render: () => (
    <section>
      <h2 id="cart-title">Cart</h2>
      <output id="cart-title">2 items</output>
    </section>
  ),
});
`,
    }).diagnostics,
    [
      {
        code: 'FW224',
        fileName: 'components/cart/cart-shell.tsx',
        length: 15,
        message: `${diagnosticDefinitions.FW224.message} duplicate id="cart-title"`,
        severity: 'error',
        start: { column: 15, line: 8 },
      },
    ],
  );
  assert.deepEqual(
    compileComponentModule({
      fileName: 'components/cart/cart-list.tsx',
      source: `
import { component } from '@jiso/core';

export const CartList = component('cart-list', {
  render: () => (
    <ul data-bind-list="cart.items" fw-key="productId">
      <template fw-stamp>
        <li id="cart-row"><span data-bind=".name">Mug</span></li>
      </template>
    </ul>
  ),
});
`,
    }).diagnostics,
    [
      {
        code: 'FW224',
        fileName: 'components/cart/cart-list.tsx',
        length: 13,
        message: `${diagnosticDefinitions.FW224.message} repeatable id="cart-row"`,
        severity: 'error',
        start: { column: 13, line: 8 },
      },
    ],
  );
});

void test('P1 compiler validates HTML content-model parser stability', async () => {
  assert.equal(diagnosticDefinitions.FW225.message, 'JSX nesting violates the HTML content model.');
  assert.deepEqual(
    compileComponentModule({
      fileName: 'components/cart/cart-table.tsx',
      registryFacts: {
        components: ['cart-row'],
      },
      source: `
import { component } from '@jiso/core';

export const CartTable = component('cart-table', {
  render: () => (
    <table>
      <tbody>
        <tr fw-c="cart-row">
          <td>Cart row</td>
        </tr>
      </tbody>
    </table>
  ),
});
`,
    }).diagnostics,
    [],
  );
  assert.deepEqual(
    compileComponentModule({
      fileName: 'components/cart/cart-shell.tsx',
      source: `
import { component } from '@jiso/core';

export const CartShell = component('cart-shell', {
  render: () => (
    <section>
      <p>
        Cart intro
        <div>Parser closes the paragraph before this div.</div>
      </p>
      <tr>
        <td>Detached row</td>
      </tr>
    </section>
  ),
});
`,
    }).diagnostics,
    [
      {
        code: 'FW225',
        fileName: 'components/cart/cart-shell.tsx',
        length: 5,
        message: `${diagnosticDefinitions.FW225.message} <div> cannot appear inside <p>`,
        severity: 'error',
        start: { column: 9, line: 9 },
      },
      {
        code: 'FW225',
        fileName: 'components/cart/cart-shell.tsx',
        length: 4,
        message: `${diagnosticDefinitions.FW225.message} <tr> must be inside a table section or table`,
        severity: 'error',
        start: { column: 7, line: 11 },
      },
    ],
  );
});

void test('P1 compiler validates declared execution trigger names', async () => {
  assert.equal(
    diagnosticDefinitions.FW211.message,
    'on:load eager trigger requires a justification comment.',
  );
  assert.equal(
    diagnosticDefinitions.FW212.message,
    'Unknown on:* event or execution trigger name.',
  );
  assert.deepEqual(
    compileComponentModule({
      fileName: 'components/execution-triggers.tsx',
      source: `
import { component } from '@jiso/core';

export const ExecutionTriggers = component('execution-triggers', {
  render: () => (
    <section>
      <button on:click="/c/cart.client.js#Cart$add">Add</button>
      <search-index on:idle="/c/search.client.js#Search$warm"></search-index>
      <sales-chart on:visible="/c/chart.client.js#SalesChart$mount"></sales-chart>
      {/* FW211: stock ticker intentionally starts at parse for market-open pages. */}
      <stock-ticker on:load="/c/ticker.client.js#Ticker$start"></stock-ticker>
    </section>
  ),
});
`,
    }).diagnostics,
    [],
  );
  assert.deepEqual(
    compileComponentModule({
      fileName: 'components/execution-triggers.tsx',
      source: `
import { component } from '@jiso/core';

export const ExecutionTriggers = component('execution-triggers', {
  render: () => (
    <section>
      <stock-ticker on:load="/c/ticker.client.js#Ticker$start"></stock-ticker>
      <video-player on:media="/c/video.client.js#Video$mount"></video-player>
    </section>
  ),
});
`,
    }).diagnostics,
    [
      {
        code: 'FW211',
        fileName: 'components/execution-triggers.tsx',
        length: 7,
        message: `${diagnosticDefinitions.FW211.message} on:load`,
        severity: 'lint',
        start: { column: 21, line: 7 },
      },
      {
        code: 'FW212',
        fileName: 'components/execution-triggers.tsx',
        length: 8,
        message: `${diagnosticDefinitions.FW212.message} on:media`,
        severity: 'lint',
        start: { column: 21, line: 8 },
      },
    ],
  );
});

void test('P1 compiler validates residual fw-c and fw-deps stamps', async () => {
  assert.equal(
    diagnosticDefinitions.FW226.message,
    'fw-deps or fw-c names an unknown query instance or component.',
  );
  assert.deepEqual(
    compileComponentModule({
      fileName: 'components/recommendations.tsx',
      source: `
import { component } from '@jiso/core';

export const Recommendations = component('recommendations', {
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <section fw-c="recommendations" fw-deps="cart">{cart.count}</section>
  ),
});
`,
    }).diagnostics,
    [],
  );
  assert.deepEqual(
    compileComponentModule({
      fileName: 'components/recommendations.tsx',
      source: `
import { component } from '@jiso/core';

export const Recommendations = component('recommendations', {
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <section fw-c="unknown-component" fw-deps="cart missingQuery:p1">{cart.count}</section>
  ),
});
`,
    }).diagnostics,
    [
      {
        code: 'FW226',
        fileName: 'components/recommendations.tsx',
        length: 24,
        message: `${diagnosticDefinitions.FW226.message} fw-c="unknown-component"`,
        severity: 'error',
        start: { column: 14, line: 9 },
      },
      {
        code: 'FW226',
        fileName: 'components/recommendations.tsx',
        length: 30,
        message: `${diagnosticDefinitions.FW226.message} fw-deps="missingQuery:p1"`,
        severity: 'error',
        start: { column: 39, line: 9 },
      },
    ],
  );
});

void test('P1 compiler emits FW311 update coverage facts', async () => {
  assert.equal(
    diagnosticDefinitions.FW311.message,
    'Query-dependent DOM position has no update status.',
  );
  const result = compileComponentModule({
    fileName: 'components/cart/cart-badge.tsx',
    source: `
import { component } from '@jiso/core';

export const CartBadge = component('cart-badge', {
  queries: { cart: {}, product: {} },
  render: () => (
    <cart-badge>
      <span data-bind="cart.count">{cart.count}</span>
      <button data-bind:hidden="cart.empty">Checkout</button>
      <span>{renderOnce(cart.currency)}</span>
      <strong className={cart.discount}>Discount</strong>
      <em className={product.name}>Product</em>
    </cart-badge>
  ),
});
`,
  });

  assert.deepEqual(result.updateCoverage, [
    {
      componentName: 'CartBadge',
      detail: 'data-bind',
      position: 'binding',
      query: 'cart.count',
      status: 'plan',
    },
    {
      componentName: 'CartBadge',
      detail: 'data-bind:hidden',
      position: 'attribute',
      query: 'cart.empty',
      status: 'plan',
    },
    {
      componentName: 'CartBadge',
      detail: 'declared renderOnce',
      position: 'expression',
      query: 'cart.currency',
      status: 'renderOnce',
    },
    {
      componentName: 'CartBadge',
      detail: 'query expression has no data-bind, renderOnce, fragment, or isomorphic status',
      position: 'expression',
      query: 'cart.discount',
      sourceSpan: { length: 13, start: 355 },
      status: 'UNHANDLED',
    },
    {
      componentName: 'CartBadge',
      detail: 'query expression has no data-bind, renderOnce, fragment, or isomorphic status',
      position: 'expression',
      query: 'product.name',
      sourceSpan: { length: 12, start: 409 },
      status: 'UNHANDLED',
    },
  ]);
  assert.deepEqual(
    result.diagnostics.filter((diagnostic) => diagnostic.code === 'FW311'),
    [
      {
        code: 'FW311',
        fileName: 'components/cart/cart-badge.tsx',
        length: 13,
        message: `${diagnosticDefinitions.FW311.message} CartBadge cart.discount expression`,
        severity: 'warn',
        start: { column: 26, line: 11 },
      },
      {
        code: 'FW311',
        fileName: 'components/cart/cart-badge.tsx',
        length: 12,
        message: `${diagnosticDefinitions.FW311.message} CartBadge product.name expression`,
        severity: 'warn',
        start: { column: 22, line: 12 },
      },
    ],
  );
  assert.equal(
    fwCheck({
      updateCoverage: [
        {
          component: 'CartBadge',
          detail: 'text binding',
          position: 'text',
          query: 'cart.count',
          status: 'plan',
        },
        {
          component: 'CartBadge',
          position: 'conditional <dot>',
          query: 'cart.discount',
          status: 'UNHANDLED',
        },
      ],
    }).output,
    [
      'fw-check/v1',
      'COVERAGE component=CartBadge query=cart.count position="text" status=plan detail="text binding"',
      'WARN FW311 component=CartBadge query=cart.discount position="conditional <dot>" Query-dependent DOM position has no update status.',
      '',
    ].join('\n'),
  );
});

void test('P1 compiler validates binding stamp expression drift', async () => {
  assert.equal(
    diagnosticDefinitions.FW222.message,
    'Hand-written binding stamp disagrees with the typed expression it wraps.',
  );
  assert.equal(
    diagnosticDefinitions.FW223.message,
    'Redundant hand-written binding stamp in sugar; the compiler derives it.',
  );
  assert.deepEqual(
    compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      source: `
import { component } from '@jiso/core';

export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.count">{cart.count}</span>,
});
`,
    }).diagnostics,
    [
      {
        code: 'FW223',
        fileName: 'components/cart/cart-badge.tsx',
        length: 22,
        message: `${diagnosticDefinitions.FW223.message} data-bind="cart.count" wraps {cart.count}`,
        severity: 'lint',
        start: { column: 31, line: 6 },
      },
    ],
  );
  assert.deepEqual(
    compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      source: `
import { component } from '@jiso/core';

export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.count">{cart.total}</span>,
});
`,
    }).diagnostics.filter((diagnostic) => diagnostic.code === 'FW222'),
    [
      {
        code: 'FW222',
        fileName: 'components/cart/cart-badge.tsx',
        length: 22,
        message: `${diagnosticDefinitions.FW222.message} data-bind="cart.count" wraps {cart.total}`,
        severity: 'error',
        start: { column: 31, line: 6 },
      },
    ],
  );
});

void test('P1 compiler validates primitive composition attribute merges', async () => {
  assert.equal(
    diagnosticDefinitions.FW231.message,
    'Unmergeable attribute conflict in primitive composition.',
  );
  assert.equal(
    diagnosticDefinitions.FW232.message,
    'Author overrides a primitive-owned ARIA or state attribute.',
  );
  assert.equal(diagnosticDefinitions.FW233.message, 'Two writers target the same binding slot.');
  assert.deepEqual(
    compileComponentModule({
      fileName: 'components/primitive-merge.tsx',
      source: `
import { component } from '@jiso/core';

export const PrimitiveMerge = component('primitive-merge', {
  render: () => (
    <primitive-merge>
      <dialog id="drawer"></dialog>
      <dialog id="confirm"></dialog>
      <button commandfor="drawer" commandfor="confirm" data-p-id="one" data-p-id="two" fw-c="primitive-merge" fw-c="primitive-merge">Open</button>
      <button aria-expanded="false" aria-expanded="true" role="button" role="link" data-state="closed" data-state="open">Toggle</button>
      <span data-bind="cart.count" data-bind="cart.total" data-bind:hidden="cart.empty" data-bind:hidden="cart.loading">2</span>
    </primitive-merge>
  ),
});
`,
    }).diagnostics.filter((diagnostic) => ['FW231', 'FW232', 'FW233'].includes(diagnostic.code)),
    [
      {
        code: 'FW231',
        fileName: 'components/primitive-merge.tsx',
        length: 19,
        message: `${diagnosticDefinitions.FW231.message} commandfor`,
        severity: 'error',
        start: { column: 15, line: 9 },
      },
      {
        code: 'FW231',
        fileName: 'components/primitive-merge.tsx',
        length: 15,
        message: `${diagnosticDefinitions.FW231.message} data-p-id`,
        severity: 'error',
        start: { column: 56, line: 9 },
      },
      {
        code: 'FW231',
        fileName: 'components/primitive-merge.tsx',
        length: 22,
        message: `${diagnosticDefinitions.FW231.message} fw-c`,
        severity: 'error',
        start: { column: 88, line: 9 },
      },
      {
        code: 'FW232',
        fileName: 'components/primitive-merge.tsx',
        length: 21,
        message: `${diagnosticDefinitions.FW232.message} aria-expanded`,
        severity: 'lint',
        start: { column: 15, line: 10 },
      },
      {
        code: 'FW232',
        fileName: 'components/primitive-merge.tsx',
        length: 13,
        message: `${diagnosticDefinitions.FW232.message} role`,
        severity: 'lint',
        start: { column: 58, line: 10 },
      },
      {
        code: 'FW232',
        fileName: 'components/primitive-merge.tsx',
        length: 19,
        message: `${diagnosticDefinitions.FW232.message} data-state`,
        severity: 'lint',
        start: { column: 84, line: 10 },
      },
      {
        code: 'FW233',
        fileName: 'components/primitive-merge.tsx',
        length: 22,
        message: `${diagnosticDefinitions.FW233.message} data-bind`,
        severity: 'error',
        start: { column: 13, line: 11 },
      },
      {
        code: 'FW233',
        fileName: 'components/primitive-merge.tsx',
        length: 29,
        message: `${diagnosticDefinitions.FW233.message} data-bind:hidden`,
        severity: 'error',
        start: { column: 59, line: 11 },
      },
    ],
  );
});

void test('P1 compiler validates fragment-target child hoisting failures', async () => {
  assert.equal(
    diagnosticDefinitions.FW230.message,
    'Fragment-target children cannot lower to a component reference.',
  );
  assert.deepEqual(
    compileComponentModule({
      fileName: 'components/cart/cart-row.tsx',
      source: `
import { component } from '@jiso/core';

export const CartRow = component('cart-row', {
  fragmentTarget: true,
  props: { rowId: String },
  render: ({ rowId }) => <tr fw-c="cart-row" data-row={rowId}></tr>,
});

export const CartTable = component('cart-table', {
  render: ({ cart }) => (
    <table>
      <CartRow rowId={cart.rowId}>
        <span>{cart.count}</span>
      </CartRow>
    </table>
  ),
});
`,
    }).diagnostics,
    [],
  );
  assert.deepEqual(
    compileComponentModule({
      fileName: 'components/cart/cart-row.tsx',
      source: `
import { component } from '@jiso/core';

export const CartRow = component('cart-row', {
  fragmentTarget: true,
  props: { rowId: String },
  render: ({ rowId }) => <tr fw-c="cart-row" data-row={rowId}></tr>,
});

export const CartTable = component('cart-table', {
  render: ({ cart }) => (
    <table>
      <CartRow rowId={cart.rowId}>
        <span>{window.location.href}</span>
      </CartRow>
    </table>
  ),
});
`,
    }).diagnostics,
    [
      {
        code: 'FW230',
        fileName: 'components/cart/cart-row.tsx',
        help: [
          'Would hoist children to: CartRow$slot_children',
          'Blocked children: <span>{window.location.href}</span>',
          'Fixes: pass serializable props, move browser/request/db values behind a server fragment, or render children inside the fragment target itself.',
        ].join('\n'),
        length: 35,
        message: `${diagnosticDefinitions.FW230.message} CartRow`,
        severity: 'error',
        start: { column: 9, line: 14 },
      },
    ],
  );
});

void test('P3 typed routes validate navigation targets', async () => {
  assert.equal(
    diagnosticDefinitions.FW220.message,
    'Literal href or form action matches no declared route.',
  );
  assert.equal(
    href('/products/:id', { params: { id: 'p 1' }, search: { max: 10 } }),
    '/products/p%201?max=10',
  );
  assert.deepEqual(redirect('/products/:id', { params: { id: 'p1' } }), {
    location: '/products/p1',
    status: 303,
  });
  assert.deepEqual(route('/products/:id'), { path: '/products/:id' });
  assert.deepEqual(Link('/products/:id', { params: { id: 'p1' } }), { href: '/products/p1' });
  const declaredRoute = serverRoute('/products/:id', { load: () => 'ok' });
  assert.equal(declaredRoute.path, '/products/:id');
  assert.equal(typeof declaredRoute.load, 'function');

  const lowered = compileComponentModule({
    fileName: 'components/product-links.tsx',
    registryFacts: {
      routes: ['/cart', '/products/:id'],
    },
    source: `
import { component, href, Link } from '@jiso/core';

export const ProductLinks = component('product-links', {
  render: () => (
    <nav>
      <Link to="/products/:id" params={{ id: 'p 1' }} search={{ max: 500 }}>Product</Link>
      <a href={href('/cart')}>Cart</a>
    </nav>
  ),
});
`,
  });
  const serverSource = lowered.files.find((file) => file.kind === 'server')?.source ?? '';
  const registrySource = lowered.files.find((file) => file.kind === 'registry')?.source ?? '';
  assert.deepEqual(lowered.diagnostics, []);
  const renderedLinks = parseHtmlElements(executeGeneratedServerRenderSource(serverSource)).filter(
    (element) => element.tagName === 'a',
  );
  assert.deepEqual(
    renderedLinks.map((element) => element.attributes.href),
    ['/products/p%201?max=500', '/cart'],
  );

  const virtualRegistryFile = join(
    fileURLToPath(new URL('../', import.meta.url)),
    '.fw-check-virtual',
    'route-registry.ts',
  );
  const virtualConsumerFile = join(
    fileURLToPath(new URL('../', import.meta.url)),
    '.fw-check-virtual',
    'route-consumer.ts',
  );

  await assertTypeScriptProgramHasNoDiagnostics({
    [virtualRegistryFile]: registrySource,
    [virtualConsumerFile]: `
import { href, Link, redirect, route } from '@jiso/core';

href('/cart', {});
href('/products/:id', { params: { id: 'p 1' }, search: { max: 500 } });
redirect('/products/:id', { params: { id: 'p1' } });
route('/products/:id');
Link('/cart', {});
Link('/products/:id', { params: { id: 'p1' } });

// @ts-expect-error generated RouteRegistry requires params for dynamic routes.
href('/products/:id', {});

// @ts-expect-error generated RouteRegistry keeps id params typed as string.
href('/products/:id', { params: { id: 1 } });

// @ts-expect-error generated RouteRegistry rejects undeclared routes.
href('/checkout', {});
`,
  });

  assert.deepEqual(
    compileComponentModule({
      fileName: 'components/product-links.tsx',
      registryFacts: {
        routes: ['/cart', '/products/:id'],
      },
      source: `
import { component } from '@jiso/core';

export const ProductLinks = component('product-links', {
  render: () => (
    <nav>
      <a href="/product/p1">Bad</a>
      <form method="get" action="/checkout"></form>
    </nav>
  ),
});
`,
    }).diagnostics,
    [
      {
        code: 'FW220',
        fileName: 'components/product-links.tsx',
        length: 18,
        message: `${diagnosticDefinitions.FW220.message} /product/p1`,
        severity: 'error',
        start: { column: 10, line: 7 },
      },
      {
        code: 'FW220',
        fileName: 'components/product-links.tsx',
        length: 18,
        message: `${diagnosticDefinitions.FW220.message} /checkout`,
        severity: 'error',
        start: { column: 26, line: 8 },
      },
    ],
  );
});

void test('P3 mutation lifecycle includes an explicit transaction boundary', async () => {
  const transactionEvents = [];
  const transactional = mutation('cart/add', {
    csrf: false,
    guard(request) {
      transactionEvents.push(`guard:${request.user}`);
      return request.user === 'u1';
    },
    input: s.object({ productId: s.string() }),
    async transaction(request, run) {
      transactionEvents.push(`begin:${request.tx === true ? 'tx' : 'plain'}`);
      const value = await run({ ...request, tx: true });
      transactionEvents.push('commit');
      return value;
    },
    handler(input, request) {
      transactionEvents.push(`handler:${request.tx === true ? 'tx' : 'plain'}`);
      return input.productId;
    },
  });

  assert.deepEqual(await runMutation(transactional, { productId: 'p1' }, { user: 'u1' }), {
    changes: [],
    ok: true,
    rerunQueries: [],
    value: 'p1',
  });
  assert.deepEqual(transactionEvents, ['guard:u1', 'begin:plain', 'handler:tx', 'commit']);

  const rollbackEvents = [];
  const failing = mutation('cart/fail', {
    csrf: false,
    errors: {
      OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
    },
    input: s.object({ productId: s.string() }),
    async transaction(request, run) {
      rollbackEvents.push('begin');
      try {
        return await run(request);
      } catch (error) {
        rollbackEvents.push('rollback');
        throw error;
      }
    },
    handler(_input, _request, context) {
      rollbackEvents.push('handler');
      return context.fail('OUT_OF_STOCK', { availableQuantity: 0 });
    },
  });
  assert.deepEqual(await runMutation(failing, { productId: 'p1' }, {}), {
    error: {
      code: 'OUT_OF_STOCK',
      payload: { availableQuantity: 0 },
    },
    ok: false,
    status: 422,
  });
  assert.deepEqual(rollbackEvents, ['begin', 'handler', 'rollback']);

  const cart = domain('cart');
  const cartQuery = query('cart', {
    instanceKey: () => 'cart:c1',
    load(_input, context) {
      return { cartId: context.request.session.cartId };
    },
    reads: [cart],
  });
  const addToCart = mutation('cart/add', {
    csrf: false,
    input: s.object({ productId: s.string() }),
    registry: {
      queries: [cartQuery],
      touches: [cart],
    },
    handler(input, request) {
      return `${request.session.cartId}:${input.productId}`;
    },
  });
  assert.deepEqual(
    await renderMutationResponse(addToCart, {
      fragment: true,
      rawInput: { productId: 'p1' },
      request: { session: { cartId: 'c1' } },
    }),
    {
      body: '<fw-query name="cart" key="cart:c1">{"cartId":"c1"}</fw-query>',
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
        'FW-Changes': '[{"domain":"cart"}]',
      },
      status: 200,
    },
  );
});

void test('P3 server data-plane APIs stay exported and covered', async () => {
  const product = domain('product');
  const productQuery = query('productDetail', {
    args: s.object({ id: s.string(), max: s.number().int().default(10) }),
    guard: (request) => request.session?.userId === 'u1',
    instanceKey: (input) => `product:${input.id}`,
    load(input, { request }) {
      return { id: input.id, max: input.max, userId: request.session?.userId };
    },
    reads: [product],
    version: (input) => input.max,
  });

  assert.deepEqual(await runQuery(productQuery, { id: 'p1' }, { session: { userId: 'u1' } }), {
    input: { id: 'p1', max: 10 },
    ok: true,
    value: { id: 'p1', max: 10, userId: 'u1' },
  });
  assert.deepEqual(await runQuery(productQuery, {}, { session: { userId: 'u1' } }), {
    error: {
      code: 'VALIDATION',
      payload: { issues: [{ message: 'Expected string', path: ['id'] }] },
    },
    ok: false,
    status: 422,
  });
  assert.deepEqual(await runQuery(productQuery, { id: 'p1' }, { session: null }), {
    error: { code: 'UNAUTHORIZED', payload: {} },
    ok: false,
    status: 422,
  });
  assert.deepEqual(
    await renderQueryEndpointResponse(productQuery, {
      request: { session: { userId: 'u1' } },
      search: new URLSearchParams([
        ['id', 'p1'],
        ['max', '3'],
      ]),
    }),
    {
      body: '<fw-query name="product:p1" version="3">{"id":"p1","max":3,"userId":"u1"}</fw-query>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200,
    },
  );
  assert.deepEqual(
    await renderQueryRegistryEndpointResponse({ queries: [productQuery] }, 'missing', {
      request: {},
    }),
    {
      body: 'Not Found',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      status: 404,
    },
  );

  const productRoute = serverRoute('/products/:id', {
    guard: (request) => request.session?.userId === 'u1',
    page(context, request) {
      if (context.params.id === 'missing') return notFound();
      return `${request.session.userId}:${context.params.id}:${context.search.tab}`;
    },
    params: s.object({ id: s.string() }),
    search: s.object({ tab: s.string() }),
  });
  assert.deepEqual(
    await runRoutePage(
      productRoute,
      { params: { id: 'p1' }, search: { tab: 'details' } },
      { session: { userId: 'u1' } },
    ),
    {
      ok: true,
      value: 'u1:p1:details',
    },
  );
  assert.deepEqual(
    await renderRoutePageResponse(
      productRoute,
      { params: { id: 'missing' }, search: { tab: 'details' } },
      { session: { userId: 'u1' } },
    ),
    {
      body: 'Not Found',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 404,
    },
  );

  const request = { session: { id: 's1' } };
  const csrf = {
    field: 'csrf',
    secret: 'test-secret',
    sessionId: (candidate) => candidate.session.id,
  };
  let guardCalls = 0;
  const addToCart = mutation('cart/add', {
    csrf,
    guard() {
      guardCalls += 1;
      return true;
    },
    input: s.object({ productId: s.string() }),
    handler(input) {
      return input.productId;
    },
  });
  const token = csrfToken(request, csrf);
  assert.equal(csrfField(request, csrf), `<input type="hidden" name="csrf" value="${token}">`);
  assert.deepEqual(await runMutation(addToCart, { csrf: token, productId: 'p1' }, request), {
    changes: [],
    ok: true,
    rerunQueries: [],
    value: 'p1',
  });
  assert.equal(guardCalls, 1);
  assert.deepEqual(await runMutation(addToCart, { productId: 'p1' }, request), {
    error: { code: 'CSRF', payload: {} },
    ok: false,
    status: 422,
  });
  assert.equal(guardCalls, 1);
});

void test('P3 route and query guard removal is mechanically audited by fw check', () => {
  // SPEC.md section 6.4 and IMPLEMENT_v1.md P3 require route/query guards to surface
  // through the unguarded audit when removed.
  assert.deepEqual(
    fwCheck({
      mutations: [
        { guards: ['authed'], key: 'cart/add', writes: ['cart'] },
        { guards: ['rateLimit:session'], key: 'inventory/sync', writes: ['product'] },
      ],
      optimistic: [
        { mutation: 'cart/add', query: 'cart', status: 'hand-written' },
        { mutation: 'inventory/sync', query: 'adminOrders', status: 'await-fragment' },
      ],
      pages: [
        { guards: ['authed'], queries: ['cart'], route: '/cart' },
        { guards: [], queries: ['adminOrders'], route: '/admin' },
      ],
      queries: [
        { domains: ['cart'], guards: ['authed'], query: 'cart' },
        { domains: ['product'], guards: [], query: 'adminOrders' },
      ],
    }),
    {
      exitCode: 0,
      output: [
        'fw-check/v1',
        'WARN UNGUARDED inventory/sync mutation is reachable without an auth guard.',
        'WARN UNGUARDED page /admin is reachable without an auth guard.',
        'WARN UNGUARDED query adminOrders is reachable without an auth guard.',
        '',
      ].join('\n'),
    },
  );
});

void test('P5 morph evidence preserves keyed identity and applies fragments', () => {
  const first = {
    browserState: {
      focused: true,
      scroll: { left: 4, top: 24 },
      selection: { direction: 'forward', end: 3, start: 1 },
    },
    children: [{ key: 'label', text: 'Alpha', type: 'span' }],
    key: 'p1',
    type: 'article',
  };
  const second = {
    children: [{ key: 'label', text: 'Beta', type: 'span' }],
    key: 'p2',
    type: 'article',
  };
  const current = { children: [first, second], type: 'section' };

  morphStructuralTree(current, {
    children: [
      {
        children: [{ key: 'label', text: 'Beta next', type: 'span' }],
        key: 'p2',
        type: 'article',
      },
      {
        children: [{ key: 'label', text: 'Alpha next', type: 'span' }],
        key: 'p1',
        type: 'article',
      },
      { key: 'p3', text: 'Gamma', type: 'article' },
    ],
    type: 'section',
  });

  assert.strictEqual(current.children[0], second);
  assert.strictEqual(current.children[1], first);
  assert.deepEqual(current.children[1].browserState, {
    focused: true,
    scroll: { left: 4, top: 24 },
    selection: { direction: 'forward', end: 3, start: 1 },
  });
  assert.equal(current.children[1].children[0].text, 'Alpha next');

  const target = {
    html: '<article fw-key="p1">Old</article>',
    appendHtml(html) {
      this.html += html;
    },
    readHtml() {
      return this.html;
    },
    replaceWithHtml(html) {
      this.html = html;
    },
  };
  const root = {
    findFragmentTarget(fragmentTarget) {
      return fragmentTarget === 'products' ? target : null;
    },
  };
  const store = createQueryStore();
  const result = applyMutationResponseToDom({
    body: [
      '<fw-query name="productGrid" key="category:all">{"count":2}</fw-query>',
      '<fw-fragment target="products" mode="append"><article fw-key="p2">New</article></fw-fragment>',
      '<fw-fragment target="missing"><article>Ignored</article></fw-fragment>',
    ].join('\n'),
    root,
    store,
  });

  assert.deepEqual(result.appliedFragments, ['products']);
  assert.deepEqual(store.get('productGrid', 'category:all'), { count: 2 });
  assert.equal(target.html, '<article fw-key="p1">Old</article><article fw-key="p2">New</article>');
});

void test('D2 commerce validates keyed append and optimistic reorder', async () => {
  const commerceGraph = JSON.parse(
    await readProjectFile('examples/commerce/src/generated/graph.json'),
  );
  assert.deepEqual(
    commerceGraph.components.map((component) => [
      component.name,
      component.fragments,
      component.queries,
    ]),
    [
      ['CartBadge', ['cart-badge'], ['cart']],
      ['ProductGrid', ['product-grid'], ['productGrid']],
      ['OrderHistory', ['order-history'], ['orderHistory']],
    ],
  );
  assert.deepEqual(commerceGraph.optimistic, [
    { mutation: 'cart/add', query: 'cart', status: 'hand-written' },
    { mutation: 'cart/add', query: 'productGrid', status: 'await-fragment' },
    { mutation: 'cart/add', query: 'orderHistory', status: 'await-fragment' },
  ]);

  const currentGrid = {
    children: [
      { browserState: { islandState: { pendingMutation: 'cart/add' } }, key: 'p1', type: 'card' },
      { key: 'p2', type: 'card' },
    ],
    key: 'product-grid',
    type: 'section',
  };
  const firstProduct = currentGrid.children[0];
  const appendedGrid = morphStructuralTree(currentGrid, {
    children: [
      { key: 'p1', type: 'card' },
      { key: 'p2', type: 'card' },
      { key: 'p3', type: 'card' },
    ],
    key: 'product-grid',
    type: 'section',
  });
  const reorderedGrid = morphStructuralTree(appendedGrid, {
    children: [
      { key: 'p3', type: 'card' },
      { key: 'p1', type: 'card' },
      { key: 'p2', type: 'card' },
    ],
    key: 'product-grid',
    type: 'section',
  });
  assert.strictEqual(reorderedGrid.children[1], firstProduct);
  assert.deepEqual(reorderedGrid.children[1].browserState, {
    islandState: { pendingMutation: 'cart/add' },
  });

  const productDomain = domain('product');
  const productP1 = query('productDetail', {
    instanceKey: 'product:p1',
    load: () => ({ id: 'p1', stock: 0 }),
    reads: [productDomain],
  });
  const productP2 = query('productDetail', {
    instanceKey: 'product:p2',
    load: () => ({ id: 'p2', stock: 10 }),
    reads: [productDomain],
  });
  const reserveProduct = mutation('product/reserve', {
    csrf: false,
    csrfJustification: 'fw-check synthetic keyed invalidation fixture',
    handler(input) {
      return input.productId;
    },
    input: s.object({ productId: s.string() }),
    registry: {
      inferredTouches: [{ domain: 'product', keys: 'arg:productId' }],
      queries: [productP1, productP2],
    },
  });
  assert.deepEqual(await runMutation(reserveProduct, { productId: 'p1' }, {}), {
    changes: [{ domain: 'product', input: { productId: 'p1' }, keys: ['p1'] }],
    ok: true,
    rerunQueries: ['productDetail'],
    rerunQueryInstances: [{ instanceKey: 'product:p1', key: 'productDetail' }],
    value: 'p1',
  });
  assert.deepEqual(
    await renderMutationEndpointResponse(reserveProduct, {
      fragmentRenderers: [],
      headers: { 'FW-Fragment': 'true' },
      rawInput: { productId: 'p1' },
      redirectTo: '/products/p1',
      request: {},
    }),
    {
      body: '<fw-query name="productDetail" key="product:p1">{"id":"p1","stock":0}</fw-query>',
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
        'FW-Changes': '[{"domain":"product","keys":["p1"]}]',
      },
      status: 200,
    },
  );

  const store = createQueryStore();
  const rebaser = new OptimisticRebaser(store);
  const target = {
    html: '',
    replaceWithHtml(html) {
      this.html = html;
    },
  };
  store.set('reviews', { items: [{ id: 'r1' }] }, 'product:p1');
  const result = await submitOptimisticEnhancedMutation({
    fetch: async () => {
      assert.deepEqual(store.get('reviews'), undefined);
      assert.deepEqual(store.get('reviews', 'product:p1'), {
        items: [{ id: 'r1' }, { id: 'draft' }],
      });
      return {
        async text() {
          return [
            '<fw-query name="reviews" key="product:p1">{"items":[{"id":"r1"},{"id":"server"}]}</fw-query>',
            '<fw-fragment target="reviews:p1"><section>Reviews ready</section></fw-fragment>',
          ].join('\n');
        },
      };
    },
    form: { action: '/_m/reviews/add', method: 'post' },
    formData: new FormData(),
    change: { domain: 'product', input: { reviewId: 'draft' }, keys: ['p1'] },
    idem: 'idem_keyed_optimistic',
    input: { reviewId: 'ignored' },
    optimistic: {
      keys: { reviews: (change) => `product:${change.keys?.[0]}` },
      transforms: {
        reviews(current, input) {
          const reviews = current;
          return { items: [...reviews.items, { id: input.reviewId }] };
        },
      },
    },
    rebaser,
    root: {
      findFragmentTarget(fragmentTarget) {
        return fragmentTarget === 'reviews:p1' ? target : null;
      },
      querySelectorAll() {
        return [];
      },
    },
    store,
  });

  assert.deepEqual(result.queries, ['reviews:product:p1']);
  assert.deepEqual(result.appliedFragments, ['reviews:p1']);
  assert.deepEqual(store.get('reviews'), undefined);
  assert.deepEqual(store.get('reviews', 'product:p1'), {
    items: [{ id: 'r1' }, { id: 'server' }],
  });
  assert.equal(target.html, '<section>Reviews ready</section>');
});

void test('P6 navigation bfcache optimism cleanup acceptance is represented', async () => {
  const listeners = new Map();
  const lifecycleRoot = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
  const pendingElement = {
    attributes: { 'fw-deps': 'cart' },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
  const pendingRoot = {
    querySelectorAll(selector) {
      return selector === '[fw-deps]' ? [pendingElement] : [];
    },
  };
  const store = createQueryStore();
  const rebaser = new OptimisticRebaser(store);
  store.set('cart', { count: 1 });

  const dispose = installPagehideOptimismCleanup({
    discardPendingOptimism() {
      const discarded = rebaser.discardPendingOptimism();
      stampPendingQueries(pendingRoot, discarded, false);
      return discarded;
    },
    root: lifecycleRoot,
  });
  assert.equal(listeners.has('pagehide'), true);
  assert.equal(listeners.has('unload'), false);

  let fetchOptions;
  let releaseFetch;
  const formData = new FormData();
  formData.set('quantity', '2');
  const submit = submitOptimisticEnhancedMutation({
    fetch(_url, options) {
      fetchOptions = options;
      return new Promise((resolve) => {
        releaseFetch = () => {
          resolve({
            headers: { get: () => null },
            async text() {
              return '<fw-query name="cart">{"count":2}</fw-query>';
            },
          });
        };
      });
    },
    form: { action: '/_m/cart/add', method: 'post' },
    formData,
    idem: 'idem_bfcache',
    input: { quantity: 2 },
    optimistic: {
      transforms: {
        cart(current, input) {
          return { count: current.count + input.quantity };
        },
      },
    },
    pendingRoot,
    rebaser,
    root: {
      findFragmentTarget() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
    },
    store,
  });

  assert.deepEqual(store.get('cart'), { count: 3 });
  assert.equal(rebaser.pendingCount('cart'), 1);
  assert.deepEqual(fetchOptions, {
    body: formData,
    headers: {
      Accept: 'text/vnd.jiso.fragment+html',
      'FW-Fragment': 'true',
      'FW-Idem': 'idem_bfcache',
      'FW-Targets': '',
    },
    keepalive: true,
    method: 'POST',
  });
  assert.deepEqual(pendingElement.attributes, {
    'aria-busy': 'true',
    'fw-deps': 'cart',
    'fw-pending': '',
  });

  listeners.get('pagehide')?.({ target: null, type: 'pagehide' });
  assert.deepEqual(store.get('cart'), { count: 1 });
  assert.equal(rebaser.pendingCount('cart'), 0);
  assert.deepEqual(pendingElement.attributes, { 'fw-deps': 'cart' });

  releaseFetch();
  assert.deepEqual(await submit, {
    appliedFragments: [],
    changes: [],
    fragments: [],
    idem: 'idem_bfcache',
    queries: ['cart'],
    targets: [],
  });
  assert.deepEqual(store.get('cart'), { count: 2 });
  assert.equal(rebaser.pendingCount('cart'), 0);

  dispose();
  assert.equal(listeners.has('pagehide'), false);
});

void test('P3 commerce mutation runs through the transaction lifecycle', async () => {
  const createTransactionalDb = () => {
    const db = {
      commits: 0,
      items: [],
      rollbacks: 0,
      async transaction(run) {
        const draft = { items: this.items.map((item) => ({ ...item })) };
        try {
          const result = await run(draft);
          this.items = draft.items;
          this.commits += 1;
          return result;
        } catch (error) {
          this.rollbacks += 1;
          throw error;
        }
      },
    };
    return db;
  };

  const addToCart = mutation('cart/add', {
    csrf: false,
    errors: {
      OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
    },
    handler(input, request, context) {
      if (input.quantity > 5) {
        return context.fail('OUT_OF_STOCK', { availableQuantity: 5 });
      }

      request.db.items.push({ productId: input.productId, qty: input.quantity });
      return { count: request.db.items.length };
    },
    input: s.object({
      productId: s.string(),
      quantity: s.number().int().min(1),
    }),
    transaction(request, run) {
      return request.db.transaction((db) => run({ ...request, db }));
    },
  });

  const db = createTransactionalDb();
  assert.deepEqual(await runMutation(addToCart, { productId: 'p1', quantity: 2 }, { db }), {
    changes: [],
    ok: true,
    rerunQueries: [],
    value: { count: 1 },
  });
  assert.deepEqual(db.items, [{ productId: 'p1', qty: 2 }]);
  assert.equal(db.commits, 1);
  assert.equal(db.rollbacks, 0);

  assert.deepEqual(await runMutation(addToCart, { productId: 'p2', quantity: 99 }, { db }), {
    error: { code: 'OUT_OF_STOCK', payload: { availableQuantity: 5 } },
    ok: false,
    status: 422,
  });
  assert.deepEqual(db.items, [{ productId: 'p1', qty: 2 }]);
  assert.equal(db.commits, 1);
  assert.equal(db.rollbacks, 1);
});

void test('D1 commerce enhanced fragments carry Tailwind stylesheet hints', async () => {
  const stylesheetManifest = [
    {
      criticalCss: 'cart-badge { color: teal; }</style> cart-badge { display: block; }',
      fragmentTargets: ['cart-badge'],
      href: '/assets/tailwind.css',
    },
    {
      fragmentTargets: ['recommendations'],
      href: '/assets/recommendations.css',
      preload: false,
    },
  ];

  assert.deepEqual(stylesheetsForTargets(stylesheetManifest, ['cart-badge']), [
    {
      criticalCss: 'cart-badge { color: teal; }</style> cart-badge { display: block; }',
      fragmentTargets: ['cart-badge'],
      href: '/assets/tailwind.css',
    },
  ]);

  const pageHints = renderPageHints({
    stylesheets: stylesheetsForTargets(stylesheetManifest),
  });
  assert.equal(
    pageHints.html,
    '<style data-jiso-critical-href="/assets/tailwind.css">cart-badge { color: teal; }<\\/style> cart-badge { display: block; }</style><link rel="stylesheet" href="/assets/tailwind.css"><link rel="stylesheet" href="/assets/recommendations.css">',
  );
  assert.deepEqual(pageHints.earlyHints, {
    Link: '</assets/tailwind.css>; rel=preload; as=style',
  });

  const deferred = renderDeferredStream({
    chunks: [
      {
        fragments: [
          {
            html: '<section class="border-slate-200">Ready</section>',
            stylesheets: stylesheetsForTargets(stylesheetManifest, ['recommendations']),
            target: 'recommendations',
          },
        ],
      },
    ],
    shell: '<!doctype html><main><fw-defer target="recommendations"></fw-defer></main>',
  });
  const deferredElements = parseHtmlElements(deferred.body);
  assert.deepEqual(
    deferredElements.map((element) => element.tagName),
    ['main', 'fw-defer', 'fw-fragment', 'link', 'section'],
  );
  assert.deepEqual(
    deferredElements.find((element) => element.tagName === 'fw-fragment')?.attributes,
    { target: 'recommendations' },
  );
  assert.deepEqual(deferredElements.find((element) => element.tagName === 'link')?.attributes, {
    href: '/assets/recommendations.css',
    rel: 'stylesheet',
  });
  assert.deepEqual(deferredElements.find((element) => element.tagName === 'section')?.attributes, {
    class: 'border-slate-200',
  });

  const cart = domain('cart');
  const addToCart = mutation('cart/add', {
    csrf: false,
    errors: {
      OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
    },
    handler(_input, _request, context) {
      return context.fail('OUT_OF_STOCK', { availableQuantity: 0 });
    },
    input: s.object({ productId: s.string() }),
    registry: { touches: [cart] },
  });
  const failure = await renderMutationEndpointResponse(addToCart, {
    failureStylesheets: ['/assets/tailwind.css'],
    failureTarget: 'product-form:p2',
    headers: { 'FW-Fragment': 'true' },
    rawInput: { productId: 'p2' },
    renderFailureFragment: () =>
      '<form class="border-slate-200"><output role="alert">Only 0 left.</output></form>',
    request: {},
  });

  assert.deepEqual(failure, {
    body: '<fw-fragment target="product-form:p2"><link rel="stylesheet" href="/assets/tailwind.css"><form class="border-slate-200"><output role="alert">Only 0 left.</output></form></fw-fragment>',
    headers: { 'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8' },
    status: 422,
  });
});

void test('D4 commerce adopt-dont-invent features stay represented', async () => {
  const element = (initialAttributes) => {
    const attributes = { ...initialAttributes };

    return {
      getAttribute(name) {
        return attributes[name] ?? null;
      },
      removeAttribute(name) {
        delete attributes[name];
      },
      setAttribute(name, value) {
        attributes[name] = value;
      },
    };
  };
  const commerceGraph = JSON.parse(
    await readProjectFile('examples/commerce/src/generated/graph.json'),
  );
  const cartPage = commerceGraph.pages.find((page) => page.route === '/cart');
  const receiptMutation = commerceGraph.mutations.find((item) => item.key === 'order/receipt');

  assert.deepEqual(cartPage.i18n, ['en-US:cartLabel,productStock']);
  assert.deepEqual(cartPage.modulepreloads, []);
  assert.equal(cartPage.prefetch, false);
  assert.deepEqual(cartPage.queries, ['cart', 'productGrid', 'orderHistory']);
  assert.equal(cartPage.route, '/cart');
  assert.deepEqual(cartPage.stylesheets, ['/assets/tailwind.css']);
  assert.deepEqual(cartPage.meta, {
    description: 'Browse products and checkout with 0 verifiable cart item.',
    title: 'Jiso Commerce (0)',
  });
  assert.deepEqual(receiptMutation, {
    enctype: 'multipart/form-data',
    fileFields: ['receipt'],
    guards: ['authed', 'rateLimit:session'],
    inputFields: ['orderId', 'receipt'],
    key: 'order/receipt',
    session: 'commerceSession',
    writes: ['attachment'],
  });

  const cartQuery = query('cart', {
    load: () => ({ count: 1 }),
    reads: [domain('cart')],
  });
  const cartMeta = metaFromQuery(cartQuery, (cart) => ({
    description: `Browse products and checkout with ${cart.count} verifiable cart item.`,
    title: `Jiso Commerce (${cart.count})`,
  }));
  const messages = i18n('en-US', {
    cartLabel: 'Cart ({count})',
    productStock: '{stock} in stock',
  });

  assert.equal(t(messages, 'cartLabel', { count: 1 }), 'Cart (1)');
  assert.deepEqual(
    renderPageHints({ i18n: messages, meta: cartMeta }, { queries: { cart: { count: 1 } } }),
    {
      earlyHints: {},
      html: [
        '<title>Jiso Commerce (1)</title>',
        '<meta name="description" content="Browse products and checkout with 1 verifiable cart item.">',
        '<meta property="og:description" content="Browse products and checkout with 1 verifiable cart item.">',
        '<script type="application/json" fw-i18n locale="en-US">{"cartLabel":"Cart ({count})","productStock":"{stock} in stock"}</script>',
      ].join(''),
    },
  );
  assert.throws(
    () => renderPageHints({ meta: cartMeta }),
    /Missing query data for route meta: cart/,
  );

  const commerceSession = session(
    s.object({
      id: s.string(),
      user: s.object({ id: s.string() }),
    }),
  );
  const authenticatedRequest = { session: { id: 's1', user: { id: 'u1' } } };
  const guarded = guards.all(guards.authed(), guards.rateLimit({ max: 1, per: 'session' }));

  assert.deepEqual(commerceSession.parse(authenticatedRequest), {
    id: 's1',
    user: { id: 'u1' },
  });
  assert.equal(await guarded(authenticatedRequest), true);
  assert.equal((await guarded(authenticatedRequest)).code, 'RATE_LIMITED');
  assert.deepEqual(await guards.authed()({ session: null }), {
    auth: 'unauthenticated',
    code: 'UNAUTHORIZED',
    payload: {},
    status: 422,
  });

  const storedObjects = new Map();
  const storage = {
    async get(key) {
      return storedObjects.get(key);
    },
    async put(key, body, options = {}) {
      const bytes =
        body instanceof ArrayBuffer
          ? new Uint8Array(body)
          : ArrayBuffer.isView(body)
            ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
            : new TextEncoder().encode(String(body));
      const stored = {
        body: bytes,
        contentType: options.contentType,
        key,
        metadata: options.metadata,
        size: bytes.byteLength,
      };
      storedObjects.set(key, stored);
      return stored;
    },
    async stat(key) {
      return storedObjects.get(key);
    },
    async stream(key) {
      const stored = storedObjects.get(key);
      return stored ? { ...stored, body: new Blob([stored.body]).stream() } : undefined;
    },
  };
  const uploadReceipt = mutation('order/receipt', {
    csrf: false,
    input: s.object({
      orderId: s.string(),
      receipt: s.file({ maxBytes: 64 * 1024, mime: ['application/pdf', 'image/png'] }).store({
        key: (file) => `receipts/${file.name}`,
        storage,
      }),
    }),
    handler(input, request) {
      return {
        orderId: input.orderId,
        session: commerceSession.parse(request).user.id,
        storageKey: input.receipt.storage.key,
      };
    },
    registry: { touches: [domain('attachment')] },
  });
  const receiptForm = new FormData();
  receiptForm.set('orderId', 'o1');
  receiptForm.set('receipt', new Blob(['receipt'], { type: 'application/pdf' }), 'receipt.pdf');

  const receiptResult = await runMutation(uploadReceipt, receiptForm, authenticatedRequest);
  assert.deepEqual(receiptResult, {
    changes: [
      {
        domain: 'attachment',
        input: {
          orderId: 'o1',
          receipt: {
            file: receiptForm.get('receipt'),
            key: 'receipts/receipt.pdf',
            storage: {
              body: new TextEncoder().encode('receipt'),
              contentType: 'application/pdf',
              key: 'receipts/receipt.pdf',
              metadata: { filename: 'receipt.pdf' },
              size: 7,
            },
          },
        },
      },
    ],
    ok: true,
    rerunQueries: [],
    value: {
      orderId: 'o1',
      session: 'u1',
      storageKey: 'receipts/receipt.pdf',
    },
  });
  assert.deepEqual(await storage.stat('receipts/receipt.pdf'), {
    body: new TextEncoder().encode('receipt'),
    contentType: 'application/pdf',
    key: 'receipts/receipt.pdf',
    metadata: { filename: 'receipt.pdf' },
    size: 7,
  });

  const progressElement = element({ 'fw-upload-progress': '', max: '100', value: '0' });
  const pendingElement = element({ 'fw-deps': 'order' });
  const form = {
    ...element({ 'data-mutation': 'order/receipt', enhance: '', 'fw-deps': 'order' }),
    action: '/_m/order/receipt',
    method: 'post',
    querySelectorAll(selector) {
      return selector === '[fw-upload-progress]' ? [progressElement] : [];
    },
  };
  const mutationRoot = {
    findFragmentTarget() {
      return null;
    },
    querySelectorAll(selector) {
      return selector === '[fw-deps]' ? [pendingElement] : [];
    },
  };

  await submitEnhancedMutation({
    fetch: async (_url, options) => ({
      headers: { get: () => null },
      async text() {
        options.onUploadProgress?.({ loaded: 32, total: 64 });
        assert.equal(pendingElement.getAttribute('fw-pending'), '');
        return '<fw-query name="receipt">{"ok":true}</fw-query>';
      },
    }),
    form,
    formData: receiptForm,
    onUploadProgress(progress) {
      const total = progress.total ?? 0;
      progressElement.setAttribute('max', '100');
      progressElement.setAttribute('value', String(Math.round((progress.loaded / total) * 100)));
    },
    pendingQueries: ['order'],
    pendingRoot: mutationRoot,
    root: mutationRoot,
    store: createQueryStore(),
  });
  assert.equal(progressElement.getAttribute('value'), '50');
  assert.equal(progressElement.getAttribute('max'), '100');
  assert.equal(pendingElement.getAttribute('fw-pending'), null);

  const fragmentFailure = mutation('product-grid/reload', {
    csrf: false,
    input: s.object({ productId: s.string() }),
    handler(input) {
      return input;
    },
  });
  const failureResponse = await renderMutationEndpointResponse(fragmentFailure, {
    fragmentRenderers: [
      errorBoundary(
        {
          render() {
            throw new Error('fragment failed');
          },
          stylesheets: ['/assets/tailwind.css'],
          target: 'product-grid',
        },
        {
          render(error) {
            return `<section role="alert">${error.message}</section>`;
          },
          target: 'product-grid-error',
        },
      ),
    ],
    headers: { 'FW-Fragment': 'true', 'FW-Targets': 'product-grid' },
    rawInput: { productId: 'p1' },
    request: {},
  });

  assert.deepEqual(failureResponse, {
    body: '<fw-fragment target="product-grid-error" error-boundary="product-grid"><link rel="stylesheet" href="/assets/tailwind.css"><section role="alert">fragment failed</section></fw-fragment>',
    headers: {
      'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
      'FW-Changes': '[]',
    },
    status: 200,
  });
});

void test('P10 commerce graph assertions answer behavior mechanically', async () => {
  const graphArtifact = await readProjectFile('examples/commerce/src/generated/graph.json');
  const commerceGraph = JSON.parse(graphArtifact);
  const cartQueryExplain = fwExplain(commerceGraph, { kind: 'query', target: 'cart' }).output;
  const cartAddExplain = fwExplain(commerceGraph, {
    kind: 'mutation',
    optimistic: true,
    target: 'cart/add',
  }).output;
  const uploadReceiptExplain = fwExplain(commerceGraph, {
    kind: 'mutation',
    optimistic: true,
    target: 'order/receipt',
  }).output;

  assert.deepEqual(fwCheck(commerceGraph), { exitCode: 0, output: 'fw-check/v1\nOK\n' });
  assert.equal(explainValue(cartQueryExplain, 'consumers: '), 'component:CartBadge,page:/cart');
  assert.equal(explainValue(cartQueryExplain, 'invalidated-by: '), 'cart/add');
  assert.equal(explainValue(cartQueryExplain, 'domain-writes: '), 'cart.addItem');
  assert.equal(explainValue(cartAddExplain, 'session: '), 'commerceSession');
  assert.equal(explainValue(cartAddExplain, 'input-fields: '), 'productId,quantity');
  assert.equal(explainValue(cartAddExplain, 'writes: '), 'cart,product,order');
  assert.equal(explainValue(cartAddExplain, 'invalidates: '), 'cart,product,order');
  assert.deepEqual(explainUpdateTargets(cartAddExplain), [
    'cart->component:CartBadge,page:/cart',
    'orderHistory->component:OrderHistory,page:/cart',
    'productGrid->component:ProductGrid,page:/cart',
  ]);
  assert.equal(explainSummary(cartAddExplain, 'OPTIMISTIC-SUMMARY ').UNHANDLED, '0');
  assert.equal(explainValue(uploadReceiptExplain, 'file-fields: '), 'receipt');
  assert.equal(explainValue(uploadReceiptExplain, 'invalidates: '), '-');
  assert.equal(
    diagnosticDefinitions.FW310.message,
    'Invalidated query lacks optimistic transform.',
  );
  assert.equal(
    diagnosticDefinitions.FW311.message,
    'Query-dependent DOM position has no update status.',
  );
  assert.equal(
    fwCheck(
      {
        mutations: [{ key: 'cart/add', writes: ['cart'] }],
        optimistic: [{ mutation: 'cart/add', query: 'orderHistory', status: 'await-fragment' }],
        queries: [
          { domains: ['cart'], query: 'cart' },
          { domains: ['order'], query: 'orderHistory' },
        ],
        touchGraph: {
          'order.write': {
            touches: [{ domain: 'order', keys: null, site: 'order.ts:1', via: 'orders' }],
            unresolved: [],
          },
        },
        updateCoverage: [
          {
            component: 'CartBadge',
            query: 'cart.discount',
            status: 'UNHANDLED',
          },
          {
            component: 'OrderHistory',
            query: 'orderHistory',
            status: 'fragment',
          },
        ],
      },
      { family: 'all' },
    ).output,
    [
      'fw-check/v1',
      'WARN FW310 cart/add -> cart Invalidated query lacks optimistic transform.',
      'WARN FW311 component=CartBadge query=cart.discount position=undefined Query-dependent DOM position has no update status.',
      'COVERAGE component=OrderHistory query=orderHistory position=undefined status=fragment',
      'WARN UNGUARDED cart/add mutation is reachable without an auth guard.',
      '',
    ].join('\n'),
  );
  const registryFacts = deriveRegistryFactsFromGraph(commerceGraph);
  assert.deepEqual(registryFacts.components, ['cart-badge', 'order-history', 'product-grid']);
  assert.deepEqual(
    registryFacts.domainKeys.toSorted((left, right) => left.localeCompare(right)),
    ['attachment', 'auth', 'cart', 'order', 'product'],
  );
  assert.deepEqual(registryFacts.invalidations, {
    'cart/add': ['cart', 'orderHistory', 'productGrid'],
  });
  assert.deepEqual(registryFacts.routes, ['/admin', '/cart']);
  const cartBadge = compileComponentModule({
    fileName: 'cart-badge.tsx',
    source: `
export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery },
  render: ({ cart }) => <cart-badge><span data-bind="cart.count">{cart.count}</span></cart-badge>,
});
`,
  });
  assert.deepEqual(cartBadge.componentGraphFacts, [
    {
      name: 'CartBadge',
      queries: ['cart'],
    },
  ]);
  assert.deepEqual(
    deriveAppGraph({
      components: [cartBadge],
      graph: { queries: [{ domains: ['cart'], query: 'cart' }] },
    }).registryFacts,
    {
      components: ['cart-badge'],
      domainKeys: ['cart'],
      invalidations: {},
      routes: [],
    },
  );
  assert.deepEqual(
    Object.keys(commerceGraph.touchGraph)
      .filter((key) => ['cart.addItem', 'order.receipt', 'payment.webhook'].includes(key))
      .sort(),
    ['cart.addItem', 'order.receipt', 'payment.webhook'],
  );
});

void test('P10 starter wires graph assertions into CI', async () => {
  const [
    packageJsonSource,
    ciWorkflow,
    starterGraphSource,
    clientSource,
    appSource,
    stylesSource,
    indexHtml,
  ] = await Promise.all([
    readProjectFile('packages/create-jiso/templates/package.json'),
    readProjectFile('packages/create-jiso/templates/.github/workflows/ci.yml'),
    readProjectFile('packages/create-jiso/templates/graph.json'),
    readProjectFile('packages/create-jiso/templates/src/client.ts'),
    readProjectFile('packages/create-jiso/templates/src/app.tsx'),
    readProjectFile('packages/create-jiso/templates/src/styles.css'),
    readProjectFile('packages/create-jiso/templates/index.html'),
  ]);
  const packageJson = JSON.parse(packageJsonSource);
  const viteTasks = (await loadVitePlusConfig('packages/create-jiso/templates/vite.config.ts')).run
    .tasks;
  const ciSteps = parseWorkflowSteps(ciWorkflow);
  const starterGraph = JSON.parse(starterGraphSource);
  const cartQueryExplain = fwExplain(starterGraph, { kind: 'query', target: 'cart' }).output;
  const cartAddExplain = fwExplain(starterGraph, {
    kind: 'mutation',
    optimistic: true,
    target: 'cart/add',
  }).output;
  const cartPageExplain = fwExplain(starterGraph, { kind: 'page', target: '/cart' }).output;

  assert.equal(packageJson.scripts['emit-graph'], 'node scripts/emit-graph.mjs');
  assert.equal(packageJson.scripts['fw-check'], undefined);
  assert.equal(packageJson.scripts['graph-assertions'], undefined);
  assert.deepEqual(Object.keys(packageJson.dependencies).sort(), [
    '@jiso/better-auth',
    '@jiso/core',
    '@jiso/runtime',
    '@jiso/server',
  ]);
  assert.deepEqual(
    [
      '@jiso/compiler',
      '@tailwindcss/vite',
      '@typescript/native-preview',
      'fw',
      'tailwindcss',
      'typescript',
      'vite',
      'vite-plus',
      'vitest',
    ].filter((dependencyName) => dependencyName in packageJson.devDependencies),
    [
      '@jiso/compiler',
      '@tailwindcss/vite',
      '@typescript/native-preview',
      'fw',
      'tailwindcss',
      'typescript',
      'vite',
      'vite-plus',
      'vitest',
    ],
  );

  assert.deepEqual(fwCheck(starterGraph), { exitCode: 0, output: 'fw-check/v1\nOK\n' });
  assert.deepEqual(
    starterGraph.components?.map((component) => component.name),
    ['CartBadge', 'CartPanel'],
  );
  assert.deepEqual(starterGraph.mutations, [
    {
      guards: ['authed'],
      invalidates: ['cart'],
      inputFields: ['productId', 'quantity'],
      key: 'cart/add',
      session: 'starterSession',
      writes: ['cart'],
    },
  ]);
  assert.deepEqual(starterGraph.optimistic, [
    { mutation: 'cart/add', query: 'cart', status: 'await-fragment' },
  ]);
  assert.deepEqual(starterGraph.pages, [
    {
      i18n: ['en-US:cartTitle'],
      meta: {
        description: 'Starter cart backed by query data.',
        title: 'Jiso Starter Cart',
      },
      queries: ['cart'],
      route: '/cart',
      stylesheets: ['/src/styles.css'],
    },
  ]);
  assert.deepEqual(starterGraph.queries, [{ domains: ['cart'], query: 'cart' }]);
  assert.deepEqual(starterGraph.touchGraph?.['cart.addItem']?.touches, [
    { domain: 'cart', keys: null, site: 'src/cart.ts:12', via: 'cart_items' },
  ]);
  assert.equal(
    explainValue(cartQueryExplain, 'consumers: '),
    'component:CartBadge,component:CartPanel,page:/cart',
  );
  assert.equal(explainValue(cartQueryExplain, 'invalidated-by: '), 'cart/add');
  assert.equal(explainValue(cartQueryExplain, 'domain-writes: '), 'cart.addItem');
  assert.equal(explainValue(cartAddExplain, 'session: '), 'starterSession');
  assert.equal(explainValue(cartAddExplain, 'input-fields: '), 'productId,quantity');
  assert.deepEqual(explainUpdateTargets(cartAddExplain), [
    'cart->component:CartBadge,component:CartPanel,page:/cart',
  ]);
  assert.deepEqual(explainLines(cartAddExplain, 'OPTIMISTIC '), ['cart await-fragment']);
  assert.equal(explainSummary(cartAddExplain, 'OPTIMISTIC-SUMMARY ').UNHANDLED, '0');
  assert.equal(
    explainValue(cartPageExplain, 'meta: '),
    'title=Jiso Starter Cart description=Starter cart backed by query data. image=-',
  );
  assert.equal(explainValue(cartPageExplain, 'i18n: '), 'en-US:cartTitle');
  assert.equal(explainValue(cartPageExplain, 'queries: '), 'cart');
  assert.equal(explainValue(cartPageExplain, 'stylesheets: '), '/src/styles.css');

  assert.deepEqual(
    {
      input: viteTasks['fw-check']?.input,
      output: viteTasks['fw-check']?.output,
    },
    {
      input: [
        { pattern: 'scripts/emit-graph.mjs', base: 'workspace' },
        { pattern: 'src/**/*', base: 'workspace' },
      ],
      output: ['graph.json'],
    },
  );
  assert.deepEqual(
    {
      input: viteTasks['graph-assertions']?.input,
      output: viteTasks['graph-assertions']?.output,
    },
    {
      input: [
        { pattern: 'graph.json', base: 'workspace' },
        { pattern: 'scripts/emit-graph.mjs', base: 'workspace' },
        { pattern: 'scripts/graph-assertions.mjs', base: 'workspace' },
        { pattern: 'src/**/*', base: 'workspace' },
      ],
      output: undefined,
    },
  );
  assert.deepEqual(
    ciSteps.filter((step) => step.run).map((step) => step.run),
    [
      'vp install',
      'vp check',
      'vp test',
      'vp run build',
      'vp run fw-check',
      'vp run graph-assertions',
    ],
  );

  const taskOutputs = await Promise.all([
    runTemplateViteTaskCommand(viteTasks['fw-check'].command),
    runTemplateViteTaskCommand(viteTasks['graph-assertions'].command),
  ]);
  assert.deepEqual(
    taskOutputs.map((taskOutput) => taskOutput.output),
    ['emit-graph/v1\nOK\nfw-check/v1\nOK\n', 'emit-graph/v1\nOK\ngraph-assertions/v1\nOK\n'],
  );
  assert.deepEqual(
    taskOutputs.map((taskOutput) => taskOutput.graph),
    [starterGraph, starterGraph],
  );

  const emittedGraph = await runEmitGraphTemplateScript();
  assert.equal(emittedGraph.output, 'emit-graph/v1\nOK\n');
  assert.deepEqual(emittedGraph.graph, starterGraph);
  assert.equal(await runGraphAssertionsTemplateScript(), 'graph-assertions/v1\nOK\n');

  const starterAppCompile = compileComponentModule({
    fileName: 'src/app.tsx',
    source: appSource,
  });
  assert.doesNotThrow(() => assertFixpoint(starterAppCompile));
  assert.doesNotThrow(() => assertRenderEquivalence(starterAppCompile));

  const starterClient = await executeStarterClientTemplate(clientSource);
  assert.equal(starterClient.loaderInstalls.length, 1);
  const loaderOptions = starterClient.loaderInstalls[0];
  assert.equal(typeof loaderOptions.importModule, 'function');
  assert.equal(loaderOptions.root, starterClient.documentRoot);
  assert.equal(loaderOptions.queryStore, starterClient.queryStore);
  assert.equal(loaderOptions.enhancedMutations.store, starterClient.queryStore);
  assert.equal(typeof loaderOptions.enhancedMutations.fetch, 'function');
  assert.equal(typeof loaderOptions.enhancedMutations.queryPlans, 'object');
  const fragmentTarget = loaderOptions.enhancedMutations.root.findFragmentTarget('cart-badge');
  assert.equal(fragmentTarget.readHtml(), '<cart-badge>0</cart-badge>');
  fragmentTarget.replaceWithHtml('<cart-badge>1</cart-badge>');
  assert.equal(fragmentTarget.readHtml(), '<cart-badge>1</cart-badge>');
  loaderOptions.enhancedMutations.root.findFragmentTarget('cart-list').appendHtml('<li>p1</li>');
  assert.deepEqual(starterClient.appendCalls, [['beforeend', '<li>p1</li>']]);
  assert.equal(
    loaderOptions.enhancedMutations.fetch('/_m/cart/add', {
      body: 'productId=p1',
      headers: { Accept: 'text/vnd.jiso.fragment+html' },
      keepalive: true,
      method: 'POST',
    }).ok,
    true,
  );
  assert.equal(starterClient.fetchCalls.length, 1);
  const [[fetchUrl, fetchOptions]] = starterClient.fetchCalls;
  assert.equal(fetchUrl, '/_m/cart/add');
  assert.deepEqual(
    {
      body: fetchOptions.body,
      headers: { ...fetchOptions.headers },
      keepalive: fetchOptions.keepalive,
      method: fetchOptions.method,
    },
    {
      body: 'productId=p1',
      headers: { Accept: 'text/vnd.jiso.fragment+html' },
      keepalive: true,
      method: 'POST',
    },
  );
  assert.equal(
    starterClient.exports.applyJisoDeferredStreamResponse('<fw-fragment></fw-fragment>', {
      boundary: 'starter-boundary',
      morph: 'structural',
    }).applied,
    true,
  );
  assert.equal(starterClient.deferredApplications.length, 1);
  const [deferredApplication] = starterClient.deferredApplications;
  assert.deepEqual(
    {
      body: deferredApplication.body,
      boundary: deferredApplication.boundary,
      morph: deferredApplication.morph,
    },
    {
      body: '<fw-fragment></fw-fragment>',
      boundary: 'starter-boundary',
      morph: 'structural',
    },
  );
  assert.equal(deferredApplication.queryPlans, loaderOptions.enhancedMutations.queryPlans);
  assert.equal(deferredApplication.root, loaderOptions.enhancedMutations.root);
  assert.equal(deferredApplication.store, starterClient.queryStore);

  assert.deepEqual(parseCssSourceDirectives(stylesSource), [
    '"../index.html"',
    '"./**/*.{ts,tsx,html}"',
    'inline("bg-emerald-50 text-emerald-700 border-emerald-200 bg-amber-50 text-amber-700 border-amber-200")',
  ]);
  const htmlElements = parseHtmlElements(indexHtml);
  assert.deepEqual(
    htmlElements.map((element) => element.tagName),
    ['html', 'head', 'meta', 'meta', 'link', 'title', 'body'],
  );
  assert.deepEqual(htmlElements.find((element) => element.tagName === 'html')?.attributes, {
    lang: 'en',
  });
  assert.deepEqual(
    htmlElements
      .filter((element) => element.tagName === 'meta')
      .map((element) => element.attributes),
    [{ charset: 'UTF-8' }, { content: 'width=device-width, initial-scale=1.0', name: 'viewport' }],
  );
  assert.deepEqual(
    htmlElements
      .filter((element) => element.tagName === 'link')
      .map((element) => element.attributes),
    [{ rel: 'stylesheet', href: '/src/styles.css' }],
  );
  assert.deepEqual(
    htmlElements
      .filter((element) => element.tagName === 'script')
      .map((element) => element.attributes),
    [],
  );

  execFileSync('pnpm', ['exec', 'vitest', '--run', 'packages/create-jiso/src/index.test.ts'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, CI: '1' },
    stdio: 'pipe',
  });
});

void test('P9 verification layer evidence remains represented', async () => {
  const createFakeDb = () => {
    const tables = new Map();
    return {
      read(table, options) {
        void options;
        return tables.get(table) ?? [];
      },
      sql() {
        return [];
      },
      write(table, value, options) {
        void options;
        tables.set(table, [...(tables.get(table) ?? []), value]);
      },
    };
  };
  const assertThrowsMessage = (callback, expected) => {
    assert.throws(callback, (error) => error instanceof Error && error.message === expected);
  };
  const assertRejectsMessage = (promise, expected) =>
    assert.rejects(promise, (error) => error instanceof Error && error.message === expected);

  for (const code of ['FW402', 'FW404', 'FW407', 'FW408', 'FW410', 'FW411']) {
    assert.equal(typeof diagnosticDefinitions[code].message, 'string');
  }

  const csrfRequest = { session: { id: 's1' } };
  const csrf = {
    field: 'csrf',
    secret: 'test-secret',
    sessionId(request) {
      return request.session.id;
    },
  };
  let csrfMutationExecutions = 0;
  const csrfMutation = mutation('cart/add', {
    csrf,
    input: s.object({ csrf: s.string(), productId: s.string() }),
    handler(input) {
      csrfMutationExecutions += 1;
      return input.productId;
    },
  });
  const csrfHarness = createJisoTestHarness({
    db: {},
    request: csrfRequest,
  });
  const token = csrfToken(csrfRequest, csrf);
  assert.equal(csrfField(csrfRequest, csrf), `<input type="hidden" name="csrf" value="${token}">`);
  assert.deepEqual(await csrfHarness.exec(csrfMutation, { csrf: token, productId: 'p1' }), {
    changes: [],
    ok: true,
    rerunQueries: [],
    value: 'p1',
  });
  assert.equal(csrfMutationExecutions, 1);
  assert.deepEqual(await csrfHarness.exec(csrfMutation, { csrf: 'wrong', productId: 'p2' }), {
    error: { code: 'CSRF', payload: {} },
    ok: false,
    status: 422,
  });
  assert.equal(csrfMutationExecutions, 1);

  const writeMutation = mutation('cart/add', {
    csrf: false,
    input: s.object({ productId: s.string() }),
    handler(input, request) {
      request.db.write('cart_items', input.productId);
      return input.productId;
    },
  });
  const writeHarness = createJisoTestHarness({
    db: createFakeDb(),
    touchGraph: {
      'cart.add': {
        touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
        unresolved: [],
      },
    },
    verification: { domainByTable: { audit_log: 'audit', cart_items: 'cart' } },
  });
  assert.deepEqual(
    await writeHarness.exec(writeMutation, { productId: 'p1' }, { touchGraphKey: 'cart.add' }),
    {
      changes: [],
      ok: true,
      rerunQueries: [],
      value: 'p1',
    },
  );

  const writeOutsideGraph = mutation('cart/add', {
    csrf: false,
    input: s.object({ productId: s.string() }),
    handler(input, request) {
      request.db.write('audit_log', input.productId);
      return input.productId;
    },
  });
  await assertRejectsMessage(
    writeHarness.exec(writeOutsideGraph, { productId: 'p1' }, { touchGraphKey: 'cart.add' }),
    'FW402 Write touched an undeclared domain: audit',
  );

  const unmappedVerifier = createDbVerifier(
    { write: { touches: [], unresolved: [] } },
    { domainByTable: {} },
  );
  const unmappedDb = unmappedVerifier.wrap(createFakeDb());
  unmappedDb.write('unknown_table', 'p1');
  assertThrowsMessage(
    () => unmappedVerifier.assertCovered('write'),
    'FW404 Write to unmapped table: unknown_table',
  );

  const exemptWriteVerifier = createDbVerifier(
    {},
    { domainByTable: {}, exemptTables: ['audit_log'] },
  );
  const exemptWriteDb = exemptWriteVerifier.wrap(createFakeDb());
  exemptWriteDb.write('audit_log', { event: 'restock' });
  assert.doesNotThrow(() => exemptWriteVerifier.assertCovered());

  const exemptReadVerifier = createDbVerifier(
    {},
    { domainByTable: { cart_items: 'cart' }, exemptTables: ['audit_log'] },
  );
  const exemptReadDb = exemptReadVerifier.wrap(createFakeDb());
  exemptReadDb.read('audit_log');
  assertThrowsMessage(
    () => exemptReadVerifier.assertReadsCovered(['cart']),
    'FW411 Query read set includes an exempt table: audit_log',
  );

  const cart = domain('cart');
  const product = domain('product');
  const queryHarness = createJisoTestHarness({
    db: createFakeDb(),
    touchGraph: {},
    verification: {
      domainByTable: { audit_log: 'audit', cart_items: 'cart', products: 'product' },
    },
  });
  const undeclaredReadQuery = query('cart', {
    load() {
      queryHarness.db.read('products');
      return queryHarness.db.read('cart_items');
    },
    reads: [cart],
  });
  await assertRejectsMessage(
    queryHarness.query(undeclaredReadQuery),
    'FW407 Query read from undeclared domain: product',
  );
  const validOutputQuery = query('cart/count', {
    load() {
      queryHarness.db.read('cart_items');
      return { count: 2 };
    },
    output: s.object({ count: s.number().int().min(0) }),
    reads: [cart],
  });
  assert.deepEqual(await queryHarness.query(validOutputQuery), { count: 2 });
  const invalidOutputQuery = query('product/list', {
    load() {
      queryHarness.db.read('products');
      return { items: [{ id: 7 }] };
    },
    output: s.object({ items: s.array(s.object({ id: s.string() })) }),
    reads: [product],
  });
  await assertRejectsMessage(
    queryHarness.query(invalidOutputQuery),
    'FW410 Query result shape failed declared output schema: product/list Expected string',
  );
  const exemptRawSqlQuery = query('cart/audit', {
    load() {
      exemptRawSqlHarness.db.sql('select * from audit_log');
      return [];
    },
    reads: [cart],
  });
  const exemptRawSqlHarness = createJisoTestHarness({
    db: createFakeDb(),
    touchGraph: {},
    verification: { domainByTable: { cart_items: 'cart' }, exemptTables: ['audit_log'] },
  });
  await assertRejectsMessage(
    exemptRawSqlHarness.query(exemptRawSqlQuery),
    'FW411 Query read set includes an exempt table: audit_log',
  );

  const structuredSqlVerifier = createDbVerifier({}, { domainByTable: { cart_items: 'cart' } });
  const structuredStatementCalls = [];
  const structuredSqlDb = structuredSqlVerifier.wrap({
    exec(statement) {
      structuredStatementCalls.push(statement);
      return [];
    },
    query() {
      return [];
    },
  });
  const structuredStatement = { text: 'select * from cart_items', values: ['c1'] };
  structuredSqlDb.exec(structuredStatement);
  assert.deepEqual(structuredStatementCalls, [structuredStatement]);
  assert.deepEqual(structuredSqlVerifier.observed, [
    {
      branch: undefined,
      domain: 'cart',
      kind: 'read',
      mutationRead: undefined,
      rowKey: undefined,
      sql: 'select * from cart_items',
      table: 'cart_items',
    },
  ]);

  const nestedVerifier = createDbVerifier(
    {
      'product.syncPrice': {
        reads: [
          {
            domain: 'price',
            keys: null,
            site: 'product.ts:2',
            source: 'update-from',
            via: 'prices',
          },
        ],
        touches: [{ domain: 'product', keys: null, site: 'product.ts:1', via: 'products' }],
        unresolved: [],
      },
    },
    { domainByTable: { prices: 'price', products: 'product' } },
  );
  const nestedDb = nestedVerifier.wrap(createFakeDb());
  nestedDb.sql(
    'update products set price = prices.amount from prices where prices.product_id = products.id',
  );
  assert.doesNotThrow(() => nestedVerifier.assertCovered('product.syncPrice'));
  assert.doesNotThrow(() => nestedVerifier.assertReadsCovered(['price']));

  const missingNestedReadVerifier = createDbVerifier(
    {
      'product.syncPrice': {
        touches: [{ domain: 'product', keys: null, site: 'product.ts:1', via: 'products' }],
        unresolved: [],
      },
    },
    { domainByTable: { prices: 'price', products: 'product' } },
  );
  const missingNestedReadDb = missingNestedReadVerifier.wrap(createFakeDb());
  missingNestedReadDb.sql(
    [
      'update products set unit_price = (select max(amount) from prices)',
      'where id in (select product_id from prices)',
    ].join(' '),
  );
  assertThrowsMessage(
    () => missingNestedReadVerifier.assertCovered('product.syncPrice'),
    'FW407 Query read from undeclared domain: price, price',
  );

  const selectSubqueryVerifier = createDbVerifier(
    {},
    { domainByTable: { prices: 'price', products: 'product' } },
  );
  const selectSubqueryDb = selectSubqueryVerifier.wrap(createFakeDb());
  selectSubqueryDb.sql('select * from products where id in (select product_id from prices)');
  assertThrowsMessage(
    () => selectSubqueryVerifier.assertReadsCovered(['product']),
    'FW407 Query read from undeclared domain: price',
  );
  assert.doesNotThrow(() => selectSubqueryVerifier.assertReadsCovered(['product', 'price']));

  const rowKeyVerifier = createDbVerifier(
    {
      'product.reserve': {
        touches: [
          { domain: 'product', keys: 'arg:productId', site: 'product.ts:1', via: 'products' },
        ],
        unresolved: [],
      },
    },
    { domainByTable: { products: 'product' }, keyByTable: { products: 'id' } },
  );
  const rowKeyDb = rowKeyVerifier.wrap(createFakeDb());
  rowKeyDb.sql("update products set reserved = true where sku = 'sku-1'");
  assertThrowsMessage(
    () => rowKeyVerifier.assertCovered('product.reserve'),
    'FW408 Declared row key differs from observed row predicate: products expected id observed sku',
  );

  const compoundRowKeyVerifier = createDbVerifier(
    {
      'product.reserve': {
        touches: [
          { domain: 'product', keys: 'arg:productId', site: 'product.ts:1', via: 'products' },
        ],
        unresolved: [],
      },
    },
    { domainByTable: { products: 'product' }, keyByTable: { products: 'id' } },
  );
  const compoundRowKeyDb = compoundRowKeyVerifier.wrap(createFakeDb());
  compoundRowKeyDb.sql("update products set reserved = true where sku = 'sku-1' and id = 'p1'");
  assert.doesNotThrow(() => compoundRowKeyVerifier.assertCovered('product.reserve'));

  const pgliteHandle = {
    exec() {
      return [];
    },
    query() {
      return [];
    },
    transaction(callback) {
      return callback({
        exec() {
          return [];
        },
        query() {
          return [];
        },
      });
    },
  };
  const pgliteHarness = createJisoTestHarness({
    db: { pglite: pgliteHandle },
    touchGraph: {
      'cart.add': {
        touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
        unresolved: [],
      },
    },
    verification: { domainByTable: { audit_log: 'audit', cart_items: 'cart' } },
  });
  const rawPgliteMutation = mutation('cart/add', {
    csrf: false,
    input: s.object({ productId: s.string() }),
    async handler(input, request) {
      await request.db.pglite.query('insert into audit_log (product_id) values ($1)', [
        input.productId,
      ]);
      return input.productId;
    },
  });
  await assertRejectsMessage(
    pgliteHarness.exec(rawPgliteMutation, { productId: 'p1' }, { touchGraphKey: 'cart.add' }),
    'FW402 Write touched an undeclared domain: audit',
  );
  const transactionMutation = mutation('cart/add-transaction', {
    csrf: false,
    input: s.object({ productId: s.string() }),
    async handler(input, request) {
      await request.db.pglite.transaction(async (tx) => {
        await tx.query('insert into audit_log (product_id) values ($1)', [input.productId]);
      });
      return input.productId;
    },
  });
  await assertRejectsMessage(
    pgliteHarness.exec(transactionMutation, { productId: 'p2' }, { touchGraphKey: 'cart.add' }),
    'FW402 Write touched an undeclared domain: audit',
  );

  assert.equal(
    fwCheck({
      diagnostics: [
        {
          code: 'FW410',
          site: 'cart.queries.ts:5',
        },
        {
          code: 'FW302',
          message: 'data-bind path is not present in the declared query shape. cart.missing',
          site: 'cart-badge.tsx',
          start: { column: 23, line: 3 },
        },
      ],
      verificationDiagnostics: [
        {
          branch: 'stock-reserve',
          code: 'FW405',
          domain: 'product',
          site: 'cart.domain.ts:2',
        },
        {
          code: 'FW402',
          detail: 'observed table audit_log',
          domain: 'audit',
        },
        {
          code: 'FW403',
          domain: 'order',
        },
        {
          code: 'FW404',
          detail: 'observed table unknown_table',
          domain: 'unknown_table',
        },
        {
          code: 'FW407',
          detail: 'observed table products',
          domain: 'product',
          site: 'cart.queries.ts:7',
        },
        {
          code: 'FW408',
          detail: 'expected id observed sku',
          domain: 'product',
          site: 'product.domain.ts:9',
        },
        {
          code: 'FW410',
          detail: 'cart Expected number',
          domain: 'cart',
          site: 'cart.queries.ts:11',
        },
      ],
    }).output,
    [
      'fw-check/v1',
      'ERROR FW410 cart.queries.ts:5 Query result shape failed declared output schema.',
      'ERROR FW302 cart-badge.tsx:3:23 data-bind path is not present in the declared query shape. cart.missing',
      'WARN FW405 cart.domain.ts:2 Conditional write branch was never executed under instrumentation. domain=product branch=stock-reserve',
      'ERROR FW402 domain:audit Write touched an undeclared domain. domain=audit observed table audit_log',
      'WARN FW403 domain:order Declared domain was never observed written. domain=order',
      'ERROR FW404 domain:unknown_table Write to unmapped table. domain=unknown_table observed table unknown_table',
      'ERROR FW407 cart.queries.ts:7 Query read from undeclared domain. domain=product observed table products',
      'ERROR FW408 product.domain.ts:9 Declared row key differs from observed row predicate. domain=product expected id observed sku',
      'ERROR FW410 cart.queries.ts:11 Query result shape failed declared output schema. domain=cart cart Expected number',
      '',
    ].join('\n'),
  );
  assert.equal(
    fwCheck({
      diagnostics: [{ code: 'FW411', site: 'cart.queries.ts:9' }],
    }).output,
    [
      'fw-check/v1',
      'ERROR FW411 cart.queries.ts:9 Query read set includes an exempt table.',
      '',
    ].join('\n'),
  );

  const noFragmentRoot = {
    findFragmentTarget() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const broadcastEvents = [];
  const enhancedStore = createQueryStore();
  const enhancedResult = await submitEnhancedMutation({
    broadcast: {
      close() {},
      publish(body, changes) {
        broadcastEvents.push({ body, changes });
      },
    },
    fetch: async (_url, options) => {
      assert.deepEqual(options.headers, {
        Accept: 'text/vnd.jiso.fragment+html',
        'FW-Fragment': 'true',
        'FW-Idem': 'idem_change_record',
        'FW-Targets': '',
      });
      return {
        headers: {
          get(name) {
            return name === 'FW-Changes'
              ? '[{"domain":"cart","keys":["c1"],"input":"ignored"},{"domain":"bad","keys":[7]},{"keys":["missing-domain"]}]'
              : null;
          },
        },
        async text() {
          return '<fw-query name="cart" key="cart:c1">{"count":2}</fw-query>';
        },
      };
    },
    form: { action: '/_m/cart/add', method: 'post' },
    formData: new FormData(),
    idem: 'idem_change_record',
    root: noFragmentRoot,
    store: enhancedStore,
  });
  assert.deepEqual(enhancedResult.changes, [{ domain: 'cart', keys: ['c1'] }]);
  assert.deepEqual(enhancedResult.queries, ['cart:c1']);
  assert.deepEqual(enhancedStore.get('cart', 'cart:c1'), { count: 2 });
  assert.deepEqual(broadcastEvents, [
    {
      body: '<fw-query name="cart" key="cart:c1">{"count":2}</fw-query>',
      changes: [{ domain: 'cart', keys: ['c1'] }],
    },
  ]);

  const malformedHeaderErrors = [];
  const malformedResult = await submitEnhancedMutation({
    fetch: async () => ({
      headers: {
        get(name) {
          return name === 'FW-Changes' ? '{bad json' : null;
        },
      },
      async text() {
        return '<fw-query name="cart">{"count":3}</fw-query>';
      },
    }),
    form: { action: '/_m/cart/add', method: 'post' },
    formData: new FormData(),
    onError(error) {
      malformedHeaderErrors.push(error);
    },
    root: noFragmentRoot,
    store: createQueryStore(),
  });
  assert.deepEqual(malformedResult.changes, []);
  assert.equal(malformedHeaderErrors.length, 1);
  assert.equal(
    malformedHeaderErrors[0].message.startsWith('Malformed JSON in FW-Changes header:'),
    true,
  );

  const optimisticStore = createQueryStore();
  optimisticStore.set('reviews', { items: [{ id: 'r1' }] }, 'product:p1');
  const rebaser = new OptimisticRebaser(optimisticStore);
  const pendingElement = {
    attributes: { 'fw-deps': 'reviews' },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
  const optimisticResult = await submitOptimisticEnhancedMutation({
    fetch: async (_url, options) => {
      assert.equal(options.headers['FW-Idem'], 'idem_optimistic_change');
      assert.deepEqual(optimisticStore.get('reviews', 'product:p1'), {
        items: [{ id: 'r1' }, { id: 'draft' }],
      });
      assert.equal(pendingElement.getAttribute('fw-pending'), '');
      return {
        headers: {
          get(name) {
            return name === 'FW-Changes' ? '[{"domain":"product","keys":["p1"]}]' : null;
          },
        },
        async text() {
          return '<fw-query name="reviews" key="product:p1">{"items":[{"id":"r1"},{"id":"server"}]}</fw-query>';
        },
      };
    },
    form: { action: '/_m/reviews/add', method: 'post' },
    formData: new FormData(),
    change: { domain: 'product', keys: ['p1'], input: { reviewId: 'draft' } },
    idem: 'idem_optimistic_change',
    input: { reviewId: 'unused' },
    optimistic: {
      keys: { reviews: (change) => `product:${change.keys?.[0]}` },
      transforms: {
        reviews(current, input) {
          return { items: [...current.items, { id: input.reviewId }] };
        },
      },
    },
    pendingRoot: {
      querySelectorAll(selector) {
        return selector === '[fw-deps]' ? [pendingElement] : [];
      },
    },
    rebaser,
    root: noFragmentRoot,
    store: optimisticStore,
  });
  assert.deepEqual(optimisticResult.changes, [{ domain: 'product', keys: ['p1'] }]);
  assert.deepEqual(optimisticResult.queries, ['reviews:product:p1']);
  assert.deepEqual(optimisticStore.get('reviews', 'product:p1'), {
    items: [{ id: 'r1' }, { id: 'server' }],
  });
  assert.equal(pendingElement.getAttribute('fw-pending'), null);
});

void test('P8 component explain includes handler, derive, trigger, and merge facts', async () => {
  const graph = {
    components: [
      {
        attributeMerges: [
          {
            attr: 'aria-expanded',
            decision: 'primitive',
            element: 'button',
            rule: 'primitive-owned',
          },
          {
            attr: 'data-bind:hidden',
            decision: 'diagnostic',
            diagnostics: ['FW233'],
            element: 'button',
            rule: 'single-binding-writer',
          },
        ],
        derives: [
          {
            inputs: ['cart'],
            name: 'CartBadge$isEmpty',
            ref: '/components/cart-badge.js#CartBadge$isEmpty',
            target: 'data-bind:hidden',
          },
        ],
        handlers: [
          {
            captures: ['ctx', 'element-params'],
            event: 'click',
            exportName: 'CartBadge$button_click',
            params: ['itemId'],
            ref: '/components/cart-badge.js#CartBadge$button_click',
          },
        ],
        name: 'CartBadge',
        queries: ['cart'],
        triggers: [
          {
            deps: ['cart'],
            exportName: 'CartBadge$mountChart',
            justification: 'charts are below the fold',
            ref: '/components/cart-badge.js#CartBadge$mountChart',
            trigger: 'visible',
          },
        ],
      },
    ],
    endpoints: [
      {
        auth: 'verifier:stripe-signature',
        csrf: 'exempt',
        csrfJustification: 'stripe-signature',
        method: 'POST',
        name: 'stripe/webhook',
        path: '/webhooks/stripe',
        writes: ['payment'],
      },
      {
        method: 'GET',
        name: 'health',
        path: '/health',
      },
    ],
    mutations: [{ key: 'cart/add', writes: ['cart'] }],
    ownerDomains: [{ domain: 'cart', owner: 'userId' }],
    pages: [{ guards: [], queries: ['cart'], route: '/cart' }],
    queries: [{ domains: ['cart'], guards: [], query: 'cart' }],
    scopeAudits: [
      {
        detail: 'where eq(carts.id, args.cartId)',
        domain: 'cart',
        kind: 'query',
        name: 'cartById',
        scope: 'args',
        site: 'cart.queries.ts:21',
      },
    ],
  };

  assert.equal(
    fwExplain(graph, { kind: 'component', target: 'CartBadge' }).output,
    [
      'fw-explain/v1',
      'COMPONENT CartBadge',
      'queries: cart',
      'fragments: -',
      'HANDLER click export=CartBadge$button_click ref=/components/cart-badge.js#CartBadge$button_click captures=ctx,element-params params=itemId substitution=-',
      'DERIVE CartBadge$isEmpty inputs=cart ref=/components/cart-badge.js#CartBadge$isEmpty target=data-bind:hidden',
      'TRIGGER visible export=CartBadge$mountChart ref=/components/cart-badge.js#CartBadge$mountChart deps=cart justification=charts are below the fold',
      'MERGE button attr=aria-expanded rule=primitive-owned decision=primitive diagnostics=-',
      'MERGE button attr=data-bind:hidden rule=single-binding-writer decision=diagnostic diagnostics=FW233',
      '',
    ].join('\n'),
  );
  assert.equal(
    fwExplain(graph, { endpoints: true }).output,
    [
      'fw-explain/v1',
      'ENDPOINTS',
      'ENDPOINT health method=GET path=/health mount=exact auth=- csrf=checked writes=-',
      'ENDPOINT stripe/webhook method=POST path=/webhooks/stripe mount=exact auth=verifier:stripe-signature csrf=exempt:stripe-signature writes=payment',
      'SUMMARY total=2',
      '',
    ].join('\n'),
  );
  assert.equal(
    fwExplain(graph, { unguarded: true }).output,
    [
      'fw-explain/v1',
      'UNGUARDED',
      'ENDPOINT health method=GET path=/health mount=exact auth=- csrf=checked',
      'MUTATION cart/add guards=- writes=cart invalidates=- manual-invalidates=-',
      'PAGE /cart guards=- queries=cart',
      'QUERY cart guards=- reads=cart',
      'SUMMARY total=4',
      '',
    ].join('\n'),
  );
  assert.equal(
    fwExplain(graph, { unscoped: true }).output,
    [
      'fw-explain/v1',
      'UNSCOPED',
      'UNSCOPED QUERY cartById domain=cart scope=args site=cart.queries.ts:21 where eq(carts.id, args.cartId)',
      'SUMMARY total=1',
      '',
    ].join('\n'),
  );
});

void test('P5 data-bind paths are checked against generated query shape facts', async () => {
  assert.equal(
    diagnosticDefinitions.FW302.message,
    'data-bind path is not present in the declared query shape.',
  );
  assert.equal(
    diagnosticDefinitions.FW227.help,
    [
      'Fixes: write the nullable traversal with ?., extract a named derive that handles null explicitly, or make the projection non-null in the query.',
      'SPEC §4.8 requires empty-on-null semantics to be explicit so the server renderer and loader cannot drift.',
    ].join('\n'),
  );

  const generatedCartShapeFacts = [
    {
      query: 'cart',
      shape: {
        count: 'number',
        empty: 'boolean',
        items: [{ name: 'string', productId: 'string', qty: 'number' }],
      },
      source: 'generated/queries/cart.shape.ts',
    },
  ];
  assert.deepEqual(queryShapesFromFacts(generatedCartShapeFacts), {
    cart: {
      count: 'number',
      empty: 'boolean',
      items: [{ name: 'string', productId: 'string', qty: 'number' }],
    },
  });

  const validCartBindings = compileComponentModule({
    fileName: 'cart-badge.tsx',
    queryShapeFacts: generatedCartShapeFacts,
    source: `
export const CartBadge = component('cart-badge', {
  render: () => (
    <cart-badge>
      <span data-bind="cart.count">2</span>
      <button data-bind:hidden="cart.empty">Checkout</button>
      <ul data-bind-list="cart.items" fw-key="productId">
        <template fw-stamp>
          <li><span data-bind=".qty">0</span> x <span data-bind=".name">Item</span></li>
        </template>
      </ul>
    </cart-badge>
  ),
});
`,
  });
  assert.deepEqual(validCartBindings.diagnostics, []);
  assert.deepEqual(validCartBindings.queryUpdatePlans, [
    {
      componentName: 'CartBadge',
      paths: ['cart.count', 'cart.empty', 'cart.items'],
      query: 'cart',
      templateStamps: [
        {
          itemBindingPlaceholders: [
            {
              path: '.name',
              value: 'Item',
            },
            {
              path: '.qty',
              value: '0',
            },
          ],
          itemBindings: ['.name', '.qty'],
          key: 'productId',
          list: 'cart.items',
          selector: '[data-bind-list="cart.items"]',
          template:
            '<li><span data-bind=".qty">0</span> x <span data-bind=".name">Item</span></li>',
        },
      ],
    },
  ]);

  const staleGeneratedShape = compileComponentModule({
    fileName: 'cart-badge.tsx',
    queryShapeFacts: [
      {
        query: 'cart',
        shape: { itemCount: 'number' },
        source: 'generated/queries/cart.shape.ts',
      },
    ],
    source: `
export const CartBadge = component('cart-badge', {
  render: () => <span data-bind="cart.count">2</span>,
});
`,
  });
  assert.deepEqual(
    staleGeneratedShape.diagnostics.map(({ code, message }) => ({ code, message })),
    [
      {
        code: 'FW302',
        message: 'data-bind path is not present in the declared query shape. cart.count',
      },
    ],
  );

  const invalidListStamp = compileComponentModule({
    fileName: 'cart-badge.tsx',
    queryShapeFacts: generatedCartShapeFacts,
    source: `
export const CartBadge = component('cart-badge', {
  render: () => (
    <ul data-bind-list="cart.items" fw-key="sku">
      <template fw-stamp>
        <li><span data-bind=".missing">0</span></li>
      </template>
    </ul>
  ),
});
`,
  });
  assert.deepEqual(
    invalidListStamp.diagnostics.map(({ code, message }) => ({ code, message })),
    [
      {
        code: 'FW302',
        message: 'data-bind path is not present in the declared query shape. cart.items',
      },
    ],
  );

  const nullableFacts = [
    {
      query: 'product',
      shape: {
        name: 'string',
        review: {
          kind: 'nullable',
          shape: {
            rating: {
              kind: 'nullable',
              shape: 'number',
            },
          },
        },
      },
      source: 'generated/queries/product.shape.ts',
    },
  ];
  assert.deepEqual(queryShapesFromFacts(nullableFacts), {
    product: {
      name: 'string',
      review: {
        kind: 'nullable',
        shape: {
          rating: {
            kind: 'nullable',
            shape: 'number',
          },
        },
      },
    },
  });
  const optionalNullablePath = compileComponentModule({
    fileName: 'product-card.tsx',
    queryShapeFacts: nullableFacts,
    source: `
export const ProductCard = component('product-card', {
  render: () => <span data-bind="product.review?.rating">5</span>,
});
`,
  });
  assert.deepEqual(optionalNullablePath.diagnostics, []);

  const unsafeNullablePath = compileComponentModule({
    fileName: 'product-card.tsx',
    queryShapeFacts: nullableFacts,
    source: `
export const ProductCard = component('product-card', {
  render: () => <span data-bind="product.review.rating">5</span>,
});
`,
  });
  assert.deepEqual(
    unsafeNullablePath.diagnostics.map(({ code, help, message }) => ({ code, help, message })),
    [
      {
        code: 'FW227',
        help: diagnosticDefinitions.FW227.help,
        message:
          'Binding path traverses a nullable segment without ?. product.review.rating (segment: review)',
      },
    ],
  );
});

void test('S1 production build proves the compiler 1:1 emit contract', async () => {
  const projectRoot = fileURLToPath(new URL('..', import.meta.url));
  const prodEmit = await execFileAsync('node', ['scripts/prod-emit-check.mjs'], {
    cwd: projectRoot,
    maxBuffer: 1024 * 1024 * 10,
  });
  assert.equal(prodEmit.stderr, '');
  assert.deepEqual(prodEmit.stdout.trim().split(/\r?\n/), ['prod-emit-check/v1', 'OK']);

  const plugin = jisoVitePlugin();
  let middleware;
  plugin.configureServer?.({
    config: { root: projectRoot },
    middlewares: {
      use(handler) {
        middleware = handler;
      },
    },
  });
  assert.equal(plugin.name, 'jiso');
  assert.equal(typeof middleware, 'function');

  const transformed = plugin.transform(
    `
import { component } from '@jiso/core';

export const ProductCard = component('product-card', {
  render: () => (
    <article>
      <button onClick={() => addToCart(product.id)}>Add</button>
    </article>
  ),
});
`,
    join(projectRoot, 'routes/products/product-card.tsx'),
  );
  assert.ok(transformed);
  assert.equal(transformed.map, null);

  const buttons = parseHtmlElements(executeGeneratedServerRenderSource(transformed.code)).filter(
    (element) => element.tagName === 'button',
  );
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0]?.attributes['data-p-id'], '{product.id}');
  const handlerRef = buttons[0]?.attributes['on:click'] ?? '';
  const handlerUrl = new URL(handlerRef, 'http://jiso.test');
  assert.equal(handlerUrl.pathname, '/c/routes/products/product-card.client.js');
  assert.equal(handlerUrl.searchParams.get('v')?.length, 8);
  assert.equal(isLowerHex(handlerUrl.searchParams.get('v') ?? ''), true);

  const version = handlerUrl.searchParams.get('v') ?? '';
  const headers = new Map();
  let body = '';
  let nextCalls = 0;
  const response = {
    setHeader(name, value) {
      headers.set(name, value);
    },
    end(value) {
      body = value;
    },
  };

  middleware({ url: `${handlerUrl.pathname}?cache=1&v=${version}` }, response, () => {
    nextCalls += 1;
  });

  assert.equal(nextCalls, 0);
  assert.equal(response.statusCode, 200);
  assert.equal(headers.get('Content-Type'), 'text/javascript');
  const cartEvents = [];
  const clientExports = executeGeneratedClientModule(body, {
    addToCart(id) {
      cartEvents.push(id);
      return `added:${id}`;
    },
  });
  const handlerName = handlerUrl.hash.slice(1);
  assert.equal(typeof clientExports[handlerName], 'function');
  assert.equal(clientExports[handlerName]('click', { params: { id: 'p1' } }), 'added:p1');
  assert.deepEqual(cartEvents, ['p1']);

  middleware({ url: `${handlerUrl.pathname}?v=00000000` }, response, () => {
    nextCalls += 1;
  });
  assert.equal(nextCalls, 1);
});

void test('D10 seeded diagnostics gate Vite, static export, and MCP red-green surfaces', async () => {
  const projectRoot = fileURLToPath(new URL('..', import.meta.url));
  const fileName = 'routes/diagnostic-card.tsx';
  const componentId = join(projectRoot, fileName);
  const redSource = `
import { component } from '@jiso/core';

export const DiagnosticCard = component('diagnostic-card', {
  render: () => <button onClick={() => window.alert('x')}>Add</button>,
});
`;
  const greenSource = `
import { component } from '@jiso/core';

export const DiagnosticCard = component('diagnostic-card', {
  render: () => <button>Add</button>,
});
`;
  const lintSource = `
import { component } from '@jiso/core';

export const DiagnosticCard = component('diagnostic-card', {
  render: () => <button onClick={() => { const response = { ok: true }; return response.ok; }}>Check</button>,
});
`;
  const assertRedTransformMessage = (message) => {
    const [summary, diagnosticBlock] = message.split('\n\n');
    const diagnosticLines = diagnosticBlock?.split('\n') ?? [];
    const loweringPrefix = '  help: Would lower to: on:click="';

    assert.equal(summary, 'Jiso Vite transform failed with 1 error diagnostic.');
    assert.equal(
      diagnosticLines[0],
      `FW201 ${fileName}:5:25 ${diagnosticDefinitions.FW201.message}`,
    );
    assert.equal(diagnosticLines[1]?.startsWith(loweringPrefix), true);
    assert.equal(diagnosticLines[1]?.endsWith('"'), true);

    const loweredHref = diagnosticLines[1]?.slice(loweringPrefix.length, -1) ?? '';
    const loweredUrl = new URL(loweredHref, 'http://jiso.test');
    assert.equal(loweredUrl.pathname, '/c/routes/diagnostic-card.client.js');
    assert.equal(loweredUrl.searchParams.get('v')?.length, 8);
    assert.equal(isLowerHex(loweredUrl.searchParams.get('v') ?? ''), true);
    assert.equal(loweredUrl.hash, '#DiagnosticCard$button_click');
    assert.deepEqual(diagnosticLines.slice(2, 6), [
      "  help: Blocked expression: () => window.alert('x')",
      '  help: Element params: -',
      `  help: ${diagnosticDefinitions.FW201.help.split('\n')[0]}`,
      `  help: ${diagnosticDefinitions.FW201.help.split('\n')[1]}`,
    ]);
  };
  const expectedStaticExportError = [
    `Static export refused error diagnostic FW201 at ${fileName}:5:25. ${diagnosticDefinitions.FW201.message}`,
    diagnosticDefinitions.FW201.help,
  ].join('\n');
  const expectedStaticExportCliError = expectedStaticExportError.replaceAll('\n', ' ');

  const plugin = jisoVitePlugin();
  const greenTransform = plugin.transform(greenSource, componentId);
  assert.ok(greenTransform);
  const greenButtons = parseHtmlElements(executeGeneratedServerRenderSource(greenTransform.code))
    .filter((element) => element.tagName === 'button')
    .map((element) => element.attributes);
  assert.deepEqual(greenButtons, [{ 'fw-c': 'diagnostic-card' }]);

  assert.throws(
    () => plugin.transform(redSource, componentId),
    (error) => {
      assertRedTransformMessage(String(error?.message ?? error));
      return true;
    },
  );

  const lintDiagnostics = [];
  const lintPlugin = jisoVitePlugin({
    onDiagnostic: (diagnostic) => lintDiagnostics.push(diagnostic),
  });
  const lintTransform = lintPlugin.transform(lintSource, componentId);
  assert.ok(lintTransform);
  const lintButtons = parseHtmlElements(executeGeneratedServerRenderSource(lintTransform.code))
    .filter((element) => element.tagName === 'button')
    .map((element) => element.attributes);
  assert.equal(lintButtons.length, 1);
  assert.equal(lintButtons[0]?.['fw-c'], 'diagnostic-card');
  assert.equal(lintButtons[0]?.['data-p-ok'], '{response.ok}');
  const lintHandlerUrl = new URL(lintButtons[0]?.['on:click'] ?? '', 'http://jiso.test');
  assert.equal(lintHandlerUrl.pathname, '/c/routes/diagnostic-card.client.js');
  const lintVersion = lintHandlerUrl.searchParams.get('v') ?? '';
  assert.equal(lintVersion.length, 8);
  assert.equal(isLowerHex(lintVersion), true);
  assert.equal(lintHandlerUrl.hash, '#DiagnosticCard$button_click');
  assert.deepEqual(
    lintDiagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      fileName: diagnostic.fileName,
      severity: diagnostic.severity,
    })),
    [{ code: 'FW210', fileName, severity: 'lint' }],
  );

  const buildFixtureRoot = await mkdtemp(join(projectRoot, 'examples/d10-vp-build-'));
  const buildFixtureSourcePath = join(buildFixtureRoot, fileName);
  const buildFixtureEntrypoint = `
import './routes/diagnostic-card';

document.querySelector('#app')!.textContent = 'D10 build green';
`;

  try {
    await mkdir(join(buildFixtureRoot, 'routes'), { recursive: true });
    await writeFile(
      join(buildFixtureRoot, 'package.json'),
      JSON.stringify({ name: 'jiso-d10-vp-build-fixture', private: true, type: 'module' }),
      'utf8',
    );
    await writeFile(
      join(buildFixtureRoot, 'index.html'),
      '<!doctype html><div id="app"></div><script type="module" src="/main.tsx"></script>\n',
      'utf8',
    );
    await writeFile(
      join(buildFixtureRoot, 'vite.config.mjs'),
      `
import { jisoVitePlugin } from ${JSON.stringify(
        pathToFileURL(join(projectRoot, 'dist/compiler/src/index.mjs')).href,
      )};

export default {
  plugins: [Object.assign(jisoVitePlugin(), { enforce: 'pre' })],
  resolve: {
    alias: {
      '@jiso/core': ${JSON.stringify(join(projectRoot, 'dist/core/src/index.mjs'))},
    },
  },
};
`,
      'utf8',
    );
    await writeFile(join(buildFixtureRoot, 'main.tsx'), buildFixtureEntrypoint, 'utf8');
    await writeFile(buildFixtureSourcePath, redSource, 'utf8');

    await assert.rejects(
      execFileAsync(join(projectRoot, 'node_modules/.bin/vp'), ['build'], {
        cwd: buildFixtureRoot,
      }),
      (error) => {
        const output = `${error?.stdout ?? ''}\n${error?.stderr ?? ''}\n${error?.message ?? ''}`;
        const diagnosticStart = output.indexOf('Jiso Vite transform failed');
        assert.notEqual(diagnosticStart, -1, 'build output includes Vite diagnostic block');
        assertRedTransformMessage(output.slice(diagnosticStart).trim());
        return true;
      },
    );

    await writeFile(buildFixtureSourcePath, greenSource, 'utf8');
    await execFileAsync(join(projectRoot, 'node_modules/.bin/vp'), ['build'], {
      cwd: buildFixtureRoot,
    });
    assert.deepEqual(
      (await readdir(join(buildFixtureRoot, 'dist'))).toSorted((left, right) =>
        left.localeCompare(right),
      ),
      ['assets', 'index.html'],
    );
  } finally {
    await rm(buildFixtureRoot, { force: true, recursive: true });
  }

  const outDir = await mkdtemp(join(tmpdir(), 'jiso-d10-export-'));
  const app = createApp({
    routes: [
      serverRoute('/', {
        page: () => '<main data-fw-check-export="api"></main>',
      }),
    ],
  });
  const errorDiagnostic = {
    code: 'FW201',
    fileName,
    help: diagnosticDefinitions.FW201.help,
    message: diagnosticDefinitions.FW201.message,
    start: { column: 25, line: 5 },
  };
  const lintDiagnostic = {
    code: 'FW210',
    fileName,
    message: diagnosticDefinitions.FW210.message,
    start: { column: 25, line: 5 },
  };

  try {
    await assert.rejects(
      exportStaticApp(app, { diagnostics: [errorDiagnostic], outDir }),
      (error) => {
        assert.equal(error?.name, 'StaticExportError');
        assert.equal(error?.code, 'FW201');
        assert.deepEqual(
          error?.diagnostics?.map((diagnostic) => diagnostic.code),
          ['FW201'],
        );
        assert.equal(String(error?.message ?? error), expectedStaticExportError);
        return true;
      },
    );
    await assert.rejects(readFile(join(outDir, 'index.html'), 'utf8'));

    const exported = await exportStaticApp(app, { diagnostics: [lintDiagnostic], outDir });
    assert.equal(exported.artifacts[0]?.path, '/index.html');
    assert.equal(exported.diagnostics.length, 0);
    const exportedHtml = await readFile(join(outDir, 'index.html'), 'utf8');
    assert.equal(exported.artifacts[0]?.body, exportedHtml);
    assertHtmlMainMarker(exportedHtml, 'api', 'static export writes the rendered main marker');
  } finally {
    await rm(outDir, { force: true, recursive: true });
  }

  const cliFixtureRoot = await mkdtemp(join(tmpdir(), 'jiso-d10-fw-export-'));
  const cliRedOutDir = join(cliFixtureRoot, 'red-out');
  const cliGreenOutDir = join(cliFixtureRoot, 'green-out');
  const cliRedModule = join(cliFixtureRoot, 'red-app.mjs');
  const cliGreenModule = join(cliFixtureRoot, 'green-app.mjs');
  const cliAppModuleSource = (diagnostics) => `
import { createApp, route as serverRoute } from ${JSON.stringify(
    pathToFileURL(join(projectRoot, 'dist/server/src/index.mjs')).href,
  )};

export const diagnostics = ${JSON.stringify(diagnostics, null, 2)};

export default createApp({
  routes: [
    serverRoute('/', {
      page: () => '<main data-fw-check-export="cli"></main>',
    }),
  ],
});
`;

  try {
    await writeFile(cliRedModule, cliAppModuleSource([errorDiagnostic]), 'utf8');
    const redExport = await runCliCommand(['export', cliRedModule, '--out', cliRedOutDir]);
    assert.equal(redExport.exitCode, 1);
    assert.equal(redExport.stdout, '');
    assert.deepEqual(parseFwExportOutput(redExport.stderr), {
      errors: [
        {
          code: 'FW201',
          message: expectedStaticExportCliError,
          route: fileName,
        },
      ],
      html: [],
      summary: undefined,
      version: 'fw-export/v1',
    });
    await assert.rejects(readFile(join(cliRedOutDir, 'index.html'), 'utf8'));

    await writeFile(cliGreenModule, cliAppModuleSource([lintDiagnostic]), 'utf8');
    const greenExport = await runCliCommand(['export', cliGreenModule, '--out', cliGreenOutDir]);
    assert.equal(greenExport.exitCode, 0);
    assert.equal(greenExport.stderr, '');
    const greenExportOutput = parseFwExportOutput(greenExport.stdout);
    assert.deepEqual(greenExportOutput.errors, []);
    assert.deepEqual(
      greenExportOutput.html.map(({ path, status }) => ({ path, status })),
      [{ path: '/index.html', status: 200 }],
    );
    assert.equal(greenExportOutput.html[0].bytes > 0, true);
    assert.deepEqual(
      {
        clientModules: greenExportOutput.summary?.clientModules,
        diagnostics: greenExportOutput.summary?.diagnostics,
        html: greenExportOutput.summary?.html,
      },
      { clientModules: '0', diagnostics: '0', html: '1' },
    );
    assert.equal(greenExportOutput.summary?.outDir, JSON.stringify(cliGreenOutDir));
    assertHtmlMainMarker(
      await readFile(join(cliGreenOutDir, 'index.html'), 'utf8'),
      'cli',
      'fw export writes the rendered main marker',
    );
  } finally {
    await rm(cliFixtureRoot, { force: true, recursive: true });
  }

  const redMcp = await handleFwMcpRequest({
    id: 'd10-red',
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      arguments: { fileName, source: redSource },
      name: 'compile_component',
    },
  });
  assert.equal(redMcp.result.version, 'fw-mcp/v1');
  assert.equal(redMcp.result.structuredContent.version, 'compile/v1');
  assert.equal(redMcp.result.structuredContent.ok, false);
  assert.deepEqual(
    redMcp.result.structuredContent.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
    })),
    [
      { code: 'FW210', severity: 'lint' },
      { code: 'FW201', severity: 'error' },
    ],
  );

  const greenMcp = await handleFwMcpRequest({
    id: 'd10-green',
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      arguments: { fileName, source: greenSource },
      name: 'compile_component',
    },
  });
  assert.equal(greenMcp.result.structuredContent.ok, true);
  assert.deepEqual(greenMcp.result.structuredContent.diagnostics, []);

  const mcpStdioChunks = [];
  const mcpStdioRequests = [redSource, greenSource]
    .map((source, index) =>
      JSON.stringify({
        id: `d10-stdio-${index}`,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: { fileName, source },
          name: 'compile_component',
        },
      }),
    )
    .join('\n');
  await runMcpFallbackStdio(
    (async function* mcpInput() {
      yield `${mcpStdioRequests}\n`;
    })(),
    { write: (chunk) => mcpStdioChunks.push(chunk) },
  );
  const [redMcpStdio, greenMcpStdio] = mcpStdioChunks
    .join('')
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));

  assert.equal(redMcpStdio.result.version, 'fw-mcp/v1');
  assert.equal(redMcpStdio.result.structuredContent.version, 'compile/v1');
  assert.equal(redMcpStdio.result.structuredContent.ok, false);
  assert.deepEqual(
    redMcpStdio.result.structuredContent.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
    })),
    [
      { code: 'FW210', severity: 'lint' },
      { code: 'FW201', severity: 'error' },
    ],
  );
  assert.equal(greenMcpStdio.result.version, 'fw-mcp/v1');
  assert.equal(greenMcpStdio.result.structuredContent.version, 'compile/v1');
  assert.equal(greenMcpStdio.result.structuredContent.ok, true);
  assert.deepEqual(greenMcpStdio.result.structuredContent.diagnostics, []);
});

void test('P3 Drizzle query facts include select shapes and instance keys', async () => {
  let drizzle;
  try {
    drizzle = await import('../dist/drizzle/src/index.mjs');
  } catch (error) {
    assert.equal(
      String(error?.stack ?? error).includes('__filename is not defined in ES module scope'),
      true,
      'unexpected Drizzle bundle import failure',
    );
    await execFileAsync(
      'pnpm',
      [
        'exec',
        'vitest',
        '--run',
        'packages/drizzle/src/index.test.ts',
        '-t',
        [
          'extracts query result shapes, read domains, and instance keys from Drizzle selects',
          'reports FW410 for opaque query projections without declared output schemas',
          'omits instance keys when Drizzle query predicates do not target an annotated table key',
          'reports FW411 when a query read set includes an exempt table',
          'omits write-side-only exempt table writes from the touch graph',
          'resolves imported table symbols in project query facts',
        ].join('|'),
      ],
      { cwd: new URL('..', import.meta.url), maxBuffer: 1024 * 1024 * 10 },
    );
    return;
  }

  const {
    diagnosticsForQueryFacts,
    extractQueryFactsFromProject,
    extractQueryFactsFromSource,
    extractTouchGraphFromSource,
  } = drizzle;

  const sourceFacts = extractQueryFactsFromSource([
    {
      fileName: 'cart.queries.ts',
      source: `
        export const cartItems = pgTable("cart_items", {
          cartId: text("cart_id").notNull(),
          productId: text("product_id"),
          qty: integer("qty").notNull(),
        }, jiso({ domain: "cart", key: "cartId" }));
        export const products = pgTable("products", {
          id: text("id").primaryKey(),
          name: text("name").notNull(),
        }, jiso({ domain: "product", key: "id" }));

        export const cartQuery = query("cart", {
          output: s.object({ count: s.number() }),
          async load(input, db) {
            return db.select({
              count: sql<number>\`count(*)\`,
              productId: products.id,
              item: {
                qty: cartItems.qty,
              },
            }).from(cartItems).innerJoin(products, eq(products.id, cartItems.productId)).where(eq(cartItems.cartId, input.cartId));
          },
        });
      `,
    },
  ]);

  assert.deepEqual(sourceFacts, [
    {
      instanceKey: {
        domain: 'cart',
        key: 'arg:cartId',
      },
      query: 'cart',
      reads: ['cart', 'product'],
      shape: {
        count: 'number',
        item: {
          qty: 'number',
        },
        productId: 'string',
      },
      site: 'cart.queries.ts:11',
    },
  ]);

  const opaqueProjectionFacts = extractQueryFactsFromSource([
    {
      fileName: 'cart.queries.ts',
      source: `
        export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "cartId" }));

        export const cartQuery = query("cart", {
          async load(input, db) {
            return db.select({
              count: sql<number>\`count(*)\`,
            }).from(cartItems).where(eq(cartItems.cartId, input.cartId));
          },
        });
      `,
    },
  ]);

  assert.deepEqual(opaqueProjectionFacts, [
    {
      diagnostics: [
        {
          code: 'FW410',
          message:
            'Opaque query projection requires a declared output schema. cart.count uses sql/raw projection without output.',
          severity: 'error',
          site: 'cart.queries.ts:4',
        },
      ],
      instanceKey: {
        domain: 'cart',
        key: 'arg:cartId',
      },
      query: 'cart',
      reads: ['cart'],
      shape: {
        count: 'number',
      },
      site: 'cart.queries.ts:4',
    },
  ]);
  assert.deepEqual(diagnosticsForQueryFacts(opaqueProjectionFacts), [
    {
      code: 'FW410',
      message:
        'Opaque query projection requires a declared output schema. cart.count uses sql/raw projection without output.',
      severity: 'error',
      site: 'cart.queries.ts:4',
    },
  ]);

  const nonKeyPredicateFacts = extractQueryFactsFromSource([
    {
      fileName: 'product.queries.ts',
      source: `
        export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));

        export const productQuery = query("product", {
          load(input, db) {
            return db.select({ sku: products.sku }).from(products).where(eq(products.sku, input.sku));
          },
        });
      `,
    },
  ]);

  assert.deepEqual(nonKeyPredicateFacts, [
    {
      query: 'product',
      reads: ['product'],
      shape: {
        sku: 'string',
      },
      site: 'product.queries.ts:4',
    },
  ]);

  const exemptReadFacts = extractQueryFactsFromSource([
    {
      fileName: 'product.queries.ts',
      source: `
        export const auditLog = pgTable("audit_log", {}, jiso({ exempt: true }));
        export const products = pgTable("products", {}, jiso({ domain: "product", key: "id" }));

        export const productQuery = query("product", {
          async load(_input, db) {
            return db.select({
              message: auditLog.message,
              name: products.name,
            }).from(products).leftJoin(auditLog, eq(auditLog.productId, products.id));
          },
        });
      `,
    },
  ]);

  assert.deepEqual(exemptReadFacts, [
    {
      diagnostics: [
        {
          code: 'FW411',
          message: 'Query read set includes an exempt table. Tables: audit_log.',
          severity: 'error',
          site: 'product.queries.ts:5',
        },
      ],
      query: 'product',
      reads: ['product'],
      shape: {
        message: 'string',
        name: 'string',
      },
      site: 'product.queries.ts:5',
    },
  ]);
  assert.deepEqual(diagnosticsForQueryFacts(exemptReadFacts), [
    {
      code: 'FW411',
      message: 'Query read set includes an exempt table. Tables: audit_log.',
      severity: 'error',
      site: 'product.queries.ts:5',
    },
  ]);

  assert.deepEqual(
    extractTouchGraphFromSource([
      {
        fileName: 'cart.domain.ts',
        source: `
          export const auditLog = pgTable("audit_log", {}, jiso({ exempt: true }));
          export const cartItems = pgTable("cart_items", {}, jiso({ domain: "cart", key: "cartId" }));

          export async function writeAudit(db) {
            await db.insert(auditLog).values({ event: "cart" });
          }

          export async function addItem(db, cartId) {
            await db.insert(cartItems).values({ cartId });
          }
        `,
      },
    ]),
    {
      addItem: {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: 'arg:cartId',
            site: 'cart.domain.ts:9',
            via: 'cart_items',
          },
        ],
        unresolved: [],
      },
    },
  );

  const projectFacts = extractQueryFactsFromProject({
    files: [
      {
        fileName: 'cart.schema.ts',
        source: `
          export const items = pgTable("cart_items", {}, jiso({ domain: "cart", key: "id" }));
        `,
      },
      {
        fileName: 'order.schema.ts',
        source: `
          export const items = pgTable("order_items", {}, jiso({ domain: "order", key: "id" }));
        `,
      },
      {
        fileName: 'cart.queries.ts',
        source: `
          import { items } from "./cart.schema";

          export const cartQuery = query("cart", {
            load(input, db) {
              return db.select({ id: items.id }).from(items).where(eq(items.id, input.id));
            },
          });
        `,
      },
    ],
  });

  assert.deepEqual(projectFacts, [
    {
      instanceKey: {
        domain: 'cart',
        key: 'arg:id',
      },
      query: 'cart',
      reads: ['cart'],
      shape: {
        id: 'string',
      },
      site: 'cart.queries.ts:4',
    },
  ]);
});

void test('P1 fragment targets emit typed registry facts', async () => {
  assert.deepEqual(fragmentTarget('cart-row', { rowId: 'row-1' }), {
    props: { rowId: 'row-1' },
    target: 'cart-row',
  });

  const result = compileComponentModule({
    fileName: 'cart-row.tsx',
    source: `
export const CartRow = component('cart-row', {
  fragmentTarget: true,
  props: { rowId: String },
  render: ({ rowId }) => <tr fw-c="cart-row" data-row={rowId}></tr>,
});
`,
  });
  const registrySource = result.files.find((file) => file.kind === 'registry')?.source ?? '';
  const virtualRegistryFile = join(
    fileURLToPath(new URL('../', import.meta.url)),
    '.fw-check-virtual',
    'generated-registry.ts',
  );
  const virtualConsumerFile = join(
    fileURLToPath(new URL('../', import.meta.url)),
    '.fw-check-virtual',
    'fragment-target-consumer.ts',
  );

  assert.deepEqual(result.componentGraphFacts, [
    {
      fragments: ['cart-row'],
      name: 'CartRow',
    },
  ]);
  await assertTypeScriptProgramHasNoDiagnostics({
    [virtualRegistryFile]: registrySource,
    [virtualConsumerFile]: `
import { fragmentTarget } from '@jiso/core';

const cartRow = fragmentTarget('cart-row', { rowId: 'row-1' });
cartRow.props.rowId.toUpperCase();

// @ts-expect-error generated FragmentTargets require rowId.
fragmentTarget('cart-row', {});

// @ts-expect-error generated FragmentTargets keep rowId typed as string.
fragmentTarget('cart-row', { rowId: 1 });

// @ts-expect-error generated FragmentTargets reject undeclared props.
fragmentTarget('cart-row', { rowId: 'row-1', sku: 'sku-1' });
`,
  });
});

void test('D9 FW235 fails fw-check for app-authored lowered IR component modules', async () => {
  const result = compileComponentModule({
    fileName: 'cart-badge.tsx',
    source: `
export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery },
  render: ({ cart }) => \`<cart-badge fw-deps="cart"><span data-bind="cart.count">\${cart.count}</span></cart-badge>\`,
});
`,
  });
  const diagnostic = result.diagnostics.find((entry) => entry.code === 'FW235');
  assert.ok(diagnostic);

  assert.deepEqual(
    fwCheck({
      diagnostics: [
        {
          code: diagnostic.code,
          message: diagnostic.message,
          site: diagnostic.fileName,
          start: diagnostic.start,
        },
      ],
    }),
    {
      exitCode: 1,
      output:
        'fw-check/v1\nERROR FW235 cart-badge.tsx:4:25 App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR.\n',
    },
  );
});

void test('P4 commerce touch graph is a committed generated artifact', async () => {
  const commerceGraph = JSON.parse(
    await readProjectFile('examples/commerce/src/generated/graph.json'),
  );
  const touchGraphSource = await readProjectFile('examples/commerce/src/generated/touch-graph.ts');
  const generatedTouchGraphModule = await executeTypeScriptModuleSource(touchGraphSource);
  const touchSummary = Object.fromEntries(
    Object.entries(commerceGraph.touchGraph).map(([key, entry]) => [
      key,
      entry.touches.map((touch) => ({
        domain: touch.domain,
        keys: touch.keys,
        predicate: touch.predicate,
        via: touch.via,
      })),
    ]),
  );
  assert.deepEqual(touchSummary, {
    'cart.addItem': [
      { domain: 'cart', keys: null, predicate: undefined, via: 'cart_items' },
      { domain: 'order', keys: null, predicate: undefined, via: 'orders' },
      { domain: 'product', keys: 'arg:productId', predicate: 'eq', via: 'products' },
    ],
    'order.receipt': [
      { domain: 'attachment', keys: 'arg:orderId', predicate: 'eq', via: 'attachments' },
    ],
    'payment.webhook': [
      { domain: 'order', keys: 'arg:data.object.id', predicate: 'eq', via: 'orders' },
    ],
  });
  assert.deepEqual(
    Object.values(commerceGraph.touchGraph).map((entry) => entry.unresolved),
    [[], [], []],
  );
  const generatedSites = Object.values(commerceGraph.touchGraph)
    .flatMap((entry) => entry.touches)
    .map((touch) => touch.site);
  assert.equal(generatedSites.length, 5);
  const generatedSiteFacts = generatedSites.map(parseProjectSite);
  assert.deepEqual(
    [...new Set(generatedSiteFacts.map((site) => site.path))],
    ['examples/commerce/src/app.ts'],
  );
  assert.equal(
    generatedSiteFacts.every((site) => site.line > 0),
    true,
    'touch graph sites carry source line facts',
  );
  // SPEC §11.1/§11.2: the committed static graph must stay source-derived
  // because runtime verification checks observed effects against these facts.
  assert.deepEqual(
    jsonClone(generatedTouchGraphModule.commerceTouchGraph),
    commerceGraph.touchGraph,
  );
  assert.deepEqual(jsonClone(generatedTouchGraphModule.commerceInvalidationSets), {
    'cart/add': [
      { domains: ['cart'], keys: null, query: 'cart' },
      { domains: ['order'], keys: null, query: 'orderHistory' },
      { domains: ['product'], keys: null, query: 'productGrid' },
    ],
  });
});

void test('Conformance suites are an explicit gate', async () => {
  const conformanceEntries = (
    await readdir(new URL('../conformance/', import.meta.url), { withFileTypes: true })
  )
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  const conformancePackages = await Promise.all(
    conformanceEntries.map(async (entry) => ({
      directory: entry.name,
      manifest: JSON.parse(await readProjectFile(`conformance/${entry.name}/package.json`)),
    })),
  );
  const conformanceManifestsByName = new Map(
    conformancePackages.map(({ manifest }) => [manifest.name, manifest]),
  );
  const expectedConformancePackages = {
    'app-shell-spike': '@jiso/conformance-app-shell-spike',
    'auth-spike': '@jiso/conformance-auth-spike',
    'better-auth-pin': '@jiso/conformance-better-auth-pin',
    'drizzle-pin': '@jiso/conformance-drizzle-pin',
    'webhook-spike': '@jiso/conformance-webhook-spike',
  };

  assert.deepEqual(
    conformancePackages.map(({ directory, manifest }) => [directory, manifest.name]),
    Object.entries(expectedConformancePackages),
    'conformance gate covers the expected suite families',
  );
  for (const { directory, manifest } of conformancePackages) {
    assert.ok(manifest.scripts?.test, `${directory} exposes an executable test script`);
  }
  const packageJson = JSON.parse(await readProjectFile('package.json'));
  const viteTasks = (await loadVitePlusConfig()).run.tasks;
  const conformanceTaskName = parseRequiredVpTask('test:conformance', packageJson);
  const conformanceTask = viteTasks[conformanceTaskName];
  assert.ok(conformanceTask, `${conformanceTaskName} task is defined`);
  const conformanceTaskCommands = parsePnpmFilterTestCommands(conformanceTask.command);
  assert.equal(
    conformanceTaskCommands.every((entry) => entry.script === 'test'),
    true,
    'conformance task runs package tests through pnpm filters',
  );
  assert.equal(
    parsePnpmRunScripts(packageJson.scripts.acceptance).includes('test:conformance'),
    true,
  );
  assert.deepEqual(
    conformanceTaskCommands
      .map((entry) => entry.packageName)
      .toSorted((left, right) => left.localeCompare(right)),
    [...conformanceManifestsByName.keys()].toSorted((left, right) => left.localeCompare(right)),
  );
  assert.deepEqual(conformanceTask.input, [
    { auto: true },
    { pattern: 'conformance/**/package.json', base: 'workspace' },
    { pattern: 'conformance/**/src/**/*.ts', base: 'workspace' },
    { pattern: 'conformance/**/docs/**', base: 'workspace' },
    { pattern: 'packages/core/src/**/*.ts', base: 'workspace' },
    { pattern: 'packages/server/src/**/*.ts', base: 'workspace' },
    { pattern: 'packages/drizzle/src/**/*.ts', base: 'workspace' },
    { pattern: 'packages/better-auth/src/**/*.ts', base: 'workspace' },
  ]);
  const executedTask = await runPnpmFilterTaskCommand(conformanceTask.command, conformancePackages);
  assert.deepEqual(
    executedTask.observed.map((entry) => entry.script),
    ['test', 'test', 'test', 'test', 'test'],
  );
  assert.deepEqual(
    executedTask.output.trimEnd().split('\n'),
    conformanceTaskCommands.map((entry) => `pnpm-filter-test ${entry.packageName}`),
  );

  const missingPackageCommand = conformanceTask.command.split(' && ').slice(0, -1).join(' && ');
  await assert.rejects(
    runPnpmFilterTaskCommand(missingPackageCommand, conformancePackages),
    /conformance task executes every discovered conformance package test/,
  );

  await execFileAsync('pnpm', ['exec', 'vitest', '--run', 'packages/drizzle/src/index.test.ts'], {
    cwd: new URL('..', import.meta.url),
    maxBuffer: 1024 * 1024 * 10,
  });
});

void test('D3 deferred stream responses are consumed by the runtime', async () => {
  const compiled = compileComponentModule({
    fileName: 'cart-badge.tsx',
    source: `
export const CartBadge$isEmpty = derive(['cart'], (cart) => cart.count === 0);

export const CartBadge = component('cart-badge', {
  queries: { cart: {} },
  render: () => (
    <cart-badge>
      <span data-bind="cart.count">0</span>
      <button data-bind:hidden="cart.empty">Checkout</button>
      <output data-derive="cart.CartBadge$isEmpty">false</output>
      <button disabled={cart.count === 0}>Disabled</button>
      <ul data-bind-list="cart.items" fw-key="productId">
        <template fw-stamp>
          <li><span data-bind=".qty">0</span> x <span data-bind=".name">Item</span></li>
        </template>
      </ul>
    </cart-badge>
  ),
});
`,
  });

  assert.deepEqual(compiled.diagnostics, []);
  assert.deepEqual(compiled.queryUpdatePlans, [
    {
      componentName: 'CartBadge',
      derives: [
        {
          exportName: 'CartBadge$isEmpty',
          expression: 'cart.count === 0',
          input: 'cart',
          name: 'CartBadge$isEmpty',
          param: 'cart',
          selector: '[data-derive="cart.CartBadge$isEmpty"]',
        },
      ],
      paths: ['cart.count', 'cart.empty', 'cart.items'],
      query: 'cart',
      stamps: [
        {
          attr: 'disabled',
          derive: {
            exportName: 'CartBadge$button_disabled_derive',
            expression: 'cart.count === 0',
            input: 'cart',
            name: 'CartBadge$button_disabled_derive',
            param: 'cart',
            selector: '[data-derive="cart.CartBadge$button_disabled_derive"]',
          },
          selector: '[data-derive="cart.CartBadge$button_disabled_derive"]',
        },
      ],
      templateStamps: [
        {
          itemBindingPlaceholders: [
            {
              path: '.name',
              value: 'Item',
            },
            {
              path: '.qty',
              value: '0',
            },
          ],
          itemBindings: ['.name', '.qty'],
          key: 'productId',
          list: 'cart.items',
          selector: '[data-bind-list="cart.items"]',
          template:
            '<li><span data-bind=".qty">0</span> x <span data-bind=".name">Item</span></li>',
        },
      ],
    },
  ]);

  const clientExports = executeGeneratedClientModule(compiled.files[1]?.source ?? '');
  const countBinding = new GateQueryElement({ 'data-bind': 'cart.count' }, { textContent: '0' });
  const emptyButton = new GateQueryElement({
    'data-bind:hidden': 'cart.empty',
    hidden: 'true',
  });
  const namedDerive = new GateQueryElement(
    { 'data-derive': 'cart.CartBadge$isEmpty' },
    { textContent: 'true' },
  );
  const disabledStamp = new GateQueryElement({
    'data-derive': 'cart.CartBadge$button_disabled_derive',
    disabled: 'true',
  });
  const itemStamp = new GateTemplateStampHost({ 'data-bind-list': 'cart.items' });
  const compiledRoot = new GateMorphRoot();
  compiledRoot.bindings.push(countBinding);
  compiledRoot.elements.push(emptyButton, namedDerive, disabledStamp, itemStamp);

  assert.deepEqual(
    clientExports.CartBadge$queryUpdatePlans.cart(compiledRoot, {
      count: 2,
      empty: false,
      items: [
        { name: 'Coffee', productId: 'p1', qty: 1 },
        { name: 'Tea', productId: 'p2', qty: 3 },
      ],
    }),
    {
      bindings: ['cart.count', 'cart.empty'],
      derives: ['CartBadge$isEmpty'],
      stamps: ['disabled'],
      templateStamps: ['[data-bind-list="cart.items"]'],
    },
  );
  assert.equal(countBinding.textContent, '2');
  assert.equal(emptyButton.getAttribute('hidden'), 'false');
  assert.equal(namedDerive.textContent, 'false');
  assert.equal(disabledStamp.getAttribute('disabled'), 'false');
  assert.deepEqual(
    itemStamp.items.map(({ html, key }) => ({ html, key })),
    [
      {
        html: '<li><span data-bind=".qty">1</span> x <span data-bind=".name">Coffee</span></li>',
        key: 'p1',
      },
      {
        html: '<li><span data-bind=".qty">3</span> x <span data-bind=".name">Tea</span></li>',
        key: 'p2',
      },
    ],
  );

  const order = [];
  const orderedRoot = new GateMorphRoot();
  const orderedBinding = new GateQueryElement(
    { 'data-bind': 'cart.count' },
    { textContent: 'stale' },
  );
  const orderedDerive = new GateQueryElement(
    { 'data-derive': 'cart.summary' },
    { textContent: 'stale' },
  );
  const orderedStamp = new GateQueryElement({ 'data-derive': 'cart.disabled' });
  orderedRoot.bindings.push(orderedBinding);
  orderedRoot.elements.push(orderedDerive, orderedStamp);
  applyCompiledQueryUpdatePlan(
    orderedRoot,
    'cart',
    { count: 6, disabled: true, items: [1] },
    {
      derives: [
        {
          name: 'summary',
          select(value) {
            order.push(`derive-after-binding:${orderedBinding.textContent}`);
            return `items:${value.items.length}`;
          },
          selector: '[data-derive="cart.summary"]',
        },
      ],
      stamps: [
        {
          attr: 'disabled',
          select(value) {
            order.push(`stamp-after-derive:${orderedDerive.textContent}`);
            return value.disabled;
          },
          selector: '[data-derive="cart.disabled"]',
        },
      ],
    },
  );
  assert.deepEqual(order, ['derive-after-binding:6', 'stamp-after-derive:items:1']);
  assert.equal(orderedStamp.getAttribute('disabled'), 'true');

  const bootstrap = emitQueryPlanBootstrapModule([
    {
      exportName: 'CartBadge$queryUpdatePlans',
      importPath: '../components/cart-badge.client.js',
    },
  ]);
  const bootstrapRoot = new GateMorphRoot();
  bootstrapRoot.targets.set('cart-badge', new GateMorphTarget());
  bootstrapRoot.bindings.push(
    new GateQueryElement({ 'data-bind': 'cart.count' }, { textContent: '0' }),
  );
  const bootstrapRuntime = executeGeneratedBootstrapModule(bootstrap.source, {
    '../components/cart-badge.client.js': {
      CartBadge$queryUpdatePlans: clientExports.CartBadge$queryUpdatePlans,
    },
  });
  assert.equal(bootstrapRuntime.calls.length, 1);
  assert.equal(bootstrapRuntime.calls[0].queryStore, bootstrapRuntime.store);
  assert.equal(
    bootstrapRuntime.calls[0].enhancedMutations.queryPlans.cart,
    clientExports.CartBadge$queryUpdatePlans.cart,
  );
  assert.equal(bootstrapRuntime.calls[0].enhancedMutations.store, bootstrapRuntime.store);
  const deferredApplyResult = bootstrapRuntime.deferredApplications.length;
  assert.equal(deferredApplyResult, 0);
  const bootstrapApplyRuntime = executeGeneratedBootstrapModule(bootstrap.source, {
    '../components/cart-badge.client.js': {
      CartBadge$queryUpdatePlans: clientExports.CartBadge$queryUpdatePlans,
    },
  });
  const applyResult = bootstrapApplyRuntime.exports.applyJisoDeferredStreamResponse(
    [
      '<!doctype html><main><fw-defer target="cart-badge"></fw-defer></main>',
      '--jiso-boundary',
      '<fw-query name="cart">{"count":9,"empty":false,"items":[]}</fw-query>',
      '<fw-fragment target="cart-badge"><cart-badge><span data-bind="cart.count">9</span></cart-badge></fw-fragment>',
      '--jiso-boundary--',
    ].join('\n'),
    { root: bootstrapRoot },
  );
  assert.equal(applyResult.appliedFragments[0], 'cart-badge');
  assert.equal(bootstrapRoot.bindings[0].textContent, '9');
  assert.equal(
    bootstrapRoot.targets.get('cart-badge').html,
    '<cart-badge><span data-bind="cart.count">9</span></cart-badge>',
  );

  assert.deepEqual(
    renderPageHints({
      bootstrapScript: '/c/generated/app.client.js',
      modulepreloads: ['/c/cart.client.js', '/c/generated/app.client.js'],
    }),
    {
      earlyHints: {
        Link: '</c/cart.client.js>; rel=modulepreload, </c/generated/app.client.js>; rel=modulepreload',
      },
      html: [
        '<link rel="modulepreload" href="/c/cart.client.js">',
        '<link rel="modulepreload" href="/c/generated/app.client.js">',
        '<script type="module" src="/c/generated/app.client.js"></script>',
      ].join(''),
    },
  );

  const serverStream = renderDeferredStream({
    boundary: 'gate-boundary',
    chunks: [
      {
        fragments: [
          { html: '<article>A</article>', mode: 'append', target: 'reviews' },
          { html: '<section>Replace</section>', priority: 'high', target: 'summary' },
        ],
        queries: [{ name: 'reviews', value: { items: ['A'] } }],
      },
      {
        fragments: [{ html: '<article>B</article>', mode: 'append', target: 'reviews' }],
        priority: 'high',
        queries: [{ name: 'reviews', value: { items: ['A', 'B'] } }],
      },
    ],
    closeHtml: '',
    shell: '<!doctype html><main><fw-defer target="reviews"></fw-defer></main>',
  });
  const serverRoot = new GateMorphRoot();
  serverRoot.targets.set('reviews', new GateMorphTarget('<article>Initial</article>'));
  serverRoot.targets.set('summary', new GateMorphTarget('<section>Old</section>'));
  const serverStore = createQueryStore();
  const serverApplied = applyDeferredStreamResponseToDom({
    body: serverStream.body,
    boundary: 'gate-boundary',
    root: serverRoot,
    store: serverStore,
  });
  assert.deepEqual(
    serverApplied.chunks.map((chunk) => chunk.queries),
    [['reviews'], ['reviews']],
  );
  assert.deepEqual(
    serverApplied.chunks.map((chunk) => chunk.fragments),
    [
      [{ html: '<article>B</article>', mode: 'append', target: 'reviews' }],
      [
        { html: '<section>Replace</section>', target: 'summary' },
        { html: '<article>A</article>', mode: 'append', target: 'reviews' },
      ],
    ],
  );
  assert.deepEqual(serverApplied.appliedFragments, ['reviews', 'summary', 'reviews']);
  assert.deepEqual(serverStore.get('reviews'), { items: ['A'] });
  assert.equal(
    serverRoot.targets.get('reviews').html,
    '<article>Initial</article><article>B</article><article>A</article>',
  );
  assert.equal(serverRoot.targets.get('summary').html, '<section>Replace</section>');

  const fixtureBody = parseWireResponses(await readWireFixture('defer-stream.http'))[0].body;
  const fixtureRoot = new GateMorphRoot();
  fixtureRoot.targets.set('reviews:p1', new GateMorphTarget());
  fixtureRoot.targets.set('recommendations:p1', new GateMorphTarget());
  const fixtureStore = createQueryStore();
  const fixtureApplied = applyDeferredStreamResponseToDom({
    body: fixtureBody,
    queryPlans: {
      reviews(root, value) {
        return applyCompiledQueryUpdatePlan(root, 'reviews', value, { bindings: true });
      },
      recommendations(root, value) {
        return applyCompiledQueryUpdatePlan(root, 'recommendations', value, { bindings: true });
      },
    },
    root: fixtureRoot,
    store: fixtureStore,
  });
  assert.equal(fixtureApplied.chunks.length, 1);
  const reviewsTargetBlocks = parseHtmlElementBlocks(
    fixtureRoot.targets.get('reviews:p1').html,
    'article',
  );
  assert.deepEqual(
    fixtureApplied.chunks[0].fragments.map((fragment) => fragment.target),
    ['reviews:p1', 'recommendations:p1'],
  );
  assert.deepEqual(fixtureApplied.queries, ['reviews:product:p1', 'recommendations:product:p1']);
  assert.deepEqual(fixtureApplied.appliedFragments, ['reviews:p1', 'recommendations:p1']);
  assert.deepEqual(fixtureStore.get('reviews', 'product:p1'), {
    items: [{ id: 'r1', rating: 5 }],
  });
  assert.deepEqual(fixtureStore.get('recommendations', 'product:p1'), {
    items: [{ id: 'rec-1' }],
  });
  assert.deepEqual(
    parseHtmlElements(fixtureRoot.targets.get('reviews:p1').html)
      .filter((element) => element.tagName === 'link')
      .map((element) => element.attributes),
    [{ rel: 'stylesheet', href: '/assets/reviews.css' }],
  );
  assert.deepEqual(reviewsTargetBlocks, [
    { attributes: { 'fw-key': 'r1' }, innerHTML: '5', tagName: 'article' },
  ]);
});

void test('P1 minifier name preservation evidence remains represented', async () => {
  const cartBadge = compileComponentModule({
    fileName: 'components/cart/cart-badge.tsx',
    source: `
import { component } from '@jiso/core';

function removeItem() {}

export const CartBadge = component('cart-badge', {
  render: () => (
    <div>
      <button onClick={removeItem}>Remove</button>
      <button onClick={() => state.count += params.quantity}>Add</button>
      <button onClick={() => state.count = state.count - params.quantity}>Subtract</button>
    </div>
  ),
});
`,
  });
  const cartDrawer = compileComponentModule({
    fileName: 'components/cart/cart-drawer.tsx',
    source: `
import { component } from '@jiso/core';

function removeItem() {}

export const CartDrawer = component('cart-drawer', {
  render: () => <button onClick={removeItem}>Remove</button>,
});
`,
  });
  const cartBadgeClientFile = cartBadge.files.find((file) => file.kind === 'client');
  assert.ok(cartBadgeClientFile, 'compiled output includes the cart badge client module');

  assert.deepEqual(cartBadge.handlerExports, [
    'CartBadge$removeItem',
    'CartBadge$button_click',
    'CartBadge$button_click_2',
  ]);
  const removeItemCalls = [];
  const cartBadgeClient = executeGeneratedClientModule(cartBadgeClientFile.source, {
    removeItem(event, ctx) {
      removeItemCalls.push({ ctx, event });
      return 'removed';
    },
  });
  assert.equal(typeof cartBadgeClient.CartBadge$removeItem, 'function');
  assert.equal(typeof cartBadgeClient.CartBadge$button_click, 'function');
  assert.equal(typeof cartBadgeClient.CartBadge$button_click_2, 'function');
  const clickContext = { params: { quantity: 2 }, state: { count: 5 } };
  assert.equal(cartBadgeClient.CartBadge$removeItem('click', clickContext), 'removed');
  assert.deepEqual(removeItemCalls, [{ ctx: clickContext, event: 'click' }]);
  assert.equal(cartBadgeClient.CartBadge$button_click('click', clickContext), 7);
  assert.equal(clickContext.state.count, 7);
  assert.equal(cartBadgeClient.CartBadge$button_click_2('click', clickContext), 5);
  assert.equal(clickContext.state.count, 5);
  assert.deepEqual(collectMinifierReservedNames([cartDrawer, cartBadge, cartBadge]), [
    'CartBadge$button_click',
    'CartBadge$button_click_2',
    'CartBadge$removeItem',
    'CartDrawer$removeItem',
  ]);
});

void test('P1 typed data param coercion remains represented', async () => {
  const result = compileComponentModule({
    fileName: 'components/cart/cart-actions.tsx',
    source: `
import { component } from '@jiso/core';

export const CartActions = component('cart-actions', {
  render: () => (
    <div>
      <button onClick={() => state.count += item.quantity}>Add</button>
      <button onClick={() => item.selected ? select(item.id) : deselect(item.id)}>Select</button>
    </div>
  ),
});
`,
  });
  const serverFile = result.files.find((file) => file.kind === 'server');
  const clientFile = result.files.find((file) => file.kind === 'client');
  assert.ok(serverFile, 'compiled output includes server render source');
  assert.ok(clientFile, 'compiled output includes client handler source');

  const buttons = parseHtmlElements(executeGeneratedServerRenderSource(serverFile.source)).filter(
    (element) => element.tagName === 'button',
  );
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0]?.attributes['fw-param-types'], 'quantity:number');
  assert.equal(buttons[0]?.attributes['data-p-quantity'], '{item.quantity}');
  assert.equal(buttons[1]?.attributes['fw-param-types'], 'selected:boolean');
  assert.equal(buttons[1]?.attributes['data-p-selected'], '{item.selected}');
  assert.equal(buttons[1]?.attributes['data-p-id'], '{item.id}');

  const cartActions = executeGeneratedClientModule(clientFile.source, {
    deselect: (id) => `deselect:${id}`,
    select: (id) => `select:${id}`,
  });
  const addParams = readElementParams({
    attributes: [{ name: 'data-p-quantity', value: '2' }],
    getAttribute: (name) =>
      name === 'fw-param-types' ? buttons[0]?.attributes['fw-param-types'] : null,
  });
  const selectParams = readElementParams({
    attributes: [
      { name: 'data-p-selected', value: 'true' },
      { name: 'data-p-id', value: 'p1' },
    ],
    getAttribute: (name) =>
      name === 'fw-param-types' ? buttons[1]?.attributes['fw-param-types'] : null,
  });
  const deselectParams = readElementParams({
    attributes: [
      { name: 'data-p-selected', value: 'false' },
      { name: 'data-p-id', value: 'p2' },
    ],
    getAttribute: (name) =>
      name === 'fw-param-types' ? buttons[1]?.attributes['fw-param-types'] : null,
  });
  const cartState = { count: 1 };
  assert.equal(
    cartActions.CartActions$button_click('click', { params: addParams, state: cartState }),
    3,
  );
  assert.equal(cartState.count, 3);
  assert.equal(
    cartActions.CartActions$button_click_2('click', { params: selectParams, state: cartState }),
    'select:p1',
  );
  assert.equal(
    cartActions.CartActions$button_click_2('click', { params: deselectParams, state: cartState }),
    'deselect:p2',
  );
  assert.deepEqual(
    readElementParams({
      attributes: [
        { name: 'data-p-product-id', value: 'p1' },
        { name: 'data-p-quantity', value: '2' },
        { name: 'data-p-featured', value: 'false' },
      ],
      getAttribute: (name) =>
        name === 'fw-param-types' ? 'quantity:number featured:boolean' : null,
    }),
    {
      featured: false,
      productId: 'p1',
      quantity: 2,
    },
  );
});

void test('P1 render-equivalence gate remains represented', async () => {
  const result = compileComponentModule({
    fileName: 'components/cart/cart-total.tsx',
    source: `
import { component } from '@jiso/core';

export const CartTotal = component('cart-total', {
  render: () => <cart-total><span data-bind="cart.total">{cart.total}</span></cart-total>,
});
`,
  });
  const serverFile = result.files.find((file) => file.kind === 'server');
  assert.ok(serverFile, 'compiled output includes server render source');
  const renderedElements = parseHtmlElements(executeGeneratedServerRenderSource(serverFile.source));
  const cartTotal = renderedElements.find((element) => element.tagName === 'cart-total');
  const boundSpan = renderedElements.find((element) => element.tagName === 'span');

  assert.equal(result.renderEquivalenceChecks.length, 1);
  assert.equal(result.renderEquivalenceChecks[0]?.artifact, 'components/cart/cart-total.server.js');
  assert.equal(result.renderEquivalenceChecks[0]?.ok, true);
  assert.deepEqual(cartTotal?.attributes, {});
  assert.deepEqual(boundSpan?.attributes, { 'data-bind': 'cart.total' });
  assert.equal(
    result.renderEquivalenceChecks[0]?.actual,
    result.renderEquivalenceChecks[0]?.expected,
  );
  assert.doesNotThrow(() => assertRenderEquivalence(result));
  assert.throws(
    () =>
      assertRenderEquivalence({
        ...result,
        renderEquivalenceChecks: [
          {
            actual: '<cart-total>0</cart-total>',
            artifact: 'components/cart/cart-total.server.js',
            expected: '<cart-total>1</cart-total>',
            ok: false,
          },
        ],
      }),
    /Render equivalence failed for components\/cart\/cart-total\.server\.js/,
  );
  assert.equal(
    fwCheck({
      renderEquivalenceChecks: [
        {
          actual: 'sha256:lowered',
          artifact: 'components/z.server.js',
          detail: 'render(src) differed from render(compile(src)).',
          expected: 'sha256:authored',
          ok: false,
        },
        {
          artifact: 'components/ok.server.js',
          ok: true,
        },
        {
          artifact: 'components/a.server.js',
          ok: false,
        },
      ],
    }).output,
    [
      'fw-check/v1',
      'ERROR RENDER_EQUIV components/a.server.js Authored and lowered render output must match byte-for-byte.',
      'ERROR RENDER_EQUIV components/z.server.js render(src) differed from render(compile(src)). expected="sha256:authored" actual="sha256:lowered"',
      '',
    ].join('\n'),
  );
});

void test('framework-owned browser suite is wired into acceptance', async () => {
  const packageJson = JSON.parse(await readProjectFile('package.json'));
  const ciWorkflow = await readProjectFile('.github/workflows/ci.yml');
  const acceptanceScripts = parsePnpmRunScripts(packageJson.scripts.acceptance);
  const ciTaskNames = parseWorkflowSteps(ciWorkflow)
    .map((step) => parseVpRunCommand(step.run ?? ''))
    .filter(Boolean);
  const tasks = (await loadVitePlusConfig()).run.tasks;
  const browserTaskName = parseRequiredVpTask('test:browser', packageJson);
  const browserTask = tasks[browserTaskName];
  assert.ok(browserTask, `${browserTaskName} task is defined`);
  const { configPath } = parseVitestTaskCommand(browserTask.command);
  const browserAcceptanceInput = browserTask.input.find((entry) =>
    entry.pattern?.endsWith('/browser-acceptance.mjs'),
  );
  assert.ok(browserAcceptanceInput, `${browserTaskName} task watches browser acceptance metadata`);
  const { browserSuiteAcceptance } = await import(
    new URL(`../${browserAcceptanceInput.pattern}`, import.meta.url).href
  );

  assert.equal(acceptanceScripts.includes('test:browser'), true);
  assert.equal(ciTaskNames.includes(browserTaskName), true);
  assert.deepEqual(browserTask.input, [
    { auto: true },
    { base: 'workspace', pattern: configPath },
    { base: 'workspace', pattern: browserAcceptanceInput.pattern },
    { base: 'workspace', pattern: browserSuiteAcceptance.include[0] },
  ]);
  assert.deepEqual(browserSuiteAcceptance, {
    browser: 'chromium',
    headless: true,
    include: ['packages/runtime/src/**/*.browser.test.ts'],
    providerPackage: '@vitest/browser-playwright',
  });
});

void test('P10 perf acceptance is wired through Playwright and CDP', async () => {
  const packageJson = JSON.parse(await readProjectFile('package.json'));
  const ciWorkflow = await readProjectFile('.github/workflows/ci.yml');
  const acceptanceScripts = parsePnpmRunScripts(packageJson.scripts.acceptance);
  const ciTaskNames = parseWorkflowSteps(ciWorkflow)
    .map((step) => parseVpRunCommand(step.run ?? ''))
    .filter(Boolean);
  const tasks = (await loadVitePlusConfig()).run.tasks;
  const perfTaskName = parseRequiredVpTask('test:p10-perf', packageJson);
  const perfTask = tasks[perfTaskName];
  assert.ok(perfTask, `${perfTaskName} task is defined`);
  const { modulePath } = parseNodeTaskCommand(perfTask.command);
  const { p10PerfAcceptance, runP10PerfAcceptance } = await import(
    new URL(`../${modulePath}`, import.meta.url).href
  );

  assert.equal(typeof runP10PerfAcceptance, 'function');
  assert.equal(acceptanceScripts.includes('test:p10-perf'), true);
  assertOrderedIncludes(acceptanceScripts, 'check:build', 'test:p10-perf');
  assertOrderedIncludes(acceptanceScripts, 'test:p10-perf', 'check:fw');
  assertOrderedIncludes(ciTaskNames, 'build', perfTaskName);
  assertOrderedIncludes(ciTaskNames, perfTaskName, 'fw-check');
  assert.deepEqual(perfTask.input, [
    { auto: true },
    { base: 'workspace', pattern: modulePath },
    { base: 'workspace', pattern: 'dist/**' },
  ]);
  assert.deepEqual(p10PerfAcceptance, {
    browser: 'chromium',
    cdpMethods: ['HeapProfiler.collectGarbage', 'Runtime.getHeapUsage'],
    heapNoiseBudget: 65536,
    navigationCount: 100,
    paintEntry: 'first-contentful-paint',
    prerenderTimingField: 'activationStart',
    ttiMetric: 'ttiMinusFcpMs',
  });
});
