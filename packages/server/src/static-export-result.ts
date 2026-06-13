import type {
  StaticExportArtifact,
  StaticExportAssetArtifact,
  StaticExportClientModuleArtifact,
  StaticExportInventoryItem,
  StaticExportManifest,
} from './static-export-types.js';

interface StaticExportResultArtifacts {
  artifacts: readonly StaticExportArtifact[];
  assets: readonly StaticExportAssetArtifact[];
  clientModules: readonly StaticExportClientModuleArtifact[];
}

// SPEC §9.5: dry-run export task wiring inspects the same route/module/asset set
// that a write export would publish, without reaching into replay internals.
export function staticExportInventory(
  result: StaticExportResultArtifacts,
): StaticExportInventoryItem[] {
  return [
    ...result.artifacts.map((artifact) => ({
      headers: artifact.headers,
      kind: 'route-document' as const,
      path: artifact.path,
      status: artifact.status,
    })),
    ...result.clientModules.map((artifact) => ({
      headers: artifact.headers,
      href: artifact.href,
      kind: 'client-module' as const,
      path: artifact.path,
      status: artifact.status,
    })),
    ...result.assets.map((artifact) => ({
      headers: artifact.headers,
      kind: 'static-asset' as const,
      path: artifact.path,
      source: artifact.source,
      status: artifact.status,
    })),
  ];
}

// SPEC §9.5: export-task consumers need a stable public manifest for the
// directory-index documents, copied assets, and /c/ modules that replay would publish.
export function staticExportManifest(result: StaticExportResultArtifacts): StaticExportManifest {
  const routeDocuments = result.artifacts.map((artifact) => ({
    headers: artifact.headers,
    path: artifact.path,
    status: artifact.status,
  }));
  const clientModules = result.clientModules.map((artifact) => ({
    headers: artifact.headers,
    href: artifact.href,
    path: artifact.path,
    status: artifact.status,
  }));
  const assets = result.assets.map((artifact) => ({
    headers: artifact.headers,
    path: artifact.path,
    source: artifact.source,
    status: artifact.status,
  }));

  return {
    assets,
    clientModules,
    files: staticExportInventory(result),
    routeDocuments,
  };
}

// SPEC §9.5: manifest/inventory task evidence must describe the same static
// host surface that a write export publishes.
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
    [
      'Static export manifest does not match the written export result.',
      `Expected ${staticExportManifestSummary(expected)}.`,
      `Received ${staticExportManifestSummary(manifest)}.`,
    ].join(' '),
  );
}

// SPEC §9.5: static export publishes route documents as directory-index HTML
// so static hosts do not depend on flat `.html` rewrite compatibility.
export function assertStaticExportManifestUsesDirectoryIndexDocuments(
  manifest: Pick<StaticExportManifest, 'files' | 'routeDocuments'>,
): void {
  const documentPaths = [
    ...manifest.routeDocuments.map((document) => document.path),
    ...manifest.files
      .filter((file) => file.kind === 'route-document')
      .map((document) => document.path),
  ];
  const flatDocuments = [...new Set(documentPaths)].filter(
    (path) => !isDirectoryIndexDocumentPath(path),
  );

  if (flatDocuments.length === 0) return;

  throw new Error(
    [
      'Static export manifest contains non-directory-index route documents.',
      `Invalid route documents: ${flatDocuments.join(', ')}.`,
      'SPEC §9.5 exports route documents as directory-index HTML.',
    ].join(' '),
  );
}

function isDirectoryIndexDocumentPath(path: string): boolean {
  return path === '/index.html' || /^\/.+\/index\.html$/.test(path);
}

function staticExportManifestSignature(manifest: StaticExportManifest): string {
  return JSON.stringify({
    assets: manifest.assets,
    clientModules: manifest.clientModules,
    files: manifest.files,
    routeDocuments: manifest.routeDocuments,
  });
}

function staticExportManifestSummary(manifest: StaticExportManifest): string {
  return [
    `routeDocuments=${manifest.routeDocuments.length}`,
    `clientModules=${manifest.clientModules.length}`,
    `assets=${manifest.assets.length}`,
    `files=${manifest.files.length}`,
  ].join(', ');
}
