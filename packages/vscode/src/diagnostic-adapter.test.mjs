import path from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { compileComponentV1 } from '../../cli/src/commands/mcp.ts';
import { formatKovoDiagnostics, projectKovoDiagnostic } from '../../cli/src/diagnostic.ts';
import { createRegisteredDiagnostic } from '../../core/src/internal/diagnostics.ts';
import { buildBundle, createMcpServer, renderPage } from '../../devtool/src/index.mjs';
import adapter from './diagnostic-adapter.cjs';

const {
  KOVO_DIAGNOSTIC_VERSION,
  MAX_ENVELOPE_BYTES,
  createEditorDiagnosticProjection,
  createVscodeDiagnostic,
  formatSourceLessDiagnostic,
  parseDiagnosticEnvelopeText,
  resolveDiagnosticArtifactPath,
  resolveWorkspaceSourcePath,
  safeFixInvocation,
} = adapter;
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const AUTHORING_FAMILIES = [
  { code: 'KV436', family: 'access', token: 'accessDecision' },
  { code: 'KV302', family: 'drizzle-data', token: 'drizzleQuery' },
  { code: 'KV242', family: 'forms-csrf', token: 'csrfForm' },
  { code: 'KV310', family: 'optimism', token: 'optimisticUpdate' },
  { code: 'KV236', family: 'trusted-output', token: 'trustedOutput' },
];

function record(overrides = {}) {
  return {
    category: 'proof',
    code: 'KV436',
    help: 'Add one explicit access decision and rerun kovo check.',
    message: 'Missing explicit access decision.',
    severity: 'error',
    source: { end: 27, file: 'src/app.tsx', start: 14 },
    version: KOVO_DIAGNOSTIC_VERSION,
    ...overrides,
  };
}

function envelope(diagnostics = [record()]) {
  return JSON.stringify({
    diagnostics,
    result: {
      command: 'check',
      exitCode: 1,
      protocol: 'kovo-check/v1',
      text: 'kovo-check/v1\nERROR findings=1\n',
    },
    version: KOVO_DIAGNOSTIC_VERSION,
  });
}

function documentFor(text) {
  return {
    getText: () => text,
    positionAt(offset) {
      const prefix = text.slice(0, offset);
      const lines = prefix.split('\n');
      return { character: lines.at(-1).length, line: lines.length - 1 };
    },
  };
}

function vscodeApi() {
  class Range {
    constructor(startLine, startCharacter, endLine, endCharacter) {
      this.start = { character: startCharacter, line: startLine };
      this.end = { character: endCharacter, line: endLine };
    }
  }
  class Diagnostic {
    constructor(range, message, severity) {
      this.message = message;
      this.range = range;
      this.severity = severity;
    }
  }
  class Location {
    constructor(uri, range) {
      this.range = range;
      this.uri = uri;
    }
  }
  class DiagnosticRelatedInformation {
    constructor(location, message) {
      this.location = location;
      this.message = message;
    }
  }
  return {
    Diagnostic,
    DiagnosticRelatedInformation,
    DiagnosticSeverity: { Error: 0, Hint: 3, Information: 2, Warning: 1 },
    Location,
    Range,
  };
}

describe('kovo-diagnostic/v1 editor adapter', () => {
  it('projects one producer-owned corpus identically across every authoring feedback surface', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'kovo-diagnostic-parity-'));
    const sourceDirectory = path.join(fixture, 'src');
    const sourceText = AUTHORING_FAMILIES.map(
      ({ family, token }) => `const ${token} = '${family}';`,
    ).join('\n');
    mkdirSync(sourceDirectory);
    writeFileSync(path.join(sourceDirectory, 'app.tsx'), `${sourceText}\n`);

    try {
      const diagnostics = AUTHORING_FAMILIES.map(({ code, token }) => {
        const start = sourceText.indexOf(token);
        return projectKovoDiagnostic(
          createRegisteredDiagnostic(
            code,
            { source: { end: start + token.length, file: 'src/app.tsx', start } },
            { includeHelp: true },
          ),
          'proof',
        );
      });
      const bundle = buildBundle({
        app: 'parity',
        diagnostics,
        graph: {},
        srcRoot: fixture,
      });
      const mcp = createMcpServer({ bundles: [bundle] });

      expect(new Set(AUTHORING_FAMILIES.map(({ family }) => family))).toEqual(
        new Set(['access', 'drizzle-data', 'forms-csrf', 'optimism', 'trusted-output']),
      );
      for (let index = 0; index < diagnostics.length; index += 1) {
        const diagnostic = diagnostics[index];
        const node = bundle.nodes[index];
        const editor = createEditorDiagnosticProjection(
          diagnostic,
          documentFor(sourceText),
          'file:///workspace/src/app.tsx',
        );
        const json = JSON.parse(formatKovoDiagnostics([diagnostic], 'json'));
        const human = formatKovoDiagnostics([diagnostic], 'human');
        const github = formatKovoDiagnostics([diagnostic], 'github');
        const githubLevel =
          diagnostic.severity === 'error'
            ? 'error'
            : diagnostic.severity === 'warn'
              ? 'warning'
              : 'notice';
        const explanation = mcp.explain({
          app: 'parity',
          limit: 1,
          query: diagnostic.code,
        });
        const html = renderPage({
          app: 'parity',
          bundle,
          manifest: [{ blurb: 'Parity corpus', id: 'parity', label: 'Parity' }],
          pzHref: '/c/devtool.js',
          sel: node.id,
        });

        expect(json.diagnostics).toEqual([diagnostic]);
        expect(human).toContain(`${diagnostic.severity.toUpperCase()} ${diagnostic.code}`);
        expect(human).toContain(
          `${diagnostic.source.file}[${diagnostic.source.start}:${diagnostic.source.end}]`,
        );
        expect(human).toContain(`HELP ${diagnostic.help}`);
        expect(github).toContain(`::${githubLevel} file=${diagnostic.source.file}`);
        expect(github).toContain(
          `title=${diagnostic.code} ${diagnostic.category} [${diagnostic.source.start}%3A${diagnostic.source.end}]`,
        );
        expect(github).toContain(
          diagnostic.help.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A'),
        );
        expect(editor.facts).toEqual({
          code: diagnostic.code,
          help: diagnostic.help,
          severity: diagnostic.severity,
          source: diagnostic.source,
        });
        expect(explanation.results[0].card.diagnostic).toEqual(diagnostic);
        expect(explanation.results[0].text).toContain(`code: ${diagnostic.code}`);
        expect(explanation.results[0].text).toContain(`severity: ${diagnostic.severity}`);
        expect(explanation.results[0].text).toContain(`help: ${diagnostic.help}`);
        expect(explanation.results[0].text).toContain(
          `source-span: ${diagnostic.source.file}:${diagnostic.source.start}-${diagnostic.source.end}`,
        );
        expect(html).toContain(diagnostic.code);
        expect(html).toContain(diagnostic.severity);
        expect(html).toContain(diagnostic.help);
        expect(html).toContain(
          `${diagnostic.source.file}:${diagnostic.source.start}-${diagnostic.source.end}`,
        );
        expect(node.source).toMatchObject({
          end: diagnostic.source.end,
          file: 'src/app.tsx',
          start: diagnostic.source.start,
        });
      }
    } finally {
      rmSync(fixture, { force: true, recursive: true });
    }
  });

  it('snapshots the complete bounded envelope without deriving producer facts', () => {
    const parsed = parseDiagnosticEnvelopeText(envelope());
    expect(parsed).toEqual({
      diagnostics: [record()],
      result: {
        command: 'check',
        exitCode: 1,
        protocol: 'kovo-check/v1',
        text: 'kovo-check/v1\nERROR findings=1\n',
      },
      version: KOVO_DIAGNOSTIC_VERSION,
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.diagnostics)).toBe(true);
    expect(Object.isFrozen(parsed.diagnostics[0].source)).toBe(true);
  });

  it.each([
    ['future envelope', { version: 'kovo-diagnostic/v2' }],
    ['extra envelope authority', { extra: true }],
    ['missing diagnostics', { diagnostics: undefined }],
  ])('refuses %s', (_label, change) => {
    const value = JSON.parse(envelope());
    for (const [key, next] of Object.entries(change)) {
      if (next === undefined) delete value[key];
      else value[key] = next;
    }
    expect(() => parseDiagnosticEnvelopeText(JSON.stringify(value))).toThrow();
  });

  it.each([
    ['extra diagnostic authority', { claimedFix: 'csrf: false' }],
    ['non-framework code grammar', { code: 'EDITOR001' }],
    ['unknown severity', { severity: 'fatal' }],
    ['reversed source span', { source: { end: 1, file: 'src/app.tsx', start: 2 } }],
    ['NUL source file', { source: { end: 2, file: 'src/\0app.tsx', start: 1 } }],
    ['empty help', { help: '' }],
  ])('refuses %s', (_label, change) => {
    expect(() => parseDiagnosticEnvelopeText(envelope([record(change)]))).toThrow();
  });

  it('enforces the same 4 MiB transport ceiling before JSON parsing', () => {
    expect(() => parseDiagnosticEnvelopeText(' '.repeat(MAX_ENVELOPE_BYTES + 1))).toThrow(
      /1\.\.4194304/u,
    );
  });

  it.each([
    ['error', 0],
    ['warn', 1],
    ['lint', 2],
    ['notice', 3],
  ])('maps %s mechanically while preserving the exact semantic field', (severity, expected) => {
    const source = `const before = 1;\nconst target = true;\n`;
    const projected = createEditorDiagnosticProjection(
      record({
        severity,
        source: { end: 36, file: 'src/app.tsx', start: 24 },
      }),
      documentFor(source),
      'file:///workspace/src/app.tsx',
    );
    expect(projected.facts).toEqual({
      code: 'KV436',
      help: record().help,
      severity,
      source: { end: 36, file: 'src/app.tsx', start: 24 },
    });

    const diagnostic = createVscodeDiagnostic(vscodeApi(), projected);
    expect(diagnostic).toMatchObject({
      code: 'KV436',
      message: 'Missing explicit access decision.',
      severity: expected,
      source: 'Kovo',
    });
    expect(diagnostic.relatedInformation).toEqual([
      expect.objectContaining({ message: record().help }),
    ]);
  });

  it('uses exact UTF-16 source offsets and refuses out-of-bounds spans', () => {
    const source = 'const glyph = "😀";\nconst target = true;\n';
    const start = source.indexOf('target');
    const end = start + 'target'.length;
    const projection = createEditorDiagnosticProjection(
      record({ source: { end, file: 'src/app.tsx', start } }),
      documentFor(source),
      'file:///workspace/src/app.tsx',
    );
    expect(projection.range).toEqual({
      end: { character: 12, line: 1 },
      start: { character: 6, line: 1 },
    });
    expect(() =>
      createEditorDiagnosticProjection(
        record({ source: { end: source.length + 1, file: 'src/app.tsx', start } }),
        documentFor(source),
        'file:///workspace/src/app.tsx',
      ),
    ).toThrow(/outside the opened source/u);
  });

  it('keeps source-less facts source-less', () => {
    const diagnostic = record({ source: undefined });
    delete diagnostic.source;
    expect(formatSourceLessDiagnostic(diagnostic)).toBe(
      `ERROR KV436 Missing explicit access decision.\nHELP ${record().help}`,
    );
    expect(() =>
      createEditorDiagnosticProjection(diagnostic, documentFor(''), 'file:///invented'),
    ).toThrow(/requires a producer-owned source anchor/u);
  });

  it('confines watched artifacts and producer source paths to the workspace', () => {
    const root = path.join(repoRoot, 'examples', 'crm');
    expect(resolveDiagnosticArtifactPath(root, '.kovo/diagnostics.json')).toBe(
      path.join(root, '.kovo', 'diagnostics.json'),
    );
    expect(resolveWorkspaceSourcePath(root, 'src/app.tsx')).toBe(path.join(root, 'src', 'app.tsx'));
    expect(() => resolveDiagnosticArtifactPath(root, path.join(repoRoot, 'outside.json'))).toThrow(
      /workspace-relative/u,
    );
    expect(() => resolveWorkspaceSourcePath(root, '../commerce/src/app.tsx')).toThrow(
      /outside the workspace/u,
    );
  });

  it('delegates one relative TSX path to kovo fix without a shell or diagnostic-code table', () => {
    const root = path.join(repoRoot, 'examples', 'crm');
    const invocation = safeFixInvocation({
      pnpmPath: 'pnpm',
      sourceFilePath: path.join(root, 'src', 'app.tsx'),
      workspaceRootPath: root,
    });
    expect(invocation).toEqual({
      args: ['exec', 'kovo', 'fix', 'src/app.tsx'],
      command: 'pnpm',
      cwd: root,
    });
    expect(JSON.stringify(invocation)).not.toMatch(
      /trusted|waiver|csrf|raw.?sql|suppress|allow-diagnostic/iu,
    );
    expect(() =>
      safeFixInvocation({
        pnpmPath: 'pnpm',
        sourceFilePath: path.join(root, 'src', 'graph.json'),
        workspaceRootPath: root,
      }),
    ).toThrow(/only app-authored TSX or JSX/u);
  });
});

describe('named diagnostic parity corpus', () => {
  it('preserves code, severity, help, and source across CLI and editor projections', () => {
    const source = 'const one = 1;\nconst two = 2;\n';
    const sourceAnchor = Object.freeze({ end: 29, file: 'src/facts.tsx', start: 15 });
    const registered = [
      ['KV201', 'error'],
      ['KV241', 'warn'],
      ['KV210', 'lint'],
      ['KV409', 'notice'],
    ].map(([code, severity]) => {
      const diagnostic = createRegisteredDiagnostic(
        code,
        { source: sourceAnchor },
        { includeHelp: true, message: `${code} parity fixture.` },
      );
      expect(diagnostic.severity).toBe(severity);
      return projectKovoDiagnostic(diagnostic, 'proof');
    });
    const json = formatKovoDiagnostics(registered, 'json');
    const parsed = parseDiagnosticEnvelopeText(json);
    const human = formatKovoDiagnostics(registered, 'human');
    const github = formatKovoDiagnostics(registered, 'github');

    for (const [index, producer] of registered.entries()) {
      const editor = createEditorDiagnosticProjection(
        parsed.diagnostics[index],
        documentFor(source),
        'file:///workspace/src/facts.tsx',
      );
      expect(editor.facts).toEqual({
        code: producer.code,
        help: producer.help,
        severity: producer.severity,
        source: producer.source,
      });
      expect(human).toContain(`${producer.severity.toUpperCase()} ${producer.code}`);
      expect(github).toContain(`title=${producer.code} proof [15%3A29]`);
      if (producer.help === undefined) {
        expect(human).not.toContain(`HELP ${producer.code}`);
      } else {
        expect(human).toContain(`HELP ${producer.help}`);
        expect(github).toContain(producer.help.replaceAll('\n', '%0A'));
      }
    }
  });

  it('accepts the exact MCP compile diagnostics without a second projection schema', async () => {
    const mcp = await compileComponentV1(
      {
        fileName: 'cart-badge.tsx',
        source: '<button onClick={() => window.alert("x")}>x</button>',
      },
      repoRoot,
    );
    const json = formatKovoDiagnostics(mcp.diagnostics, 'json');
    const editor = parseDiagnosticEnvelopeText(json);
    expect(editor.diagnostics).toEqual(mcp.diagnostics);
    expect(
      editor.diagnostics.map(({ code, severity, source }) => ({ code, severity, source })),
    ).toEqual([
      {
        code: 'KV210',
        severity: 'lint',
        source: { end: 13, file: 'cart-badge.tsx', start: 8 },
      },
      {
        code: 'KV201',
        severity: 'error',
        source: { end: 16, file: 'cart-badge.tsx', start: 8 },
      },
      {
        code: 'KV449',
        severity: 'error',
        source: { end: 40, file: 'cart-badge.tsx', start: 23 },
      },
    ]);
  });
});
