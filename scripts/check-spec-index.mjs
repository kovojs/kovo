#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const defaultRepoRoot = path.resolve(scriptDir, '..');

export const requiredSpecModules = [
  'spec/04-component-model.md',
  'spec/05-compiler.md',
  'spec/06-type-system.md',
  'spec/07-navigation.md',
  'spec/09-wire-protocol.md',
  'spec/10-data-plane.md',
  'spec/11-verification.md',
  'spec/11-diagnostics.md',
  'spec/12-testing.md',
  'spec/14-deploy-skew.md',
];

export const movedSectionMappings = [
  { section: '4', target: 'spec/04-component-model.md' },
  { section: '5', target: 'spec/05-compiler.md' },
  { section: '6', target: 'spec/06-type-system.md' },
  { section: '7', target: 'spec/07-navigation.md' },
  { section: '8', target: 'spec/07-navigation.md' },
  { section: '9', target: 'spec/09-wire-protocol.md' },
  { section: '10', target: 'spec/10-data-plane.md' },
  { section: '11', target: 'spec/11-verification.md' },
  { section: '11.3', target: 'spec/11-diagnostics.md' },
  { section: '12', target: 'spec/12-testing.md' },
  { section: '13.1', target: 'spec/04-component-model.md' },
  { section: '13.2', target: 'spec/04-component-model.md' },
  { section: '14', target: 'spec/14-deploy-skew.md' },
];

const requiredSpecModuleSet = new Set(requiredSpecModules);
const preSplitRootLineThreshold = 1000;

export function collectSpecModuleLinks(markdown) {
  const text = stripFencedCodeBlocks(markdown);
  const targets = [];
  const inlineLinkPattern = /!?\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^)]*["'])?\s*\)/g;
  const referenceDefinitionPattern = /^\s*\[[^\]\n]+]:\s*<?([^\s>]+)>?/gm;
  const autolinkPattern = /<((?:\.\/)?spec\/[^>\s)]+\.md(?:#[^>\s)]*)?)>/g;

  collectMarkdownTargets(text, inlineLinkPattern, targets);
  collectMarkdownTargets(text, referenceDefinitionPattern, targets);
  collectMarkdownTargets(text, autolinkPattern, targets);

  return uniqueSorted(targets.map(normalizeSpecModuleTarget).filter(Boolean));
}

export function validateSpecIndex({ rootDir = defaultRepoRoot } = {}) {
  const rootSpecPath = path.join(rootDir, 'SPEC.md');
  const rootSpec = readFileSync(rootSpecPath, 'utf8');
  const specModuleLinks = collectSpecModuleLinks(rootSpec);
  const linkedSpecModuleSet = new Set(specModuleLinks);
  const specDirPath = path.join(rootDir, 'spec');
  const specDirStat = statIfExists(specDirPath);
  const rootLineCount = countLines(rootSpec);
  const splitActive =
    specDirStat !== undefined ||
    specModuleLinks.length > 0 ||
    rootLineCount <= preSplitRootLineThreshold;

  if (!splitActive) {
    return {
      ok: true,
      skipped: true,
      findings: [],
      summary:
        'pre-split SPEC.md detected; spec-index enforcement starts when spec/ or root module links exist',
    };
  }

  const findings = [];
  const existingSpecModules = specDirStat?.isDirectory()
    ? listTopLevelSpecModules(specDirPath)
    : [];
  const existingSpecModuleSet = new Set(existingSpecModules);

  if (specDirStat === undefined) {
    findings.push('spec/ directory is missing after the root SPEC split appears active');
  } else if (!specDirStat.isDirectory()) {
    findings.push('spec/ exists but is not a directory');
  }

  for (const specModule of requiredSpecModules) {
    if (!existingSpecModuleSet.has(specModule)) {
      findings.push(`required spec module is missing: ${specModule}`);
    }
    if (!linkedSpecModuleSet.has(specModule)) {
      findings.push(`SPEC.md must link required spec module: ${specModule}`);
    }
  }

  for (const specModule of existingSpecModules) {
    if (!requiredSpecModuleSet.has(specModule) && !linkedSpecModuleSet.has(specModule)) {
      findings.push(`SPEC.md must link existing spec module: ${specModule}`);
    }
  }

  for (const specModule of specModuleLinks) {
    if (!existsSync(path.join(rootDir, specModule))) {
      findings.push(`SPEC.md links ${specModule}, but that file does not exist`);
    }
  }

  const evidenceChunks = markdownEvidenceChunks(rootSpec);
  if (!hasDiagnosticOwnerLink(evidenceChunks)) {
    findings.push(
      'SPEC.md must identify spec/11-diagnostics.md as the diagnostic registry owner/source',
    );
  }

  for (const mapping of movedSectionMappings) {
    if (!hasSectionMapping(evidenceChunks, mapping)) {
      findings.push(`SPEC.md must map old SPEC §${mapping.section} citations to ${mapping.target}`);
    }
  }

  return {
    ok: findings.length === 0,
    skipped: false,
    findings,
    summary: findings.length === 0 ? 'spec index is complete' : 'spec index drift detected',
  };
}

export function runSpecIndexCheck(options = {}) {
  const result = validateSpecIndex(options);
  if (result.ok) {
    process.stdout.write(
      `check-spec-index/v1\n${result.skipped ? 'SKIP' : 'OK'} ${result.summary}\n`,
    );
    return 0;
  }

  process.stderr.write(
    `check-spec-index/v1\nFAIL ${result.summary}:\n${result.findings
      .map((finding) => `- ${finding}`)
      .join('\n')}\n`,
  );
  return 1;
}

function collectMarkdownTargets(text, pattern, targets) {
  for (const match of text.matchAll(pattern)) {
    targets.push(match[1]);
  }
}

function normalizeSpecModuleTarget(target) {
  const normalized = target
    .trim()
    .replace(/^<|>$/g, '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .split('#')[0]
    .split('?')[0];

  if (!normalized.startsWith('spec/') || !normalized.endsWith('.md')) return undefined;
  if (normalized.includes('..')) return undefined;
  return normalized;
}

function listTopLevelSpecModules(specDirPath) {
  return readdirSync(specDirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => `spec/${entry.name}`)
    .sort(compareStrings);
}

function statIfExists(filePath) {
  try {
    return statSync(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

function stripFencedCodeBlocks(markdown) {
  return markdown.replace(/^```[\s\S]*?^```/gm, '');
}

function markdownEvidenceChunks(markdown) {
  const text = stripFencedCodeBlocks(markdown);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const paragraphs = text
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return [...lines, ...paragraphs];
}

function hasDiagnosticOwnerLink(chunks) {
  return chunks.some(
    (chunk) =>
      chunk.includes('spec/11-diagnostics.md') &&
      /\bdiagnostics?\b/i.test(chunk) &&
      /\b(?:owner|owns|owned|authoritative|authority|source|registry|normative)\b/i.test(chunk),
  );
}

function hasSectionMapping(chunks, { section, target }) {
  const pattern = sectionReferencePattern(section);
  return chunks.some((chunk) => chunk.includes(target) && pattern.test(chunk));
}

function sectionReferencePattern(section) {
  const escaped = escapeRegExp(section);
  return new RegExp(`(?:§\\s*${escaped}(?=$|[^\\d])|\\bsection\\s+${escaped}(?=$|[^\\d]))`, 'i');
}

function countLines(text) {
  if (text.length === 0) return 0;
  return text.split(/\r?\n/).length;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort(compareStrings);
}

function compareStrings(a, b) {
  return a.localeCompare(b);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exit(runSpecIndexCheck());
}
