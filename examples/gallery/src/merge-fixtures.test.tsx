/** @jsxImportSource @jiso/server */
import { describe, expect, it } from 'vitest';

import {
  dialogContentAttributes,
  dialogTriggerAttributes,
  toggleRootAttributes,
} from '@jiso/headless-ui/primitives';

type AttributeValue = boolean | number | string | undefined;
type AttributeRecord = Readonly<Record<string, AttributeValue>>;

interface MergeDiagnostic {
  attr: string;
  code: 'FW231' | 'FW232' | 'FW233';
  message: string;
}

interface MergeFixtureResult {
  attrs: Record<string, AttributeValue>;
  diagnostics: readonly MergeDiagnostic[];
}

const idrefAttributes = new Set([
  'aria-activedescendant',
  'aria-controls',
  'aria-describedby',
  'aria-labelledby',
  'aria-owns',
  'commandfor',
  'for',
  'popovertarget',
]);

const logicalOrAttributes = new Set(['aria-disabled', 'disabled', 'readonly', 'required']);

describe('gallery G5 primitive merge fixtures', () => {
  it('renders a golden toggle merge with authored class, handlers, scalars, and state overrides', () => {
    const merged = mergePrimitiveAttrs(
      {
        ...toggleRootAttributes({ pressed: true }),
        class: 'inline-flex saved',
        'fw-deps': 'toggle:pressed',
        'on:click': '/gallery/toggle.client.js#primitiveToggle',
        style: '--toggle-state: pressed; color: blue',
      },
      {
        'aria-pressed': 'mixed',
        class: 'saved rounded-sm',
        'data-state': 'author-pressed',
        disabled: true,
        'fw-deps': 'route:gallery',
        'on:click': '/gallery/author.client.js#trackToggle',
        style: 'color: red; margin: 0',
        type: 'submit',
      },
    );

    expect(merged.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'FW232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-pressed',
        code: 'FW232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(<button {...merged.attrs}>Saved</button>).toBe(
      '<button data-state="pressed" aria-pressed="mixed" disabled type="submit" class="inline-flex saved rounded-sm" fw-deps="toggle:pressed route:gallery" on:click="/gallery/author.client.js#trackToggle /gallery/toggle.client.js#primitiveToggle" style="--toggle-state: pressed; color: blue; color: red; margin: 0">Saved</button>',
    );
  });

  it('rewires dialog trigger IDREFs when an authored dialog content id wins', () => {
    const idRewrites = new Map([['gallery-dialog-content', 'authored-dialog-content']]);
    const trigger = mergePrimitiveAttrs(
      rewriteIdrefs(
        dialogTriggerAttributes({ contentId: 'gallery-dialog-content', open: false }),
        idRewrites,
      ),
      { class: 'dialog-trigger' },
    );
    const content = mergePrimitiveAttrs(
      dialogContentAttributes({
        contentId: 'gallery-dialog-content',
        descriptionId: 'gallery-dialog-description',
        open: true,
        titleId: 'gallery-dialog-title',
      }),
      { class: 'dialog-panel', id: 'authored-dialog-content' },
    );

    expect(trigger.diagnostics).toEqual([]);
    expect(content.diagnostics).toEqual([]);
    expect(
      <section data-gallery-merge="dialog-idref">
        <button {...trigger.attrs}>Open</button>
        <dialog {...content.attrs}>Body</dialog>
      </section>,
    ).toBe(
      '<section data-gallery-merge="dialog-idref"><button data-state="closed" aria-expanded="false" aria-haspopup="dialog" type="button" aria-controls="authored-dialog-content" command="show-modal" commandfor="authored-dialog-content" class="dialog-trigger">Open</button><dialog data-state="open" open id="authored-dialog-content" aria-labelledby="gallery-dialog-title" aria-describedby="gallery-dialog-description" class="dialog-panel">Body</dialog></section>',
    );
  });

  it('pins FW231 for double-wired dialog trigger relationships', () => {
    const merged = mergePrimitiveAttrs(
      dialogTriggerAttributes({ contentId: 'gallery-dialog-content', open: false }),
      { commandfor: 'other-dialog' },
    );

    expect(merged.diagnostics).toEqual([
      {
        attr: 'commandfor',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
  });
});

function mergePrimitiveAttrs(
  primitive: AttributeRecord,
  author: AttributeRecord,
): MergeFixtureResult {
  const attrs: Record<string, AttributeValue> = {};
  const diagnostics: MergeDiagnostic[] = [];
  const keys = stableKeys(primitive, author);

  // SPEC.md §4.6 is the normative merge table. This gallery-only oracle keeps
  // G5 deterministic while compiler/runtime merge lowering remains outside this slice.
  for (const key of keys) {
    const primitiveValue = primitive[key];
    const authorValue = author[key];
    const primitiveSet = primitiveValue !== undefined;
    const authorSet = authorValue !== undefined;

    if (key === 'class') {
      attrs[key] = mergeTokenLists(primitiveValue, authorValue);
      continue;
    }

    if (key === 'style') {
      attrs[key] = mergeStyles(primitiveValue, authorValue);
      continue;
    }

    if (key.startsWith('on:')) {
      attrs[key] = mergeRefs(authorValue, primitiveValue);
      continue;
    }

    if (key === 'id') {
      attrs[key] = authorSet ? authorValue : primitiveValue;
      continue;
    }

    if (idrefAttributes.has(key)) {
      if (primitiveSet && authorSet && primitiveValue !== authorValue) {
        diagnostics.push({
          attr: key,
          code: 'FW231',
          message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
        });
      }
      attrs[key] = authorSet ? authorValue : primitiveValue;
      continue;
    }

    if (key.startsWith('aria-') || key === 'role') {
      if (primitiveSet && authorSet && primitiveValue !== authorValue) {
        diagnostics.push({
          attr: key,
          code: 'FW232',
          message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
        });
      }
      attrs[key] = authorSet ? authorValue : primitiveValue;
      continue;
    }

    if (key === 'data-state') {
      if (primitiveSet && authorSet && primitiveValue !== authorValue) {
        diagnostics.push({
          attr: key,
          code: 'FW232',
          message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
        });
      }
      attrs[key] = primitiveSet ? primitiveValue : authorValue;
      continue;
    }

    if (key.startsWith('data-p-')) {
      if (primitiveSet && authorSet && primitiveValue !== authorValue) {
        diagnostics.push({
          attr: key,
          code: 'FW231',
          message: 'Unmergeable primitive handler-param conflict per SPEC.md section 4.6',
        });
      }
      attrs[key] = authorSet ? authorValue : primitiveValue;
      continue;
    }

    if (key === 'data-bind' || key.startsWith('data-bind:')) {
      if (primitiveSet && authorSet && primitiveValue !== authorValue) {
        diagnostics.push({
          attr: key,
          code: 'FW233',
          message: 'Unmergeable primitive binding conflict per SPEC.md section 4.6',
        });
      }
      attrs[key] = authorSet ? authorValue : primitiveValue;
      continue;
    }

    if (logicalOrAttributes.has(key)) {
      attrs[key] = Boolean(primitiveValue) || Boolean(authorValue);
      continue;
    }

    if (key === 'fw-deps') {
      attrs[key] = mergeTokenLists(primitiveValue, authorValue);
      continue;
    }

    if (key === 'fw-c' || key === 'fw-state') {
      if (primitiveSet && authorSet && primitiveValue !== authorValue) {
        diagnostics.push({
          attr: key,
          code: 'FW231',
          message: 'Unmergeable primitive island conflict per SPEC.md section 4.6',
        });
      }
      attrs[key] = authorSet ? authorValue : primitiveValue;
      continue;
    }

    attrs[key] = authorSet ? authorValue : primitiveValue;
  }

  return { attrs, diagnostics };
}

function rewriteIdrefs(
  attrs: AttributeRecord,
  rewrites: ReadonlyMap<string, string>,
): AttributeRecord {
  const rewritten: Record<string, AttributeValue> = {};

  for (const [key, value] of Object.entries(attrs)) {
    rewritten[key] =
      typeof value === 'string' && idrefAttributes.has(key)
        ? rewriteIdrefValue(value, rewrites)
        : value;
  }

  return rewritten;
}

function rewriteIdrefValue(value: string, rewrites: ReadonlyMap<string, string>): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => rewrites.get(token) ?? token)
    .join(' ');
}

function stableKeys(primitive: AttributeRecord, author: AttributeRecord): readonly string[] {
  return [...new Set([...Object.keys(primitive), ...Object.keys(author)])];
}

function mergeRefs(
  authorValue: AttributeValue,
  primitiveValue: AttributeValue,
): string | undefined {
  return mergeTokenLists(authorValue, primitiveValue);
}

function mergeStyles(
  primitiveValue: AttributeValue,
  authorValue: AttributeValue,
): string | undefined {
  return (
    [primitiveValue, authorValue]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim().replace(/;+$/, ''))
      .join('; ') || undefined
  );
}

function mergeTokenLists(first: AttributeValue, second: AttributeValue): string | undefined {
  const tokens: string[] = [];
  const seen = new Set<string>();

  for (const value of [first, second]) {
    if (typeof value !== 'string') continue;

    for (const token of value.trim().split(/\s+/)) {
      if (!token || seen.has(token)) continue;
      seen.add(token);
      tokens.push(token);
    }
  }

  return tokens.join(' ') || undefined;
}
