# Product

## Register

brand

## Users

The primary reader is a **senior engineer or tech lead evaluating Kovo for adoption** — someone
who has shipped enough SPAs, hydration bugs, and stale-UI incidents to be skeptical of framework
marketing and to reward honesty about tradeoffs. They arrive wanting to answer one question fast:
_does this actually eliminate a class of bugs I have, and what does it cost me?_ They read code,
open devtools, and distrust adjectives.

A strong secondary audience is **builders and deployers of AI coding agents**, who care that Kovo
is the most machine-auditable compilation target an agent can emit (`edit → check → fixed`, not
`edit → deploy → bug report`). The site speaks to both, but when voice and proof must be tuned for
one, it is tuned for the human evaluator — the landing's "For agents / For users" split is the
model for holding both without diluting either.

Context of use: focused, often at a desk, comparing against React/Next/Qwik/htmx, frequently
mid-decision with a tab full of competitors. They will leave the instant the page feels like it is
selling rather than demonstrating.

## Product Purpose

The site is the public face of **Kovo** — a web framework for multi-page applications that are
_interactive at first paint, legible at every layer, and statically verifiable end-to-end_. Its job
is to make a hard, technical thesis legible and credible in minutes:

- An application's complete behavior — handler wiring, navigation targets, form fields, mutation
  contracts, data dependencies, optimistic predictions — should be **provable by TypeScript static
  checking plus static graph queries**, and **auditable by reading the page source and the Network
  panel**.
- Two outcomes carry the pitch, in priority order: (1) **eliminate stale-UI bugs at compile time**,
  and (2) **make loading instant** — interactive at first paint with little-to-no JS on the
  critical path.

Success looks like: an evaluator finishes the landing's "break it" demo and the tutorial and comes
away able to explain _why_ the staleness bug class becomes a build error — not just that it does.
The site converts on understanding, not hype. It is also a live proof: the site itself runs on
Kovo (JS-off-capable, interactive at first paint), so every claim is something the reader can
verify in their own devtools on this very page.

## Brand Personality

**Sharp, candid, technical.** Opinionated and direct — it names what the framework rejects and why
(the SPEC's non-goals voice: client routers, hydration, shadow DOM, runtime signal graphs — each
with its reason), states tradeoffs plainly, and never reaches for a superlative when a runnable
artifact would do. Dry, precise, zero hype. The tone of a senior engineer explaining a system they
deeply understand to a peer they respect — confident enough to show the failure cases, not just the
happy path.

Voice rules:

- Lead with the artifact (a diagnostic, a diff, a graph, a measured byte count), then the claim.
- Quantify with measured numbers from this build, never rounded marketing figures.
- Prefer the specific verb to the adjective. "Caught at the database → query junction" beats "powerful type safety."
- It is allowed to be blunt about what Kovo is _not_ for (§1.4 non-goals). Candor is a feature.

## Anti-references

This site must not look or feel like any of these:

- **The generic SaaS-cream / AI dev-tool landing.** Gradient-purple hero, rounded glassy cards, the
  hero-metric template, a tracked-uppercase eyebrow over every section, identical icon-card grids.
  The saturated 2026 AI-generated look. Kovo's terminal-ledger system is the deliberate opposite.
- **The hype-driven launch page.** "Blazingly fast" superlatives, benchmarks-as-bragging with no
  reproducible method, vague claims unbacked by a runnable artifact, logo-soup social proof.
- **Over-animated / flashy.** Scroll-jacking, parallax-everything, decorative motion that competes
  with the substance. Motion here is intentional and earns its place (the blinking cursor, the
  `:has()`-driven break-it demo) or it is absent.
- **Sterile, lifeless docs.** The opposite failure: default-browser styling, no point of view, no
  craft. Restraint is not the same as not caring — the site is quiet _and_ exacting.

## Design Principles

1. **Show, don't tell.** Every headline claim is paired with a thing the reader can run, read, or
   reproduce — the break-it demo, real `kovo check` output, a measured loader byte count. Proof
   over adjectives.
2. **Practice what you preach.** The site is built on Kovo and must hold to Kovo's own promises:
   interactive at first paint, works with JS off, legible source, fast. It is the first and most
   important reference app. Dogfooding is the argument.
3. **Legible at every layer.** Like the framework, the site rewards inspection — clean source, no
   decorative obfuscation, structure you can read in devtools. The aesthetic _is_ the thesis made
   visible.
4. **Earn the reader's trust by being candid.** State tradeoffs and non-goals openly. Respect the
   evaluator's skepticism instead of papering over it; a framework honest about its boundaries is
   more credible inside them.
5. **Restraint with conviction.** Quiet, monochrome-leaning, typography-and-structure-driven — but
   never timid. The single teal accent, the square hairline frames, and the terminal idiom are
   committed choices, not the absence of choices.

## Accessibility & Inclusion

Target **WCAG 2.2 AA**, and the site should model the accessibility standards the framework itself
holds apps to (see `rules/accessibility-conformance.md`).

- Body text meets ≥4.5:1 contrast against its background; large/bold text ≥3:1. The muted ramp
  (`--dim`, `--faint`) must clear these bars in both light and dark themes — verify, don't assume.
- Full keyboard operability with a visible focus indicator on every interactive element, including
  the `:has()`-driven landing demos (they are real radio inputs/labels, so keep them reachable and
  labeled).
- Light and dark themes are both first-class; respect `color-scheme` and the user's theme choice.
- Every animation has a `prefers-reduced-motion: reduce` alternative (the blinking cursor and any
  future motion degrade to a static state).
- Semantic landmarks and heading order; prose capped at a readable measure (~65–75ch).
- Code terminals stay black in both themes by design — ensure their syntax token colors clear AA on
  that black, not just on the page background.
