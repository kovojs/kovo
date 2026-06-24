import type { KovoApp } from './app-types.js';

/**
 * @internal Derive app-config capability facts for `kovo explain --capabilities`.
 *
 * Secure-by-construction Phase 5/7 makes app-held dangerous capabilities
 * auditable from the same graph surface as compiler-derived facts.
 */
export function capabilityFactsFromApp(
  app: Pick<KovoApp, 'capabilityUrls' | 'document' | 'egress'>,
): KovoApp['capabilities'] {
  return [
    ...capabilityUrlFacts(app),
    ...cspAllowFacts(app.document.csp?.allow?.scripts ?? [], 'scripts'),
    ...cspAllowFacts(app.document.csp?.allow?.frames ?? [], 'frames'),
    ...app.egress.allowInternal.map((entry, index) => ({
      detail: `host=${entry}`,
      kind: 'egressAllowInternal' as const,
      site: `app.ts#egress.allowInternal[${index}]`,
      source: entry,
    })),
  ];
}

function capabilityUrlFacts(app: Pick<KovoApp, 'capabilityUrls'>): KovoApp['capabilities'] {
  const options = app.capabilityUrls;
  if (options === undefined) return [];

  const details = [
    `path=${options.path ?? '/_cap/storage'}`,
    `storage=${options.storage === undefined ? 'no' : 'yes'}`,
    `oneTime=${options.replayStore === undefined ? 'no' : 'yes'}`,
  ];

  return [
    {
      detail: details.join(','),
      kind: 'capabilityUrl',
      site: 'app.ts#capabilityUrls',
      source: 'createApp.capabilityUrls',
    },
  ];
}

function cspAllowFacts(
  sources: readonly string[],
  directive: 'frames' | 'scripts',
): KovoApp['capabilities'] {
  return sources.map((source, index) => ({
    detail: `directive=${directive},index=${index}`,
    kind: 'cspAllow' as const,
    site: `app.ts#document.csp.allow.${directive}[${index}]`,
    source,
  }));
}
