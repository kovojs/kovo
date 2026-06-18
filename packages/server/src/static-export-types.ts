export interface StaticExportResponseSnapshot {
  body: string;
  headers: Record<string, string>;
  status: number;
}

export interface StaticExportArtifact extends StaticExportResponseSnapshot {
  path: string;
}

export interface StaticExportClientModuleArtifact extends StaticExportResponseSnapshot {
  href: string;
  path: string;
}

export interface StaticExportAssetInput {
  contentType?: string;
  headers?: HeadersInit;
  path: string;
  source: string | URL;
}

export interface StaticExportAssetArtifact {
  headers: Record<string, string>;
  path: string;
  source: string;
  status: number;
}

export type StaticExportInventoryItem =
  | {
      headers: Record<string, string>;
      kind: 'route-document';
      path: string;
      status: number;
    }
  | {
      headers: Record<string, string>;
      href: string;
      kind: 'client-module';
      path: string;
      status: number;
    }
  | {
      headers: Record<string, string>;
      kind: 'static-asset';
      path: string;
      source: string;
      status: number;
    };

export interface StaticExportManifest {
  assets: readonly StaticExportManifestAsset[];
  clientModules: readonly StaticExportManifestClientModule[];
  files: readonly StaticExportInventoryItem[];
  routeDocuments: readonly StaticExportManifestRouteDocument[];
}

export interface StaticExportManifestRouteDocument {
  headers: Record<string, string>;
  path: string;
  status: number;
}

export interface StaticExportManifestClientModule {
  headers: Record<string, string>;
  href: string;
  path: string;
  status: number;
}

export interface StaticExportManifestAsset {
  headers: Record<string, string>;
  path: string;
  source: string;
  status: number;
}

export type StaticExportNonExportablePolicy = 'error' | 'skip';

/** Options for exporting a `KovoApp` request shell to static route documents. */
export interface StaticExportOptions {
  assets?: readonly StaticExportAssetInput[];
  diagnostics?: readonly import('./static-export-diagnostics.js').StaticExportCompileDiagnostic[];
  onNonExportable?: StaticExportNonExportablePolicy;
  origin?: string;
  outDir?: string | URL;
}

/** Static export output produced by `exportStaticApp()`. */
export interface StaticExportResult {
  artifacts: readonly StaticExportArtifact[];
  assets: readonly StaticExportAssetArtifact[];
  clientModules: readonly StaticExportClientModuleArtifact[];
  diagnostics: readonly import('./static-export-diagnostics.js').StaticExportDiagnostic[];
}
