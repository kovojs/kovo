#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';
import {
  assertCleanCurrentCodeSubject,
  buildSourceSet,
  canonicalJson,
  parseExactCliArguments,
  SECURITY_EVIDENCE_SUBJECT_PROTOCOL,
  validateCodeSubjectSha,
} from './lib/security-evidence-subject.mjs';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const typescriptUrl = new URL(specifier.replace(/\.js$/u, '.ts'), context.parentURL);
      if (existsSync(typescriptUrl)) return nextResolve(typescriptUrl.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const [provenanceModule, policyModule, headerGrammarModule, ipv4GrammarModule] = await Promise.all([
  import('./provenance-closure.mjs'),
  import('../packages/server/src/postgres-authorization-correspondence.ts'),
  import('../packages/server/src/internal/header-serializer-grammars.ts'),
  import('../packages/server/src/internal/ipv4-grammars.ts'),
]);

const { buildProvenanceRelationArtifact, defaultProvenanceRelationPath, provenanceRelationSchema } =
  provenanceModule;
const {
  POSTGRES_OWNER_POLICY_MAX_OWNER_VIA_DEPTH,
  decidePostgresOwnerPolicyCorrespondence,
  enumeratePostgresOwnerPolicyModels,
  postgresOwnerColumnPolicyTerm,
  postgresOwnerPolicyModelAllows,
  postgresOwnerPolicyShape,
  postgresOwnerViaPolicyTerm,
} = policyModule;
const { decideHeaderSerializerDisjointness } = headerGrammarModule;
const { decideIpv4GrammarRelations } = ipv4GrammarModule;

export const decidedSurfaceSchema = 'kovo.decided-surface/v1';
export const defaultDecidedSurfacePath = 'security/decided-surface.json';
export const decidedSurfaceSourcePaths = Object.freeze([
  'packages/compiler/src/scan/security-operation-ir.ts',
  'packages/compiler/src/scan/security-provenance-relation.ts',
  'packages/server/src/content-disposition.ts',
  'packages/server/src/cookies.ts',
  'packages/server/src/egress.ts',
  'packages/server/src/internal/header-serializer-grammars.ts',
  'packages/server/src/internal/ipv4-grammars.ts',
  'packages/server/src/internal/linear-regex/automata.ts',
  'packages/server/src/postgres-authorization-correspondence.ts',
  'packages/server/src/serialized-header-safety.ts',
  'scripts/decided-surface-gate.mjs',
  'scripts/provenance-closure.mjs',
  defaultProvenanceRelationPath,
]);

export function buildDecidedSurfaceArtifact({ codeSubjectSha, repoRoot = findRepoRoot() } = {}) {
  const subjectSha = validateCodeSubjectSha(codeSubjectSha);
  const provenance = buildProvenanceDecision();
  const policy = buildPolicyDecision();
  const grammars = buildGrammarDecision();
  const fragments = Object.freeze([provenance, policy, grammars]);
  const decided = fragments.reduce((sum, fragment) => sum + fragment.decided, 0);
  const total = fragments.reduce((sum, fragment) => sum + fragment.total, 0);
  if (decided !== total) {
    throw new Error(`aggregate decided surface is incomplete: ${decided}/${total}`);
  }
  return Object.freeze({
    schema: decidedSurfaceSchema,
    subject: Object.freeze({
      ...SECURITY_EVIDENCE_SUBJECT_PROTOCOL,
      codeSubjectSha: subjectSha,
      sources: buildSourceSet({ paths: decidedSurfaceSourcePaths, repoRoot }),
    }),
    fragments,
    aggregate: Object.freeze({
      decided,
      percent: 100,
      total,
      unit: 'sum of each fragment exact denominator; per-fragment rows remain authoritative because units differ',
    }),
  });
}

function buildProvenanceDecision() {
  const artifact = buildProvenanceRelationArtifact();
  const states = Object.keys(artifact.serverMemberRelation);
  const decided = states.reduce(
    (count, state) => count + Object.keys(artifact.serverMemberRelation[state]).length,
    0,
  );
  const total = artifact.serverStates.length * artifact.memberClasses.length;
  if (decided !== total || total !== artifact.summary.relationPairs) {
    throw new Error(
      `provenance relation is not total: cells=${decided} states*members=${total} summary=${artifact.summary.relationPairs}`,
    );
  }
  return Object.freeze({
    id: 'provenance-transition-pairs',
    schema: provenanceRelationSchema,
    artifact: defaultProvenanceRelationPath,
    decided,
    denominator: Object.freeze({
      memberClasses: artifact.memberClasses.length,
      serverStates: artifact.serverStates.length,
    }),
    total,
    unit: 'server-state/member-class transition pair',
  });
}

function buildPolicyDecision() {
  const shapes = [];
  let term = postgresOwnerColumnPolicyTerm({ columnName: 'owner_id', tableName: 'level_0' });
  for (let depth = 0; depth <= POSTGRES_OWNER_POLICY_MAX_OWNER_VIA_DEPTH; depth += 1) {
    const shape = postgresOwnerPolicyShape(term);
    const models = enumeratePostgresOwnerPolicyModels(term);
    const decision = decidePostgresOwnerPolicyCorrespondence(term, (model) =>
      postgresOwnerPolicyModelAllows(term, model),
    );
    if (
      decision.status !== 'proved' ||
      decision.checkedModels !== shape.modelCount ||
      models.length !== shape.modelCount
    ) {
      throw new Error(`policy fragment depth ${depth} is not exhaustively decided`);
    }
    shapes.push(
      Object.freeze({
        checkedModels: decision.checkedModels,
        closedForm: `3^(1+${depth})`,
        depth,
        expectedModels: shape.modelCount,
      }),
    );
    if (depth < POSTGRES_OWNER_POLICY_MAX_OWNER_VIA_DEPTH) {
      term = postgresOwnerViaPolicyTerm({
        fkColumnName: 'parent_id',
        parent: term,
        parentKeyColumnName: 'id',
        tableName: `level_${depth + 1}`,
      });
    }
  }
  const decided = shapes.reduce((sum, shape) => sum + shape.checkedModels, 0);
  const total = shapes.reduce((sum, shape) => sum + shape.expectedModels, 0);
  return Object.freeze({
    id: 'postgres-owner-policy-models',
    schema: 'kovo.postgres-owner-policy-fragment/v1',
    decided,
    denominator: Object.freeze({
      constructors: 2,
      maximumOwnerViaDepth: POSTGRES_OWNER_POLICY_MAX_OWNER_VIA_DEPTH,
      shapes: Object.freeze(shapes),
    }),
    total,
    unit: 'three-valued abstract policy model across every shipped depth shape',
  });
}

function buildGrammarDecision() {
  const header = decideHeaderSerializerDisjointness();
  const ipv4 = decideIpv4GrammarRelations();
  const obligations = [
    grammarObligation('header/content-disposition-disjoint', header.contentDisposition),
    grammarObligation('header/set-cookie-disjoint', header.forwardedSetCookie),
    grammarObligation('ipv4/kovo-within-rfc3986', ipv4.kovoWithinRfc3986),
    grammarObligation('ipv4/kovo-within-traditional-inet-aton', ipv4.kovoWithinTraditionalInetAton),
    grammarObligation('ipv4/rfc3986-within-kovo', ipv4.rfc3986WithinKovo),
    grammarObligation('ipv4/traditional-inet-aton-within-kovo', ipv4.traditionalInetAtonWithinKovo),
  ];
  return Object.freeze({
    id: 'grammar-decision-obligations',
    schema: 'kovo.grammar-decisions/v1',
    decided: obligations.length,
    denominator: Object.freeze({
      headerVersion: header.version,
      ipv4Version: ipv4.version,
      obligations: Object.freeze(obligations),
    }),
    total: obligations.length,
    unit: 'declared language containment or disjointness obligation',
  });
}

function grammarObligation(id, decision) {
  if (
    typeof decision?.holds !== 'boolean' ||
    !Number.isSafeInteger(decision.exploredStates) ||
    decision.exploredStates <= 0 ||
    (decision.holds === false && typeof decision.counterexample !== 'string')
  ) {
    throw new Error(`${id} did not return one explicit closed grammar verdict`);
  }
  return Object.freeze({
    ...(decision.counterexample === undefined ? {} : { counterexample: decision.counterexample }),
    exploredStates: decision.exploredStates,
    holds: decision.holds,
    id,
  });
}

export function validateDecidedSurfaceArtifact(document, { repoRoot = findRepoRoot() } = {}) {
  const findings = [];
  if (document?.schema !== decidedSurfaceSchema) {
    findings.push(`schema must be ${decidedSurfaceSchema}`);
    return { findings, ok: false };
  }
  let expected;
  try {
    expected = buildDecidedSurfaceArtifact({
      codeSubjectSha: document?.subject?.codeSubjectSha,
      repoRoot,
    });
  } catch (error) {
    findings.push(error instanceof Error ? error.message : String(error));
    return { findings, ok: false };
  }
  if (canonicalJson(document) !== canonicalJson(expected)) {
    findings.push(
      `${defaultDecidedSurfacePath} drifted; commit the measured code, then run pnpm run generate:decided-surface -- --subject-sha $(git rev-parse HEAD)`,
    );
  }
  return { findings, ok: findings.length === 0, summary: expected.aggregate };
}

async function main() {
  const root = findRepoRoot();
  const artifactPath = path.join(root, defaultDecidedSurfacePath);
  const args = process.argv.slice(2);
  if (args.length > 0) {
    const options = parseExactCliArguments(args, {
      command: '--write',
      valueFlags: ['--subject-sha'],
    });
    const codeSubjectSha = options['subject-sha'];
    assertCleanCurrentCodeSubject({ repoRoot: root, subjectSha: codeSubjectSha });
    const artifact = buildDecidedSurfaceArtifact({ codeSubjectSha, repoRoot: root });
    mkdirSync(path.dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, canonicalJson(artifact), 'utf8');
  }
  const document = JSON.parse(readFileSync(artifactPath, 'utf8'));
  const check = validateDecidedSurfaceArtifact(document, { repoRoot: root });
  if (!check.ok) throw new Error(check.findings.join('\n'));
  process.stdout.write(
    `${decidedSurfaceSchema} provenance=${document.fragments[0].decided}/${document.fragments[0].total} policy=${document.fragments[1].decided}/${document.fragments[1].total} grammars=${document.fragments[2].decided}/${document.fragments[2].total} aggregate=${check.summary.decided}/${check.summary.total} OK\n`,
  );
}

if (isMainEntry(import.meta.url)) await runGate(main);
