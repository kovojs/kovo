/** @jsxImportSource @kovojs/server */
import { describe, expect, it } from 'vitest';

import {
  accordionContentAttributes,
  accordionTriggerAttributes,
} from '@kovojs/headless-ui/accordion';
import {
  avatarFallbackAttributes,
  avatarImageAttributes,
  avatarRootAttributes,
} from '@kovojs/headless-ui/avatar';
import {
  collapsibleContentAttributes,
  collapsibleRootAttributes,
  collapsibleTriggerAttributes,
} from '@kovojs/headless-ui/collapsible';
import {
  disclosureContentAttributes,
  disclosureRootAttributes,
  disclosureTriggerAttributes,
} from '@kovojs/headless-ui/disclosure';
import { meterRootAttributes } from '@kovojs/headless-ui/meter';
import { progressRootAttributes } from '@kovojs/headless-ui/progress';
import {
  scrollAreaCornerAttributes,
  scrollAreaRootAttributes,
  scrollAreaScrollbarAttributes,
  scrollAreaThumbAttributes,
  scrollAreaViewportAttributes,
} from '@kovojs/headless-ui/scroll-area';
import { separatorRootAttributes } from '@kovojs/headless-ui/separator';
import { mergeCompilerPrimitiveAttrs } from './gallery-merge-fixtures-oracle.js';

describe('gallery G5 primitive merge fixtures', () => {
  it('renders a golden accordion merge with primitive-owned state and authored ARIA overrides', () => {
    const state = {
      orientation: 'vertical' as const,
      type: 'multiple' as const,
      value: ['shipping'],
    };
    const trigger = mergeCompilerPrimitiveAttrs(
      {
        ...accordionTriggerAttributes({
          ...state,
          contentId: 'gallery-accordion-shipping-panel',
          itemValue: 'shipping',
          triggerId: 'gallery-accordion-shipping-trigger',
        }),
        class: 'accordion-trigger',
      },
      {
        'aria-expanded': 'false',
        class: 'accordion-trigger font-medium',
        'data-state': 'author-open',
        disabled: true,
        id: 'author-accordion-trigger',
      },
    );
    const content = mergeCompilerPrimitiveAttrs(
      {
        ...accordionContentAttributes({
          ...state,
          contentId: 'gallery-accordion-shipping-panel',
          itemValue: 'shipping',
          triggerId: 'gallery-accordion-shipping-trigger',
        }),
        class: 'accordion-panel',
      },
      {
        class: 'accordion-panel px-3',
        id: 'author-accordion-panel',
        role: 'group',
      },
    );

    expect(trigger.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-expanded',
        // SPEC.md §4.6 J1: state-aria is primitive-wins; primitive "true" vs author "false" → KV317 error.
        code: 'KV317',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(content.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(
      <section data-gallery-merge="accordion">
        <button {...trigger.attrs}>Shipping</button>
        <div {...content.attrs}>Ships soon.</div>
      </section>,
    ).toBe(
      '<section data-gallery-merge="accordion"><button data-state="open" aria-expanded="true" disabled tabIndex="0" type="button" aria-controls="gallery-accordion-shipping-panel" id="author-accordion-trigger" class="accordion-trigger font-medium">Shipping</button><div data-state="open" id="author-accordion-panel" aria-labelledby="gallery-accordion-shipping-trigger" role="group" class="accordion-panel px-3">Ships soon.</div></section>',
    );
  });

  it('renders a golden avatar merge with fallback scalar and semantic root overrides', () => {
    const root = mergeCompilerPrimitiveAttrs(
      {
        ...avatarRootAttributes({
          label: 'Ada Lovelace avatar',
          src: '/avatars/ada.png',
          status: 'loading',
        }),
        class: 'avatar-root',
      },
      {
        'aria-label': 'Author label',
        class: 'avatar-root rounded-full',
        'data-state': 'author-loading',
        role: 'figure',
      },
    );
    const fallback = mergeCompilerPrimitiveAttrs(
      {
        ...avatarFallbackAttributes({
          delayMs: 250,
          src: '/avatars/ada.png',
          status: 'loaded',
        }),
        class: 'avatar-fallback',
      },
      {
        class: 'avatar-fallback text-xs',
        'data-state': 'author-loaded',
        hidden: false,
      },
    );

    expect(root.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-label',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(fallback.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
    ]);
    expect(
      <div data-gallery-merge="avatar">
        <span {...root.attrs}>
          <span {...fallback.attrs}>AL</span>
        </span>
      </div>,
    ).toBe(
      '<div data-gallery-merge="avatar"><span data-state="loading" aria-label="Author label" role="figure" class="avatar-root rounded-full"><span data-state="loaded" data-delay="250" class="avatar-fallback text-xs">AL</span></span></div>',
    );
  });

  it('renders a golden collapsible merge with details and summary attrs', () => {
    const root = mergeCompilerPrimitiveAttrs(
      {
        ...collapsibleRootAttributes({ disabled: true, open: false }),
        class: 'collapsible-root',
      },
      {
        class: 'collapsible-root border',
        'data-state': 'author-open',
        open: true,
      },
    );
    const trigger = mergeCompilerPrimitiveAttrs(
      {
        ...collapsibleTriggerAttributes({
          contentId: 'gallery-filters-panel',
          open: false,
        }),
        class: 'collapsible-trigger',
      },
      {
        'aria-controls': 'author-filters-panel',
        'aria-expanded': 'true',
        class: 'collapsible-trigger font-medium',
        'data-state': 'author-open',
      },
    );
    const content = mergeCompilerPrimitiveAttrs(
      {
        ...collapsibleContentAttributes({
          contentId: 'gallery-filters-panel',
          open: false,
        }),
        class: 'collapsible-content',
      },
      {
        class: 'collapsible-content p-3',
        id: 'author-filters-panel',
      },
    );

    expect(root.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
    ]);
    expect(trigger.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-expanded',
        // SPEC.md §4.6 J1: state-aria is primitive-wins; primitive "false" vs author "true" → KV317 error.
        code: 'KV317',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-controls',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(content.diagnostics).toEqual([]);
    expect(
      <details {...root.attrs}>
        <summary {...trigger.attrs}>Filters</summary>
        <div {...content.attrs}>Panel</div>
      </details>,
    ).toBe(
      '<details data-state="closed" data-disabled="" open class="collapsible-root border"><summary data-state="closed" aria-expanded="false" aria-controls="author-filters-panel" class="collapsible-trigger font-medium">Filters</summary><div data-state="closed" id="author-filters-panel" class="collapsible-content p-3">Panel</div></details>',
    );
  });

  it('renders a golden meter merge with threshold scalars and author value text', () => {
    const merged = mergeCompilerPrimitiveAttrs(
      {
        ...meterRootAttributes({
          high: 90,
          low: 50,
          max: 100,
          min: 0,
          optimum: 80,
          value: 42,
          valueText: '42 percent quality score',
        }),
        class: 'meter-root',
      },
      {
        'aria-valuetext': 'Author meter label',
        class: 'meter-root h-2',
        'data-state': 'author-suboptimum',
        high: 95,
        low: 40,
        optimum: 75,
        value: 64,
      },
    );

    expect(merged.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-valuetext',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(<meter {...merged.attrs}>64%</meter>).toBe(
      '<meter data-high="90" data-low="50" data-max="100" data-min="0" data-optimum="80" data-state="suboptimum" data-value="42" high="95" low="40" max="100" min="0" optimum="75" value="64" aria-valuetext="Author meter label" class="meter-root h-2">64%</meter>',
    );
  });

  it('renders a golden progress merge with scalar author values and primitive-owned state', () => {
    const merged = mergeCompilerPrimitiveAttrs(
      {
        ...progressRootAttributes({
          max: 100,
          value: 42,
          valueText: '42 of 100 tasks complete',
        }),
        class: 'progress-root',
      },
      {
        'aria-valuetext': 'Author progress label',
        class: 'progress-root h-2',
        'data-state': 'author-loading',
        max: 80,
        value: 50,
      },
    );

    expect(merged.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-valuetext',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(<progress {...merged.attrs}>50%</progress>).toBe(
      '<progress data-max="100" data-state="loading" max="80" data-value="42" value="50" aria-valuetext="Author progress label" class="progress-root h-2">50%</progress>',
    );
  });

  it('renders a golden separator merge with orientation and semantic overrides', () => {
    const merged = mergeCompilerPrimitiveAttrs(
      {
        ...separatorRootAttributes({ decorative: false, orientation: 'vertical' }),
        class: 'separator-root',
      },
      {
        'aria-orientation': 'horizontal',
        class: 'separator-root my-2',
        role: 'presentation',
      },
    );

    expect(merged.diagnostics).toEqual([
      {
        attr: 'aria-orientation',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(<div {...merged.attrs} />).toBe(
      '<div data-orientation="vertical" aria-orientation="horizontal" role="presentation" class="separator-root my-2"></div>',
    );
  });

  it('renders a golden scroll-area merge with viewport ARIA overrides and hidden parts', () => {
    const viewport = mergeCompilerPrimitiveAttrs(
      {
        ...scrollAreaViewportAttributes({
          descriptionId: 'gallery-scroll-description',
          id: 'gallery-scroll-viewport',
          labelledBy: 'gallery-scroll-title',
          scrollbars: 'both',
        }),
        class: 'scroll-viewport',
      },
      {
        'aria-labelledby': 'author-scroll-title',
        class: 'scroll-viewport overscroll-contain',
        role: 'feed',
        tabIndex: -1,
      },
    );
    const scrollbar = mergeCompilerPrimitiveAttrs(
      {
        ...scrollAreaScrollbarAttributes({
          forceMount: true,
          id: 'gallery-scrollbar-x',
          orientation: 'horizontal',
          scrollbars: 'both',
          visible: false,
        }),
        class: 'scrollbar',
      },
      {
        'aria-hidden': 'false',
        class: 'scrollbar h-2',
        'data-state': 'author-visible',
        hidden: false,
      },
    );

    expect(viewport.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-labelledby',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(scrollbar.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-hidden',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(
      <div data-gallery-merge="scroll-area">
        <div {...viewport.attrs}>Feed</div>
        <div {...scrollbar.attrs} />
      </div>,
    ).toBe(
      '<div data-gallery-merge="scroll-area"><div data-scrollbars="both" tabIndex="-1" aria-describedby="gallery-scroll-description" role="feed" aria-labelledby="author-scroll-title" id="gallery-scroll-viewport" class="scroll-viewport overscroll-contain">Feed</div><div data-scrollbars="both" data-orientation="horizontal" data-state="hidden" aria-hidden="false" id="gallery-scrollbar-x" class="scrollbar h-2"></div></div>',
    );
  });

  it('renders golden disclosure and avatar image merges for remaining simple attrs records', () => {
    const disclosure = { disabled: true, open: true };
    const root = mergeCompilerPrimitiveAttrs(
      { ...disclosureRootAttributes(disclosure), class: 'disclosure-root' },
      { class: 'disclosure-root rounded', 'data-state': 'closed' },
    );
    const trigger = mergeCompilerPrimitiveAttrs(
      {
        ...disclosureTriggerAttributes({
          ...disclosure,
          contentId: 'gallery-disclosure-panel',
        }),
        class: 'disclosure-trigger',
      },
      {
        'aria-controls': 'author-disclosure-panel',
        'aria-expanded': 'false',
        class: 'disclosure-trigger font-medium',
        disabled: false,
      },
    );
    const content = mergeCompilerPrimitiveAttrs(
      {
        ...disclosureContentAttributes({
          ...disclosure,
          contentId: 'gallery-disclosure-panel',
        }),
        class: 'disclosure-panel',
      },
      {
        class: 'disclosure-panel p-3',
        hidden: true,
        id: 'author-disclosure-panel',
      },
    );
    const image = mergeCompilerPrimitiveAttrs(
      {
        ...avatarImageAttributes({
          alt: 'Ada Lovelace',
          loading: 'lazy',
          src: '/avatars/ada.png',
          status: 'loaded',
        }),
        class: 'avatar-image',
      },
      {
        alt: 'Author alt',
        class: 'avatar-image object-cover',
        'data-state': 'loading',
        hidden: true,
        src: '/avatars/author.png',
      },
    );

    expect(root.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
    ]);
    expect(trigger.diagnostics).toEqual([
      {
        attr: 'aria-expanded',
        // SPEC.md §4.6 J1: state-aria is primitive-wins; primitive "true" vs author "false" → KV317 error.
        code: 'KV317',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-controls',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(content.diagnostics).toEqual([]);
    expect(image.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
    ]);
    expect(
      <section data-gallery-merge="disclosure-avatar-image">
        <div {...root.attrs}>
          <button {...trigger.attrs}>Details</button>
          <div {...content.attrs}>Panel</div>
        </div>
        <img {...image.attrs} />
      </section>,
    ).toBe(
      '<section data-gallery-merge="disclosure-avatar-image"><div data-state="open" data-disabled="" class="disclosure-root rounded"><button data-state="open" data-disabled="" aria-expanded="true" disabled type="button" aria-controls="author-disclosure-panel" class="disclosure-trigger font-medium">Details</button><div data-state="open" hidden id="author-disclosure-panel" class="disclosure-panel p-3">Panel</div></div><img alt="Author alt" data-state="loaded" decoding="async" hidden loading="lazy" src="/avatars/author.png" class="avatar-image object-cover"></section>',
    );
  });

  it('renders golden scroll-area merges across root, viewport, scrollbar, thumb, and corner attrs', () => {
    const root = mergeCompilerPrimitiveAttrs(
      {
        ...scrollAreaRootAttributes({
          dir: 'rtl',
          disabled: true,
          id: 'gallery-scroll-root',
          scrollbars: 'both',
        }),
        class: 'scroll-root',
      },
      {
        class: 'scroll-root rounded',
        'data-scrollbars': 'author-scrollbars',
        dir: 'ltr',
        id: 'author-scroll-root',
      },
    );
    const viewport = mergeCompilerPrimitiveAttrs(
      {
        ...scrollAreaViewportAttributes({
          descriptionId: 'gallery-scroll-description',
          id: 'gallery-scroll-viewport',
          label: 'Invoices',
          scrollbars: 'both',
        }),
        class: 'scroll-viewport',
      },
      {
        'aria-label': 'Author invoices',
        class: 'scroll-viewport focus-ring',
        role: 'feed',
      },
    );
    const thumb = mergeCompilerPrimitiveAttrs(
      {
        ...scrollAreaThumbAttributes({
          forceMount: true,
          id: 'gallery-scroll-thumb-y',
          orientation: 'vertical',
          scrollbars: 'both',
          visible: true,
        }),
        class: 'scroll-thumb',
      },
      {
        'aria-hidden': 'false',
        class: 'scroll-thumb rounded-full',
        'data-state': 'hidden',
      },
    );
    const corner = mergeCompilerPrimitiveAttrs(
      {
        ...scrollAreaCornerAttributes({
          forceMount: true,
          id: 'gallery-scroll-corner',
          scrollbars: 'both',
          visible: false,
        }),
        class: 'scroll-corner',
      },
      {
        'aria-hidden': 'false',
        class: 'scroll-corner bg-muted',
        'data-state': 'visible',
        hidden: false,
      },
    );

    expect(root.diagnostics).toEqual([]);
    expect(viewport.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-label',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(thumb.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-hidden',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(corner.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-hidden',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(
      <section data-gallery-merge="scroll-area-family">
        <div {...root.attrs}>
          <div {...viewport.attrs}>Scrollable invoices</div>
          <span {...thumb.attrs}></span>
          <span {...corner.attrs}></span>
        </div>
      </section>,
    ).toBe(
      '<section data-gallery-merge="scroll-area-family"><div data-disabled="" data-scrollbars="author-scrollbars" dir="ltr" id="author-scroll-root" class="scroll-root rounded"><div data-scrollbars="both" tabIndex="0" aria-describedby="gallery-scroll-description" role="feed" aria-label="Author invoices" id="gallery-scroll-viewport" class="scroll-viewport focus-ring">Scrollable invoices</div><span data-scrollbars="both" data-orientation="vertical" data-state="visible" aria-hidden="false" id="gallery-scroll-thumb-y" class="scroll-thumb rounded-full"></span><span data-scrollbars="both" data-state="hidden" aria-hidden="false" id="gallery-scroll-corner" class="scroll-corner bg-muted"></span></div></section>',
    );
  });
});
