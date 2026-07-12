import { buildOwnDataProperty, snapshotBuildArray } from './build-security-intrinsics.js';
import {
  createSecurityNullRecord,
  createSecuritySet,
  securityArrayJoin,
  securityArrayPush,
  securityArraySort,
  securityObjectKeys,
  securityRegExpTest,
  securitySetAdd,
  securitySetHas,
  securityString,
} from './response-security-intrinsics.js';
import { witnessFreeze } from './security-witness-intrinsics.js';
import type {
  StaticExportArtifact,
  StaticExportAssetArtifact,
  StaticExportClientModuleArtifact,
  StaticExportInventoryItem,
  StaticExportManifest,
  StaticExportManifestAsset,
  StaticExportManifestClientModule,
  StaticExportManifestRouteDocument,
} from './static-export-types.js';

interface StaticExportResultArtifacts {
  artifacts: readonly StaticExportArtifact[];
  assets: readonly StaticExportAssetArtifact[];
  clientModules: readonly StaticExportClientModuleArtifact[];
}

interface PinnedStaticExportResultArtifacts {
  readonly artifacts: readonly StaticExportArtifact[];
  readonly assets: readonly StaticExportAssetArtifact[];
  readonly clientModules: readonly StaticExportClientModuleArtifact[];
}

/**
 * @internal Dry-run export task wiring inspects the same route/module/asset set
 * that a write export would publish, without reaching into replay internals
 * (SPEC.md §9.5).
 */
export function staticExportInventory(
  result: StaticExportResultArtifacts,
): StaticExportInventoryItem[] {
  return staticExportInventoryFromPinned(pinStaticExportResultArtifacts(result));
}

/**
 * @internal Export-task manifest for directory-index documents, copied assets,
 * and /c/ modules that replay would publish (SPEC.md §9.5).
 */
export function staticExportManifest(result: StaticExportResultArtifacts): StaticExportManifest {
  const pinned = pinStaticExportResultArtifacts(result);
  const routeDocuments: StaticExportManifestRouteDocument[] = [];
  const clientModules: StaticExportManifestClientModule[] = [];
  const assets: StaticExportManifestAsset[] = [];

  for (let index = 0; index < pinned.artifacts.length; index += 1) {
    const artifact = pinned.artifacts[index]!;
    securityArrayPush(
      routeDocuments,
      witnessFreeze({
        headers: manifestHeaders(artifact, `route document ${index}`),
        path: manifestString(artifact, 'path', `route document ${index}`),
        status: manifestNumber(artifact, 'status', `route document ${index}`),
      }),
    );
  }
  for (let index = 0; index < pinned.clientModules.length; index += 1) {
    const artifact = pinned.clientModules[index]!;
    securityArrayPush(
      clientModules,
      witnessFreeze({
        headers: manifestHeaders(artifact, `client module ${index}`),
        href: manifestString(artifact, 'href', `client module ${index}`),
        path: manifestString(artifact, 'path', `client module ${index}`),
        status: manifestNumber(artifact, 'status', `client module ${index}`),
      }),
    );
  }
  for (let index = 0; index < pinned.assets.length; index += 1) {
    const artifact = pinned.assets[index]!;
    securityArrayPush(
      assets,
      witnessFreeze({
        headers: manifestHeaders(artifact, `static asset ${index}`),
        path: manifestString(artifact, 'path', `static asset ${index}`),
        source: manifestString(artifact, 'source', `static asset ${index}`),
        status: manifestNumber(artifact, 'status', `static asset ${index}`),
      }),
    );
  }

  return witnessFreeze({
    assets: witnessFreeze(assets),
    clientModules: witnessFreeze(clientModules),
    files: witnessFreeze(staticExportInventoryFromPinned(pinned)),
    routeDocuments: witnessFreeze(routeDocuments),
  });
}

/**
 * @internal Manifest/inventory task evidence must describe the same static host
 * surface that a write export publishes (SPEC.md §9.5).
 */
export function assertStaticExportManifestMatchesResult(
  result: StaticExportResultArtifacts,
  manifest: StaticExportManifest,
): void {
  const expected = staticExportManifest(result);
  assertStaticExportManifestUsesDirectoryIndexDocuments(expected);
  assertStaticExportManifestUsesDirectoryIndexDocuments(manifest);
  const expectedSignature = staticExportManifestSignature(expected);
  const actualSignature = staticExportManifestSignature(manifest);

  if (actualSignature === expectedSignature) return;

  throw new Error(
    securityArrayJoin(
      [
        'Static export manifest does not match the written export result.',
        `Expected ${staticExportManifestSummary(expected)}.`,
        `Received ${staticExportManifestSummary(manifest)}.`,
      ],
      ' ',
    ),
  );
}

/**
 * @internal Static export publishes route documents as directory-index HTML so
 * static hosts do not depend on flat `.html` rewrite compatibility (SPEC.md §9.5).
 */
export function assertStaticExportManifestUsesDirectoryIndexDocuments(
  manifest: Pick<StaticExportManifest, 'files' | 'routeDocuments'>,
): void {
  const routeDocuments = manifestArrayFromProperty(
    manifest,
    'routeDocuments',
    'static-export manifest route documents',
  );
  const files = manifestArrayFromProperty(manifest, 'files', 'static-export manifest files');
  const seen = createSecuritySet<string>();
  const flatDocuments: string[] = [];

  for (let index = 0; index < routeDocuments.length; index += 1) {
    recordManifestDocumentPath(
      manifestString(routeDocuments[index]!, 'path', `manifest route document ${index}`),
      seen,
      flatDocuments,
    );
  }
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!;
    if (manifestString(file, 'kind', `manifest file ${index}`) !== 'route-document') continue;
    recordManifestDocumentPath(
      manifestString(file, 'path', `manifest file ${index}`),
      seen,
      flatDocuments,
    );
  }

  if (flatDocuments.length === 0) return;

  throw new Error(
    securityArrayJoin(
      [
        'Static export manifest contains non-directory-index route documents.',
        `Invalid route documents: ${securityArrayJoin(flatDocuments, ', ')}.`,
        'SPEC §9.5 exports route documents as directory-index HTML.',
      ],
      ' ',
    ),
  );
}

function pinStaticExportResultArtifacts(
  result: StaticExportResultArtifacts,
): PinnedStaticExportResultArtifacts {
  return witnessFreeze({
    artifacts: snapshotBuildArray(
      manifestArrayProperty(result, 'artifacts'),
      'static-export result route documents',
    ) as readonly StaticExportArtifact[],
    assets: snapshotBuildArray(
      manifestArrayProperty(result, 'assets'),
      'static-export result assets',
    ) as readonly StaticExportAssetArtifact[],
    clientModules: snapshotBuildArray(
      manifestArrayProperty(result, 'clientModules'),
      'static-export result client modules',
    ) as readonly StaticExportClientModuleArtifact[],
  });
}

function staticExportInventoryFromPinned(
  result: PinnedStaticExportResultArtifacts,
): StaticExportInventoryItem[] {
  const files: StaticExportInventoryItem[] = [];
  for (let index = 0; index < result.artifacts.length; index += 1) {
    const artifact = result.artifacts[index]!;
    securityArrayPush(
      files,
      witnessFreeze({
        headers: manifestHeaders(artifact, `route document ${index}`),
        kind: 'route-document' as const,
        path: manifestString(artifact, 'path', `route document ${index}`),
        status: manifestNumber(artifact, 'status', `route document ${index}`),
      }),
    );
  }
  for (let index = 0; index < result.clientModules.length; index += 1) {
    const artifact = result.clientModules[index]!;
    securityArrayPush(
      files,
      witnessFreeze({
        headers: manifestHeaders(artifact, `client module ${index}`),
        href: manifestString(artifact, 'href', `client module ${index}`),
        kind: 'client-module' as const,
        path: manifestString(artifact, 'path', `client module ${index}`),
        status: manifestNumber(artifact, 'status', `client module ${index}`),
      }),
    );
  }
  for (let index = 0; index < result.assets.length; index += 1) {
    const artifact = result.assets[index]!;
    securityArrayPush(
      files,
      witnessFreeze({
        headers: manifestHeaders(artifact, `static asset ${index}`),
        kind: 'static-asset' as const,
        path: manifestString(artifact, 'path', `static asset ${index}`),
        source: manifestString(artifact, 'source', `static asset ${index}`),
        status: manifestNumber(artifact, 'status', `static asset ${index}`),
      }),
    );
  }
  return files;
}

function recordManifestDocumentPath(
  path: string,
  seen: Set<string>,
  flatDocuments: string[],
): void {
  if (securitySetHas(seen, path)) return;
  securitySetAdd(seen, path);
  if (!isDirectoryIndexDocumentPath(path)) securityArrayPush(flatDocuments, path);
}

function isDirectoryIndexDocumentPath(path: string): boolean {
  return path === '/index.html' || securityRegExpTest(/^\/.+\/index\.html$/u, path);
}

function staticExportManifestSignature(manifest: StaticExportManifest): string {
  const parts: string[] = [];
  appendManifestSection(
    parts,
    'routeDocuments',
    manifestArrayFromProperty(manifest, 'routeDocuments', 'static-export manifest route documents'),
    ['path', 'status', 'headers'],
  );
  appendManifestSection(
    parts,
    'clientModules',
    manifestArrayFromProperty(manifest, 'clientModules', 'static-export manifest client modules'),
    ['href', 'path', 'status', 'headers'],
  );
  appendManifestSection(
    parts,
    'assets',
    manifestArrayFromProperty(manifest, 'assets', 'static-export manifest assets'),
    ['path', 'source', 'status', 'headers'],
  );
  appendManifestSection(
    parts,
    'files',
    manifestArrayFromProperty(manifest, 'files', 'static-export manifest files'),
    ['kind', 'href', 'path', 'source', 'status', 'headers'],
  );
  return securityArrayJoin(parts, '');
}

function appendManifestSection(
  parts: string[],
  section: string,
  rawEntries: readonly object[],
  fields: readonly string[],
): void {
  const entries = snapshotBuildArray(rawEntries, `static-export manifest ${section}`);
  appendSignaturePart(parts, section);
  appendSignaturePart(parts, securityString(entries.length));
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
      const field = fields[fieldIndex]!;
      const property = buildOwnDataProperty(entry, field, `${section}[${index}].${field}`);
      appendSignaturePart(parts, field);
      if (!property.present) {
        appendSignaturePart(parts, 'absent');
      } else if (field === 'headers') {
        appendHeadersSignature(parts, property.value, `${section}[${index}].headers`);
      } else if (typeof property.value === 'string' || typeof property.value === 'number') {
        appendSignaturePart(parts, securityString(property.value));
      } else {
        throw new TypeError(`Static export manifest ${section}[${index}].${field} is invalid.`);
      }
    }
  }
}

function appendHeadersSignature(parts: string[], value: unknown, label: string): void {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`Static export manifest ${label} must be an object.`);
  }
  const keys = securityObjectKeys(value);
  securityArraySort(keys, (left, right) => (left < right ? -1 : left > right ? 1 : 0));
  appendSignaturePart(parts, securityString(keys.length));
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const property = buildOwnDataProperty(value, key, `${label}.${key}`);
    if (!property.present || typeof property.value !== 'string') {
      throw new TypeError(`Static export manifest ${label}.${key} must be a string.`);
    }
    appendSignaturePart(parts, key);
    appendSignaturePart(parts, property.value);
  }
}

function appendSignaturePart(parts: string[], value: string): void {
  securityArrayPush(parts, `${value.length}:${value}`);
}

function manifestArrayProperty(
  value: object,
  property: keyof StaticExportResultArtifacts,
): readonly unknown[] {
  const result = buildOwnDataProperty(value, property, `static-export result.${property}`);
  if (!result.present) {
    throw new TypeError(`Static export result must declare ${property}.`);
  }
  return result.value as readonly unknown[];
}

function manifestArrayFromProperty(
  value: object,
  property: keyof StaticExportManifest,
  label: string,
): readonly object[] {
  const result = buildOwnDataProperty(value, property, `static-export manifest.${property}`);
  if (!result.present) {
    throw new TypeError(`Static export manifest must declare ${property}.`);
  }
  return snapshotBuildArray(result.value as readonly object[], label);
}

function manifestHeaders(value: object, label: string): Record<string, string> {
  const property = buildOwnDataProperty(value, 'headers', `${label}.headers`);
  if (!property.present || typeof property.value !== 'object' || property.value === null) {
    throw new TypeError(`Static export ${label}.headers must be an object.`);
  }
  const source = property.value;
  const headers = createSecurityNullRecord<string>();
  const keys = securityObjectKeys(source);
  securityArraySort(keys, (left, right) => (left < right ? -1 : left > right ? 1 : 0));
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const header = buildOwnDataProperty(source, key, `${label}.headers.${key}`);
    if (!header.present || typeof header.value !== 'string') {
      throw new TypeError(`Static export ${label}.headers.${key} must be a string.`);
    }
    headers[key] = header.value;
  }
  return witnessFreeze(headers);
}

function manifestString(value: object, property: string, label: string): string {
  const result = buildOwnDataProperty(value, property, `${label}.${property}`);
  if (!result.present || typeof result.value !== 'string') {
    throw new TypeError(`Static export ${label}.${property} must be a string.`);
  }
  return result.value;
}

function manifestNumber(value: object, property: string, label: string): number {
  const result = buildOwnDataProperty(value, property, `${label}.${property}`);
  if (!result.present || typeof result.value !== 'number') {
    throw new TypeError(`Static export ${label}.${property} must be a number.`);
  }
  return result.value;
}

function staticExportManifestSummary(manifest: StaticExportManifest): string {
  const routeDocuments = manifestArrayFromProperty(
    manifest,
    'routeDocuments',
    'static-export manifest route documents',
  );
  const clientModules = manifestArrayFromProperty(
    manifest,
    'clientModules',
    'static-export manifest client modules',
  );
  const assets = manifestArrayFromProperty(manifest, 'assets', 'static-export manifest assets');
  const files = manifestArrayFromProperty(manifest, 'files', 'static-export manifest files');
  return securityArrayJoin(
    [
      `routeDocuments=${routeDocuments.length}`,
      `clientModules=${clientModules.length}`,
      `assets=${assets.length}`,
      `files=${files.length}`,
    ],
    ', ',
  );
}
