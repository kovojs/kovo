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

declare module 'virtual:kovo-fixture-generated-query-plans' {
  import type {
    CompiledQueryUpdateContext,
    QueryBindingRoot,
  } from '@kovojs/browser/generated';

  export type KovoFixtureQueryPlan = (
    root: QueryBindingRoot,
    value: unknown,
    context?: CompiledQueryUpdateContext,
  ) => unknown;

  export const kovoFixtureQueryPlans: Readonly<Record<string, KovoFixtureQueryPlan>>;
}
