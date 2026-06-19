// @kovojs/test/internal/html-fragment — repo-internal HTML/Kovo fragment
// extractors and DTOs used by conformance fixtures and tooling, not part of the
// published @kovojs/test public API. SPEC.md §9.1.
export {
  documentQueryScriptBehaviorFact,
  htmlDocumentRegions,
  htmlJsonScriptFacts,
  htmlKeyFacts,
  htmlKeyTextMap,
  htmlLinkHrefs,
  htmlMainMarkerFact,
  kovoFragmentFacts,
  kovoQueryFacts,
  kovoResponseBodyFact,
} from './html-fragment-impl.js';

export type {
  DocumentQueryScriptBehaviorFact,
  HtmlDocumentRegions,
  HtmlKeyFact,
  HtmlMainMarkerFact,
  KovoFragmentFact,
  KovoQueryFact,
  KovoResponseBodyFact,
} from './html-fragment-impl.js';
