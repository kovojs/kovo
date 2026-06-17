declare module 'virtual:kovo-fixture-css-manifest' {
  export interface KovoFixtureCssAsset {
    componentName: string;
    criticalCss: string;
    fragmentTargets: readonly string[];
    href: string;
    sourceFileName: string;
  }

  export function kovoFixtureStylesheetManifest(): readonly KovoFixtureCssAsset[];
  export function kovoFixtureStylesheetsForTargets(
    targets?: readonly string[],
  ): readonly KovoFixtureCssAsset[];
}
