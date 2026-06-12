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
  assertRenderEquivalence,
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

const explainValue = (output, prefix) => {
  const line = output.split('\n').find((item) => item.startsWith(prefix));
  assert.ok(line, `explain output includes ${prefix}`);
  return line.slice(prefix.length);
};

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

const parseTemplateViteTasks = (source) => {
  const tasks = {};
  let currentTask;
  let currentArray;
  let currentMultilineProperty;

  for (const line of source.split('\n')) {
    const indent = line.search(/\S|$/);
    const trimmed = line.trim();

    if (indent === 6) {
      const taskMatch = /^'?([\w-]+)'?: \{$/.exec(trimmed);

      if (taskMatch) {
        currentTask = taskMatch[1];
        currentArray = undefined;
        currentMultilineProperty = undefined;
        tasks[currentTask] = {};
        continue;
      }
    }

    if (!currentTask) continue;

    if (indent === 8 && trimmed === '},') {
      currentTask = undefined;
      currentArray = undefined;
      currentMultilineProperty = undefined;
      continue;
    }

    if (currentMultilineProperty) {
      const stringMatch = /^'([^']+)',?$/.exec(trimmed);
      if (stringMatch) {
        tasks[currentTask][currentMultilineProperty] = stringMatch[1];
        currentMultilineProperty = undefined;
        continue;
      }
    }

    const multilinePropertyMatch = /^(command):$/.exec(trimmed);
    if (multilinePropertyMatch) {
      currentMultilineProperty = multilinePropertyMatch[1];
      continue;
    }

    const commandMatch = /^command: '([^']+)',?$/.exec(trimmed);
    if (commandMatch) {
      tasks[currentTask].command = commandMatch[1];
      continue;
    }

    const outputMatch = /^output: \[(.*)\],?$/.exec(trimmed);
    if (outputMatch) {
      tasks[currentTask].output = [...outputMatch[1].matchAll(/'([^']+)'/g)].map(
        (match) => match[1],
      );
      continue;
    }

    const arrayMatch = /^(input): \[$/.exec(trimmed);
    if (arrayMatch) {
      currentArray = arrayMatch[1];
      tasks[currentTask][currentArray] = [];
      continue;
    }

    if (currentArray && trimmed === '],') {
      currentArray = undefined;
      continue;
    }

    const inputMatch = /^\{ pattern: '([^']+)', base: '([^']+)' \},?$/.exec(trimmed);
    if (currentArray && inputMatch) {
      tasks[currentTask][currentArray].push({ pattern: inputMatch[1], base: inputMatch[2] });
    }
  }

  return tasks;
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

const balancedSnippetAfter = (source, marker, open, close) => {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `source contains ${marker}`);
  const openIndex = source.indexOf(open, markerIndex);
  assert.notEqual(openIndex, -1, `source contains ${open} after ${marker}`);
  let depth = 0;

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];

    if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;

      if (depth === 0) {
        return source.slice(openIndex, index + 1);
      }
    }
  }

  assert.fail(`source contains balanced ${open}${close} after ${marker}`);
};

const objectKeysFromSnippet = (snippet) => {
  const keys = [];

  for (const match of snippet.matchAll(/(?:^|[,{])\s*([A-Za-z_$][\w$]*)\s*:/g)) {
    keys.push(match[1]);
  }

  return keys;
};

const objectEntriesFromSnippet = (snippet) => {
  const keys = [];

  for (const line of snippet.split('\n')) {
    const match = /^\s*([A-Za-z_$][\w$]*)\s*(?::|,)/.exec(line);
    if (match) {
      keys.push(match[1]);
    }
  }

  return keys;
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

const assignmentExpressionsFromSource = (source) =>
  source
    .split('\n')
    .map((line) => {
      const match = /^\s*([^=]+?)\s*=\s*(.+?);?\s*$/.exec(line);
      return match ? { target: match[1].trim(), value: match[2].trim() } : undefined;
    })
    .filter(Boolean);

const importedNamesFrom = (source, specifier) => {
  const names = new Set();
  const importPattern = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;

  for (const match of source.matchAll(importPattern)) {
    const [, clause, importSpecifier] = match;
    if (importSpecifier !== specifier) continue;

    const namedImportSnippet = clause.match(/\{([\s\S]*?)\}/)?.[1] ?? '';
    for (const item of namedImportSnippet.split(',')) {
      const name = item
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (name) names.add(name);
    }
  }

  return [...names].sort((left, right) => left.localeCompare(right));
};

const interfaceMembersFromSource = (source, interfaceName) => {
  const snippet = balancedSnippetAfter(source, `interface ${interfaceName}`, '{', '}');
  const members = {};
  let statement = '';
  let depth = 0;

  for (const char of snippet.slice(1, -1)) {
    if (char === '{' || char === '(' || char === '[') depth += 1;
    if (char === '}' || char === ')' || char === ']') depth -= 1;

    if (char === ';' && depth === 0) {
      const match = /^(?:(['"])(.*?)\1|([A-Za-z_$][\w$-]*))\??\s*:\s*([\s\S]+)$/.exec(
        statement.trim(),
      );
      if (match) members[match[2] ?? match[3]] = match[4].replace(/\s+/g, ' ').trim();
      statement = '';
      continue;
    }

    statement += char;
  }

  return members;
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
    const body = await readWireFixture(name);
    assert.match(body, /^### /m, `${name} names the scenario`);
    assert.match(body, /^>>> REQUEST/m, `${name} includes a request transcript`);
    assert.match(body, /^<<< RESPONSE/m, `${name} includes a response transcript`);
  }

  for (const name of ['enhanced-mutation.http', 'validation-422-fragment.http']) {
    const body = await readWireFixture(name);
    assert.match(body, /^FW-Fragment: true$/m, `${name} declares enhanced fragment mode`);
    assert.match(
      body,
      /^Accept: text\/vnd\.jiso\.fragment\+html$/m,
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
  const body = await readFile(new URL('../fixtures/wire/README.md', import.meta.url), 'utf8');

  assert.match(body, /SSE.*v2 backlog/i);
});

void test('P10 constitution rejects forbidden browser architecture in framework code', async () => {
  const sourcePaths = await listProjectFiles(
    'packages',
    (path) => path.endsWith('.ts') && path.includes('/src/') && !path.endsWith('.test.ts'),
  );
  const forbiddenPatterns = [
    /\bcustomElements\.define\b/,
    /\battachShadow\b/,
    /\baddEventListener\(['"]unload['"]/,
    /\bonunload\b/,
    /<script\b[^>]*type=["']importmap["']/i,
    /\bcreateBrowserRouter\b/,
    /\bhydrateRoot\b/,
  ];

  for (const path of sourcePaths) {
    const source = await readProjectFile(path);

    for (const pattern of forbiddenPatterns) {
      assert.doesNotMatch(source, pattern, `${path} must not match ${pattern}`);
    }
  }
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
  assert.match(explainValue(cartAddExplain, 'updates: '), /cart->component:CartBadge,page:\/cart/);
});

void test('P10 normative docs cover the constitution and compiler hard rules', async () => {
  const constitution = await readProjectFile('docs/constitution.md');
  const compilerRules = await readProjectFile('docs/compiler-hard-rules.md');
  const spec = await readProjectFile('SPEC.md');
  const compilerRuleItems = parseMarkdownNumberedList(compilerRules);
  const cssContract = spec
    .split('\n')
    .find((line) => normalizeMarkdownCell(line).startsWith('13.1 CSS.'));

  assert.ok(
    normalizeMarkdownCell(markdownSection(constitution, 'Jiso Constitution')).includes(
      'SPEC.md is the source of truth',
    ),
    'constitution names SPEC.md as the source of truth',
  );
  assert.deepEqual(numberedListTitles(constitution), [
    'Legibility is load-bearing',
    'Local code must not require global knowledge',
    'Sugar must lower to authorable IR',
    'The wire is the documentation',
    'Server truth always wins',
  ]);
  assert.ok(
    normalizeMarkdownCell(markdownSection(compilerRules, 'Compiler Hard Rules')).includes(
      'SPEC.md section 5.2 is normative',
    ),
    'compiler hard rules cite the normative SPEC section',
  );
  assert.deepEqual(
    compilerRuleItems.map((item) => normalizeMarkdownCell(item.split('.')[0])),
    [
      'Source-derived names',
      'One-to-one file mapping',
      'Fixpoint invariant',
      'Platform behavior emission',
      'Teaching errors',
      'TSX-only authoring',
    ],
  );
  assert.ok(
    compilerRuleItems
      .find((item) => item.startsWith('Source-derived names.'))
      .includes('capture channels (ctx, element-params, module-scope)'),
    'source-derived rule keeps handler capture-channel coverage',
  );
  assert.ok(
    compilerRuleItems
      .find((item) => item.startsWith('Fixpoint invariant.'))
      .includes('render-equivalence gate'),
    'fixpoint rule keeps render-equivalence coverage',
  );
  assert.ok(cssContract, 'SPEC section 13.1 CSS contract exists');
  assert.ok(cssContract.includes('Tailwind-first'), 'SPEC CSS contract keeps Tailwind v1 stance');
  assert.ok(
    cssContract.includes('dynamic classes must be safelisted explicitly'),
    'SPEC CSS contract keeps dynamic-class safelisting',
  );
  assert.ok(cssContract.includes('@source inline("...")'), 'SPEC CSS contract cites safelists');
  assert.ok(cssContract.includes('@scope'), 'SPEC CSS contract requires scoped component CSS');
  assert.ok(
    !cssContract.includes('needs a design pass before v1 freeze'),
    'SPEC CSS contract is no longer a pre-freeze placeholder',
  );
});

void test('P10 legibility study packet is ready but not claimed complete', async () => {
  const study = await readProjectFile('docs/legibility-study.md');
  const fields = parseMarkdownFields(study);
  const tasks = parseMarkdownTable(markdownSection(study, 'Tasks'));
  const results = parseMarkdownTable(markdownSection(study, 'Results Ledger'));
  const issues = parseMarkdownTable(markdownSection(study, 'Issues Ledger'));
  const completionRule = normalizeMarkdownCell(markdownSection(study, 'Completion Rule'));

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
  assert.ok(completionRule.includes('SPEC §16.2'), 'completion rule names the SPEC criterion');
  assert.ok(completionRule.includes('P10 legibility'), 'completion rule blocks P10 legibility');
  assert.ok(completionRule.includes('five dated outside-developer result rows'));
});

void test('P10 v1 acceptance ledger tracks every freeze criterion', async () => {
  const ledger = await readProjectFile('docs/v1-acceptance.md');
  const spec = await readProjectFile('SPEC.md');
  const specCriteria = parseMarkdownNumberedList(
    markdownSection(spec, '16. Success Criteria (v1)'),
  ).map((item) => item.split(':')[0]);
  const gateRows = parseMarkdownTable(markdownSection(ledger, 'Required Gates'));
  const gatesByCriterion = new Map(gateRows.map((row) => [row['SPEC §16 criterion'], row]));
  const freezeRule = normalizeMarkdownCell(markdownSection(ledger, 'Freeze Rule'));

  assert.ok(
    normalizeMarkdownCell(markdownSection(ledger, 'v1 Acceptance Ledger')).includes(
      'SPEC.md section 16 is the normative acceptance contract',
    ),
    'acceptance ledger cites the normative SPEC section',
  );
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
  assert.ok(freezeRule.includes('IMPLEMENT_v1.md P10'), 'freeze rule blocks P10 completion');
  assert.ok(freezeRule.includes('docs/legibility-study.md'), 'freeze rule requires study evidence');
  assert.ok(
    freezeRule.includes('docs/prelaunch-checklist.md'),
    'freeze rule requires pre-launch evidence',
  );
});

void test('pre-launch checklist is tracked explicitly', async () => {
  const checklist = await readProjectFile('docs/prelaunch-checklist.md');
  const requiredChecks = parseMarkdownTable(markdownSection(checklist, 'Required Checks'));
  const completionRule = normalizeMarkdownCell(markdownSection(checklist, 'Completion Rule'));

  assert.ok(
    normalizeMarkdownCell(markdownSection(checklist, 'Pre-launch Checklist')).includes(
      'launch-readiness checks required before v1 freeze',
    ),
    'pre-launch checklist states the v1 freeze scope',
  );
  assert.deepEqual(
    requiredChecks.map((row) => row.Check),
    ['Trademark screen', 'Domain', 'npm scope', 'Linguistic screen'],
  );
  assert.deepEqual(
    requiredChecks.map((row) => row['Where to record evidence']),
    [
      'Trademark Evidence Ledger below.',
      'Domain Evidence Ledger below.',
      'npm Scope Evidence Ledger below.',
      'Linguistic Evidence Ledger below.',
    ],
  );
  for (const row of requiredChecks) {
    assert.equal(row.Status, 'pending', `${row.Check} remains pending`);
  }
  assert.equal(
    parseMarkdownTable(markdownSection(checklist, 'Domain Evidence Ledger'))[0].Domain,
    'jiso.dev',
  );
  assert.equal(
    parseMarkdownTable(markdownSection(checklist, 'npm Scope Evidence Ledger'))[0].Scope,
    '@jiso',
  );
  assert.ok(completionRule.includes('no ledger row remains pending'));
  assert.ok(completionRule.includes('docs/v1-acceptance.md'));
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

  assert.equal(renderQueryScript(query), queryScript);
  assert.equal(renderDocumentQueryScript(query), queryScript);
  assert.match(
    renderDocument({
      body: '<main></main>',
      queries: [query],
    }).html,
    /<head>[\s\S]*<script type="application\/json" fw-query="cart" key="cart:c1">\{"html":"\\u003c\/script>"\}<\/script>[\s\S]*<\/head><body><main><\/main><\/body>/,
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
  assert.deepEqual(interfaceMembersFromSource(registrySource, 'ViewTransitions'), {
    'product-p1-image': 'unknown',
  });
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
  assert.deepEqual(interfaceMembersFromSource(registrySource, 'RouteRegistry'), {
    '/cart': "import('@jiso/core').Route<'/cart'>",
    '/products/:id': "import('@jiso/core').Route<'/products/:id'>",
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

  assert.deepEqual(result.queries, ['reviews']);
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
  assert.match(
    deferred.body,
    /<fw-fragment target="recommendations"><link rel="stylesheet" href="\/assets\/recommendations\.css"><section class="border-slate-200">Ready<\/section><\/fw-fragment>/,
  );

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

  assert.deepEqual(cartPage, {
    i18n: ['en-US:cartLabel,productStock'],
    meta: {
      description: 'Browse products and checkout with 1 verifiable cart item.',
      title: 'Jiso Commerce (1)',
    },
    modulepreloads: [],
    prefetch: false,
    queries: ['cart', 'productGrid', 'orderHistory'],
    route: '/cart',
    stylesheets: ['/assets/tailwind.css'],
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
  assert.match(explainValue(cartAddExplain, 'updates: '), /cart->component:CartBadge,page:\/cart/);
  assert.match(
    explainValue(cartAddExplain, 'updates: '),
    /productGrid->component:ProductGrid,page:\/cart/,
  );
  assert.match(
    explainValue(cartAddExplain, 'updates: '),
    /orderHistory->component:OrderHistory,page:\/cart/,
  );
  assert.match(cartAddExplain, /^OPTIMISTIC-SUMMARY .*UNHANDLED=0$/m);
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
  assert.deepEqual(deriveRegistryFactsFromGraph(commerceGraph), {
    components: ['cart-badge', 'order-history', 'product-grid'],
    domainKeys: ['attachment', 'cart', 'order', 'product'],
    invalidations: {
      'cart/add': ['cart', 'orderHistory', 'productGrid'],
    },
    routes: ['/cart'],
  });
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
    viteConfigSource,
    ciWorkflow,
    starterGraphSource,
    clientSource,
    appFixpointTest,
    stylesSource,
    indexHtml,
  ] = await Promise.all([
    readProjectFile('packages/create-jiso/templates/package.json'),
    readProjectFile('packages/create-jiso/templates/vite.config.ts'),
    readProjectFile('packages/create-jiso/templates/.github/workflows/ci.yml'),
    readProjectFile('packages/create-jiso/templates/graph.json'),
    readProjectFile('packages/create-jiso/templates/src/client.ts'),
    readProjectFile('packages/create-jiso/templates/src/app.fixpoint.test.ts'),
    readProjectFile('packages/create-jiso/templates/src/styles.css'),
    readProjectFile('packages/create-jiso/templates/index.html'),
  ]);
  const packageJson = JSON.parse(packageJsonSource);
  const viteTasks = parseTemplateViteTasks(viteConfigSource);
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
  assert.equal(packageJson.dependencies['@jiso/runtime'], 'workspace:*');
  assert.equal(packageJson.devDependencies['@jiso/compiler'], 'workspace:*');
  assert.equal(packageJson.devDependencies['@tailwindcss/vite'], '^4.1.0');
  assert.equal(packageJson.devDependencies.tailwindcss, '^4.1.0');

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
  assert.equal(
    explainValue(cartAddExplain, 'updates: '),
    'cart->component:CartBadge,component:CartPanel,page:/cart',
  );
  assert.match(cartAddExplain, /^OPTIMISTIC cart await-fragment$/m);
  assert.match(cartAddExplain, /^OPTIMISTIC-SUMMARY .*UNHANDLED=0$/m);
  assert.equal(
    explainValue(cartPageExplain, 'meta: '),
    'title=Jiso Starter Cart description=Starter cart backed by query data. image=-',
  );
  assert.equal(explainValue(cartPageExplain, 'i18n: '), 'en-US:cartTitle');
  assert.equal(explainValue(cartPageExplain, 'queries: '), 'cart');
  assert.equal(explainValue(cartPageExplain, 'stylesheets: '), '/src/styles.css');

  assert.deepEqual(viteTasks['fw-check'], {
    command: 'node scripts/emit-graph.mjs && fw check graph.json',
    input: [
      { pattern: 'scripts/emit-graph.mjs', base: 'workspace' },
      { pattern: 'src/**/*', base: 'workspace' },
    ],
    output: ['graph.json'],
  });
  assert.deepEqual(viteTasks['graph-assertions'], {
    command: 'node scripts/emit-graph.mjs && node scripts/graph-assertions.mjs',
    input: [
      { pattern: 'graph.json', base: 'workspace' },
      { pattern: 'scripts/emit-graph.mjs', base: 'workspace' },
      { pattern: 'scripts/graph-assertions.mjs', base: 'workspace' },
      { pattern: 'src/**/*', base: 'workspace' },
    ],
  });
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

  const emittedGraph = await runEmitGraphTemplateScript();
  assert.equal(emittedGraph.output, 'emit-graph/v1\nOK\n');
  assert.deepEqual(emittedGraph.graph, starterGraph);
  assert.equal(await runGraphAssertionsTemplateScript(), 'graph-assertions/v1\nOK\n');

  assert.deepEqual(importedNamesFrom(appFixpointTest, '@jiso/compiler'), [
    'assertFixpoint',
    'assertRenderEquivalence',
    'compileComponentModule',
  ]);

  assert.deepEqual(importedNamesFrom(clientSource, '@jiso/runtime'), [
    'applyDeferredStreamResponseToDom',
    'createQueryStore',
    'EnhancedMutationFetch',
    'installJisoLoader',
    'MorphRoot',
    'TargetCollectorRoot',
  ]);
  assert.deepEqual(
    objectKeysFromSnippet(
      balancedSnippetAfter(clientSource, 'installJisoLoader({', '{', '}'),
    ).filter((key) => ['enhancedMutations', 'importModule', 'queryStore', 'root'].includes(key)),
    ['importModule', 'root', 'queryStore', 'enhancedMutations'],
  );
  assert.deepEqual(
    objectEntriesFromSnippet(
      balancedSnippetAfter(clientSource, 'enhancedMutations', '{', '}'),
    ).filter((key) => ['fetch', 'queryPlans', 'root', 'store'].includes(key)),
    ['fetch', 'queryPlans', 'root', 'store'],
  );
  assert.equal(
    assignmentExpressionsFromSource(clientSource).some(
      (assignment) =>
        assignment.target.endsWith('innerHTML') &&
        assignment.value.startsWith('App.definition.render'),
    ),
    false,
  );

  assert.deepEqual(parseCssSourceDirectives(stylesSource), [
    '"../index.html"',
    '"./**/*.{ts,tsx,html}"',
    'inline("bg-emerald-50 text-emerald-700 border-emerald-200 bg-amber-50 text-amber-700 border-amber-200")',
  ]);
  const htmlElements = parseHtmlElements(indexHtml);
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
    [{ type: 'module', src: '/src/client.ts' }],
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
  assert.deepEqual(enhancedResult.queries, ['cart']);
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
  assert.match(malformedHeaderErrors[0].message, /Malformed JSON in FW-Changes header/);

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
  assert.deepEqual(optimisticResult.queries, ['reviews']);
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
  assert.match(handlerUrl.searchParams.get('v') ?? '', /^[0-9a-f]{8}$/);

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

  const plugin = jisoVitePlugin();
  const greenTransform = plugin.transform(greenSource, componentId);
  assert.ok(greenTransform);
  assert.match(greenTransform.code, /diagnostic-card/);

  assert.throws(
    () => plugin.transform(redSource, componentId),
    (error) => {
      const message = String(error?.message ?? error);
      assert.match(message, /Jiso Vite transform failed with 1 error diagnostic\./);
      assert.match(message, /FW201 routes\/diagnostic-card\.tsx:5:25/);
      assert.match(message, /Closure captures unserializable value\./);
      assert.match(message, /Fixes: move the value into component\/query state via ctx/);
      return true;
    },
  );

  const lintDiagnostics = [];
  const lintPlugin = jisoVitePlugin({
    onDiagnostic: (diagnostic) => lintDiagnostics.push(diagnostic),
  });
  const lintTransform = lintPlugin.transform(lintSource, componentId);
  assert.ok(lintTransform);
  assert.match(lintTransform.code, /diagnostic-card/);
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
        assert.match(output, /Jiso Vite transform failed with 1 error diagnostic\./);
        assert.match(output, /FW201 routes\/diagnostic-card\.tsx:5:25/);
        assert.match(output, /Closure captures unserializable value\./);
        return true;
      },
    );

    await writeFile(buildFixtureSourcePath, greenSource, 'utf8');
    const greenBuild = await execFileAsync(join(projectRoot, 'node_modules/.bin/vp'), ['build'], {
      cwd: buildFixtureRoot,
    });
    assert.match(`${greenBuild.stdout}\n${greenBuild.stderr}`, /built in|✓ built/);
  } finally {
    await rm(buildFixtureRoot, { force: true, recursive: true });
  }

  const outDir = await mkdtemp(join(tmpdir(), 'jiso-d10-export-'));
  const app = createApp({
    routes: [
      serverRoute('/', {
        page: () => '<main>D10 export green</main>',
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
        assert.match(
          String(error?.message ?? error),
          /Static export refused error diagnostic FW201 at routes\/diagnostic-card\.tsx:5:25/,
        );
        return true;
      },
    );
    await assert.rejects(readFile(join(outDir, 'index.html'), 'utf8'));

    const exported = await exportStaticApp(app, { diagnostics: [lintDiagnostic], outDir });
    assert.equal(exported.artifacts[0]?.path, '/index.html');
    assert.equal(exported.diagnostics.length, 0);
    assert.match(await readFile(join(outDir, 'index.html'), 'utf8'), /D10 export green/);
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
      page: () => '<main>D10 fw export green</main>',
    }),
  ],
});
`;

  try {
    await writeFile(cliRedModule, cliAppModuleSource([errorDiagnostic]), 'utf8');
    const redExport = await runCliCommand(['export', cliRedModule, '--out', cliRedOutDir]);
    assert.equal(redExport.exitCode, 1);
    assert.equal(redExport.stdout, '');
    assert.match(redExport.stderr, /fw-export\/v1/);
    assert.match(
      redExport.stderr,
      /ERROR FW201 route=routes\/diagnostic-card\.tsx Static export refused error diagnostic FW201 at routes\/diagnostic-card\.tsx:5:25/,
    );
    await assert.rejects(readFile(join(cliRedOutDir, 'index.html'), 'utf8'));

    await writeFile(cliGreenModule, cliAppModuleSource([lintDiagnostic]), 'utf8');
    const greenExport = await runCliCommand(['export', cliGreenModule, '--out', cliGreenOutDir]);
    assert.equal(greenExport.exitCode, 0);
    assert.equal(greenExport.stderr, '');
    assert.match(greenExport.stdout, /fw-export\/v1/);
    assert.match(greenExport.stdout, /HTML \/index\.html status=200 bytes=/);
    assert.match(greenExport.stdout, /SUMMARY html=1 clientModules=0 diagnostics=0/);
    assert.match(await readFile(join(cliGreenOutDir, 'index.html'), 'utf8'), /D10 fw export green/);
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
    assert.match(
      String(error?.stack ?? error),
      /__filename is not defined in ES module scope/,
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

  assert.deepEqual(result.componentGraphFacts, [
    {
      fragments: ['cart-row'],
      name: 'CartRow',
    },
  ]);
  assert.deepEqual(interfaceMembersFromSource(registrySource, 'FragmentTargets'), {
    'cart-row': '{ rowId: string }',
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
  const expectedTouchGraph = {
    'cart.addItem': {
      reads: [],
      touches: [
        {
          domain: 'cart',
          keys: null,
          site: 'examples/commerce/src/app.ts:404',
          via: 'cart_items',
        },
        {
          domain: 'order',
          keys: null,
          site: 'examples/commerce/src/app.ts:409',
          via: 'orders',
        },
        {
          domain: 'product',
          keys: 'arg:productId',
          predicate: 'eq',
          site: 'examples/commerce/src/app.ts:416',
          via: 'products',
        },
      ],
      unresolved: [],
    },
    'order.receipt': {
      reads: [],
      touches: [
        {
          domain: 'attachment',
          keys: 'arg:orderId',
          predicate: 'eq',
          site: 'examples/commerce/src/app.ts:458',
          via: 'attachments',
        },
      ],
      unresolved: [],
    },
    'payment.webhook': {
      reads: [],
      touches: [
        {
          domain: 'order',
          keys: 'arg:data.object.id',
          predicate: 'eq',
          site: 'examples/commerce/src/app.ts:508',
          via: 'orders',
        },
      ],
      unresolved: [],
    },
  };

  assert.deepEqual(commerceGraph.touchGraph, expectedTouchGraph);
  assert.deepEqual(
    Object.values(commerceGraph.touchGraph)
      .flatMap((entry) => entry.touches)
      .map((touch) => touch.site)
      .sort((left, right) => left.localeCompare(right)),
    [
      'examples/commerce/src/app.ts:404',
      'examples/commerce/src/app.ts:409',
      'examples/commerce/src/app.ts:416',
      'examples/commerce/src/app.ts:458',
      'examples/commerce/src/app.ts:508',
    ],
  );
  // SPEC §11.1/§11.2: the committed static graph must stay source-derived
  // because runtime verification checks observed effects against these facts.
  const [cartItemsTouch, ordersTouch, productsTouch] = expectedTouchGraph['cart.addItem'].touches;
  const [attachmentsTouch] = expectedTouchGraph['order.receipt'].touches;
  const [webhookOrdersTouch] = expectedTouchGraph['payment.webhook'].touches;
  assert.equal(
    touchGraphSource,
    `import type { CartQueryResult, CommerceDb, ProductGridResult } from '../app.js';

export const commerceTouchGraph = {
  'cart.addItem': {
    touches: [
      {
        domain: 'cart',
        keys: null,
        site: '${cartItemsTouch.site}',
        via: 'cart_items',
      },
      {
        domain: 'order',
        keys: null,
        site: '${ordersTouch.site}',
        via: 'orders',
      },
      {
        domain: 'product',
        keys: 'arg:productId',
        predicate: 'eq',
        site: '${productsTouch.site}',
        via: 'products',
      },
    ],
    reads: [],
    unresolved: [],
  },
  'order.receipt': {
    touches: [
      {
        domain: 'attachment',
        keys: 'arg:orderId',
        predicate: 'eq',
        site: '${attachmentsTouch.site}',
        via: 'attachments',
      },
    ],
    reads: [],
    unresolved: [],
  },
  'payment.webhook': {
    touches: [
      {
        domain: 'order',
        keys: 'arg:data.object.id',
        predicate: 'eq',
        site: '${webhookOrdersTouch.site}',
        via: 'orders',
      },
    ],
    reads: [],
    unresolved: [],
  },
} as const;

export const commerceInvalidationSets = {
  'cart/add': [
    { query: 'cart', domains: ['cart'], keys: null },
    { query: 'orderHistory', domains: ['order'], keys: null },
    { query: 'productGrid', domains: ['product'], keys: null },
  ],
} as const;

export interface CommerceInvalidationSets {
  'cart/add': 'cart' | 'orderHistory' | 'productGrid';
}

declare module '@jiso/core' {
  interface QueryRegistry {
    cart: CartQueryResult;
    productGrid: ProductGridResult;
    orderHistory: { items: CommerceDb['orders'] };
  }

  interface InvalidationSets extends CommerceInvalidationSets {}
}
`,
  );
});

void test('Conformance suites are an explicit gate', async () => {
  const packageJson = JSON.parse(await readProjectFile('package.json'));
  const viteConfig = await readProjectFile('vite.config.ts');
  const ciWorkflow = await readProjectFile('.github/workflows/ci.yml');
  const acceptanceSteps = packageJson.scripts.acceptance.split(' && ');
  const ciSteps = parseWorkflowSteps(ciWorkflow).map((step) => step.run ?? step.uses);
  const tasks = parseTemplateViteTasks(viteConfig);
  const authSpikePackageJson = JSON.parse(
    await readProjectFile('conformance/auth-spike/package.json'),
  );
  const betterAuthPinPackageJson = JSON.parse(
    await readProjectFile('conformance/better-auth-pin/package.json'),
  );
  const webhookSpikePackageJson = JSON.parse(
    await readProjectFile('conformance/webhook-spike/package.json'),
  );
  const appShellSpikePackageJson = JSON.parse(
    await readProjectFile('conformance/app-shell-spike/package.json'),
  );
  const drizzlePackageJson = JSON.parse(await readProjectFile('packages/drizzle/package.json'));
  const drizzlePinPackageJson = JSON.parse(
    await readProjectFile('conformance/drizzle-pin/package.json'),
  );

  assert.equal(acceptanceSteps.includes('pnpm run test:conformance'), true);
  assert.equal(packageJson.scripts['test:conformance'], 'vp run conformance');
  assert.equal(drizzlePackageJson.dependencies['ts-morph'], '^28.0.0');
  assert.equal(drizzlePinPackageJson.devDependencies['drizzle-orm'], '0.45.2');
  assert.equal(betterAuthPinPackageJson.devDependencies['better-auth'], '1.6.17');
  assert.equal(ciSteps.includes('vp run conformance'), true);
  assert.deepEqual(tasks['conformance-drizzle'], {
    command: 'vitest --run conformance/drizzle-pin/src/index.test.ts',
    input: [
      { base: 'workspace', pattern: 'conformance/drizzle-pin/src/index.test.ts' },
      { base: 'workspace', pattern: 'packages/drizzle/src/**/*.ts' },
    ],
  });
  assert.deepEqual(tasks.conformance, {
    command:
      'pnpm --filter @jiso/conformance-drizzle-pin test && pnpm --filter @jiso/conformance-better-auth-pin test && pnpm --filter @jiso/conformance-auth-spike test && pnpm --filter @jiso/conformance-webhook-spike test && pnpm --filter @jiso/conformance-app-shell-spike test',
    input: [
      { base: 'workspace', pattern: 'conformance/**/package.json' },
      { base: 'workspace', pattern: 'conformance/**/src/**/*.ts' },
      { base: 'workspace', pattern: 'conformance/**/docs/**' },
      { base: 'workspace', pattern: 'packages/core/src/**/*.ts' },
      { base: 'workspace', pattern: 'packages/server/src/**/*.ts' },
      { base: 'workspace', pattern: 'packages/drizzle/src/**/*.ts' },
      { base: 'workspace', pattern: 'packages/better-auth/src/**/*.ts' },
    ],
  });
  assert.equal(betterAuthPinPackageJson.name, '@jiso/conformance-better-auth-pin');
  assert.equal(authSpikePackageJson.name, '@jiso/conformance-auth-spike');
  assert.equal(webhookSpikePackageJson.name, '@jiso/conformance-webhook-spike');
  assert.equal(appShellSpikePackageJson.name, '@jiso/conformance-app-shell-spike');

  await execFileAsync('pnpm', ['exec', 'vitest', '--run', 'packages/drizzle/src/index.test.ts'], {
    cwd: new URL('..', import.meta.url),
    maxBuffer: 1024 * 1024 * 10,
  });
  await execFileAsync(
    'pnpm',
    ['exec', 'vitest', '--run', 'conformance/drizzle-pin/src/index.test.ts'],
    { cwd: new URL('..', import.meta.url), maxBuffer: 1024 * 1024 * 10 },
  );
  await execFileAsync(
    'pnpm',
    ['exec', 'vitest', '--run', 'conformance/better-auth-pin/src/index.test.ts'],
    { cwd: new URL('..', import.meta.url), maxBuffer: 1024 * 1024 * 10 },
  );
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
  assert.deepEqual(
    fixtureApplied.chunks[0].fragments.map((fragment) => fragment.target),
    ['reviews:p1', 'recommendations:p1'],
  );
  assert.deepEqual(fixtureApplied.queries, ['reviews', 'recommendations']);
  assert.deepEqual(fixtureApplied.appliedFragments, ['reviews:p1', 'recommendations:p1']);
  assert.deepEqual(fixtureStore.get('reviews', 'product:p1'), {
    items: [{ id: 'r1', rating: 5 }],
  });
  assert.deepEqual(fixtureStore.get('recommendations', 'product:p1'), {
    items: [{ id: 'rec-1' }],
  });
  assert.ok(fixtureRoot.targets.get('reviews:p1').html.includes('/assets/reviews.css'));
  assert.ok(
    fixtureRoot.targets.get('reviews:p1').html.includes('<article fw-key="r1">5</article>'),
  );
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
  assert.equal(result.renderEquivalenceChecks.length, 1);
  assert.equal(result.renderEquivalenceChecks[0]?.artifact, 'components/cart/cart-total.server.js');
  assert.equal(result.renderEquivalenceChecks[0]?.ok, true);
  assert.match(result.renderEquivalenceChecks[0]?.actual ?? '', /component\('cart-total'/);
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
  const { browserSuiteAcceptance } = await import('./browser-acceptance.mjs');
  const packageJson = JSON.parse(await readProjectFile('package.json'));
  const ciWorkflow = await readProjectFile('.github/workflows/ci.yml');
  const viteConfig = await readProjectFile('vite.config.ts');
  const ciSteps = parseWorkflowSteps(ciWorkflow).map((step) => step.run ?? step.uses);
  const tasks = parseTemplateViteTasks(viteConfig);

  assert.equal(
    packageJson.scripts.acceptance.split(' && ').includes('pnpm run test:browser'),
    true,
  );
  assert.equal(packageJson.scripts['test:browser'], 'vp run browser');
  assert.equal(ciSteps.includes('vp run browser'), true);
  assert.deepEqual(tasks.browser, {
    command: 'vitest --config vitest.browser.config.ts --run',
    input: [
      { base: 'workspace', pattern: 'vitest.browser.config.ts' },
      { base: 'workspace', pattern: 'tests/browser-acceptance.mjs' },
      { base: 'workspace', pattern: 'packages/runtime/src/**/*.browser.test.ts' },
    ],
  });
  assert.deepEqual(browserSuiteAcceptance, {
    browser: 'chromium',
    headless: true,
    include: ['packages/runtime/src/**/*.browser.test.ts'],
    providerPackage: '@vitest/browser-playwright',
  });
});

void test('P10 perf acceptance is wired through Playwright and CDP', async () => {
  const { p10PerfAcceptance } = await import('./p10-perf.node.mjs');
  const packageJson = JSON.parse(await readProjectFile('package.json'));
  const ciWorkflow = await readProjectFile('.github/workflows/ci.yml');
  const viteConfig = await readProjectFile('vite.config.ts');
  const acceptanceSteps = packageJson.scripts.acceptance.split(' && ');
  const ciSteps = parseWorkflowSteps(ciWorkflow).map((step) => step.run ?? step.uses);
  const tasks = parseTemplateViteTasks(viteConfig);

  assert.equal(acceptanceSteps.includes('pnpm run test:p10-perf'), true);
  assert.equal(packageJson.scripts['test:p10-perf'], 'vp run p10-perf');
  assert.ok(
    acceptanceSteps.indexOf('pnpm run check:build') <
      acceptanceSteps.indexOf('pnpm run test:p10-perf'),
  );
  assert.ok(
    acceptanceSteps.indexOf('pnpm run test:p10-perf') <
      acceptanceSteps.indexOf('pnpm run check:fw'),
  );
  assert.ok(ciSteps.indexOf('vp run build') < ciSteps.indexOf('vp run p10-perf'));
  assert.ok(ciSteps.indexOf('vp run p10-perf') < ciSteps.indexOf('vp run fw-check'));
  assert.deepEqual(tasks['p10-perf'], {
    command: 'node tests/p10-perf.node.mjs',
    input: [
      { base: 'workspace', pattern: 'tests/p10-perf.node.mjs' },
      { base: 'workspace', pattern: 'dist/**' },
    ],
  });
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
