#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ts = await loadTypeScript();
const root = process.cwd();
const findings = [];

for (const file of sourceFiles(join(root, 'src'))) {
  const source = readFileSync(file, 'utf8');
  const relativeFile = relative(root, file);
  if (ts) {
    analyzeWithTypeScript(ts, source, relativeFile);
  } else {
    analyzeWithScanner(source, relativeFile);
  }
}

if (findings.length > 0) {
  console.error(`Kovo starter sound-subset check failed:\n${findings.join('\n')}`);
  process.exit(1);
}

console.log('Kovo starter sound-subset check passed.');

function sourceFiles(dir) {
  return readdirSync(dir)
    .flatMap((entry) => {
      const path = join(dir, entry);
      const stats = statSync(path);
      if (stats.isDirectory()) return sourceFiles(path);
      return /\.[cm]?tsx?$/.test(entry) ? [path] : [];
    })
    .sort();
}

async function loadTypeScript() {
  try {
    const module = await import('typescript');
    return module.default ?? module;
  } catch {
    return null;
  }
}

function analyzeWithTypeScript(ts, source, relativeFile) {
  const sourceFile = ts.createSourceFile(
    relativeFile,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(ts, relativeFile),
  );
  visitTypeScriptNode(ts, sourceFile, sourceFile, relativeFile);
}

function visitTypeScriptNode(ts, node, sourceFile, relativeFile) {
  if (node.kind === ts.SyntaxKind.AnyKeyword) {
    reportTypeScriptFinding(sourceFile, relativeFile, node, 'SPEC.md §6.6 sound subset bans any');
  } else if (
    ts.isAsExpression(node) &&
    !isConstAssertion(ts, node, sourceFile) &&
    !isFrameworkTransactionDbBridgeCast(ts, node, sourceFile)
  ) {
    reportTypeScriptFinding(
      sourceFile,
      relativeFile,
      node,
      'SPEC.md §6.6 sound subset bans unchecked casts',
    );
  } else if (ts.isNonNullExpression(node)) {
    reportTypeScriptFinding(
      sourceFile,
      relativeFile,
      node,
      'SPEC.md §6.6 sound subset bans non-null assertions',
    );
  }
  ts.forEachChild(node, (child) => visitTypeScriptNode(ts, child, sourceFile, relativeFile));
}

function isConstAssertion(ts, node, sourceFile) {
  return (
    node.type.kind === ts.SyntaxKind.TypeReference && node.type.getText(sourceFile) === 'const'
  );
}

function isFrameworkTransactionDbBridgeCast(ts, node, sourceFile) {
  if (isFrameworkTransactionDbBridgeOuterCast(ts, node, sourceFile)) return true;
  return (
    ts.isAsExpression(node.parent) &&
    node.parent.expression === node &&
    isFrameworkTransactionDbBridgeOuterCast(ts, node.parent, sourceFile)
  );
}

function isFrameworkTransactionDbBridgeOuterCast(ts, node, sourceFile) {
  if (!ts.isAsExpression(node.expression)) return false;
  if (node.expression.type.getText(sourceFile) !== 'unknown') return false;
  if (!/Db(?:\b|[<.])/.test(node.type.getText(sourceFile))) return false;

  const property = node.parent;
  if (!ts.isPropertyAssignment(property)) return false;
  if (property.name.getText(sourceFile) !== 'db') return false;

  const object = property.parent;
  if (!ts.isObjectLiteralExpression(object)) return false;
  if (!object.properties.some((candidate) => ts.isSpreadAssignment(candidate))) return false;

  const call = object.parent;
  if (!ts.isCallExpression(call)) return false;
  if (call.arguments[0] !== object) return false;
  if (call.expression.getText(sourceFile) !== 'run') return false;

  return isInsideTransactionDefinition(ts, call);
}

function isInsideTransactionDefinition(ts, node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isMethodDeclaration(current)) {
      return current.name?.getText() === 'transaction';
    }
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      ts.isPropertyAssignment(current.parent)
    ) {
      return current.parent.name.getText() === 'transaction';
    }
  }
  return false;
}

function reportTypeScriptFinding(sourceFile, relativeFile, node, message) {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  findings.push(`${relativeFile}:${line + 1}: ${message}`);
}

function scriptKind(ts, file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (file.endsWith('.mts')) return ts.ScriptKind.MTS;
  if (file.endsWith('.cts')) return ts.ScriptKind.CTS;
  if (file.endsWith('.ts')) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function analyzeWithScanner(source, relativeFile) {
  const lines = maskIgnoredText(source).split('\n');
  for (const [index, line] of lines.entries()) {
    if (/\bany\b/.test(line)) {
      findings.push(`${relativeFile}:${index + 1}: SPEC.md §6.6 sound subset bans any`);
    }
    if (/\bas\s+(?!const\b)[A-Za-z_{]/.test(line)) {
      findings.push(`${relativeFile}:${index + 1}: SPEC.md §6.6 sound subset bans unchecked casts`);
    }
    if (/[A-Za-z0-9_$)\]]!\s*(?:[.;,\])}]|\?|$)/.test(line)) {
      findings.push(
        `${relativeFile}:${index + 1}: SPEC.md §6.6 sound subset bans non-null assertions`,
      );
    }
  }
}

function maskIgnoredText(source) {
  const chars = [...source];
  const expressionStack = [];
  let state = 'code';
  let pendingJsxTag = null;

  for (let index = 0; index < chars.length; index += 1) {
    const current = chars[index] ?? '';
    const next = chars[index + 1] ?? '';

    if (state === 'line-comment') {
      if (current !== '\n') chars[index] = ' ';
      else state = restoreState(expressionStack, 'code');
      continue;
    }

    if (state === 'block-comment') {
      if (current === '*' && next === '/') {
        chars[index] = ' ';
        chars[index + 1] = ' ';
        index += 1;
        state = restoreState(expressionStack, 'code');
      } else if (current !== '\n') {
        chars[index] = ' ';
      }
      continue;
    }

    if (state === 'single-quote' || state === 'double-quote') {
      if (current === '\\') {
        chars[index] = ' ';
        if (next && next !== '\n') chars[index + 1] = ' ';
        index += 1;
        continue;
      }
      if (current !== '\n') chars[index] = ' ';
      if (
        (state === 'single-quote' && current === "'") ||
        (state === 'double-quote' && current === '"')
      ) {
        state = restoreState(expressionStack, 'code');
      }
      continue;
    }

    if (state === 'template') {
      if (current === '\\') {
        chars[index] = ' ';
        if (next && next !== '\n') chars[index + 1] = ' ';
        index += 1;
        continue;
      }
      if (current === '$' && next === '{') {
        chars[index] = ' ';
        chars[index + 1] = '{';
        expressionStack.push({ braceDepth: 1, returnState: 'template' });
        state = 'code';
        index += 1;
        continue;
      }
      if (current !== '\n') chars[index] = ' ';
      if (current === '`') state = restoreState(expressionStack, 'code');
      continue;
    }

    if (state === 'jsx-text') {
      if (current === '{') {
        expressionStack.push({ braceDepth: 1, returnState: 'jsx-text' });
        state = 'code';
        continue;
      }
      if (current === '<' && startsJsxTag(chars, index)) {
        pendingJsxTag = classifyJsxTag(chars, index);
        state = 'jsx-tag';
        continue;
      }
      if (current !== '\n') chars[index] = ' ';
      continue;
    }

    if (state === 'jsx-tag') {
      if (current === "'" || current === '"') {
        state = current === "'" ? 'single-quote' : 'double-quote';
        continue;
      }
      if (current === '{') {
        expressionStack.push({ braceDepth: 1, returnState: 'jsx-tag' });
        state = 'code';
        continue;
      }
      if (current === '>') {
        if (pendingJsxTag === 'open') state = 'jsx-text';
        else state = restoreState(expressionStack, 'code');
        pendingJsxTag = null;
      }
      continue;
    }

    if (current === '/' && next === '/') {
      chars[index] = ' ';
      chars[index + 1] = ' ';
      state = 'line-comment';
      index += 1;
      continue;
    }
    if (current === '/' && next === '*') {
      chars[index] = ' ';
      chars[index + 1] = ' ';
      state = 'block-comment';
      index += 1;
      continue;
    }
    if (current === "'" || current === '"') {
      state = current === "'" ? 'single-quote' : 'double-quote';
      continue;
    }
    if (current === '`') {
      state = 'template';
      continue;
    }
    if (current === '<' && startsJsxTag(chars, index)) {
      pendingJsxTag = classifyJsxTag(chars, index);
      state = 'jsx-tag';
      continue;
    }

    const expression = expressionStack.at(-1);
    if (expression) {
      if (current === '{') expression.braceDepth += 1;
      if (current === '}') {
        expression.braceDepth -= 1;
        if (expression.braceDepth === 0) {
          expressionStack.pop();
          state = expression.returnState;
        }
      }
    }
  }

  return chars.join('');
}

function startsJsxTag(chars, index) {
  const next = chars[index + 1] ?? '';
  if (next === '/' || next === '>') return true;
  return /[A-Za-z]/.test(next);
}

function classifyJsxTag(chars, index) {
  return chars[index + 1] === '/' ? 'close' : 'open';
}

function restoreState(expressionStack, fallback) {
  const current = expressionStack.at(-1);
  return current ? current.returnState : fallback;
}
