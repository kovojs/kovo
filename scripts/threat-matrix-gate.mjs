import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

export const THREAT_CATEGORIES = Object.freeze(['C', 'I', 'A', 'Au']);

const mappingCollections = Object.freeze([
  'auditedEscapeMappings',
  'publicSurfaceMappings',
  'sinkMappings',
]);
const dispositions = new Set(['audited-escape', 'control', 'out-of-scope']);

/**
 * Validate the machine-readable liveness projection of the human threat matrix.
 *
 * SPEC.md §2 makes every trust-boundary exception audit-visible. This gate keeps
 * that promise live by comparing the projection with the actual C9 sink registry,
 * the graph audit-kind registries, and the public capability-surface census.
 */
export function validateThreatMatrixCoverage(options) {
  const findings = [];
  const {
    auditedCapabilityKinds,
    auditedTrustEscapeKinds,
    documentedSurfaceLabels,
    manifest,
    publicSecuritySurfaceIds,
    publicRuntimeExportPostures,
    repoRoot,
    rootScripts,
    sourceSinkInventory,
  } = options;

  if (!isRecord(manifest)) return ['threat-matrix coverage manifest must be an object'];
  if (manifest.version !== 1) findings.push('threat-matrix coverage manifest version must be 1');

  const surfaceIds = validateSurfaces(manifest.surfaces, documentedSurfaceLabels, findings);
  const proofs = validateProofs(manifest.proofs, rootScripts, repoRoot, findings);
  const usedProofs = new Set();

  validateSinkMappings({
    findings,
    mappings: manifest.sinkMappings,
    proofs,
    sourceSinkInventory,
    surfaceIds,
    usedProofs,
  });
  validateAuditedEscapeMappings({
    auditedCapabilityKinds,
    auditedTrustEscapeKinds,
    findings,
    mappings: manifest.auditedEscapeMappings,
    proofs,
    surfaceIds,
    usedProofs,
  });
  validatePublicSurfaceMappings({
    findings,
    mappings: manifest.publicSurfaceMappings,
    proofs,
    publicSecuritySurfaceIds,
    surfaceIds,
    usedProofs,
  });
  validatePublicRuntimeExportPostures({
    findings,
    postures: publicRuntimeExportPostures,
    proofs,
    surfaceIds,
    usedProofs,
  });

  for (const collection of mappingCollections) {
    if (!Array.isArray(manifest[collection])) {
      findings.push(`${collection} must be an array`);
    }
  }

  for (const proofId of proofs.keys()) {
    if (!usedProofs.has(proofId)) findings.push(`stale unused threat-matrix proof: ${proofId}`);
  }

  return findings.sort((left, right) => left.localeCompare(right));
}

function validatePublicRuntimeExportPostures(options) {
  const { findings, postures, proofs, surfaceIds, usedProofs } = options;
  const seen = new Set();
  if (!Array.isArray(postures) || postures.length === 0) {
    findings.push('public runtime export postures must be a non-empty array');
    return;
  }
  for (const [index, posture] of postures.entries()) {
    const label = `publicRuntimeExportPostures[${index}]`;
    if (!isRecord(posture) || !isNonBlank(posture.id)) {
      findings.push(`${label}.id must be non-blank`);
      continue;
    }
    if (seen.has(posture.id))
      findings.push(`duplicate public runtime export posture: ${posture.id}`);
    seen.add(posture.id);
    if (!isNonBlank(posture.securityRole)) {
      findings.push(`${label}.securityRole must be non-blank`);
    }
    if (!isNonBlank(posture.disposition)) {
      findings.push(`${label}.disposition must be non-blank`);
    }
    if (!isRecord(posture.matrix)) {
      findings.push(`${label}.matrix must be an object`);
      continue;
    }
    validateMappingCellRefs(
      posture.matrix,
      `${label}.matrix`,
      surfaceIds,
      proofs,
      usedProofs,
      findings,
    );
  }
}

function validateSurfaces(value, documentedSurfaceLabels, findings) {
  const ids = new Set();
  const labels = new Set();
  if (!Array.isArray(value)) {
    findings.push('surfaces must be an array');
    return ids;
  }

  for (const [index, surface] of value.entries()) {
    const label = `surfaces[${index}]`;
    if (!isRecord(surface)) {
      findings.push(`${label} must be an object`);
      continue;
    }
    if (!isNonBlank(surface.id)) findings.push(`${label}.id must be non-blank`);
    if (!isNonBlank(surface.label)) findings.push(`${label}.label must be non-blank`);
    if (!isNonBlank(surface.id) || !isNonBlank(surface.label)) continue;
    if (ids.has(surface.id)) findings.push(`duplicate threat-matrix surface id: ${surface.id}`);
    if (labels.has(surface.label)) {
      findings.push(`duplicate threat-matrix surface label: ${surface.label}`);
    }
    ids.add(surface.id);
    labels.add(surface.label);
  }

  compareExactSet(
    labels,
    new Set(documentedSurfaceLabels),
    'manifest surface labels',
    'documented matrix surface labels',
    findings,
  );
  return ids;
}

function validateProofs(value, rootScripts, repoRoot, findings) {
  const proofs = new Map();
  if (!isRecord(value)) {
    findings.push('proofs must be an object');
    return proofs;
  }

  for (const [proofId, proof] of Object.entries(value)) {
    if (!isNonBlank(proofId) || !isRecord(proof)) {
      findings.push(`invalid threat-matrix proof row: ${proofId || '<empty>'}`);
      continue;
    }
    if (!dispositions.has(proof.disposition)) {
      findings.push(`${proofId}: unknown disposition ${String(proof.disposition)}`);
    }
    if (!isNonBlank(proof.control)) findings.push(`${proofId}: control must be non-blank`);
    if (proof.disposition === 'out-of-scope' && !isNonBlank(proof.owner)) {
      findings.push(`${proofId}: out-of-scope disposition must name its owner`);
    }
    if (!Array.isArray(proof.evidence) || proof.evidence.length === 0) {
      findings.push(`${proofId}: evidence must be a non-empty array`);
    } else {
      for (const evidence of proof.evidence) {
        validateEvidence(proofId, evidence, rootScripts, repoRoot, findings);
      }
    }
    proofs.set(proofId, proof);
  }
  return proofs;
}

function validateEvidence(proofId, evidence, rootScripts, repoRoot, findings) {
  if (!isNonBlank(evidence)) {
    findings.push(`${proofId}: evidence entry must be non-blank`);
    return;
  }
  const gate = /^pnpm run ([a-z0-9:-]+)$/u.exec(evidence);
  if (gate !== null) {
    if (!isNonBlank(rootScripts?.[gate[1]])) {
      findings.push(`${proofId}: evidence cites unknown root gate ${evidence}`);
    }
    return;
  }

  const absolute = resolve(repoRoot, evidence);
  const local = relative(repoRoot, absolute);
  if (local.startsWith('..') || isAbsolute(local)) {
    findings.push(`${proofId}: evidence escapes the repository: ${evidence}`);
  } else if (!existsSync(absolute)) {
    findings.push(`${proofId}: stale evidence path: ${evidence}`);
  }
}

function validateSinkMappings(options) {
  const { findings, mappings, proofs, sourceSinkInventory, surfaceIds, usedProofs } = options;
  const expectedSinks = new Map();
  for (const sink of sourceSinkInventory) {
    if (!isRecord(sink) || !isNonBlank(sink.sink)) {
      findings.push('C9 source/sink registry contains an invalid sink row');
      continue;
    }
    if (expectedSinks.has(sink.sink)) {
      findings.push(`C9 source/sink registry contains duplicate sink: ${sink.sink}`);
      continue;
    }
    expectedSinks.set(sink.sink, escapeHatchesForSink(sink));
  }

  const seen = new Set();
  for (const [index, mapping] of arrayOrEmpty(mappings).entries()) {
    const label = `sinkMappings[${index}]`;
    if (!isRecord(mapping) || !isNonBlank(mapping.sink)) {
      findings.push(`${label}.sink must be non-blank`);
      continue;
    }
    if (seen.has(mapping.sink)) findings.push(`duplicate C9 sink mapping: ${mapping.sink}`);
    seen.add(mapping.sink);
    if (!expectedSinks.has(mapping.sink)) {
      findings.push(`stale/unknown C9 sink mapping: ${mapping.sink}`);
    }
    validateMappingCellRefs(mapping, label, surfaceIds, proofs, usedProofs, findings);
    const mappedEscapes = stringSet(mapping.escapeHatches, `${label}.escapeHatches`, findings);
    const expectedEscapes = expectedSinks.get(mapping.sink) ?? new Set();
    compareExactSet(
      mappedEscapes,
      expectedEscapes,
      `${mapping.sink} mapped escape hatches`,
      `${mapping.sink} registry escape hatches`,
      findings,
    );
    if (expectedEscapes.size > 0) {
      validateCellRefs(mapping.escapeCells, `${label}.escapeCells`, proofs, usedProofs, findings);
    } else if (mapping.escapeCells !== undefined) {
      findings.push(`${label}.escapeCells is stale because the sink has no escape hatch`);
    }
  }

  const missing = [...expectedSinks.keys()].filter((sink) => !seen.has(sink));
  if (missing.length > 0) findings.push(`C9 sink mappings missing: ${missing.sort().join(', ')}`);
}

function validateAuditedEscapeMappings(options) {
  const {
    auditedCapabilityKinds,
    auditedTrustEscapeKinds,
    findings,
    mappings,
    proofs,
    surfaceIds,
    usedProofs,
  } = options;
  const expected = new Set([
    ...auditedTrustEscapeKinds.map((kind) => `trust:${kind}`),
    ...auditedCapabilityKinds.map((kind) => `capability:${kind}`),
  ]);
  const seen = new Set();

  for (const [index, mapping] of arrayOrEmpty(mappings).entries()) {
    const label = `auditedEscapeMappings[${index}]`;
    if (!isRecord(mapping) || !['capability', 'trust'].includes(mapping.channel)) {
      findings.push(`${label}.channel must be capability or trust`);
      continue;
    }
    validateMappingCellRefs(mapping, label, surfaceIds, proofs, usedProofs, findings);
    const kinds = stringSet(mapping.kinds, `${label}.kinds`, findings);
    if (kinds.size === 0) findings.push(`${label}.kinds must not be empty`);
    for (const kind of kinds) {
      const key = `${mapping.channel}:${kind}`;
      if (seen.has(key)) findings.push(`duplicate audited escape mapping: ${key}`);
      if (!expected.has(key)) findings.push(`stale/unknown audited escape mapping: ${key}`);
      seen.add(key);
    }
  }

  const missing = [...expected].filter((key) => !seen.has(key));
  if (missing.length > 0) {
    findings.push(`audited escape mappings missing: ${missing.sort().join(', ')}`);
  }
}

function validatePublicSurfaceMappings(options) {
  const { findings, mappings, proofs, publicSecuritySurfaceIds, surfaceIds, usedProofs } = options;
  const expected = new Set(publicSecuritySurfaceIds);
  const seen = new Set();

  for (const [index, mapping] of arrayOrEmpty(mappings).entries()) {
    const label = `publicSurfaceMappings[${index}]`;
    if (!isRecord(mapping)) {
      findings.push(`${label} must be an object`);
      continue;
    }
    validateMappingCellRefs(mapping, label, surfaceIds, proofs, usedProofs, findings);
    const ids = stringSet(mapping.ids, `${label}.ids`, findings);
    if (ids.size === 0) findings.push(`${label}.ids must not be empty`);
    for (const id of ids) {
      if (seen.has(id)) findings.push(`duplicate public security surface mapping: ${id}`);
      if (!expected.has(id)) findings.push(`stale/unknown public security surface mapping: ${id}`);
      seen.add(id);
    }
  }

  const missing = [...expected].filter((id) => !seen.has(id));
  if (missing.length > 0) {
    findings.push(`public security surface mappings missing: ${missing.sort().join(', ')}`);
  }
}

function validateMappingCellRefs(mapping, label, surfaceIds, proofs, usedProofs, findings) {
  if (!isNonBlank(mapping.surface) || !surfaceIds.has(mapping.surface)) {
    findings.push(`${label}: unknown threat-matrix surface ${String(mapping.surface)}`);
  }
  validateCellRefs(mapping.cells, `${label}.cells`, proofs, usedProofs, findings);
}

function validateCellRefs(cells, label, proofs, usedProofs, findings) {
  if (!isRecord(cells) || Object.keys(cells).length === 0) {
    findings.push(`${label} must map at least one threat category`);
    return;
  }
  for (const [threat, proofId] of Object.entries(cells)) {
    if (!THREAT_CATEGORIES.includes(threat)) {
      findings.push(`${label}: unknown threat category ${threat}`);
    }
    if (!isNonBlank(proofId) || !proofs.has(proofId)) {
      findings.push(`${label}: unknown proof ${String(proofId)} for ${threat}`);
    } else {
      usedProofs.add(proofId);
    }
  }
}

function escapeHatchesForSink(sink) {
  if (!isNonBlank(sink.escapeHatch) || sink.escapeHatch === 'none') return new Set();
  return new Set(
    sink.escapeHatch
      .split('|')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function compareExactSet(left, right, leftLabel, rightLabel, findings) {
  const missing = [...right].filter((value) => !left.has(value));
  const stale = [...left].filter((value) => !right.has(value));
  if (missing.length > 0) {
    findings.push(`${leftLabel} missing from ${rightLabel}: ${missing.sort().join(', ')}`);
  }
  if (stale.length > 0) {
    findings.push(`${leftLabel} stale/unknown vs ${rightLabel}: ${stale.sort().join(', ')}`);
  }
}

function stringSet(value, label, findings) {
  const result = new Set();
  if (!Array.isArray(value)) {
    findings.push(`${label} must be an array`);
    return result;
  }
  for (const item of value) {
    if (!isNonBlank(item)) {
      findings.push(`${label} entries must be non-blank strings`);
      continue;
    }
    if (result.has(item)) findings.push(`${label} contains duplicate ${item}`);
    result.add(item);
  }
  return result;
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function isNonBlank(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
