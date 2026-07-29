import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import extension from './extension.cjs';

const { applyCompilerProvenFix, createFolderState, createKovoEditorExtension, runBoundedProcess } =
  extension;
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

function disposable() {
  return { dispose: vi.fn() };
}

function extensionApi() {
  let codeActionProvider;
  const commandHandlers = new Map();
  const collection = { ...disposable(), delete: vi.fn(), set: vi.fn() };
  const output = { ...disposable(), appendLine: vi.fn() };
  class CodeAction {
    constructor(title, kind) {
      this.kind = kind;
      this.title = title;
    }
  }
  return {
    api: {
      CodeAction,
      CodeActionKind: { QuickFix: 'quickfix' },
      commands: {
        registerCommand(name, handler) {
          commandHandlers.set(name, handler);
          return disposable();
        },
      },
      languages: {
        createDiagnosticCollection: vi.fn(() => collection),
        registerCodeActionsProvider: vi.fn((_selectors, provider) => {
          codeActionProvider = provider;
          return disposable();
        }),
      },
      window: {
        createOutputChannel: vi.fn(() => output),
        showWarningMessage: vi.fn(),
      },
      workspace: {
        onDidChangeConfiguration: vi.fn(() => disposable()),
        onDidChangeWorkspaceFolders: vi.fn(() => disposable()),
        workspaceFolders: [],
      },
    },
    collection,
    commandHandlers,
    getCodeActionProvider: () => codeActionProvider,
    output,
  };
}

function processChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

function watchApi(workspaceRoot, readArtifact) {
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
  class RelativePattern {
    constructor(folder, pattern) {
      this.base = folder;
      this.pattern = pattern;
    }
  }
  const uriFor = (file) => ({
    fsPath: file,
    scheme: 'file',
    toString: () => `file://${file}`,
  });
  const watcher = {
    ...disposable(),
    onDidChange: vi.fn(() => disposable()),
    onDidCreate: vi.fn(() => disposable()),
    onDidDelete: vi.fn(() => disposable()),
  };
  const source = 'const before = true;\nconst target = false;\n';
  return {
    Diagnostic,
    DiagnosticRelatedInformation,
    DiagnosticSeverity: { Error: 0, Hint: 3, Information: 2, Warning: 1 },
    FileType: { File: 1, SymbolicLink: 64 },
    Location,
    Range,
    RelativePattern,
    Uri: { file: uriFor },
    workspace: {
      createFileSystemWatcher: vi.fn(() => watcher),
      fs: {
        readFile: vi.fn(async () => readArtifact()),
        stat: vi.fn(async () => ({ size: readArtifact().byteLength, type: 1 })),
      },
      getConfiguration: vi.fn(() => ({ get: () => '.kovo/diagnostics.json' })),
      openTextDocument: vi.fn(async (uri) => ({
        getText: () => source,
        positionAt(offset) {
          const prefix = source.slice(0, offset);
          const lines = prefix.split('\n');
          return { character: lines.at(-1).length, line: lines.length - 1 };
        },
        uri,
      })),
    },
    workspaceRoot,
  };
}

describe('VS Code extension boundary', () => {
  it('loads watched facts and clears all prior Problems on malformed replacement', async () => {
    const workspaceRoot = path.join(repoRoot, 'examples', 'crm');
    let bytes = Buffer.from(
      JSON.stringify({
        diagnostics: [
          {
            category: 'proof',
            code: 'KV436',
            help: 'Choose explicit access.',
            message: 'Missing access.',
            severity: 'error',
            source: { end: 36, file: 'src/app.tsx', start: 24 },
            version: 'kovo-diagnostic/v1',
          },
          {
            category: 'config',
            code: 'KOVO_DOCTOR_CONFIG',
            help: 'Create kovo.config.ts.',
            message: 'Missing config.',
            severity: 'error',
            version: 'kovo-diagnostic/v1',
          },
        ],
        version: 'kovo-diagnostic/v1',
      }),
    );
    const vscode = watchApi(workspaceRoot, () => bytes);
    const collection = { delete: vi.fn(), set: vi.fn() };
    const output = { appendLine: vi.fn() };
    const folder = {
      name: 'crm',
      uri: vscode.Uri.file(workspaceRoot),
    };
    const state = createFolderState(vscode, folder, collection, output);

    await state.refresh();
    expect(collection.set).toHaveBeenCalledOnce();
    expect(collection.set.mock.calls[0][1]).toEqual([
      expect.objectContaining({
        code: 'KV436',
        message: 'Missing access.',
        severity: 0,
        source: 'Kovo',
      }),
    ]);
    expect(output.appendLine).toHaveBeenCalledWith(
      'LOADED workspace=crm diagnostics=2 anchored=1 source-less=1',
    );
    expect(output.appendLine).toHaveBeenCalledWith(
      'ERROR KOVO_DOCTOR_CONFIG Missing config.\nHELP Create kovo.config.ts.',
    );

    bytes = Buffer.from('{ malformed');
    await state.refresh();
    expect(collection.delete).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: path.join(workspaceRoot, 'src', 'app.tsx') }),
    );
    expect(output.appendLine).toHaveBeenCalledWith(
      expect.stringContaining('stale diagnostics cleared'),
    );
    state.dispose();
  });

  it('registers a command-only quick fix with no editor-authored WorkspaceEdit', () => {
    const harness = extensionApi();
    const instance = createKovoEditorExtension(harness.api);
    const actions = harness
      .getCodeActionProvider()
      .provideCodeActions({ uri: 'file:///workspace/src/app.tsx' }, undefined, {
        diagnostics: [{ code: 'KV436', source: 'Kovo' }],
      });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      command: {
        arguments: ['file:///workspace/src/app.tsx'],
        command: 'kovo.diagnostics.applySafeFix',
      },
      diagnostics: [{ code: 'KV436', source: 'Kovo' }],
      isPreferred: false,
      kind: 'quickfix',
    });
    expect(actions[0]).not.toHaveProperty('edit');
    instance.dispose();
  });

  it('does not offer actions for diagnostics owned by another producer', () => {
    const harness = extensionApi();
    const instance = createKovoEditorExtension(harness.api);
    expect(
      harness
        .getCodeActionProvider()
        .provideCodeActions({ uri: 'file:///workspace/src/app.tsx' }, undefined, {
          diagnostics: [{ code: 1234, source: 'TypeScript' }],
        }),
    ).toEqual([]);
    instance.dispose();
  });

  it('refuses process authority in an untrusted workspace', async () => {
    const spawnProcess = vi.fn();
    const vscode = {
      window: { showWarningMessage: vi.fn() },
      workspace: { isTrusted: false },
    };
    await applyCompilerProvenFix(vscode, spawnProcess, { appendLine: vi.fn() }, {});
    expect(spawnProcess).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Kovo safe fixes require a trusted workspace.',
    );
  });

  it('refuses dirty and symlinked source files before process execution', async () => {
    const workspaceRoot = path.join(repoRoot, 'examples', 'crm');
    const uri = {
      fsPath: path.join(workspaceRoot, 'src', 'app.tsx'),
      scheme: 'file',
      toString: () => 'file:///workspace/src/app.tsx',
    };
    const spawnProcess = vi.fn();
    const warnings = vi.fn();
    const base = {
      FileType: { File: 1, SymbolicLink: 64 },
      ProgressLocation: { Notification: 15 },
      window: {
        showInformationMessage: vi.fn(),
        showWarningMessage: warnings,
        withProgress: vi.fn(async (_options, task) => task()),
      },
      workspace: {
        fs: { stat: vi.fn(async () => ({ size: 10, type: 65 })) },
        getConfiguration: vi.fn(() => ({ get: () => 'pnpm' })),
        getWorkspaceFolder: vi.fn(() => ({ uri: { fsPath: workspaceRoot } })),
        isTrusted: true,
        textDocuments: [{ isDirty: true, uri }],
      },
    };
    await applyCompilerProvenFix(base, spawnProcess, { appendLine: vi.fn() }, uri);
    expect(warnings).toHaveBeenCalledWith('Save the file before running a compiler-proven fix.');

    base.workspace.textDocuments[0].isDirty = false;
    await applyCompilerProvenFix(base, spawnProcess, { appendLine: vi.fn() }, uri);
    expect(warnings).toHaveBeenCalledWith(
      'Kovo safe fix refused: Kovo safe fixes require a regular non-symlink source file.',
    );
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('delegates a clean in-workspace TSX file to kovo fix with shell disabled', async () => {
    const workspaceRoot = path.join(repoRoot, 'examples', 'crm');
    const uri = {
      fsPath: path.join(workspaceRoot, 'src', 'app.tsx'),
      scheme: 'file',
      toString: () => 'file:///workspace/src/app.tsx',
    };
    const folder = { uri: { fsPath: workspaceRoot } };
    const child = processChild();
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from('OK kovo fix src/app.tsx rewritten=1\n'));
        child.emit('close', 0, null);
      });
      return child;
    });
    const output = { appendLine: vi.fn() };
    const vscode = {
      FileType: { File: 1, SymbolicLink: 64 },
      ProgressLocation: { Notification: 15 },
      window: {
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        withProgress: vi.fn(async (_options, task) => task()),
      },
      workspace: {
        fs: { stat: vi.fn(async () => ({ size: 10, type: 1 })) },
        getConfiguration: vi.fn(() => ({ get: () => 'pnpm' })),
        getWorkspaceFolder: vi.fn(() => folder),
        isTrusted: true,
        textDocuments: [{ isDirty: false, uri }],
      },
    };

    await applyCompilerProvenFix(vscode, spawnProcess, output, uri);
    expect(spawnProcess).toHaveBeenCalledWith('pnpm', ['exec', 'kovo', 'fix', 'src/app.tsx'], {
      cwd: workspaceRoot,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(output.appendLine).toHaveBeenCalledWith('OK kovo fix src/app.tsx rewritten=1');
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Kovo safe fix completed. Rerun the diagnostic producer to refresh Problems.',
    );
  });

  it('kills a fix subprocess whose output exceeds the editor transport budget', async () => {
    const child = processChild();
    const spawnProcess = () => {
      queueMicrotask(() => child.stdout.emit('data', Buffer.alloc(256 * 1024 + 1, 65)));
      return child;
    };
    const result = await runBoundedProcess(spawnProcess, {
      args: ['exec', 'kovo', 'fix', 'src/app.tsx'],
      command: 'pnpm',
      cwd: repoRoot,
    });
    expect(child.kill).toHaveBeenCalledOnce();
    expect(result).toEqual({
      exitCode: 2,
      output: expect.stringContaining('exceeded its editor transport budget'),
    });
  });
});
