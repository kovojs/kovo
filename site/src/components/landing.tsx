/** @jsxImportSource @kovojs/server */
import * as style from '@kovojs/style';

import { SiteFooter, SiteHeader, type ClientHrefs } from './chrome.js';

// Landing page (SPEC §7 L0): authored as TSX route composition so the route
// compiler can derive enhanced-navigation page boundaries. Interactions are
// zero-JS by construction — the hero's stale-UI demo is a CSS keyframe loop and
// the auto-invalidation section's mobile tabs are radio + :has() — so the page
// is interactive at first paint with no JavaScript required on load.
//
// The header and footer are the shared site chrome (SiteHeader/SiteFooter from
// chrome.tsx). The visual system is "The Proof" (see DESIGN.md): all colors flow
// from the global design tokens (--bg/--ink/--accent/… in styles.css), so the
// page reads correctly in both light and dark themes; code and terminal frames
// stay near-black in both as evidence.

const landingStyles = style.create(
  {
    // The page inherits the global design tokens from styles.css (no local
    // overrides), so it tracks the light/dark theme like the rest of the site.
    root: {
      background: 'var(--bg)',
      color: 'var(--ink)',
      minHeight: '100vh',
    },
    link: {
      color: 'inherit',
      textDecoration: 'none',
    },
    wrap: {
      margin: '0 auto',
      maxWidth: '80rem',
      padding: '0 1.5rem',
    },
    cmd: {
      alignItems: 'center',
      background: 'var(--panel)',
      borderColor: 'var(--edge)',
      borderStyle: 'solid',
      borderWidth: 1,
      display: 'inline-flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.88rem',
      gap: '1rem',
      padding: '0.7rem 1.1rem',
    },
    dollar: {
      color: 'var(--teal)',
    },
    copyButton: {
      background: 'none',
      border: 'none',
      color: 'var(--faint)',
      cursor: 'pointer',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.68rem',
      letterSpacing: '0.1em',
      margin: 0,
      padding: 0,
      textTransform: 'uppercase',
      ':hover': {
        color: 'var(--ink)',
      },
      '[data-copied]': {
        color: 'var(--teal)',
      },
    },
    go: {
      borderBottomColor: 'var(--teal)',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      color: 'var(--ink)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.78rem',
      letterSpacing: '0.12em',
      paddingBottom: '0.15rem',
      textTransform: 'uppercase',
    },
  },
  { namespace: 'site-landing', source: 'site/src/components/landing.tsx' },
);

// The Proof hero (DESIGN.md signature component): the stale-UI story as a
// zero-JS CSS auto-loop. Base styles render the consistent end-state, and the
// @keyframes in styles.css (hero-*) animate the 15s loop; prefers-reduced-motion
// freezes to that consistent state via [data-anim="hero"].
const heroStyles = style.create(
  {
    // Full-width headline on top, then a two-column row (copy + live demo)
    // below — the headline spans the whole measure rather than sharing the
    // left column with the lede.
    // Mobile-first: the atomic layer emits max-width media *before* the base
    // rule in the same layer, so a max-width override loses to the base. Author
    // the stacked phone layout as the base and opt into the two-column desktop
    // layout with a min-width query, which sorts after the base and wins.
    hero: {
      display: 'block',
      padding: '2.8rem 0 2.6rem',
      '@media (min-width: 64rem)': {
        padding: '4rem 0 3.6rem',
      },
    },
    // Technical-preview banner: a quiet caution strip above the headline. A left
    // amber rule + top/bottom hairlines with no fill (no hard box), an outlined
    // mono chip, and a feedback link to GitHub issues. Amber (not the indigo
    // --accent) because "not ready for production" is a caution, not a feature.
    preview: {
      alignItems: 'center',
      borderBottomColor: 'var(--edge)',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      borderLeftColor: 'var(--amber)',
      borderLeftStyle: 'solid',
      borderLeftWidth: 3,
      borderTopColor: 'var(--edge)',
      borderTopStyle: 'solid',
      borderTopWidth: 1,
      display: 'flex',
      flexWrap: 'wrap',
      gap: '0.5rem 0.7rem',
      marginBottom: '1.9rem',
      padding: '0.65rem 0.95rem',
    },
    previewBadge: {
      alignItems: 'center',
      borderColor: 'color-mix(in srgb, var(--amber) 50%, var(--edge))',
      borderStyle: 'solid',
      borderWidth: 1,
      color: 'var(--amber)',
      display: 'inline-flex',
      flexShrink: 0,
      fontFamily: 'var(--font-mono)',
      fontSize: '0.6rem',
      fontWeight: 700,
      letterSpacing: '0.13em',
      padding: '0.22rem 0.5rem',
      textTransform: 'uppercase',
    },
    previewText: {
      color: 'var(--dim)',
      fontSize: '0.92rem',
      lineHeight: 1.5,
    },
    previewStrong: { color: 'var(--ink)', fontWeight: 600 },
    previewLink: {
      borderBottomColor: 'var(--amber)',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      color: 'var(--ink)',
      fontWeight: 600,
      textDecoration: 'none',
      ':hover': { color: 'var(--amber)' },
    },
    row: {
      alignItems: 'start',
      display: 'grid',
      gap: '2.4rem',
      marginTop: '1.8rem',
      // No base grid-template-columns: a lone implicit column stacks the copy and
      // demo on mobile, and the two-column track is added only at min-width. This
      // mirrors pageStyles.aiUnit — setting a base value and overriding it from a
      // media query is order-fragile in the atomic layer (the base can win even
      // at desktop), so the column track lives solely in the min-width rule.
      '@media (min-width: 64rem)': {
        gap: '3.6rem',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.05fr)',
        marginTop: '2.2rem',
      },
    },
    col: { minWidth: 0 },
    h1: {
      color: 'var(--ink)',
      fontFamily: 'var(--font-display)',
      // Min sized so the longest unbreakable line ("The web framework") clears a
      // ~360px content width without overflow; full-bleed measure earns the cap.
      fontSize: 'clamp(2.15rem, 5.4vw, 4.4rem)',
      fontWeight: 600,
      letterSpacing: '-0.025em',
      lineHeight: 1.07,
      margin: 0,
      // Greedy wrapping by default so the nbsp-locked emphasis phrases always
      // drop to their own line on phones instead of overflowing; balance the
      // full-bleed measure only once there is room (min-width sorts correctly in
      // the atomic layer, unlike a max-width override).
      textWrap: 'normal',
      '@media (min-width: 40rem)': {
        textWrap: 'balance',
      },
    },
    // The emphasis phrases read as a hand-applied highlighter stroke: a soft
    // tint marker that fills the glyph height, sits snug to the text, and is
    // skewed a hair off-true. The text keeps the fixed semantics (red = the
    // bug, indigo = the caught/build-error state per DESIGN.md §2).
    bugPhrase: {
      color: 'var(--red)',
      fontStyle: 'normal',
      padding: '0 0.1em',
      position: 'relative',
      zIndex: 0,
      '::before': {
        background: 'color-mix(in srgb, var(--red) 20%, transparent)',
        borderRadius: '3px 5px 4px 6px',
        bottom: '0.04em',
        content: '""',
        left: '-0.03em',
        position: 'absolute',
        right: '-0.03em',
        top: '0.04em',
        transform: 'rotate(-0.8deg)',
        zIndex: -1,
      },
    },
    buildPhrase: {
      color: 'var(--accent)',
      fontStyle: 'normal',
      padding: '0 0.1em',
      position: 'relative',
      zIndex: 0,
      '::before': {
        background: 'color-mix(in srgb, var(--accent) 20%, transparent)',
        borderRadius: '3px 5px 4px 6px',
        bottom: '0.04em',
        content: '""',
        left: '-0.03em',
        position: 'absolute',
        right: '-0.03em',
        top: '0.04em',
        transform: 'rotate(0.7deg)',
        zIndex: -1,
      },
    },
    lede: {
      color: 'var(--ink)',
      fontFamily: 'var(--font-display)',
      fontSize: 'clamp(1.2rem, 2vw, 1.55rem)',
      fontWeight: 380,
      lineHeight: 1.34,
      margin: 0,
      maxWidth: '33rem',
    },
    sub: {
      color: 'var(--dim)',
      fontSize: '1rem',
      lineHeight: 1.62,
      margin: '1.1rem 0 0',
      maxWidth: '32rem',
    },
    strong: { color: 'var(--ink)', fontWeight: 600 },
    cta: {
      alignItems: 'center',
      display: 'flex',
      flexWrap: 'wrap',
      gap: '1.1rem',
      marginTop: '1.9rem',
    },
    unit: {
      background: 'var(--card)',
      borderColor: 'var(--green)',
      borderStyle: 'solid',
      borderWidth: 1,
      minWidth: 0,
      overflow: 'hidden',
      animation: 'hero-unit 15s linear infinite',
    },
    acts: {
      borderBottomColor: 'var(--edge)',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      display: 'flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.6rem',
      letterSpacing: '0.05em',
      textTransform: 'uppercase',
    },
    actA: {
      display: 'flex',
      flexDirection: 'column',
      gap: '0.45rem',
      opacity: 0.38,
      padding: '0.6rem 0.85rem',
      animation: 'hero-acta 15s linear infinite',
    },
    actB: {
      background: 'color-mix(in srgb, var(--accent) 6%, var(--card))',
      display: 'flex',
      flex: 1,
      flexDirection: 'column',
      gap: '0.45rem',
      padding: '0.6rem 0.85rem',
      animation: 'hero-actb 15s linear infinite',
    },
    actLabA: { color: 'var(--ink)', fontSize: '0.76rem', fontWeight: 700, letterSpacing: '0.03em' },
    actLabB: {
      alignItems: 'center',
      color: 'var(--accent)',
      display: 'flex',
      fontSize: '0.76rem',
      fontWeight: 700,
      gap: '0.45rem',
      letterSpacing: '0.03em',
    },
    diamond: { background: 'var(--accent)', height: 8, transform: 'rotate(45deg)', width: 8 },
    beats: { display: 'flex', flexWrap: 'wrap', gap: '0.8rem', marginTop: '0.1rem' },
    beat: {
      alignItems: 'center',
      color: 'var(--faint)',
      display: 'flex',
      fontSize: '0.62rem',
      fontWeight: 500,
      gap: '0.35rem',
    },
    seam: {
      alignItems: 'center',
      borderLeftColor: 'var(--accent)',
      borderLeftStyle: 'dashed',
      borderLeftWidth: 1,
      borderRightColor: 'var(--accent)',
      borderRightStyle: 'dashed',
      borderRightWidth: 1,
      color: 'var(--accent)',
      display: 'flex',
      fontSize: '0.52rem',
      lineHeight: 1.2,
      padding: '0 0.7rem',
      textAlign: 'center',
      whiteSpace: 'nowrap',
    },
    shopbar: {
      alignItems: 'center',
      background: 'var(--panel)',
      borderBottomColor: 'var(--edge-soft)',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      display: 'flex',
      justifyContent: 'space-between',
      padding: '0.7rem 1rem',
    },
    brand: { fontFamily: 'var(--font-display)', fontSize: '0.95rem', fontWeight: 600 },
    pill: {
      alignItems: 'center',
      background: 'var(--synced-bg)',
      borderColor: 'var(--green)',
      borderStyle: 'solid',
      borderWidth: 1,
      color: 'var(--green)',
      display: 'inline-flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.8rem',
      gap: '0.45rem',
      padding: '0.28rem 0.62rem',
      animation: 'hero-pill 15s linear infinite',
    },
    badgeWrap: { display: 'inline-block', fontWeight: 700, position: 'relative' },
    badge2: { animation: 'hero-badge2 15s linear infinite', opacity: 0 },
    badge3: {
      animation: 'hero-badge3 15s linear infinite',
      left: 0,
      opacity: 1,
      position: 'absolute',
      top: 0,
    },
    shopbody: {
      display: 'grid',
      gridTemplateColumns: '1.15fr 1fr',
      '@media (max-width: 30rem)': { gridTemplateColumns: '1fr' },
    },
    prod: { padding: '1.1rem', position: 'relative' },
    prodNm: { fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 600 },
    prodPr: {
      color: 'var(--dim)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.82rem',
      margin: '0.2rem 0 0.9rem',
    },
    addBtn: {
      background: 'var(--ink)',
      border: 'none',
      color: 'var(--bg)',
      cursor: 'pointer',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.7rem',
      letterSpacing: '0.06em',
      padding: '0.55rem 0.9rem',
      position: 'relative',
      textTransform: 'uppercase',
      animation: 'hero-press 15s ease infinite',
    },
    lblWrap: { display: 'inline-block', position: 'relative' },
    lbl1: { animation: 'hero-lbl1 15s linear infinite', opacity: 0 },
    lbl2: {
      animation: 'hero-lbl2 15s linear infinite',
      left: 0,
      opacity: 1,
      position: 'absolute',
      top: 0,
      whiteSpace: 'nowrap',
    },
    ring: {
      borderColor: 'var(--accent)',
      borderRadius: 9999,
      borderStyle: 'solid',
      borderWidth: 2,
      height: 54,
      left: '2.4rem',
      marginLeft: -27,
      marginTop: -27,
      opacity: 0,
      pointerEvents: 'none',
      position: 'absolute',
      top: '5.5rem',
      width: 54,
      animation: 'hero-ring 15s linear infinite',
    },
    ring2: { borderColor: 'var(--accent-soft)', animation: 'hero-ring2 15s linear infinite' },
    cursor: {
      height: 34,
      left: '1.9rem',
      opacity: 0,
      pointerEvents: 'none',
      position: 'absolute',
      top: '5rem',
      transform: 'translate(0, 0)',
      width: 34,
      zIndex: 4,
      animation: 'hero-cursor 15s cubic-bezier(0.33, 1, 0.68, 1) infinite',
    },
    cursorPath: { fill: 'var(--ink)', stroke: 'var(--card)' },
    mini: {
      borderLeftColor: 'var(--edge-soft)',
      borderLeftStyle: 'solid',
      borderLeftWidth: 1,
      padding: '1.1rem',
      '@media (max-width: 30rem)': {
        borderLeftWidth: 0,
        borderTopColor: 'var(--edge-soft)',
        borderTopStyle: 'solid',
        borderTopWidth: 1,
      },
    },
    miniH: {
      color: 'var(--faint)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.6rem',
      letterSpacing: '0.16em',
      margin: '0 0 0.7rem',
      textTransform: 'uppercase',
    },
    mline: {
      color: 'var(--dim)',
      display: 'flex',
      fontSize: '0.85rem',
      justifyContent: 'space-between',
      marginBottom: '0.4rem',
    },
    mlineB: { color: 'var(--ink)' },
    mtot: {
      borderTopColor: 'var(--edge-soft)',
      borderTopStyle: 'solid',
      borderTopWidth: 1,
      display: 'flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.85rem',
      justifyContent: 'space-between',
      marginTop: '0.55rem',
      paddingTop: '0.55rem',
    },
    swap: { display: 'inline-block', position: 'relative' },
    tick: { animation: 'hero-tick 15s ease infinite' },
    num2: { animation: 'hero-cart2 15s linear infinite', opacity: 0 },
    num3: {
      animation: 'hero-cart3 15s linear infinite',
      left: 0,
      opacity: 1,
      position: 'absolute',
      top: 0,
    },
    verdict: {
      alignItems: 'flex-start',
      background: 'var(--synced-bg)',
      borderTopColor: 'var(--edge)',
      borderTopStyle: 'solid',
      borderTopWidth: 1,
      display: 'flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.76rem',
      gap: '0.7rem',
      lineHeight: 1.5,
      minHeight: '4.7rem',
      padding: '0.85rem 0.95rem',
      animation: 'hero-vtint 15s linear infinite',
    },
    vMark: {
      background: 'var(--green)',
      color: '#fff',
      flexGrow: 0,
      flexShrink: 0,
      fontWeight: 700,
      height: '1.35rem',
      marginTop: '0.05rem',
      position: 'relative',
      width: '1.35rem',
      animation: 'hero-vmark 15s linear infinite',
    },
    vGlyph: {
      alignItems: 'center',
      bottom: 0,
      display: 'flex',
      justifyContent: 'center',
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0,
    },
    vBody: { color: 'var(--ink)', flex: 1, minHeight: '3rem', position: 'relative' },
    vLine: { left: 0, position: 'absolute', right: 0, top: 0 },
    vFix: { color: 'var(--accent)', display: 'block', marginTop: '0.3rem' },
    vg0: { animation: 'hero-v0 15s linear infinite', opacity: 0 },
    vg1: { animation: 'hero-v1 15s linear infinite', opacity: 0 },
    vg2: { animation: 'hero-v2 15s linear infinite', opacity: 0 },
    vg3: { animation: 'hero-v3 15s linear infinite', opacity: 0 },
    vg4: { animation: 'hero-v4 15s linear infinite', opacity: 1 },
  },
  { namespace: 'site-hero', source: 'site/src/components/landing.tsx' },
);

// Security hero (Bobby Tables SQL injection). Shares the hero unit / two-act
// header / verdict and several hero-* keyframes; only the form, table, and the
// security-tinted verdict are new. Base styles render the safe end-state.
const secStyles = style.create(
  {
    formBlock: { padding: '1.1rem 1.1rem 0.6rem' },
    formLabel: {
      color: 'var(--faint)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.6rem',
      letterSpacing: '0.16em',
      margin: '0 0 0.5rem',
      textTransform: 'uppercase',
    },
    field: {
      alignItems: 'center',
      background: 'var(--card)',
      borderColor: 'var(--edge)',
      borderStyle: 'solid',
      borderWidth: 1,
      display: 'flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.82rem',
      minHeight: '2.4rem',
      padding: '0.55rem 0.7rem',
      animation: 'sec-field 15s linear infinite',
    },
    typed: {
      color: 'var(--stale)',
      opacity: 1,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      animation: 'sec-typed 15s linear infinite',
    },
    tableBlock: { padding: '0.6rem 1.1rem 1.1rem' },
    tlabel: {
      color: 'var(--faint)',
      display: 'flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.6rem',
      justifyContent: 'space-between',
      letterSpacing: '0.16em',
      margin: '0 0 0.5rem',
      textTransform: 'uppercase',
    },
    tstate: { display: 'inline-block', minWidth: '8rem', position: 'relative', textAlign: 'right' },
    tsline: { position: 'absolute', right: 0, top: 0, whiteSpace: 'nowrap' },
    tsBad: { color: 'var(--stale)' },
    tsAccent: { color: 'var(--accent)' },
    tsGood: { color: 'var(--synced)' },
    table: {
      borderColor: 'var(--edge)',
      borderStyle: 'solid',
      borderWidth: 1,
      fontFamily: 'var(--font-mono)',
      fontSize: '0.78rem',
      animation: 'sec-table 15s linear infinite',
    },
    thead: {
      borderBottomColor: 'var(--edge-soft)',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      color: 'var(--faint)',
      display: 'flex',
      justifyContent: 'space-between',
      padding: '0.4rem 0.7rem',
    },
    trow: {
      borderBottomColor: 'var(--edge-soft)',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      display: 'flex',
      justifyContent: 'space-between',
      padding: '0.4rem 0.7rem',
      animation: 'sec-rows 15s linear infinite',
    },
    trowLast: { borderBottomWidth: 0 },
    verdict: {
      alignItems: 'flex-start',
      background: 'var(--synced-bg)',
      borderTopColor: 'var(--edge)',
      borderTopStyle: 'solid',
      borderTopWidth: 1,
      display: 'flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.76rem',
      gap: '0.7rem',
      lineHeight: 1.5,
      minHeight: '4.6rem',
      padding: '0.85rem 0.95rem',
      animation: 'sec-vtint 15s linear infinite',
    },
    vMark: {
      background: 'var(--synced)',
      color: '#fff',
      flexGrow: 0,
      flexShrink: 0,
      fontWeight: 700,
      height: '1.35rem',
      marginTop: '0.05rem',
      position: 'relative',
      width: '1.35rem',
      animation: 'sec-vmark 15s linear infinite',
    },
  },
  { namespace: 'site-sec', source: 'site/src/components/landing.tsx' },
);

export interface LandingPageProps {
  clients: ClientHrefs;
}

export function LandingRoutePage({ clients }: LandingPageProps): string {
  return (
    <div style={landingStyles.root}>
      {SiteHeader.definition.render({ activePath: '/', clients })}
      <div style={landingStyles.wrap}>
        <SecurityHero clients={clients} />
        <HowItWorks />
        <StaleUiSection />
        <InstantLoad />
        <BatteriesIncluded />
        <Credibility />
      </div>
      {SiteFooter.definition.render()}
    </div>
  );
}

function SecurityHero({ clients }: { clients: ClientHrefs }): string {
  return (
    <section style={heroStyles.hero}>
      <div style={heroStyles.preview}>
        <span style={heroStyles.previewBadge}>Technical Preview</span>
        <span style={heroStyles.previewText}>
          <b style={heroStyles.previewStrong}>Not ready for production.</b> Breaking changes and
          rough edges to be expected &mdash;{' '}
          <a
            style={heroStyles.previewLink}
            href="https://github.com/kovojs/kovo/issues"
            rel="external"
          >
            share feedback
          </a>
          .
        </span>
      </div>
      <h1 style={heroStyles.h1}>
        The web framework that turns <em style={heroStyles.bugPhrase}>security&nbsp;bugs</em> into{' '}
        <em style={heroStyles.buildPhrase}>build&nbsp;errors</em>
      </h1>
      <div style={heroStyles.row}>
        <div style={heroStyles.col}>
          <p style={heroStyles.lede}>Make security holes a build error -- not a 2AM incident.</p>
          <p style={heroStyles.sub}>
            The Kovo compiler catches the most common security vulnerabilities --{' '}
            <b style={heroStyles.strong}>SQL injection</b>, <b style={heroStyles.strong}>XSS</b>,{' '}
            <b style={heroStyles.strong}>CSRF</b>, <b style={heroStyles.strong}>IDOR</b> -- as soon
            as your coding agent writes them.
          </p>
          <div style={heroStyles.cta}>
            <div style={landingStyles.cmd}>
              <span>
                <span style={landingStyles.dollar}>$</span> <code>npx create-kovo</code>
              </span>
              <button
                type="button"
                style={landingStyles.copyButton}
                on:click={`${clients.code}#copy`}
              >
                copy
              </button>
            </div>
            <a style={[landingStyles.link, landingStyles.go]} href="/tutorial/">
              Start the tutorial
            </a>
          </div>
        </div>
        <div data-anim="hero" style={heroStyles.unit}>
          <SecActs />
          <SecForm />
          <SecTable />
          <SecVerdict />
        </div>
      </div>
    </section>
  );
}

function SecActs(): string {
  return (
    <div style={heroStyles.acts}>
      <div style={heroStyles.actA}>
        <span style={heroStyles.actLabA}>Every other framework</span>
        <div style={heroStyles.beats}>
          <span style={heroStyles.beat}>attacker submits</span>
          <span style={heroStyles.beat}>SQL runs</span>
          <span style={heroStyles.beat}>dropped &#10007;</span>
        </div>
      </div>
      <div style={heroStyles.seam}>
        kovo
        <br />
        check
      </div>
      <div style={heroStyles.actB}>
        <span style={heroStyles.actLabB}>
          <span style={heroStyles.diamond}></span>What Kovo adds
        </span>
        <div style={heroStyles.beats}>
          <span style={heroStyles.beat}>caught at build</span>
          <span style={heroStyles.beat}>harmless &#10003;</span>
        </div>
      </div>
    </div>
  );
}

function SecForm(): string {
  return (
    <div style={secStyles.formBlock}>
      <p style={secStyles.formLabel}>Sign up &middot; name</p>
      <div style={secStyles.field}>
        <span style={secStyles.typed}>Robert&apos;); DROP TABLE users;--</span>
      </div>
    </div>
  );
}

function SecTable(): string {
  return (
    <div style={secStyles.tableBlock}>
      <p style={secStyles.tlabel}>
        <span>users</span>
        <span style={secStyles.tstate}>
          <span style={[secStyles.tsline, heroStyles.vg0]}>3 rows</span>
          <span style={[secStyles.tsline, heroStyles.vg1]}>3 rows</span>
          <span style={[secStyles.tsline, heroStyles.vg2, secStyles.tsBad]}>&#10007; dropped</span>
          <span style={[secStyles.tsline, heroStyles.vg3, secStyles.tsAccent]}>
            caught at build
          </span>
          <span style={[secStyles.tsline, heroStyles.vg4, secStyles.tsGood]}>&#10003; intact</span>
        </span>
      </p>
      <div style={secStyles.table}>
        <div style={secStyles.thead}>
          <span>id</span>
          <span>name</span>
        </div>
        <div style={secStyles.trow}>
          <span>1</span>
          <span>ada</span>
        </div>
        <div style={secStyles.trow}>
          <span>2</span>
          <span>grace</span>
        </div>
        <div style={[secStyles.trow, secStyles.trowLast]}>
          <span>3</span>
          <span>linus</span>
        </div>
      </div>
    </div>
  );
}

function SecVerdict(): string {
  return (
    <div style={secStyles.verdict}>
      <span style={secStyles.vMark}>
        <span style={[heroStyles.vGlyph, heroStyles.vg0]}>&middot;</span>
        <span style={[heroStyles.vGlyph, heroStyles.vg1]}>&middot;</span>
        <span style={[heroStyles.vGlyph, heroStyles.vg2]}>&#10007;</span>
        <span style={[heroStyles.vGlyph, heroStyles.vg3]}>!</span>
        <span style={[heroStyles.vGlyph, heroStyles.vg4]}>&#10003;</span>
      </span>
      <span style={heroStyles.vBody}>
        <span style={[heroStyles.vLine, heroStyles.vg0]}>
          Three users. A sign-up form that stores your name.
        </span>
        <span style={[heroStyles.vLine, heroStyles.vg1]}>
          An attacker submits a name that is really SQL.
        </span>
        <span style={[heroStyles.vLine, heroStyles.vg2, secStyles.tsBad]}>
          &#10007; the string executes -- <b>DROP TABLE users.</b> Everyone is gone.
        </span>
        <span style={[heroStyles.vLine, heroStyles.vg3]}>
          &#10007; KV422 -- a build error in Kovo. The query never shipped.
          <span style={heroStyles.vFix}>
            -&gt; parameterized: where(eq(users.name, input.name))
          </span>
        </span>
        <span style={[heroStyles.vLine, heroStyles.vg4, secStyles.tsGood]}>
          &#10003; the input is bound as a value -- stored as a name, no SQL run.
        </span>
      </span>
    </div>
  );
}

// ── "Secure by construction": how the security analysis actually works ───────
// Beat A makes the source -> sink mechanism literal (the SQL case fails
// unparameterized, the sql`` case is proven safe) and generalizes it to
// XSS/CSRF/IDOR. Beat B shows the real `kovo check` diagnostic the same code
// produces, in a dark captured-output evidence frame (DESIGN.md §5). Diagnostic
// codes are the real ones from site/gen/reference/diagnostics.md:
// SQL=KV422, XSS=KV424, CSRF=KV418, IDOR=KV414. Mobile-first: multi-column
// layouts are opted into with min-width media (the atomic layer drops max-width
// overrides; see pageStyles.aiUnit).
// ── "Secure by construction": how the security analysis works ────────────────
// One compact, tabbed evidence panel. Each tab is a real vulnerability class;
// selecting it swaps in that class's real `kovo check` diagnostic (the line, the
// rule, the fix) inside a dark captured-output frame (DESIGN.md §5). Tabs are
// zero-JS radio inputs revealed with :has() (same pattern as pageStyles.aiUnit),
// so the panels stay keyboard-operable and work with scripting off. Diagnostic
// codes are the real ones from site/gen/reference/diagnostics.md: SQL=KV422,
// XSS=KV424, CSRF=KV418, IDOR=KV414. The terminal frame is black in both themes
// per DESIGN.md §4, so its colors are fixed hex, not theme tokens.
const hiwStyles = style.create(
  {
    unit: {
      marginTop: '2rem',
      position: 'relative',
      // Panels hide by default and reveal when their radio is checked; the id in
      // :has() raises specificity above the base display:none, so this is robust
      // to atomic source order (unlike a plain media override).
      ':has(#sec-sql:checked) [data-panel="sql"]': { display: 'block' },
      ':has(#sec-xss:checked) [data-panel="xss"]': { display: 'block' },
      ':has(#sec-csrf:checked) [data-panel="csrf"]': { display: 'block' },
      ':has(#sec-idor:checked) [data-panel="idor"]': { display: 'block' },
      ':has(#sec-sql:checked) [data-tab="sql"]': {
        background: '#000',
        borderColor: '#1f1f1f',
        color: '#e9eaee',
      },
      ':has(#sec-xss:checked) [data-tab="xss"]': {
        background: '#000',
        borderColor: '#1f1f1f',
        color: '#e9eaee',
      },
      ':has(#sec-csrf:checked) [data-tab="csrf"]': {
        background: '#000',
        borderColor: '#1f1f1f',
        color: '#e9eaee',
      },
      ':has(#sec-idor:checked) [data-tab="idor"]': {
        background: '#000',
        borderColor: '#1f1f1f',
        color: '#e9eaee',
      },
    },
    radio: { height: 0, opacity: 0, pointerEvents: 'none', position: 'absolute', width: 0 },
    tabbar: { display: 'flex', flexWrap: 'wrap', gap: '0.3rem', position: 'relative', zIndex: 1 },
    tab: {
      alignItems: 'center',
      borderColor: 'transparent',
      borderStyle: 'solid',
      borderWidth: '1px 1px 0',
      color: 'var(--dim)',
      cursor: 'pointer',
      display: 'flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.72rem',
      gap: '0.5rem',
      letterSpacing: '0.02em',
      marginBottom: '-1px',
      padding: '0.55rem 0.9rem',
      ':hover': { color: 'var(--ink)' },
    },
    tabKv: { color: 'var(--faint)', fontSize: '0.66rem' },
    frame: { background: '#000', borderColor: '#1f1f1f', borderStyle: 'solid', borderWidth: 1 },
    panel: { display: 'none' },
    tbar: {
      borderBottomColor: '#1f1f1f',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      color: '#5a5a5a',
      display: 'flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.62rem',
      gap: '0.9rem',
      justifyContent: 'space-between',
      letterSpacing: '0.13em',
      padding: '0.5rem 1rem',
      textTransform: 'uppercase',
    },
    tbody: {
      color: '#dcdee2',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.84rem',
      lineHeight: 1.7,
      overflowX: 'auto',
      padding: '0.85rem 1rem',
    },
    codeLine: { whiteSpace: 'pre' },
    sep: {
      borderTopColor: '#1f1f1f',
      borderTopStyle: 'solid',
      borderTopWidth: 1,
      margin: '0.65rem 0',
    },
    diagHead: { whiteSpace: 'pre' },
    drow: { display: 'flex', gap: '0.9rem', whiteSpace: 'pre' },
    dlbl: { color: '#7e828b', flex: 'none', width: '3.4rem' },
    tErr: { color: '#ff7a72' },
    tOk: { color: '#5fd0c4' },
    tDim: { color: '#7e828b' },
    tLoc: { color: '#cfd2d7' },
    tStr: { color: '#e8c07d' },
    underBad: {
      textDecorationColor: '#ff7a72',
      textDecorationLine: 'underline',
      textDecorationStyle: 'wavy',
      textUnderlineOffset: '3px',
    },
  },
  { namespace: 'site-hiw', source: 'site/src/components/landing.tsx' },
);

function HowItWorks(): string {
  return (
    <section style={pageStyles.section}>
      <p style={pageStyles.eyebrow}>Secure by construction</p>
      <h2 style={pageStyles.title}>The unsafe line never compiles.</h2>
      <p style={pageStyles.lead}>
        Pick a vulnerability class. The compiler traces untrusted input to the dangerous sink and
        answers before the code runs: the exact line, the rule, and the fix.
      </p>

      <div style={hiwStyles.unit}>
        <input type="radio" name="sec-tab" id="sec-sql" checked style={hiwStyles.radio} />
        <input type="radio" name="sec-tab" id="sec-xss" style={hiwStyles.radio} />
        <input type="radio" name="sec-tab" id="sec-csrf" style={hiwStyles.radio} />
        <input type="radio" name="sec-tab" id="sec-idor" style={hiwStyles.radio} />

        <div style={hiwStyles.tabbar}>
          <label for="sec-sql" data-tab="sql" style={hiwStyles.tab}>
            SQL injection <span style={hiwStyles.tabKv}>KV422</span>
          </label>
          <label for="sec-xss" data-tab="xss" style={hiwStyles.tab}>
            XSS <span style={hiwStyles.tabKv}>KV424</span>
          </label>
          <label for="sec-csrf" data-tab="csrf" style={hiwStyles.tab}>
            CSRF <span style={hiwStyles.tabKv}>KV418</span>
          </label>
          <label for="sec-idor" data-tab="idor" style={hiwStyles.tab}>
            IDOR <span style={hiwStyles.tabKv}>KV414</span>
          </label>
        </div>

        <div style={hiwStyles.frame}>
          <div data-panel="sql" style={hiwStyles.panel}>
            <div style={hiwStyles.tbar}>
              <span>app/routes/signup.tsx</span>
              <span>$ kovo check &middot; 0.2s</span>
            </div>
            <div style={hiwStyles.tbody}>
              <div style={hiwStyles.codeLine}>
                <span style={hiwStyles.tDim}>
                  {'// name comes straight from the sign-up form (untrusted)'}
                </span>
              </div>
              <div style={hiwStyles.codeLine}>
                {'db.'}
                <span style={hiwStyles.tOk}>query</span>
                {'('}
                <span style={hiwStyles.tStr}>{"`select * from users where name = '"}</span>
                <span style={[hiwStyles.tStr, hiwStyles.underBad]}>{'${input.name}'}</span>
                <span style={hiwStyles.tStr}>{"'`"}</span>
                {')'}
              </div>
              <div style={hiwStyles.sep}></div>
              <div style={hiwStyles.diagHead}>
                <span style={hiwStyles.tErr}>&#10007; KV422</span>
                {'  '}
                <span style={hiwStyles.tLoc}>signup.tsx:14</span>
                {'  untrusted input reaches SQL as text'}
              </div>
              <div style={hiwStyles.drow}>
                <span style={hiwStyles.dlbl}>source</span>
                <span>
                  {'form field name '}&middot;{' request body'}
                </span>
              </div>
              <div style={hiwStyles.drow}>
                <span style={hiwStyles.dlbl}>sink</span>
                <span>{'raw SQL string in db.query()'}</span>
              </div>
              <div style={hiwStyles.drow}>
                <span style={hiwStyles.dlbl}>fix</span>
                <span style={hiwStyles.tOk}>
                  {'db.query(sql`select … where name = ${input.name}`)'}
                </span>
              </div>
            </div>
          </div>

          <div data-panel="xss" style={hiwStyles.panel}>
            <div style={hiwStyles.tbar}>
              <span>app/routes/comment.tsx</span>
              <span>$ kovo check &middot; 0.2s</span>
            </div>
            <div style={hiwStyles.tbody}>
              <div style={hiwStyles.codeLine}>
                <span style={hiwStyles.tDim}>
                  {'// comment body is user-submitted (untrusted)'}
                </span>
              </div>
              <div style={hiwStyles.codeLine}>
                {'<article>{ '}
                <span style={hiwStyles.underBad}>{'raw(comment.body)'}</span>
                {' }</article>'}
              </div>
              <div style={hiwStyles.sep}></div>
              <div style={hiwStyles.diagHead}>
                <span style={hiwStyles.tErr}>&#10007; KV424</span>
                {'  '}
                <span style={hiwStyles.tLoc}>comment.tsx:22</span>
                {'  untrusted value reaches an HTML sink'}
              </div>
              <div style={hiwStyles.drow}>
                <span style={hiwStyles.dlbl}>source</span>
                <span>
                  {'comment.body '}&middot;{' request data'}
                </span>
              </div>
              <div style={hiwStyles.drow}>
                <span style={hiwStyles.dlbl}>sink</span>
                <span>{'raw HTML output'}</span>
              </div>
              <div style={hiwStyles.drow}>
                <span style={hiwStyles.dlbl}>fix</span>
                <span style={hiwStyles.tOk}>
                  {'<article>{comment.body}</article> escapes by default'}
                </span>
              </div>
            </div>
          </div>

          <div data-panel="csrf" style={hiwStyles.panel}>
            <div style={hiwStyles.tbar}>
              <span>app/routes/transfer.ts</span>
              <span>$ kovo check &middot; 0.2s</span>
            </div>
            <div style={hiwStyles.tbody}>
              <div style={hiwStyles.codeLine}>
                <span style={hiwStyles.tDim}>{'// money movement, but CSRF is switched off'}</span>
              </div>
              <div style={hiwStyles.codeLine}>
                {'endpoint('}
                <span style={hiwStyles.tStr}>{"'/transfer'"}</span>
                {', { '}
                <span style={hiwStyles.underBad}>{'csrf: false'}</span>
                {' }, (req) => pay(req.session))'}
              </div>
              <div style={hiwStyles.sep}></div>
              <div style={hiwStyles.diagHead}>
                <span style={hiwStyles.tErr}>&#10007; KV418</span>
                {'  '}
                <span style={hiwStyles.tLoc}>transfer.ts:8</span>
                {'  csrf-exempt endpoint depends on the session'}
              </div>
              <div style={hiwStyles.drow}>
                <span style={hiwStyles.dlbl}>source</span>
                <span>
                  {'cross-site POST '}&middot;{' forged'}
                </span>
              </div>
              <div style={hiwStyles.drow}>
                <span style={hiwStyles.dlbl}>sink</span>
                <span>{'session-authenticated mutation'}</span>
              </div>
              <div style={hiwStyles.drow}>
                <span style={hiwStyles.dlbl}>fix</span>
                <span style={hiwStyles.tOk}>
                  {"endpoint('/transfer', (req) => pay(req.session))"}
                </span>
              </div>
            </div>
          </div>

          <div data-panel="idor" style={hiwStyles.panel}>
            <div style={hiwStyles.tbar}>
              <span>app/domain/invoices.ts</span>
              <span>$ kovo check &middot; 0.2s</span>
            </div>
            <div style={hiwStyles.tbody}>
              <div style={hiwStyles.codeLine}>
                <span style={hiwStyles.tDim}>
                  {'// invoice id comes from the URL (client-supplied)'}
                </span>
              </div>
              <div style={hiwStyles.codeLine}>
                {'db.select().from(invoices).where('}
                <span style={hiwStyles.underBad}>{'eq(invoices.id, params.id)'}</span>
                {')'}
              </div>
              <div style={hiwStyles.sep}></div>
              <div style={hiwStyles.diagHead}>
                <span style={hiwStyles.tErr}>&#10007; KV414</span>
                {'  '}
                <span style={hiwStyles.tLoc}>invoices.ts:17</span>
                {'  owner-table read not scoped to the session'}
              </div>
              <div style={hiwStyles.drow}>
                <span style={hiwStyles.dlbl}>source</span>
                <span>
                  {'params.id '}&middot;{' client-supplied'}
                </span>
              </div>
              <div style={hiwStyles.drow}>
                <span style={hiwStyles.dlbl}>sink</span>
                <span>{'owner-scoped table read'}</span>
              </div>
              <div style={hiwStyles.drow}>
                <span style={hiwStyles.dlbl}>fix</span>
                <span style={hiwStyles.tOk}>
                  {'.where(and(eq(invoices.id, params.id), eq(invoices.userId, session.userId)))'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function StaleUiSection(): string {
  return (
    <section style={pageStyles.section}>
      <div style={[pageStyles.instGrid, pageStyles.alignStart]}>
        <div>
          <p style={pageStyles.eyebrow}>No stale UI</p>
          <h2 style={pageStyles.title}>Your UI can&apos;t disagree with itself.</h2>
          <p style={pageStyles.lead}>
            Add to cart, and every view of the cart agrees by construction. Kovo owns the path from
            the database to the DOM, so a view that could drift out of date is a compile error, not
            a bug your users find later.
          </p>
          <p style={pageStyles.lead}>
            And nothing is wired by hand: declare what a view reads, and the compiler invalidates
            exactly the views a mutation touches -- no cache tags, no{' '}
            <span style={pageStyles.leadCode}>invalidateQueries</span>, no{' '}
            <span style={pageStyles.leadCode}>useEffect</span>.
          </p>
        </div>
        <div data-anim="hero" style={heroStyles.unit}>
          <HeroActs />
          <HeroShop />
          <HeroVerdict />
        </div>
      </div>
      <div style={pageStyles.aiUnit}>
        <input type="radio" name="ai-tab" id="ai-other" checked style={pageStyles.radioTab} />
        <input type="radio" name="ai-tab" id="ai-kovo" style={pageStyles.radioTab} />
        <div style={pageStyles.aiTabs}>
          <label for="ai-other" data-aitab="other" style={pageStyles.aiTab}>
            <span style={pageStyles.markBad}>&#10007;</span> Other frameworks
          </label>
          <label for="ai-kovo" data-aitab="kovo" style={[pageStyles.aiTab, pageStyles.aiTabDiv]}>
            <span style={pageStyles.markAccent}>&#10003;</span> In Kovo
          </label>
        </div>
        <div style={pageStyles.aiCol} data-aicol="other">
          <div style={[pageStyles.aiHead, pageStyles.aiHeadBad]}>
            <span style={pageStyles.aiHeadLabel}>&#10007; Other frameworks</span>
            <span style={pageStyles.aiHeadFile}>cart.ts</span>
          </div>
          <pre style={[pageStyles.code, pageStyles.grow]}>
            <span style={pageStyles.cKw}>async function</span> addToCart(item) {'{'}
            {'\n  '}
            <span style={pageStyles.cKw}>await</span> db.cart.add(item)
            {'\n\n  '}
            <span style={pageStyles.cDim}>// remember every view that reads cart:</span>
            {'\n  '}
            <span style={pageStyles.cFn}>invalidate</span>(
            <span style={pageStyles.cStr}>&apos;cart&apos;</span>){'\n  '}
            <span style={pageStyles.cFn}>invalidate</span>(
            <span style={pageStyles.cStr}>&apos;cart-badge&apos;</span>){'\n  '}
            <span style={pageStyles.cFn}>invalidate</span>(
            <span style={pageStyles.cStr}>&apos;free-shipping&apos;</span>){'\n  '}
            <span style={pageStyles.bad}>// miss one and it silently goes stale.</span>
            {'\n'}
            {'}'}
          </pre>
          <div style={pageStyles.aiVerdict}>
            Forget one <span style={pageStyles.mono}>invalidate(...)</span> and you ship the{' '}
            <span style={pageStyles.bad}>stale bug</span> -- the badge that disagrees with the cart.
          </div>
        </div>
        <div style={[pageStyles.aiCol, pageStyles.aiColRight]} data-aicol="kovo">
          <div style={[pageStyles.aiHead, pageStyles.aiHeadGood]}>
            <span style={pageStyles.aiHeadLabel}>&#10003; In Kovo</span>
            <span style={pageStyles.aiHeadFile}>cart.ts</span>
          </div>
          <pre style={[pageStyles.code, pageStyles.grow]}>
            <span style={pageStyles.cDim}>// a view reads what it needs:</span>
            {'\n'}
            <span style={pageStyles.cKw}>const</span> total ={' '}
            <span style={pageStyles.cBind}>cart.total</span>
            {'\n\n'}
            <span style={pageStyles.cDim}>// the mutation only writes:</span>
            {'\n'}
            <span style={pageStyles.cFn}>mutation</span>(
            <span style={pageStyles.cStr}>&apos;cart/add&apos;</span>, (item) =&gt;
            {'\n  '}db.cart.add(item))
            {'\n\n'}
            <span style={pageStyles.good}>// every view that reads cart refreshes.</span>
            {'\n'}
            <span style={pageStyles.cDim}>// nothing to invalidate. checked at build.</span>
          </pre>
          <div style={pageStyles.aiVerdict}>
            The read set <span style={pageStyles.good}>is</span> the invalidation set. Add a view
            and it is already wired -- diffable in CI.
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroActs(): string {
  return (
    <div style={heroStyles.acts}>
      <div style={heroStyles.actA}>
        <span style={heroStyles.actLabA}>Every other framework</span>
        <div style={heroStyles.beats}>
          <span style={heroStyles.beat}>idle</span>
          <span style={heroStyles.beat}>add to cart</span>
          <span style={heroStyles.beat}>stale, shipped &#10007;</span>
        </div>
      </div>
      <div style={heroStyles.seam}>
        kovo
        <br />
        check
      </div>
      <div style={heroStyles.actB}>
        <span style={heroStyles.actLabB}>
          <span style={heroStyles.diamond}></span>What Kovo adds
        </span>
        <div style={heroStyles.beats}>
          <span style={heroStyles.beat}>caught</span>
          <span style={heroStyles.beat}>consistent &#10003;</span>
        </div>
      </div>
    </div>
  );
}

function NumberSwap({ two, three }: { two: string; three: string }): string {
  return (
    <span style={heroStyles.swap}>
      <span style={heroStyles.num2}>{two}</span>
      <span style={heroStyles.num3}>{three}</span>
    </span>
  );
}

function HeroShop(): string {
  return (
    <div>
      <div style={heroStyles.shopbar}>
        <span style={heroStyles.brand}>Northwind</span>
        <span style={heroStyles.pill}>
          cart{' '}
          <b style={heroStyles.badgeWrap}>
            <span style={heroStyles.badge2}>2</span>
            <span style={heroStyles.badge3}>3</span>
          </b>
        </span>
      </div>
      <div style={heroStyles.shopbody}>
        <div style={heroStyles.prod}>
          <div style={heroStyles.prodNm}>Aeron Chair</div>
          <div style={heroStyles.prodPr}>$48.00</div>
          <button type="button" style={heroStyles.addBtn}>
            <span style={heroStyles.lblWrap}>
              <span style={heroStyles.lbl1}>add to cart</span>
              <span style={heroStyles.lbl2}>&#10003; added</span>
            </span>
          </button>
          <span style={heroStyles.ring}></span>
          <span style={[heroStyles.ring, heroStyles.ring2]}></span>
          <span style={heroStyles.cursor}>
            <svg viewBox="0 0 32 32" width="34" height="34">
              <path
                d="M7 3.5l19 10.5-8.1 1.7-3.5 8.3z"
                style={heroStyles.cursorPath}
                stroke-width="1.7"
                stroke-linejoin="round"
              />
            </svg>
          </span>
        </div>
        <div style={heroStyles.mini}>
          <p style={heroStyles.miniH}>Your cart</p>
          <div style={heroStyles.mline}>
            <span>Items</span>
            <b style={[heroStyles.mlineB, heroStyles.tick]}>
              <NumberSwap two="2" three="3" />
            </b>
          </div>
          <div style={heroStyles.mline}>
            <span>Aeron Chair</span>
            <span>
              &times;
              <NumberSwap two="2" three="3" />
            </span>
          </div>
          <div style={heroStyles.mtot}>
            <span>Subtotal</span>
            <b style={heroStyles.mlineB}>
              <NumberSwap two="$96" three="$144" />
            </b>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeroVerdict(): string {
  return (
    <div style={heroStyles.verdict}>
      <span style={heroStyles.vMark}>
        <span style={[heroStyles.vGlyph, heroStyles.vg0]}>&#10003;</span>
        <span style={[heroStyles.vGlyph, heroStyles.vg1]}>+</span>
        <span style={[heroStyles.vGlyph, heroStyles.vg2]}>&#10007;</span>
        <span style={[heroStyles.vGlyph, heroStyles.vg3]}>!</span>
        <span style={[heroStyles.vGlyph, heroStyles.vg4]}>&#10003;</span>
      </span>
      <span style={heroStyles.vBody}>
        <span style={[heroStyles.vLine, heroStyles.vg0]}>Two views of one cart, in agreement.</span>
        <span style={[heroStyles.vLine, heroStyles.vg1]}>
          Added 1 to the cart, refreshing the views...
        </span>
        <span style={[heroStyles.vLine, heroStyles.vg2]}>
          Header shows 2, cart shows 3 -- the stale UI most frameworks ship.
        </span>
        <span style={[heroStyles.vLine, heroStyles.vg3]}>
          KV251 -- cart/add updates items, but the header reads cart.count and isn't in its touch
          set.
          <span style={heroStyles.vFix}>-&gt; add cart.count to the cart/add touch set</span>
        </span>
        <span style={[heroStyles.vLine, heroStyles.vg4]}>
          kovo check passed -- the header, cart, and subtotal are one fact.
        </span>
      </span>
    </div>
  );
}

// ── Landing content sections (The Proof, DESIGN.md) ──────────────────────────
const pageStyles = style.create(
  {
    section: {
      borderTopColor: 'var(--edge)',
      borderTopStyle: 'solid',
      borderTopWidth: 1,
      padding: '4.2rem 0',
    },
    eyebrow: {
      color: 'var(--accent)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.7rem',
      letterSpacing: '0.18em',
      margin: '0 0 0.9rem',
      textTransform: 'uppercase',
    },
    title: {
      color: 'var(--ink)',
      fontFamily: 'var(--font-display)',
      fontSize: 'clamp(1.9rem, 3.4vw, 2.55rem)',
      fontWeight: 600,
      letterSpacing: '-0.02em',
      lineHeight: 1.08,
      margin: 0,
      maxWidth: '22ch',
      textWrap: 'balance',
    },
    lead: {
      color: 'var(--dim)',
      fontFamily: 'var(--font-serif)',
      fontSize: 'clamp(1.1rem, 1.7vw, 1.3rem)',
      fontWeight: 380,
      lineHeight: 1.45,
      margin: '1rem 0 0',
      maxWidth: '46rem',
    },
    alignStart: { alignItems: 'start' },
    leadCode: { color: 'var(--ink)', fontFamily: 'var(--font-mono)', fontSize: '0.85em' },
    aiUnit: {
      background: 'var(--card)',
      borderColor: 'var(--edge)',
      borderStyle: 'solid',
      borderWidth: 1,
      display: 'grid',
      margin: '2.4rem 0 0',
      position: 'relative',
      // The two-column layout is set ONLY in a min-width media (no base value),
      // so narrow viewports default to a single column. Overriding a base
      // grid-template-columns from a media query is order-fragile in the atomic
      // compiler, so we avoid the conflict entirely. On mobile the tab bar shows
      // and :has() reveals only the selected column (radio + :has(), zero JS).
      '@media (min-width: 52.01rem)': { gridTemplateColumns: '1fr 1fr' },
      ':has(#ai-other:checked) [data-aicol="kovo"]': {
        '@media (max-width: 52rem)': { display: 'none' },
      },
      ':has(#ai-kovo:checked) [data-aicol="other"]': {
        '@media (max-width: 52rem)': { display: 'none' },
      },
      ':has(#ai-other:checked) [data-aitab="other"]': {
        '@media (max-width: 52rem)': { background: 'var(--card)', color: 'var(--ink)' },
      },
      ':has(#ai-kovo:checked) [data-aitab="kovo"]': {
        '@media (max-width: 52rem)': { background: 'var(--card)', color: 'var(--ink)' },
      },
    },
    radioTab: { height: 0, opacity: 0, pointerEvents: 'none', position: 'absolute', width: 0 },
    aiTabs: {
      borderBottomColor: 'var(--edge)',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      '@media (max-width: 52rem)': { display: 'flex' },
      '@media (min-width: 52.01rem)': { display: 'none' },
    },
    aiTab: {
      alignItems: 'center',
      background: 'var(--panel)',
      color: 'var(--dim)',
      cursor: 'pointer',
      display: 'flex',
      flex: 1,
      fontFamily: 'var(--font-mono)',
      fontSize: '0.74rem',
      fontWeight: 700,
      gap: '0.45rem',
      justifyContent: 'center',
      letterSpacing: '0.03em',
      padding: '0.7rem 1rem',
      textTransform: 'uppercase',
    },
    aiTabDiv: { borderLeftColor: 'var(--edge)', borderLeftStyle: 'solid', borderLeftWidth: 1 },
    aiHead: {
      alignItems: 'center',
      borderBottomColor: 'var(--edge)',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      display: 'flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.72rem',
      fontWeight: 700,
      justifyContent: 'space-between',
      letterSpacing: '0.04em',
      padding: '0.7rem 1rem',
      textTransform: 'uppercase',
    },
    aiHeadBad: {
      background: 'color-mix(in srgb, var(--red) 9%, var(--card))',
      color: 'var(--red)',
    },
    aiHeadGood: {
      background: 'color-mix(in srgb, var(--accent) 9%, var(--card))',
      color: 'var(--accent)',
    },
    aiHeadLabel: { alignItems: 'center', display: 'flex', gap: '0.5rem' },
    aiHeadFile: { color: 'var(--faint)', fontWeight: 400, letterSpacing: '0.1em' },
    markBad: { color: 'var(--red)' },
    markAccent: { color: 'var(--accent)' },
    aiCol: { display: 'flex', flexDirection: 'column' },
    aiColRight: {
      '@media (min-width: 52.01rem)': {
        borderLeftColor: 'var(--edge)',
        borderLeftStyle: 'solid',
        borderLeftWidth: 1,
      },
    },
    grow: { flexGrow: 1 },
    aiVerdict: {
      background: 'var(--panel)',
      borderTopColor: 'var(--edge)',
      borderTopStyle: 'solid',
      borderTopWidth: 1,
      color: 'var(--dim)',
      fontSize: '0.9rem',
      lineHeight: 1.5,
      padding: '0.9rem 1.1rem',
    },
    code: {
      color: 'var(--dim)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.77rem',
      lineHeight: 1.85,
      margin: 0,
      padding: '1rem 1.1rem',
      whiteSpace: 'pre-wrap',
    },
    cKw: { color: 'var(--purple)' },
    cFn: { color: 'var(--sky)' },
    cStr: { color: 'var(--green)' },
    cBind: { color: 'var(--accent)' },
    cDim: { color: 'var(--faint)' },
    mono: { color: 'var(--ink)', fontFamily: 'var(--font-mono)', fontSize: '0.85em' },
    bad: { color: 'var(--red)', fontWeight: 600 },
    good: { color: 'var(--green)', fontWeight: 600 },
    rhead: {
      color: 'var(--dim)',
      display: 'flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.72rem',
      justifyContent: 'space-between',
      letterSpacing: '0.03em',
      marginBottom: '0.5rem',
      textTransform: 'uppercase',
    },
    instGrid: {
      alignItems: 'center',
      display: 'grid',
      gap: '3rem',
      gridTemplateColumns: '1fr 1.05fr',
      '@media (max-width: 60rem)': { gap: '2rem', gridTemplateColumns: '1fr' },
    },
    bars: { display: 'flex', flexDirection: 'column', gap: '1.15rem' },
    barNote: {
      color: 'var(--faint)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.62rem',
      letterSpacing: '0.02em',
      marginTop: '0.4rem',
    },
    track: {
      background: 'var(--panel)',
      borderRadius: 9999,
      height: '0.5rem',
      overflow: 'hidden',
      position: 'relative',
    },
    seg: { bottom: 0, position: 'absolute', top: 0 },
    sIdle: { background: 'var(--faint)' },
    sHatch: {
      background:
        'repeating-linear-gradient(135deg, color-mix(in srgb, var(--amber) 55%, var(--panel)) 0 6px, color-mix(in srgb, var(--amber) 20%, var(--panel)) 6px 12px)',
    },
    sLive: { background: 'color-mix(in srgb, var(--accent) 35%, var(--panel))' },
    sKovo: { background: 'linear-gradient(90deg, var(--accent), var(--accent-soft))' },
    spa1: { left: 0, width: '16%' },
    spa2: { left: '16%', width: '56%' },
    spa3: { left: '72%', width: '28%' },
    ssr1: { left: 0, width: '10%' },
    ssr2: { left: '10%', width: '40%' },
    ssr3: { left: '50%', width: '50%' },
    kovo1: { left: 0, width: '6%' },
    kovo2: { left: '6%', width: '94%' },
    warn: { color: 'var(--amber)' },
    statRow: { display: 'flex', flexWrap: 'wrap', gap: '2.4rem', margin: '2.4rem 0 0' },
    statNum: {
      color: 'var(--ink)',
      fontFamily: 'var(--font-display)',
      fontSize: '1.7rem',
      fontWeight: 600,
      letterSpacing: '-0.01em',
    },
    statLabel: {
      color: 'var(--dim)',
      fontSize: '0.84rem',
      lineHeight: 1.4,
      marginTop: '0.2rem',
      maxWidth: '15rem',
    },

    credLink: {
      borderBottomColor: 'var(--accent)',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      color: 'var(--ink)',
      fontWeight: 500,
      textDecoration: 'none',
    },
    faq: {
      borderTopColor: 'var(--edge)',
      borderTopStyle: 'solid',
      borderTopWidth: 1,
      margin: '2.4rem 0 0',
      maxWidth: '54rem',
    },
    faqItem: {
      borderBottomColor: 'var(--edge)',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      '[open] [data-q-plus]': { display: 'none' },
      '[open] [data-q-minus]': { display: 'inline' },
    },
    faqQ: {
      alignItems: 'center',
      color: 'var(--ink)',
      cursor: 'pointer',
      display: 'flex',
      fontFamily: 'var(--font-display)',
      fontSize: '1.15rem',
      fontWeight: 600,
      gap: '1rem',
      justifyContent: 'space-between',
      listStyle: 'none',
      padding: '1.05rem 0',
    },
    faqMark: { color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: '1.1rem' },
    qMinus: { display: 'none' },
    faqA: {
      color: 'var(--dim)',
      fontSize: '0.98rem',
      lineHeight: 1.62,
      margin: '0 0 1.2rem',
      maxWidth: '52rem',
    },
    starCta: {
      alignItems: 'center',
      background: 'var(--card)',
      borderColor: 'var(--edge)',
      borderStyle: 'solid',
      borderWidth: 1,
      display: 'flex',
      flexWrap: 'wrap',
      gap: '1.4rem',
      justifyContent: 'space-between',
      margin: '2.8rem 0 0',
      padding: '1.8rem 2rem',
    },
    starCtaH: {
      color: 'var(--ink)',
      fontFamily: 'var(--font-display)',
      fontSize: '1.5rem',
      fontWeight: 600,
      letterSpacing: '-0.015em',
      margin: 0,
    },
    starCtaSub: {
      color: 'var(--dim)',
      fontSize: '0.95rem',
      lineHeight: 1.5,
      margin: '0.4rem 0 0',
      maxWidth: '34rem',
    },
    starBtn: {
      alignItems: 'center',
      background: 'var(--ink)',
      color: 'var(--bg)',
      display: 'inline-flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.78rem',
      gap: '0.5rem',
      letterSpacing: '0.07em',
      padding: '0.85rem 1.3rem',
      textDecoration: 'none',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    },
    ghMark: { height: 15, width: 15 },

    // Batteries included -- "database to DOM" rendered as a literal layer stack.
    batGrid: {
      alignItems: 'start',
      display: 'grid',
      gap: '3rem',
      gridTemplateColumns: '1fr 1.1fr',
      margin: 0,
      '@media (max-width: 62rem)': { gap: '2rem', gridTemplateColumns: '1fr' },
    },
    batKey: {
      color: 'var(--faint)',
      display: 'flex',
      flexWrap: 'wrap',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.62rem',
      gap: '0.5rem 1.4rem',
      letterSpacing: '0.1em',
      margin: '1.8rem 0 0',
      textTransform: 'uppercase',
    },
    batKeyItem: { alignItems: 'center', display: 'inline-flex', gap: '0.45rem' },
    // Legend swatches mirror the stack's left rail: a solid accent bar for
    // shipped dependencies, a dashed one for borrowed approaches.
    batKdot: { background: 'var(--accent)', display: 'inline-block', height: '0.85rem', width: 2 },
    batKdotInsp: {
      background: 'repeating-linear-gradient(to bottom, var(--accent) 0 3px, transparent 3px 6px)',
    },
    batStack: {
      background: 'var(--card)',
      borderColor: 'var(--edge)',
      borderStyle: 'solid',
      borderWidth: 1,
      position: 'relative',
    },
    // Per-row left rail. Solid = a shipped dependency; dashed = a borrowed
    // approach. Absolutely positioned so it never claims a grid column.
    batRailSeg: {
      background: 'var(--accent)',
      bottom: 0,
      left: 0,
      position: 'absolute',
      top: 0,
      width: 2,
    },
    batRailDashed: {
      background: 'repeating-linear-gradient(to bottom, var(--accent) 0 4px, transparent 4px 8px)',
    },
    batCap: {
      background: 'var(--panel)',
      color: 'var(--faint)',
      display: 'flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.58rem',
      justifyContent: 'space-between',
      letterSpacing: '0.14em',
      padding: '0.5rem 1.1rem 0.5rem 1.4rem',
      position: 'relative',
      textTransform: 'uppercase',
    },
    batCapBot: { borderTopColor: 'var(--edge)', borderTopStyle: 'solid', borderTopWidth: 1 },
    batRow: {
      alignItems: 'center',
      borderBottomColor: 'var(--edge-soft)',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      display: 'grid',
      gap: '0.95rem',
      gridTemplateColumns: '1.9rem 9rem 1fr',
      padding: '0.72rem 1.1rem 0.72rem 1.4rem',
      position: 'relative',
      '@media (max-width: 30rem)': { gap: '0.7rem', gridTemplateColumns: '1.6rem 6.5rem 1fr' },
    },
    batRowLast: { borderBottomWidth: 0 },
    batLogo: {
      alignItems: 'center',
      color: 'var(--ink)',
      display: 'flex',
      height: '1.45rem',
      justifyContent: 'center',
      width: '1.45rem',
    },
    batLogoInsp: { opacity: 0.7 },
    batLogoSvg: { display: 'block', height: '100%', width: '100%' },
    batMeta: { minWidth: 0 },
    batKick: {
      color: 'var(--faint)',
      display: 'block',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.58rem',
      letterSpacing: '0.13em',
      marginBottom: '0.12rem',
      textTransform: 'uppercase',
    },
    batKickInsp: { color: 'var(--accent)' },
    batName: {
      color: 'var(--ink)',
      fontFamily: 'var(--font-display)',
      fontSize: '1.12rem',
      fontWeight: 600,
      letterSpacing: '-0.01em',
      lineHeight: 1.05,
    },
    batDesc: { color: 'var(--dim)', fontSize: '0.86rem', lineHeight: 1.4 },
  },
  { namespace: 'site-page', source: 'site/src/components/landing.tsx' },
);

function InstantLoad(): string {
  return (
    <section style={pageStyles.section}>
      <div style={pageStyles.instGrid}>
        <div>
          <p style={pageStyles.eyebrow}>Instant load</p>
          <h2 style={pageStyles.title}>Interactive at first paint. No uncanny valley.</h2>
          <p style={pageStyles.lead}>
            No hydration means no window where the page looks ready but ignores your clicks. The
            JavaScript you do use loads on first interaction, not on load. Turn JavaScript off and
            every page still renders, every form still posts.
          </p>
          <div style={pageStyles.statRow}>
            <div>
              <div style={pageStyles.statNum}>0&nbsp;ms</div>
              <p style={pageStyles.statLabel}>Time-to-interactive equals first paint.</p>
            </div>
            <div>
              <div style={pageStyles.statNum}>JS&nbsp;off</div>
              <p style={pageStyles.statLabel}>Every page renders, every form posts.</p>
            </div>
          </div>
        </div>
        <div style={pageStyles.bars}>
          <div>
            <p style={pageStyles.rhead}>
              <span>Typical SPA</span>
              <span style={pageStyles.bad}>3.2s</span>
            </p>
            <div style={pageStyles.track}>
              <span style={[pageStyles.seg, pageStyles.sIdle, pageStyles.spa1]}></span>
              <span style={[pageStyles.seg, pageStyles.sHatch, pageStyles.spa2]}></span>
              <span style={[pageStyles.seg, pageStyles.sLive, pageStyles.spa3]}></span>
            </div>
            <p style={pageStyles.barNote}>
              <span style={pageStyles.warn}>&#9888; looks ready, ignores clicks until 3.2s</span>
            </p>
          </div>
          <div>
            <p style={pageStyles.rhead}>
              <span>SSR + hydration</span>
              <span style={pageStyles.bad}>1.6s</span>
            </p>
            <div style={pageStyles.track}>
              <span style={[pageStyles.seg, pageStyles.sIdle, pageStyles.ssr1]}></span>
              <span style={[pageStyles.seg, pageStyles.sHatch, pageStyles.ssr2]}></span>
              <span style={[pageStyles.seg, pageStyles.sLive, pageStyles.ssr3]}></span>
            </div>
            <p style={pageStyles.barNote}>
              <span style={pageStyles.warn}>&#9888; frozen until the bundle hydrates</span>
            </p>
          </div>
          <div>
            <p style={pageStyles.rhead}>
              <span>Kovo</span>
              <span style={pageStyles.good}>first paint</span>
            </p>
            <div style={pageStyles.track}>
              <span style={[pageStyles.seg, pageStyles.sIdle, pageStyles.kovo1]}></span>
              <span style={[pageStyles.seg, pageStyles.sKovo, pageStyles.kovo2]}></span>
            </div>
            <p style={pageStyles.barNote}>
              <span style={pageStyles.good}>
                &#10003; every click works at 0ms, handlers load on demand
              </span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Faq({ q, children }: { q: string; children: unknown }): string {
  return (
    <details style={pageStyles.faqItem}>
      <summary style={pageStyles.faqQ}>
        {q}
        <span style={pageStyles.faqMark}>
          <span data-q-plus>+</span>
          <span data-q-minus style={pageStyles.qMinus}>
            &#8722;
          </span>
        </span>
      </summary>
      <p style={pageStyles.faqA}>{children}</p>
    </details>
  );
}

// Each row is a real layer of the stack, from the DOM the browser receives down
// to the database the data lives in. Drizzle / Better Auth / TypeScript are
// dependencies Kovo ships and verifies; shadcn/ui and StyleX are approaches it
// borrows (own-your-source components; compile-time atomic CSS -- the same
// idiom this very page is built on via style.create). Logos are inlined
// single-color marks so they inherit --ink and read in both themes. The brand
// marks are reproduced from each project's official SVG.
function BatLogo({
  kind,
  inspired,
}: {
  kind: 'dom' | 'shadcn' | 'stylex' | 'typescript' | 'betterauth' | 'vite' | 'drizzle';
  inspired?: boolean;
}): string {
  const box = inspired ? [pageStyles.batLogo, pageStyles.batLogoInsp] : pageStyles.batLogo;
  return (
    <span style={box}>
      {kind === 'dom' ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.1"
          stroke-linecap="round"
          stroke-linejoin="round"
          style={pageStyles.batLogoSvg}
          aria-hidden="true"
        >
          <path d="M8.5 8 4.5 12l4 4M15.5 8l4 4-4 4" />
        </svg>
      ) : kind === 'shadcn' ? (
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          style={pageStyles.batLogoSvg}
          aria-hidden="true"
        >
          <path d="M22.219 11.784 11.784 22.219c-.407.407-.407 1.068 0 1.476.407.407 1.068.407 1.476 0L23.695 13.26c.407-.408.407-1.069 0-1.476-.408-.407-1.069-.407-1.476 0ZM20.132.305.305 20.132c-.407.407-.407 1.068 0 1.476.408.407 1.069.407 1.476 0L21.608 1.781c.407-.407.407-1.068 0-1.476-.408-.407-1.069-.407-1.476 0Z" />
        </svg>
      ) : kind === 'stylex' ? (
        <svg
          viewBox="0 0 180 180"
          fill="currentColor"
          style={pageStyles.batLogoSvg}
          aria-hidden="true"
        >
          <path d="M123.054863,93.4254443 C124.041858,95.7626109 128.450105,105.044084 129.355779,107.321152 C123.84289,116.561307 122.549601,118.95899 111.024753,133.60593 C64.1232983,182.705627 27.9371992,190.639891 5.76263041,167.701852 C3.59627766,165.361764 1.67512566,162.319274 0,158.574382 C0.471825684,159.433291 1.09514745,160.379843 1.86996531,161.414039 L6.49038953,166.771159 C33.8818726,191.84228 61.2048315,170.332834 98.3027967,128.773838 C103.902786,122.190123 112.153337,110.407464 123.054863,93.4254443 Z M137.380118,14.1032604 C154.739423,29.1884191 154.739423,52.5968124 141.717364,86.0295639 C140.719637,83.5713654 136.323774,73.7444144 135.221609,71.226952 C145.472981,42.8320467 145.710752,29.3332399 130.967334,15.8715774 C122.485617,8.12762615 116.462513,7.80876984 104.995043,9.69477985 L92.9145722,12.0507273 L92.9145722,12.0340333 L93.1139526,11.9605794 C111.260459,5.27670019 126.843916,4.74249067 137.380118,14.1032604 Z" />
          <path d="M125.890167,63.5141248 C153.449324,115.583313 155.188797,143.75817 146.009025,163.468062 C142.702042,170.570383 134.455253,175.478804 130.907687,177.387749 C122.003636,182.178957 103.568032,179.793293 87.0876824,174.955283 L84.6173661,173.901615 C92.8984649,176.570162 110.89548,180.056296 120.598168,177.387749 C152.463016,168.623747 148.671973,130.669324 116.64467,71.0621007 C84.6173661,11.4548774 49.5757474,-4.8960329 21.9537585,6.3426811 C19.3015581,7.42161421 16.9891503,8.8960871 15,10.7226111 L16.282696,9.38854448 C19.3635641,6.29215141 22.5576963,3.87542408 25.8493845,2.76294257 C50.8282672,-5.6788289 93.7099159,2.71324123 125.890167,63.5141248 Z" />
        </svg>
      ) : kind === 'typescript' ? (
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          style={pageStyles.batLogoSvg}
          aria-hidden="true"
        >
          <path d="M1.125 0C.502 0 0 .502 0 1.125v21.75C0 23.498.502 24 1.125 24h21.75c.623 0 1.125-.502 1.125-1.125V1.125C24 .502 23.498 0 22.875 0zm17.363 9.75c.612 0 1.154.037 1.627.111a6.38 6.38 0 0 1 1.306.34v2.458a3.95 3.95 0 0 0-.643-.361 5.093 5.093 0 0 0-.717-.26 5.453 5.453 0 0 0-1.426-.2c-.3 0-.573.028-.819.086a2.1 2.1 0 0 0-.623.242c-.17.104-.3.229-.393.374a.888.888 0 0 0-.14.49c0 .196.053.373.156.529.104.156.252.304.443.444s.423.276.696.41c.273.135.582.274.926.416.47.197.892.407 1.266.628.374.222.695.473.963.753.268.279.472.598.614.957.142.359.214.776.214 1.253 0 .657-.125 1.21-.373 1.656a3.033 3.033 0 0 1-1.012 1.085 4.38 4.38 0 0 1-1.487.596c-.566.12-1.163.18-1.79.18a9.916 9.916 0 0 1-1.84-.164 5.544 5.544 0 0 1-1.512-.493v-2.63a5.033 5.033 0 0 0 3.237 1.2c.333 0 .624-.03.872-.09.249-.06.456-.144.623-.25.166-.108.29-.234.373-.38a1.023 1.023 0 0 0-.074-1.089 2.12 2.12 0 0 0-.537-.5 5.597 5.597 0 0 0-.807-.444 27.72 27.72 0 0 0-1.007-.436c-.918-.383-1.602-.852-2.053-1.405-.45-.553-.676-1.222-.676-2.005 0-.614.123-1.141.369-1.582.246-.441.58-.804 1.004-1.089a4.494 4.494 0 0 1 1.47-.629 7.536 7.536 0 0 1 1.77-.201zm-15.113.188h9.563v2.166H9.506v9.646H6.789v-9.646H3.375z" />
        </svg>
      ) : kind === 'betterauth' ? (
        // Official Better Auth mark: a right half-disc, centered with a translate
        // so it balances against the other logos in the 1.45rem box.
        <svg
          viewBox="0 0 32 32"
          fill="currentColor"
          style={pageStyles.batLogoSvg}
          aria-hidden="true"
        >
          <path
            transform="translate(-6.667 0)"
            d="M16 2.66667V29.3333C19.5362 29.3333 22.9276 27.9286 25.4281 25.4281C27.9286 22.9276 29.3333 19.5362 29.3333 16C29.3333 12.4638 27.9286 9.07239 25.4281 6.57191C22.9276 4.07142 19.5362 2.66667 16 2.66667Z"
          />
        </svg>
      ) : kind === 'vite' ? (
        // Official Vite lightning-bolt mark, single color. The viewBox is cropped
        // to the bolt's bounds so it centers in the 1.45rem box like the others.
        <svg
          viewBox="143 0 184 331"
          fill="currentColor"
          style={pageStyles.batLogoSvg}
          aria-hidden="true"
        >
          <path d="M292.965 1.5744L156.801 28.2552C154.563 28.6937 152.906 30.5903 152.771 32.8664L144.395 174.33C144.198 177.662 147.258 180.248 150.51 179.498L188.42 170.749C191.967 169.931 195.172 173.055 194.443 176.622L183.18 231.775C182.422 235.487 185.907 238.661 189.532 237.56L212.947 230.446C216.577 229.344 220.065 232.527 219.297 236.242L201.398 322.875C200.278 328.294 207.486 331.249 210.492 326.603L323.454 102.072C325.312 98.3645 322.108 94.137 318.036 94.9209L279.014 102.434C275.347 103.14 272.227 99.7316 273.262 96.1422L298.731 7.86689C299.767 4.27314 296.636 0.860668 292.965 1.5744Z" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          style={pageStyles.batLogoSvg}
          aria-hidden="true"
        >
          <path d="M5.353 11.823a1.036 1.036 0 0 0-.395-1.422 1.063 1.063 0 0 0-1.437.399L.138 16.702a1.035 1.035 0 0 0 .395 1.422 1.063 1.063 0 0 0 1.437-.398l3.383-5.903Zm11.216 0a1.036 1.036 0 0 0-.394-1.422 1.064 1.064 0 0 0-1.438.399l-3.382 5.902a1.036 1.036 0 0 0 .394 1.422c.506.283 1.15.104 1.438-.398l3.382-5.903Zm7.293-4.525a1.036 1.036 0 0 0-.395-1.422 1.062 1.062 0 0 0-1.437.399l-3.383 5.902a1.036 1.036 0 0 0 .395 1.422 1.063 1.063 0 0 0 1.437-.399l3.383-5.902Zm-11.219 0a1.035 1.035 0 0 0-.394-1.422 1.064 1.064 0 0 0-1.438.398l-3.382 5.903a1.036 1.036 0 0 0 .394 1.422c.506.282 1.15.104 1.438-.399l3.382-5.902Z" />
        </svg>
      )}
    </span>
  );
}

// One layer of the stack. The left rail segment is the legend made literal: a
// solid accent rail marks a shipped dependency, a dashed rail marks a borrowed
// approach (shadcn/ui, StyleX). The rail is an absolutely positioned child so it
// does not take a grid column.
function BatRow({
  kind,
  kicker,
  name,
  desc,
  inspired,
  last,
}: {
  kind: 'dom' | 'shadcn' | 'stylex' | 'typescript' | 'betterauth' | 'vite' | 'drizzle';
  kicker: string;
  name: unknown;
  desc: unknown;
  inspired?: boolean;
  last?: boolean;
}): string {
  return (
    <div style={last ? [pageStyles.batRow, pageStyles.batRowLast] : pageStyles.batRow}>
      <span
        style={inspired ? [pageStyles.batRailSeg, pageStyles.batRailDashed] : pageStyles.batRailSeg}
      ></span>
      <BatLogo kind={kind} inspired={inspired} />
      <span style={pageStyles.batMeta}>
        <span style={inspired ? [pageStyles.batKick, pageStyles.batKickInsp] : pageStyles.batKick}>
          {kicker}
        </span>
        <span style={pageStyles.batName}>{name}</span>
      </span>
      <span style={pageStyles.batDesc}>{desc}</span>
    </div>
  );
}

function BatteriesIncluded(): string {
  return (
    <section style={pageStyles.section}>
      <div style={pageStyles.batGrid}>
        <div>
          <p style={pageStyles.eyebrow}>Batteries included</p>
          <h2 style={pageStyles.title}>Everything from the database to the DOM.</h2>
          <p style={pageStyles.lead}>
            Kovo owns the whole path: a Drizzle row becomes a DOM node, and the types follow it the
            entire way. It does not reinvent the foundations. It stands on libraries you already
            trust and type-checks the seams between them.
          </p>
          <div style={pageStyles.batKey}>
            <span style={pageStyles.batKeyItem}>
              <i style={pageStyles.batKdot}></i> Built on &middot; shipped
            </span>
            <span style={pageStyles.batKeyItem}>
              <i style={[pageStyles.batKdot, pageStyles.batKdotInsp]}></i> Inspired by &middot;
              borrowed
            </span>
          </div>
        </div>

        <div style={pageStyles.batStack}>
          <div style={pageStyles.batCap}>
            <span style={pageStyles.batRailSeg}></span>
            <span>top of stack</span>
            <span>what the browser gets</span>
          </div>

          <BatRow
            kind="dom"
            kicker="DOM"
            name="Real HTML"
            desc="Server-rendered, interactive at first paint. No hydration, no client router."
          />
          <BatRow
            kind="shadcn"
            inspired
            kicker="Components · inspired"
            name="shadcn/ui"
            desc="You own the component source. Copy it in, read it, change it."
          />
          <BatRow
            kind="stylex"
            inspired
            kicker="Styles · inspired"
            name="StyleX"
            desc="Atomic CSS compiled at build time, zero runtime. This page ships its styles the same way."
          />
          <BatRow
            kind="typescript"
            kicker="Compiler"
            name="TypeScript"
            desc={
              <span>
                No new language to learn. <span style={pageStyles.mono}>tsc</span> is the engine
                every guarantee runs on.
              </span>
            }
          />
          <BatRow
            kind="vite"
            kicker="Build"
            name="Vite"
            desc="Dev server and bundler. Kovo's compiler runs as a Vite plugin, and HMR morphs the DOM in place."
          />
          <BatRow
            kind="betterauth"
            kicker="Auth"
            name={'Better Auth'}
            desc="Sessions, accounts, providers. Kovo traces ownership into every query."
          />
          <BatRow
            kind="drizzle"
            last
            kicker="Database"
            name="Drizzle"
            desc="Your schema and queries, fully typed. The same types feed the compiler."
          />

          <div style={[pageStyles.batCap, pageStyles.batCapBot]}>
            <span style={pageStyles.batRailSeg}></span>
            <span>bottom of stack</span>
            <span>where the data lives</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Credibility(): string {
  return (
    <section style={pageStyles.section}>
      <p style={pageStyles.eyebrow}>Who builds this</p>
      <h2 style={pageStyles.title}>Made by people who build AI tools for a living.</h2>
      <p style={pageStyles.lead}>
        Kovo comes from the team behind{' '}
        <a style={pageStyles.credLink} href="https://github.com/dyad-sh/dyad" rel="external">
          Dyad
        </a>
        , the open-source, local AI app builder with 20k+ stars on GitHub. We built Kovo because we
        wanted a target our own agents could generate and verify without guessing.
      </p>

      <div style={pageStyles.faq}>
        <Faq q="Why yet another web framework?">
          Because the stale-UI bug class and the hydration gap are still unsolved at the framework
          level. Kovo turns &ldquo;this view drifted out of sync&rdquo; into a compile error and
          makes first paint interactive. If your stack already proves those two things, you do not
          need Kovo.
        </Faq>
        <Faq q="Can AI agents actually write Kovo code?">
          That is the whole design goal. Generated apps fail{' '}
          <span style={pageStyles.mono}>tsc</span> when wiring is wrong, and{' '}
          <span style={pageStyles.mono}>kovo check</span> returns the exact line, the reason, and
          candidate fixes. The agent loops on edit, check, fixed -- not edit, deploy, bug report.
          Skills, an MCP server, and LLM-readable docs ship with it. That is not a claim of
          prompt-injection immunity: the framework narrows blast radius with default-deny guards,
          structured sinks, and the egress floor, but an app that lets a model read hostile content
          or call tools still needs its own LLM01 posture.
        </Faq>
        <Faq q="Do I have to throw away React?">
          You keep the model you know: composable components, props, TypeScript. You give up the
          client router, hydration, and the runtime store. Kovo compiles your components to real
          HTML and wires interactivity on demand.
        </Faq>
        <Faq q="Is it production-ready?">
          Not yet. Kovo is pre-v1 and under active implementation; nothing is published to npm. The
          spec, the conformance suite, and this site are open -- follow along and kick the tires.
        </Faq>
      </div>

      <div style={pageStyles.starCta}>
        <div>
          <p style={pageStyles.starCtaH}>If this resonates, star it.</p>
          <p style={pageStyles.starCtaSub}>
            Stars tell us the problem is worth solving and help other builders find Kovo early.
          </p>
        </div>
        <a style={pageStyles.starBtn} href="https://github.com/kovojs/kovo" rel="external">
          <svg viewBox="0 0 16 16" style={pageStyles.ghMark} fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          Star kovojs/kovo
        </a>
      </div>
    </section>
  );
}
