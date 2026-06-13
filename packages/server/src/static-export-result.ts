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
