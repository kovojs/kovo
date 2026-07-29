'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const { TextDecoder } = require('node:util');

const {
  MAX_ENVELOPE_BYTES,
  createEditorDiagnosticProjection,
  createVscodeDiagnostic,
  formatSourceLessDiagnostic,
  parseDiagnosticEnvelopeText,
  resolveDiagnosticArtifactPath,
  resolveWorkspaceSourcePath,
  safeFixInvocation,
} = require('./diagnostic-adapter.cjs');

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_FIX_OUTPUT_BYTES = 256 * 1024;

/** @type {undefined | {dispose(): void}} */
let activeExtension;

/**
 * VS Code activation entry. The runtime dependency is acquired only inside the extension host,
 * keeping the fact adapter independently testable and packageable.
 *
 * @param {{subscriptions: Array<{dispose(): void}>}} context
 */
function activate(context) {
  const vscode = require('vscode');
  activeExtension = createKovoEditorExtension(vscode);
  context.subscriptions.push(activeExtension);
}

function deactivate() {
  activeExtension?.dispose();
  activeExtension = undefined;
}

/**
 * Build the presentation-only extension against the VS Code API.
 *
 * @param {Record<string, any>} vscode
 * @param {{spawnProcess?: typeof spawn}} dependencies
 */
function createKovoEditorExtension(vscode, dependencies = {}) {
  const spawnProcess = dependencies.spawnProcess ?? spawn;
  const collection = vscode.languages.createDiagnosticCollection('kovo');
  const output = vscode.window.createOutputChannel('Kovo Diagnostics');
  /** @type {Map<string, ReturnType<typeof createFolderState>>} */
  const folders = new Map();
  const disposables = [collection, output];
  let disposed = false;
  let fixRunning = false;

  function addFolder(folder) {
    const key = folder.uri.toString();
    folders.get(key)?.dispose();
    const state = createFolderState(vscode, folder, collection, output);
    folders.set(key, state);
    void state.refresh();
  }

  function removeFolder(folder) {
    const key = folder.uri.toString();
    folders.get(key)?.dispose();
    folders.delete(key);
  }

  function rebuildFolders() {
    for (const state of folders.values()) state.dispose();
    folders.clear();
    for (const folder of vscode.workspace.workspaceFolders ?? []) addFolder(folder);
  }

  rebuildFolders();
  disposables.push(
    vscode.workspace.onDidChangeWorkspaceFolders((event) => {
      for (const folder of event.removed) removeFolder(folder);
      for (const folder of event.added) addFolder(folder);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('kovo.diagnostics.file')) rebuildFolders();
    }),
    vscode.commands.registerCommand('kovo.diagnostics.refresh', async () => {
      await Promise.all([...folders.values()].map(async (state) => state.refresh()));
    }),
    vscode.commands.registerCommand('kovo.diagnostics.applySafeFix', async (uri) => {
      if (fixRunning) {
        void vscode.window.showWarningMessage('A compiler-proven Kovo fix is already running.');
        return;
      }
      fixRunning = true;
      try {
        await applyCompilerProvenFix(vscode, spawnProcess, output, uri);
      } finally {
        fixRunning = false;
      }
    }),
    vscode.languages.registerCodeActionsProvider(
      [
        { language: 'typescriptreact', scheme: 'file' },
        { language: 'javascriptreact', scheme: 'file' },
      ],
      {
        provideCodeActions(document, _range, context) {
          const diagnostics = context.diagnostics.filter(
            (diagnostic) => diagnostic.source === 'Kovo',
          );
          if (diagnostics.length === 0) return [];
          const action = new vscode.CodeAction(
            'Kovo: Apply compiler-proven safe fix for this file',
            vscode.CodeActionKind.QuickFix,
          );
          action.command = {
            arguments: [document.uri],
            command: 'kovo.diagnostics.applySafeFix',
            title: 'Kovo: Apply compiler-proven safe fix',
          };
          action.diagnostics = diagnostics;
          action.isPreferred = false;
          return [action];
        },
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
  );

  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const state of folders.values()) state.dispose();
      folders.clear();
      for (const disposable of disposables.reverse()) disposable.dispose();
    },
  });
}

function createFolderState(vscode, folder, collection, output) {
  const configuration = vscode.workspace.getConfiguration('kovo.diagnostics', folder.uri);
  const configuredPath = configuration.get('file', '.kovo/diagnostics.json');
  let artifactPath;
  let artifactUri;
  /** @type {Map<string, unknown>} */
  let published = new Map();
  let revision = 0;
  let disposed = false;

  try {
    artifactPath = resolveDiagnosticArtifactPath(folder.uri.fsPath, configuredPath);
    artifactUri = vscode.Uri.file(artifactPath);
  } catch (error) {
    output.appendLine(
      `REFUSED workspace=${folder.name} reason=${singleLine(error)}; no diagnostics published`,
    );
    return inertFolderState();
  }

  const relativePath = path.relative(folder.uri.fsPath, artifactPath).split(path.sep).join('/');
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(folder, relativePath),
    false,
    false,
    false,
  );
  const subscriptions = [
    watcher,
    watcher.onDidCreate(() => void refresh()),
    watcher.onDidChange(() => void refresh()),
    watcher.onDidDelete(() => clear('diagnostic artifact deleted')),
  ];

  function clear(reason) {
    revision += 1;
    for (const uri of published.values()) collection.delete(uri);
    published = new Map();
    output.appendLine(`CLEARED workspace=${folder.name} reason=${reason}`);
  }

  async function refresh() {
    if (disposed) return;
    const currentRevision = ++revision;
    try {
      const stat = await vscode.workspace.fs.stat(artifactUri);
      if (
        stat.size <= 0 ||
        stat.size > MAX_ENVELOPE_BYTES ||
        (stat.type & vscode.FileType.SymbolicLink) !== 0
      ) {
        throw new TypeError('diagnostic artifact must be a bounded regular non-symlink file');
      }
      const bytes = await vscode.workspace.fs.readFile(artifactUri);
      if (bytes.byteLength <= 0 || bytes.byteLength > MAX_ENVELOPE_BYTES) {
        throw new TypeError('diagnostic artifact changed outside the bounded stat snapshot');
      }
      const envelope = parseDiagnosticEnvelopeText(utf8Decoder.decode(bytes));
      const next = new Map();
      const documents = new Map();
      const sourceLess = [];

      for (const record of envelope.diagnostics) {
        if (record.source === undefined) {
          sourceLess.push(formatSourceLessDiagnostic(record));
          continue;
        }
        const sourcePath = resolveWorkspaceSourcePath(folder.uri.fsPath, record.source.file);
        const sourceUri = vscode.Uri.file(sourcePath);
        const uriKey = sourceUri.toString();
        let document = documents.get(uriKey);
        if (document === undefined) {
          const sourceStat = await vscode.workspace.fs.stat(sourceUri);
          if (
            (sourceStat.type & vscode.FileType.File) === 0 ||
            (sourceStat.type & vscode.FileType.SymbolicLink) !== 0
          ) {
            throw new TypeError(
              'diagnostic source anchor must resolve to a regular non-symlink file',
            );
          }
          document = await vscode.workspace.openTextDocument(sourceUri);
          documents.set(uriKey, document);
        }
        const projection = createEditorDiagnosticProjection(record, document, sourceUri);
        const diagnostics = next.get(uriKey)?.diagnostics ?? [];
        diagnostics.push(createVscodeDiagnostic(vscode, projection));
        next.set(uriKey, { diagnostics, uri: sourceUri });
      }

      if (disposed || currentRevision !== revision) return;
      for (const [key, uri] of published) {
        if (!next.has(key)) collection.delete(uri);
      }
      const nextPublished = new Map();
      for (const [key, entry] of next) {
        collection.set(entry.uri, entry.diagnostics);
        nextPublished.set(key, entry.uri);
      }
      published = nextPublished;
      output.appendLine(
        `LOADED workspace=${folder.name} diagnostics=${String(envelope.diagnostics.length)} anchored=${String(
          envelope.diagnostics.length - sourceLess.length,
        )} source-less=${String(sourceLess.length)}`,
      );
      for (const message of sourceLess) output.appendLine(message);
    } catch (error) {
      if (disposed || currentRevision !== revision) return;
      for (const uri of published.values()) collection.delete(uri);
      published = new Map();
      output.appendLine(
        `REFUSED workspace=${folder.name} reason=${singleLine(error)}; stale diagnostics cleared`,
      );
    }
  }

  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      revision += 1;
      for (const uri of published.values()) collection.delete(uri);
      published = new Map();
      for (const subscription of subscriptions.reverse()) subscription.dispose();
    },
    refresh,
  });
}

function inertFolderState() {
  return Object.freeze({
    dispose() {},
    async refresh() {},
  });
}

async function applyCompilerProvenFix(vscode, spawnProcess, output, uri) {
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showWarningMessage('Kovo safe fixes require a trusted workspace.');
    return;
  }
  if (uri === undefined || uri.scheme !== 'file') {
    void vscode.window.showWarningMessage('Kovo safe fixes require a workspace file.');
    return;
  }
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (folder === undefined) {
    void vscode.window.showWarningMessage('Kovo safe fixes refuse files outside the workspace.');
    return;
  }
  const document = vscode.workspace.textDocuments.find(
    (candidate) => candidate.uri.toString() === uri.toString(),
  );
  if (document?.isDirty) {
    void vscode.window.showWarningMessage('Save the file before running a compiler-proven fix.');
    return;
  }

  let invocation;
  try {
    const pnpmPath = vscode.workspace
      .getConfiguration('kovo.diagnostics', uri)
      .get('pnpmPath', 'pnpm');
    invocation = safeFixInvocation({
      pnpmPath,
      sourceFilePath: uri.fsPath,
      workspaceRootPath: folder.uri.fsPath,
    });
    const stat = await vscode.workspace.fs.stat(uri);
    if (
      (stat.type & vscode.FileType.File) === 0 ||
      (stat.type & vscode.FileType.SymbolicLink) !== 0
    ) {
      throw new TypeError('Kovo safe fixes require a regular non-symlink source file.');
    }
  } catch (error) {
    void vscode.window.showWarningMessage(`Kovo safe fix refused: ${singleLine(error)}`);
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Running compiler-proven Kovo fix',
    },
    async () => {
      const result = await runBoundedProcess(spawnProcess, invocation);
      if (result.exitCode === 0) {
        output.appendLine(result.output);
        void vscode.window.showInformationMessage(
          'Kovo safe fix completed. Rerun the diagnostic producer to refresh Problems.',
        );
        return;
      }
      output.appendLine(result.output);
      void vscode.window.showWarningMessage(
        'Kovo did not apply a safe fix. See the Kovo Diagnostics output channel.',
      );
    },
  );
}

function runBoundedProcess(spawnProcess, invocation) {
  return new Promise((resolve) => {
    const child = spawnProcess(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    let output = '';
    let outputBytes = 0;

    function finish(exitCode, suffix = '') {
      if (settled) return;
      settled = true;
      resolve(
        Object.freeze({
          exitCode,
          output: `${output}${suffix}`.trim(),
        }),
      );
    }

    function append(chunk) {
      if (settled) return;
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      outputBytes += value.byteLength;
      if (outputBytes > MAX_FIX_OUTPUT_BYTES) {
        child.kill();
        finish(2, '\nKovo safe fix output exceeded its editor transport budget.');
        return;
      }
      output += value.toString('utf8');
    }

    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', (error) => finish(2, `\n${singleLine(error)}`));
    child.on('close', (code, signal) =>
      finish(code === 0 ? 0 : 1, signal === null ? '' : `\nterminated by ${signal}`),
    );
  });
}

function singleLine(value) {
  return (value instanceof Error ? value.message : String(value)).replace(/\s+/gu, ' ').trim();
}

module.exports = Object.freeze({
  activate,
  applyCompilerProvenFix,
  createFolderState,
  createKovoEditorExtension,
  deactivate,
  runBoundedProcess,
});
