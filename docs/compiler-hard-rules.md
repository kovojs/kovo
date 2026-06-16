# Compiler Hard Rules

`SPEC.md` section 5.2 is normative. This page keeps the implementation checklist visible in the repo docs.

The compiler must preserve these rules:

1. Source-derived names. Extracted handlers use stable names such as `Component$fnName` or `Component$element_event`; hashes belong only in cache-busting URLs or equivalent deployment metadata. `kovo explain component` must print each handler's capture channels (`ctx`, `element-params`, `module-scope`) beside its emitted ref and params.
2. One-to-one file mapping. An input component file emits its matching server and client modules. Production merging is opt-in, never the default.
3. Fixpoint invariant. The compiler emits valid Kovo source, so `compile(compile(source))` must equal `compile(source)`, and the browser-free render-equivalence gate must prove `render(source)` equals `render(compile(source))`. This proves compiler output, not a second app-authoring surface.
4. Platform behavior emission. Proven platform equivalents should lower to declarative HTML behavior and be reported by `kovo explain`.
5. Teaching errors. Diagnostics must show the intended lowering, why it failed, and the available fixes.
6. TSX-only authoring. App source is TSX. Lowered IR is compiler output for fixpoint, render-equivalence, and devtools verification; hand-authored string-rendered or lowered IR in app source is KV235.
7. Post-parse decisions use typed facts, not source strings. After parsing, compiler post-parse phases (`lower`, `validate`, `analyze`, `emit`, `graph`) decide from typed model facts and spans, never from raw source snippets, regexes, `getText()`, or ad hoc string slicing; the scanner/parser is the sole boundary that reads source text into typed facts. A mechanical kovo-check guard enforces this.

These rules are release gates, not style preferences.
