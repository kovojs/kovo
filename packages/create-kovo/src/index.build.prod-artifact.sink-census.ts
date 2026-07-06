import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const prodArtifactSinkCensusVersion = 'kovo-prod-artifact-sink-census/v1';

export type ProdArtifactSinkProof =
  | {
      evidence: string;
      kind: 'proof';
    }
  | {
      diagnostic: 'KV406';
      kind: 'kv406';
    };

export interface ProdArtifactSinkCensusEntry {
  proof: ProdArtifactSinkProof;
  sink: string;
  witnesses: readonly string[];
}

export interface ProdArtifactSinkCensusManifest {
  entries: readonly {
    proof: ProdArtifactSinkProof;
    sink: string;
    witnessFiles: readonly string[];
  }[];
  generatedBy: 'create-kovo prod-artifact sink census';
  version: typeof prodArtifactSinkCensusVersion;
}

export interface ProdArtifactSinkInventoryEvidence {
  hostileValueProof: string;
  sink: string;
}

interface ArtifactTextFile {
  path: string;
  text: string;
}

export function assertProdArtifactSinkCensus(
  root: string,
  entries: readonly ProdArtifactSinkCensusEntry[],
): ProdArtifactSinkCensusManifest {
  if (entries.length === 0) throw new Error('Prod artifact sink census requires at least one row.');
  const files = productionArtifactTextFiles(root);
  if (files.length === 0) throw new Error(`No production artifact files found under ${root}/dist.`);

  return {
    entries: entries.map((entry) => ({
      proof: entry.proof,
      sink: entry.sink,
      witnessFiles: witnessFilesForEntry(files, entry),
    })),
    generatedBy: 'create-kovo prod-artifact sink census',
    version: prodArtifactSinkCensusVersion,
  };
}

export function readProductionGraph(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, 'dist/.kovo/graph.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

export function assertRequiredSinkInventoryEvidence(
  entries: readonly ProdArtifactSinkInventoryEvidence[],
): readonly ProdArtifactSinkInventoryEvidence[] {
  const bySink = new Map(entries.map((entry) => [entry.sink, entry]));
  for (const sink of requiredSinkInventoryEvidenceSinks) {
    const entry = bySink.get(sink);
    if (entry === undefined) {
      throw new Error(`Required sink inventory evidence is missing sink "${sink}".`);
    }
    if (entry.hostileValueProof.trim() === '') {
      throw new Error(
        `Required sink inventory evidence "${sink}" has an empty hostile-value proof.`,
      );
    }
  }
  return entries;
}

function witnessFilesForEntry(
  files: readonly ArtifactTextFile[],
  entry: ProdArtifactSinkCensusEntry,
): string[] {
  const witnessFiles = new Set<string>();
  const missing: string[] = [];

  for (const witness of entry.witnesses) {
    const matches = files.filter((file) => file.text.includes(witness));
    if (matches.length === 0) {
      missing.push(witness);
      continue;
    }
    for (const match of matches) witnessFiles.add(match.path);
  }

  if (missing.length > 0) {
    throw new Error(
      [
        `Production artifact sink census row "${entry.sink}" is missing witness(es):`,
        ...missing.map((witness) => `- ${JSON.stringify(witness)}`),
      ].join('\n'),
    );
  }

  if (entry.proof.kind !== 'proof' && entry.proof.kind !== 'kv406') {
    throw new Error(`Production artifact sink census row "${entry.sink}" has no proof-or-KV406.`);
  }

  return [...witnessFiles].sort();
}

function productionArtifactTextFiles(root: string): readonly ArtifactTextFile[] {
  const dist = join(root, 'dist');
  const files: ArtifactTextFile[] = [];
  if (!existsSync(dist)) return files;

  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      const stats = statSync(path);
      if (stats.isDirectory()) {
        visit(path);
        continue;
      }
      if (!isTextArtifact(path)) continue;
      files.push({
        path: relative(root, path),
        text: readFileSync(path, 'utf8'),
      });
    }
  };

  visit(dist);
  return files;
}

function isTextArtifact(path: string): boolean {
  return /\.(?:css|html|js|json|mjs|txt)$/u.test(path);
}

const requiredSinkInventoryEvidenceSinks = [
  'db driver statement',
  'http response body',
  'http response headers',
  'redirect URL',
  'Set-Cookie',
  'blob/file write',
  'durable-task payload',
  'webhook payload',
  'HTML/render output',
  'log/error output',
  'outbound egress request',
] as const;
