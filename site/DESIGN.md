---
name: Kovo
description: The Proof — an editorial-technical system for a framework that makes app behavior provable.
colors:
  ground: '#fafafa'
  surface: '#f0f0f0'
  card: '#ffffff'
  ink: '#191919'
  dim: '#525252'
  faint: '#838383'
  edge: '#dcdcdc'
  edge-soft: '#e8e8e8'
  indigo: '#2f4d8a'
  indigo-soft: '#5f78b8'
  stale-red: '#c0392b'
  synced-green: '#1c7d44'
  warn-amber: '#b07012'
  terminal-ink: '#16171b'
  ground-dark: '#121319'
  card-dark: '#181a21'
  ink-dark: '#e9eaee'
  indigo-dark: '#8aa6f2'
typography:
  display:
    fontFamily: 'Source Serif 4, Iowan Old Style, Charter, Georgia, serif'
    fontSize: 'clamp(2.7rem, 5.4vw, 4.5rem)'
    fontWeight: 600
    lineHeight: 1.02
    letterSpacing: '-0.025em'
  headline:
    fontFamily: 'Source Serif 4, Georgia, serif'
    fontSize: 'clamp(1.8rem, 3.2vw, 2.4rem)'
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: '-0.02em'
  lede:
    fontFamily: 'Source Serif 4, Georgia, serif'
    fontSize: 'clamp(1.2rem, 2vw, 1.55rem)'
    fontWeight: 380
    lineHeight: 1.34
    letterSpacing: 'normal'
  title:
    fontFamily: 'Inter, system-ui, sans-serif'
    fontSize: '1.45rem'
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: '-0.015em'
  body:
    fontFamily: 'Inter, system-ui, sans-serif'
    fontSize: '1.02rem'
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 'normal'
  label:
    fontFamily: 'JetBrains Mono, ui-monospace, monospace'
    fontSize: '0.66rem'
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: '0.14em'
rounded:
  none: '0'
  sm: '4px'
  md: '6px'
  pill: '9999px'
spacing:
  xs: '0.4rem'
  sm: '0.7rem'
  md: '1.1rem'
  lg: '1.8rem'
  xl: '3rem'
  section: '3.6rem'
components:
  button-primary:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.ground}'
    rounded: '{rounded.none}'
    padding: '0.75rem 1.4rem'
  button-line:
    backgroundColor: '{colors.card}'
    textColor: '{colors.ink}'
    rounded: '{rounded.none}'
    padding: '0.75rem 1.4rem'
  link:
    textColor: '{colors.indigo}'
  install-chip:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.none}'
    padding: '0.66rem 1rem'
  callout:
    backgroundColor: '{colors.card}'
    textColor: '{colors.ink}'
    rounded: '{rounded.none}'
    padding: '0.85rem 0.95rem'
  code-frame:
    backgroundColor: '{colors.terminal-ink}'
    textColor: '#dcdee2'
    rounded: '{rounded.none}'
    padding: '1rem 1.25rem'
---

# Design System: Kovo

## 1. Overview

**Creative North Star: "The Proof"**

Kovo's thesis is that an application's behavior should be _provable_ — checked end to end, before
anything runs. The site makes that thesis visible by presenting itself as a typeset proof: the
restraint of a well-set engineering paper, the precision of a reference manual, the confidence of an
author who shows the failure cases, not just the happy path. Structure and typography carry the
argument; ornament is absent because a proof has none.

The system is **editorial-technical**. A near-neutral off-white ground keeps the page calm and
literate. A single deep-indigo accent behaves like a proof mark or an errata correction: rare,
deliberate, never decorative. Serif display headings give the page the authority of print; a clean
grotesque body keeps it legible at length; monospace appears only where the machine speaks (code,
diagnostics, labels). Real toolchain output lives in hard, dark terminal frames that read as
_evidence_, not decoration.

This system explicitly rejects the saturated defaults of its category. It is **not** a SaaS-cream
dev-tool landing (no gradient-purple hero, no rounded glassy cards, no eyebrow kicker over every
section, no identical icon-card grid). It is **not** a hype launch page (no "blazingly fast"
superlatives, no benchmark bragging without a reproducible method). It is **not** over-animated
(motion is intentional and earns its place, or it is absent). And it is **not** sterile, unconsidered
docs — restraint here is a committed choice, not the absence of one.

**Key Characteristics:**

- Off-white neutral ground (chroma 0), never cream or warm-tinted.
- One indigo accent, used on ≤10% of any screen.
- Serif display + grotesque body + mono for machine voice.
- Square frames, hairline borders, flat by default. No drop shadows as decoration.
- Dark code/terminal frames in both themes — evidence, not chrome.
- Red means stale/error, green means in-sync; these are semantics, never the brand color.

## 2. Colors

A near-neutral off-white system carrying a single deep-indigo accent, with fixed red/green
semantics for the framework's core story (stale vs. in-sync). Canonical values are sRGB hex; the
project's runtime tokens may also be expressed in OKLCH (the `@kovojs/style` theme pipeline), but
the hex here is the source of truth for this spec.

### Primary

- **Compiler Indigo** (`#2f4d8a`): The one brand hue. Links, the italic emphasis words in display
  headings, the CTA underline, the "Kovo catches it" moment in the hero. Cool and precise — it
  reads "there is a real compiler here," and stays clearly distinct from the red/green semantics.
  Soft companion **Indigo Soft** (`#5f78b8`) for hovers and secondary marks. On dark ground the
  accent brightens to **Indigo Light** (`#8aa6f2`) to hold contrast.

### Neutral

- **Off-White Ground** (`#fafafa`): The page background. True neutral, chroma 0 — deliberately not
  cream, sand, or warm paper.
- **Surface** (`#f0f0f0`): Inset chips, the install command, quiet panels.
- **Card** (`#ffffff`): The raised reading surface — the hero unit, doc cards, table rows.
- **Ink** (`#191919`): Primary text and the solid (dark) button fill.
- **Dim** (`#525252`): Secondary text, captions. Clears 4.5:1 on ground and card.
- **Faint** (`#838383`): Mono labels, meta, table headers. Used at small sizes only.
- **Edge** (`#dcdcdc`) / **Edge-Soft** (`#e8e8e8`): Hairline borders and dividers. The structure of
  the page is drawn with 1px lines, not shadows.
- **Terminal Ink** (`#16171b`): The near-black fill of code and captured-output frames, in both
  light and dark themes.

### Semantic (fixed — not brand colors)

- **Stale Red** (`#c0392b`): A UI that disagrees with itself; a build error; the "shipped the bug"
  state. Background tint `#fbeceb`.
- **Synced Green** (`#1c7d44`): Every view of a fact in agreement; a passing check. Background tint
  `#e9f4ec`.
- **Warn Amber** (`#b07012`): The hydration "dead zone," wasted-time hatching, soft warnings.

### Named Rules

**The One Voice Rule.** Indigo appears on no more than ~10% of any screen. Its rarity is what makes
it read as a deliberate mark rather than decoration. If a section has indigo in three places, two of
them are wrong.

**The Semantics-Aren't-Branding Rule.** Red is always stale/error and green is always in-sync,
everywhere, forever. Never recolor a status to match the brand, and never use indigo to mean
"good." The framework's entire pitch depends on the reader trusting red-means-broken on sight.

## 3. Typography

**Display Font:** Source Serif 4 (with Iowan Old Style, Charter, Georgia fallback)
**Body Font:** Inter (with system-ui fallback)
**Label / Mono Font:** JetBrains Mono (with ui-monospace fallback)

**Character:** A high-contrast transitional serif paired with a neutral grotesque on a true
contrast axis (serif vs. sans), with monospace reserved for the machine's own voice. The serif gives
headings the authority of a printed paper; Inter keeps long-form reading clean and modern; the mono
signals "this is real output," not prose. The pairing is literate but unsentimental — the serif is
structural, not a fashion face.

### Hierarchy

- **Display** (600, `clamp(2.7rem, 5.4vw, 4.5rem)`, line-height 1.02, letter-spacing −0.025em):
  Hero headline only. Tight but never touching; the −0.04em floor is respected.
- **Headline** (600, `clamp(1.8rem, 3.2vw, 2.4rem)`, −0.02em): Section titles (serif).
- **Lede** (serif, 380, `clamp(1.2rem, 2vw, 1.55rem)`, line-height 1.34): The subhead under the
  hero and section intros. A serif body weight — literate, calm.
- **Title** (Inter 600, 1.45rem): Card and component headings where sans reads cleaner than serif.
- **Body** (Inter 400, 1.02rem, line-height 1.6): Prose. Capped at 65–75ch measure.
- **Label** (JetBrains Mono 500, 0.66rem, letter-spacing 0.14em, uppercase): Mono eyebrows,
  table headers, terminal title bars, timeline beats.

### Named Rules

**The Machine-Voice Rule.** Monospace is reserved for things the machine produced or consumes: code,
diagnostics, file paths, CLI commands, key labels. Never set prose or marketing copy in mono to look
"technical." When the reader sees mono, it must be literal.

**The Display-Serif-Only Rule.** The serif is for display, headline, and lede. Body prose is always
the grotesque. Two competing serifs at reading size is forbidden.

## 4. Elevation

This system is **flat by default**. Depth is conveyed by 1px hairline borders and tonal layering
(ground → surface → card), not by drop shadows. A surface at rest never floats. The only legitimate
"raise" is the dark terminal frame, whose contrast against the off-white page already reads as a
distinct plane without any shadow.

Drop shadows are reserved for genuinely transient, overlapping UI (a dropdown, popover, or dialog
that must visibly sit above the page), and even then they are a single soft shadow at ≤8px blur,
never the wide ambient glow of a "ghost card."

### Named Rules

**The Flat-By-Default Rule.** Surfaces are flat. If you reach for a `box-shadow` on a card, button,
or section, stop — use a hairline border or a tonal step instead. A 1px border plus a wide soft
shadow on the same element (the codex "ghost-card") is forbidden.

## 5. Components

### Buttons

- **Shape:** Square (`0` radius). Pills (`9999px`) are allowed only for small tags/chips, never
  for primary actions.
- **Primary:** Solid Ink fill (`#191919`), Off-White text, mono uppercase label at 0.74rem,
  letter-spacing 0.12em, padding `0.75rem 1.4rem`. The high-commitment action (Get started).
- **Line:** Card background, Ink text, 1px Edge border, same mono label. Secondary action.
- **Hover / Focus:** Line buttons shift border toward Faint. A visible focus ring (2px Indigo
  outline, 2px offset) on every interactive element. Transitions are 0.15s, color/border only.

### Install Chip / Inline Command

- **Style:** Surface background, 1px Edge border, square, JetBrains Mono at 0.85rem. A leading
  Indigo `$`. A quiet "copy" affordance in mono uppercase Faint, brightening to Ink on hover.
- The single most-clicked element on the page; it is plain and unmistakable, not a styled button.

### Callout (the verdict bar)

- **Style:** Card or tinted background, 1px border, square. A **leading status chip** (a small
  filled square with ✓ / ✗ / !) carries the color; the body text stays Ink for readability.
- **States:** Synced → green chip + `#e9f4ec` tint. Stale → red chip + `#fbeceb` tint. Caught →
  indigo chip + faint indigo tint. The tint and chip do the signaling; the text is never set in
  pure red/green at body size.
- **Never** a thick colored left-stripe. The leading chip replaces the side-stripe entirely.

### Cards / Containers / The Hero Unit

- **Corner Style:** Square (`0`), or `sm`/`md` (4–6px) at the very most. Never 24px+.
- **Background:** Card (`#ffffff`) on the Ground.
- **Border:** 1px Edge. The frame's border may shift to a semantic color (red/indigo/green) when it
  is narrating a state, as the hero unit does.
- **Shadow Strategy:** None (see Elevation).
- **Internal Padding:** `1.1rem`–`1.8rem`. Compose related elements (timeline header, body,
  verdict callout) inside one bordered unit rather than stacking separate floating boxes.

### Code & Terminal Frames

- **Style:** Terminal Ink (`#16171b`) fill in both themes, 1px dark border, square. A mono uppercase
  title bar (Faint) with the file/command on the left and a quiet action on the right.
- **Syntax/diagnostic tokens:** error red `#ff7a72`, fix/accent teal-cyan `#5fd0c4`, dim `#7e828b`,
  location `#cfd2d7`. These are tuned to clear AA on the dark frame, independent of the page accent.

### Inputs / Fields

- **Style:** Card background, 1px Edge border, square. Mono or Inter per context.
- **Focus:** Border shifts to Indigo with a 2px Indigo ring. No glow.
- **Error:** Border and helper text in Stale Red; the field keeps its shape.

### Navigation

- **Style:** Sticky, Ground at 90% with a light blur, 1px Edge bottom border. Serif wordmark on the
  left; Inter nav links in Dim brightening to Ink (or Indigo on the active route); a mono "GitHub"
  line-link. Collapses the GitHub link into a menu below 48rem.

### Signature Component — The Two-Act Stale/Sync Timeline

The hero's teaching device. A single bordered unit whose header is a two-zone timeline —
**"Every other framework"** (idle → add → stale, shipped ✗) and **"What Kovo adds"** (caught →
consistent ✓) — separated by a `kovo check` gate. The active beat lights; the inactive era dims; the
accent zone carries a faint indigo tint. Below sits the live demo, and below that a morphing verdict
callout. Built to be re-authorable as zero-JS `:has()` + CSS, so the hero itself dogfoods the
no-JS-on-load claim.

## 6. Do's and Don'ts

### Do:

- **Do** keep the ground a true neutral off-white (`#fafafa`, chroma 0). Carry warmth, if any, in
  type and accent — never in the body background.
- **Do** use Indigo on ≤10% of any screen (the One Voice Rule).
- **Do** set headings in the serif and body in Inter; reserve mono for the machine's voice.
- **Do** draw structure with 1px hairline borders and tonal steps (ground → surface → card).
- **Do** keep red = stale/error and green = in-sync, everywhere, always.
- **Do** pair every animation with a `prefers-reduced-motion: reduce` fallback to the resolved
  (consistent) state.
- **Do** verify body text ≥4.5:1 and large text ≥3:1 in both light and dark themes, including the
  Dim/Faint ramps and any text over tinted callouts.

### Don't:

- **Don't** ship the SaaS-cream dev-tool look: no gradient-purple hero, no rounded glassy cards, no
  tracked-uppercase eyebrow over every section, no identical icon + heading + text card grid.
- **Don't** make hype claims ("blazingly fast", benchmark bragging) without a runnable, reproducible
  artifact beside them. Show, don't tell.
- **Don't** over-animate: no scroll-jacking, no parallax-everything, no decorative motion that
  competes with the substance.
- **Don't** go sterile either — default-browser styling with no point of view is the opposite
  failure. Restraint is a committed choice.
- **Don't** use a colored `border-left`/`border-right` greater than 1px as an accent stripe on
  cards, callouts, or list items. Use the leading status chip instead.
- **Don't** pair `border: 1px solid` with a wide `box-shadow` (≥16px blur) on the same element (the
  ghost-card). Pick one.
- **Don't** round cards to 24px+. Cards are square or 4–6px at most; pills are for tags only.
- **Don't** set the display heading letter-spacing tighter than −0.04em, and don't exceed a ~6rem
  display max.
- **Don't** recolor a status to the brand, or use Indigo to mean "good."
