// Public HTML/Kovo fragment fact extractors used by app scenario assertions
// (SPEC.md §9.1). The implementation lives in `./html-fragment-impl.js`; the
// lower-level extractors and DTOs are repo-internal and re-exported from
// `./internal-html-fragment.js` (subpath `@kovojs/test/internal/html-fragment`).
export {
  fragmentHtml,
  htmlDocumentFacts,
  htmlElementCount,
  htmlElementFacts,
  htmlFormActions,
  htmlFormFacts,
  htmlFormFields,
  htmlFormFieldsByName,
  htmlKeyValues,
  htmlTextContent,
  kovoQueryJsonValues,
} from './html-fragment-impl.js';

export type {
  HtmlDocumentFact,
  HtmlElementFact,
  HtmlElementSelector,
  HtmlFormFact,
  HtmlFormFieldFact,
  HtmlJsonScriptFact,
} from './html-fragment-impl.js';
