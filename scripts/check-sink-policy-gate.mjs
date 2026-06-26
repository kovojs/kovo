#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const defaultSinkPolicyPath = 'packages/core/src/internal/sink-policy.ts';

export const defaultBlessedSinkFiles = [
  defaultSinkPolicyPath,
  'packages/core/src/internal/sql-safety.ts',
  'packages/core/src/index.ts',
  'packages/server/src/file.ts',
  'packages/server/src/response.ts',
  'packages/server/src/route.ts',
];

export const defaultPublicEntrypointFiles = [
  'packages/core/src/index.ts',
  'packages/server/src/index.ts',
];

const allowedSinkPolicyExports = new Set([
  'Blessed',
  'FRAMEWORK_BLESSED_SINK_KINDS',
  'FrameworkBlessedSinkKind',
  'RuntimeSinkAction',
  'RuntimeSinkDecision',
  'RuntimeSinkFamily',
  'RuntimeSinkSecurityEvent',
  'RuntimeSinkSecurityEventHandler',
  'SAFE_URL_SCHEMES',
  'SRCSET_ATTRIBUTE_NAMES',
  'RAW_HTML_SINK_NAMES',
  'URL_ATTRIBUTE_NAMES',
  'blessSink',
  'decideRuntimeAttributeWrite',
  'drainRuntimeSinkSecurityEvent',
  'hasUnsafeCssText',
  'hasUnsafeCssUrl',
  'isBlessedSink',
  'isCssTextAttributeName',
  'isEventHandlerAttributeName',
  'isRawHtmlSinkName',
  'isSrcdocAttributeName',
  'isSrcsetAttributeName',
  'runtimeSinkFamilyForAttribute',
  'sanitizeRuntimeSrcset',
  'setRuntimeSinkSecurityEventHandler',
]);

const forbiddenPublicEscapeNames = new Set([
  'assertBlessed',
  'assertBlessedSink',
  'bless',
  'blessSink',
  'trust',
  'trustSink',
  'trusted',
  'isBlessedSink',
]);

export function checkSinkPolicyGate(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const sinkPolicyPath = options.sinkPolicyPath ?? defaultSinkPolicyPath;
  const blessedSinkFiles = options.blessedSinkFiles ?? defaultBlessedSinkFiles;
  const publicEntrypointFiles = options.publicEntrypointFiles ?? defaultPublicEntrypointFiles;
  const readText =
    options.readText ?? ((relativePath) => readFileSync(path.join(root, relativePath), 'utf8'));
  const exists = options.exists ?? ((relativePath) => existsSync(path.join(root, relativePath)));

  const findings = [];
  const sinkPolicyText = readText(sinkPolicyPath);
  const registeredKinds = extractRegisteredBlessedSinkKinds(sinkPolicyText);

  if (registeredKinds.size === 0) {
    findings.push(`${sinkPolicyPath}: FRAMEWORK_BLESSED_SINK_KINDS registry is missing or empty`);
  }

  if (/\bSymbol\.for\s*\(/.test(sinkPolicyText)) {
    findings.push(
      `${sinkPolicyPath}: shared Blessed<Sink> witness substrate must not use Symbol.for()`,
    );
  }

  for (const exportedName of exportedNames(sinkPolicyText)) {
    if (!allowedSinkPolicyExports.has(exportedName)) {
      findings.push(
        `${sinkPolicyPath}: unexpected sink-policy export ${exportedName}; avoid generic trust/bless escape hatches`,
      );
    }
  }

  for (const filePath of blessedSinkFiles) {
    if (!exists(filePath)) {
      findings.push(`${filePath}: blessed sink gate input is missing`);
      continue;
    }

    const text = readText(filePath);
    for (const sinkKind of blessedSinkKindsReferencedByFile(text)) {
      if (!registeredKinds.has(sinkKind)) {
        findings.push(
          `${filePath}: blessed sink kind ${JSON.stringify(
            sinkKind,
          )} is used but not declared in FRAMEWORK_BLESSED_SINK_KINDS`,
        );
      }
    }
  }

  for (const filePath of publicEntrypointFiles) {
    if (!exists(filePath)) continue;
    const text = readText(filePath);
    for (const exportedName of exportedNames(text)) {
      if (forbiddenPublicEscapeNames.has(exportedName)) {
        findings.push(
          `${filePath}: public export ${exportedName} would create a generic blessed-sink escape hatch`,
        );
      }
    }
  }

  return findings;
}

export function extractRegisteredBlessedSinkKinds(text) {
  const registry = /\bFRAMEWORK_BLESSED_SINK_KINDS\s*=\s*\[([\s\S]*?)\]\s+as\s+const\b/.exec(
    stripComments(text),
  );
  if (!registry) return new Set();
  return new Set(stringLiterals(registry[1]));
}

export function blessedSinkKindsReferencedByFile(text) {
  const source = stripComments(text);
  const constants = stringLiteralConstants(source);
  const kinds = new Set();

  for (const kind of stringLiteralUnionTypeMembers(source, /\b\w*BlessedSink\w*\b/g)) {
    kinds.add(kind);
  }

  const callPattern =
    /\b(?:blessSink|isBlessedSink)\s*(?:<[^>()]*>)?\s*\(\s*([A-Za-z_$][\w$]*|'[^']*'|"[^"]*")/g;
  let match;
  while ((match = callPattern.exec(source)) !== null) {
    const argument = match[1];
    if (argument.startsWith("'") || argument.startsWith('"')) {
      kinds.add(argument.slice(1, -1));
      continue;
    }
    const constantValue = constants.get(argument);
    if (constantValue !== undefined) kinds.add(constantValue);
  }

  return kinds;
}

export function exportedNames(text) {
  const source = stripComments(text);
  const names = new Set();
  const declarationPattern =
    /\bexport\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class|interface|type)\s+([A-Za-z_$][\w$]*)/g;
  let declaration;
  while ((declaration = declarationPattern.exec(source)) !== null) {
    names.add(declaration[1]);
  }

  const namedExportPattern = /\bexport\s*\{([^}]+)\}/g;
  let namedExport;
  while ((namedExport = namedExportPattern.exec(source)) !== null) {
    for (const specifier of namedExport[1].split(',')) {
      const cleaned = specifier.trim();
      if (!cleaned) continue;
      names.add(
        cleaned
          .split(/\s+as\s+/)
          .at(-1)
          .trim(),
      );
    }
  }

  return names;
}

function stringLiteralConstants(text) {
  const constants = new Map();
  const pattern = /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*(['"])(.*?)\2/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    constants.set(match[1], match[3]);
  }
  return constants;
}

function stringLiteralUnionTypeMembers(text, namePattern) {
  const kinds = [];
  const typePattern = /\btype\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]*['"][^;]+)\s*;/g;
  let match;
  while ((match = typePattern.exec(text)) !== null) {
    if (!namePattern.test(match[1])) {
      namePattern.lastIndex = 0;
      continue;
    }
    namePattern.lastIndex = 0;
    kinds.push(...stringLiterals(match[2]));
  }
  return kinds;
}

function stringLiterals(text) {
  const values = [];
  const pattern = /(['"])(.*?)\1/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    values.push(match[2]);
  }
  return values;
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = checkSinkPolicyGate();
  if (findings.length > 0) {
    console.error(`Sink policy gate failed with ${findings.length} finding(s):`);
    for (const finding of findings) console.error(`- ${finding}`);
    process.exit(1);
  }
  console.log('Sink policy gate passed.');
}
