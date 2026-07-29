export const COMPONENT_CATALOG_SCHEMA = 'kovo-component-catalog/v1';

export const COMPONENT_CATALOG_KINDS = Object.freeze(['component', 'icon']);
export const COMPONENT_ENHANCEMENT_TIERS = Object.freeze([
  'none',
  'native',
  'progressive',
  'scripted',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringArrayFinding(findings, label, value, { nonEmpty = false } = {}) {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)
  ) {
    findings.push(`${label} must be an array of non-empty strings`);
    return;
  }
  if (nonEmpty && value.length === 0) findings.push(`${label} must not be empty`);
  if (JSON.stringify(value) !== JSON.stringify([...new Set(value)])) {
    findings.push(`${label} must be unique`);
  }
}

/**
 * Validate one package-owned catalog document. UI/headless and icons have separate
 * generators; this schema is the only shared output contract.
 */
export function validateComponentCatalogDocument(document) {
  const findings = [];
  if (!isRecord(document) || document.schema !== COMPONENT_CATALOG_SCHEMA) {
    return [`catalog schema must be ${COMPONENT_CATALOG_SCHEMA}`];
  }
  if (typeof document.owner !== 'string' || !document.owner.startsWith('@kovojs/')) {
    findings.push('catalog owner must name an @kovojs package');
  }
  if (!Array.isArray(document.entries)) {
    findings.push('catalog entries must be an array');
    return findings;
  }

  const ids = new Set();
  let previousId = '';
  for (const [index, entry] of document.entries.entries()) {
    const label = `entries[${index}]`;
    if (!isRecord(entry)) {
      findings.push(`${label} must be an object`);
      continue;
    }
    if (!COMPONENT_CATALOG_KINDS.includes(entry.kind)) {
      findings.push(`${label}.kind is invalid`);
    }
    for (const field of ['id', 'name', 'title', 'summary', 'packageImport', 'searchText']) {
      if (typeof entry[field] !== 'string' || entry[field].trim().length === 0) {
        findings.push(`${label}.${field} must be a non-empty string`);
      }
    }
    if (ids.has(entry.id)) findings.push(`${label}.id is duplicated`);
    ids.add(entry.id);
    if (previousId.localeCompare(entry.id) > 0) findings.push('catalog entries must be id-sorted');
    previousId = entry.id;

    if (!isRecord(entry.enhancement)) {
      findings.push(`${label}.enhancement must be an object`);
    } else {
      if (!COMPONENT_ENHANCEMENT_TIERS.includes(entry.enhancement.tier)) {
        findings.push(`${label}.enhancement.tier is invalid`);
      }
      stringArrayFinding(findings, `${label}.enhancement.roles`, entry.enhancement.roles);
      for (const field of ['keyboard', 'accessibility']) {
        if (
          typeof entry.enhancement[field] !== 'string' ||
          entry.enhancement[field].trim().length < 12
        ) {
          findings.push(`${label}.enhancement.${field} must state a concrete contract`);
        }
      }
    }

    if (entry.kind === 'component') {
      if (entry.packageImport !== `@kovojs/ui/${entry.name}`) {
        findings.push(`${label}.packageImport must use the component subpath`);
      }
      if (entry.copyCommand !== `kovo add ${entry.name}`) {
        findings.push(`${label}.copyCommand must use kovo add`);
      }
      if (!isRecord(entry.anatomy)) {
        findings.push(`${label}.anatomy must be an object`);
      } else {
        stringArrayFinding(findings, `${label}.anatomy.parts`, entry.anatomy.parts, {
          nonEmpty: true,
        });
        stringArrayFinding(findings, `${label}.anatomy.slots`, entry.anatomy.slots, {
          nonEmpty: true,
        });
        stringArrayFinding(findings, `${label}.anatomy.ids`, entry.anatomy.ids);
        stringArrayFinding(findings, `${label}.anatomy.stateInputs`, entry.anatomy.stateInputs);
      }
    } else if (entry.kind === 'icon') {
      if (entry.packageImport !== `@kovojs/icons/${entry.name}`) {
        findings.push(`${label}.packageImport must use the glyph subpath`);
      }
      if (entry.copyCommand !== null) findings.push(`${label}.copyCommand must be null`);
      if (entry.anatomy !== null) findings.push(`${label}.anatomy must be null`);
    }
  }
  return findings;
}

export function combineComponentCatalogDocuments(documents) {
  const findings = documents.flatMap((document) =>
    validateComponentCatalogDocument(document).map(
      (finding) => `${document?.owner ?? 'unknown owner'}: ${finding}`,
    ),
  );
  if (findings.length > 0) {
    throw new Error(`Invalid component catalog documents:\n${findings.join('\n')}`);
  }
  const entries = documents
    .flatMap((document) => document.entries)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
    throw new Error('Combined component catalog contains duplicate ids');
  }
  return {
    schema: COMPONENT_CATALOG_SCHEMA,
    owner: '@kovojs/catalog',
    entries,
  };
}
