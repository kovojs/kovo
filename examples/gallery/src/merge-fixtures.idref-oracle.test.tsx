/** @jsxImportSource @jiso/server */
import { describe, expect, it } from 'vitest';

import {
  dialogContentAttributes,
  dialogTriggerAttributes,
  radioGroupLabelAttributes,
  radioGroupRadioAttributes,
  tabsPanelAttributes,
  tabsTriggerAttributes,
  tooltipTriggerAttributes,
} from '@jiso/headless-ui/primitives';
import {
  type AttributeRecord,
  authorStressAttrs,
  idrefAttributes,
  mergePrimitiveAttrs,
  primitiveAttributeBuilderNames,
  primitiveExports,
  renderMergedBuilder,
  rewriteIdrefs,
  samplePrimitiveAttributes,
} from './merge-fixtures-oracle.js';

describe('gallery G5 primitive merge fixtures', () => {
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

  it('rewires tab trigger and panel IDREFs when authored ids win', () => {
    const idRewrites = new Map([
      ['gallery-tabs-overview', 'authored-tabs-overview'],
      ['gallery-tabs-overview-panel', 'authored-tabs-overview-panel'],
    ]);
    const trigger = mergePrimitiveAttrs(
      rewriteIdrefs(
        tabsTriggerAttributes({
          activeValue: 'overview',
          id: 'gallery-tabs-overview',
          itemValue: 'overview',
          panelId: 'gallery-tabs-overview-panel',
          value: 'overview',
        }),
        idRewrites,
      ),
      { class: 'tabs-trigger', id: 'authored-tabs-overview' },
    );
    const panel = mergePrimitiveAttrs(
      rewriteIdrefs(
        tabsPanelAttributes({
          id: 'gallery-tabs-overview-panel',
          itemValue: 'overview',
          triggerId: 'gallery-tabs-overview',
          value: 'overview',
        }),
        idRewrites,
      ),
      { class: 'tabs-panel', id: 'authored-tabs-overview-panel' },
    );

    expect(trigger.diagnostics).toEqual([]);
    expect(panel.diagnostics).toEqual([]);
    expect(
      <section data-gallery-merge="tabs-idref">
        <button {...trigger.attrs}>Overview</button>
        <div {...panel.attrs}>Panel</div>
      </section>,
    ).toBe(
      '<section data-gallery-merge="tabs-idref"><button data-state="active" aria-selected="true" role="tab" tabIndex="0" type="button" value="overview" aria-controls="authored-tabs-overview-panel" id="authored-tabs-overview" class="tabs-trigger">Overview</button><div data-state="active" role="tabpanel" tabIndex="0" aria-labelledby="authored-tabs-overview" id="authored-tabs-overview-panel" class="tabs-panel">Panel</div></section>',
    );
  });

  it('rewires radio label IDREFs when an authored native radio id wins', () => {
    const idRewrites = new Map([['gallery-radio-express', 'authored-radio-express']]);
    const state = {
      items: [{ value: 'standard' }, { value: 'express' }],
      name: 'gallery-shipping-speed',
      required: true,
      value: 'express',
    };
    const radio = mergePrimitiveAttrs(
      radioGroupRadioAttributes({
        ...state,
        controlId: 'gallery-radio-express',
        itemValue: 'express',
      }),
      { class: 'radio-input', id: 'authored-radio-express', required: false },
    );
    const label = mergePrimitiveAttrs(
      rewriteIdrefs(
        radioGroupLabelAttributes({
          ...state,
          controlId: 'gallery-radio-express',
          itemValue: 'express',
        }),
        idRewrites,
      ),
      { class: 'radio-label' },
    );

    expect(radio.diagnostics).toEqual([]);
    expect(label.diagnostics).toEqual([]);
    expect(
      <div data-gallery-merge="radio-idref">
        <input {...radio.attrs} />
        <label {...label.attrs}>Express</label>
      </div>,
    ).toBe(
      '<div data-gallery-merge="radio-idref"><input data-state="checked" aria-checked="true" checked tabIndex="0" type="radio" value="express" id="authored-radio-express" name="gallery-shipping-speed" required class="radio-input"><label data-state="checked" for="authored-radio-express" class="radio-label">Express</label></div>',
    );
  });

  it('pins FW231 for package-prefixed behavior IDREF conflicts', () => {
    const merged = mergePrimitiveAttrs(
      tooltipTriggerAttributes({
        contentId: 'gallery-tooltip-content',
        open: true,
      }),
      { 'jiso-tooltip': 'author-tooltip-content' },
    );

    expect(merged.diagnostics).toEqual([
      {
        attr: 'jiso-tooltip',
        code: 'FW231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
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

  it('covers every exported primitive attrs builder with the merge oracle', () => {
    const exportedAttributeBuilders = Object.keys(primitiveExports)
      .filter((name) => /^[a-z]/.test(name) && name.endsWith('Attributes'))
      .sort();

    expect([...primitiveAttributeBuilderNames].sort()).toEqual(exportedAttributeBuilders);

    const cases = primitiveAttributeBuilderNames.map((name) => {
      const primitive: AttributeRecord = {
        ...samplePrimitiveAttributes(name),
        class: `primitive-${name}`,
      };
      const author = authorStressAttrs(name, primitive);
      const merged = mergePrimitiveAttrs(primitive, author);

      expect(merged.attrs.class).toBe(`primitive-${name} author-${name}`);

      for (const attr of Object.keys(primitive)) {
        const authorValue = author[attr];
        if (authorValue === undefined || primitive[attr] === authorValue) continue;

        if (attr === 'data-state') {
          expect(merged.diagnostics).toContainEqual({
            attr,
            code: 'FW232',
            message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
          });
        }

        if (attr === 'role' || attr.startsWith('aria-')) {
          const code = idrefAttributes.has(attr) ? 'FW231' : 'FW232';
          const message =
            code === 'FW231'
              ? 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6'
              : 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6';
          expect(merged.diagnostics).toContainEqual({ attr, code, message });
        }

        if (idrefAttributes.has(attr)) {
          expect(merged.diagnostics).toContainEqual({
            attr,
            code: 'FW231',
            message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
          });
        }
      }

      return {
        attrCount: Object.keys(primitive).length,
        diagnostics: merged.diagnostics.length,
        html: renderMergedBuilder(name, merged.attrs),
        name,
      };
    });

    expect(cases).toHaveLength(135);
    expect(cases.some((testCase) => testCase.diagnostics > 0)).toBe(true);
    expect(cases.filter((testCase) => testCase.attrCount > 1).length).toBeGreaterThan(100);
    expect(
      cases.map(({ diagnostics, html, name }) => ({
        diagnostics,
        html,
        name,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="accordionContentAttributes" data-state="open" id="author-accordionContentAttributes" aria-labelledby="author-aria-labelledby" role="presentation" class="primitive-accordionContentAttributes author-accordionContentAttributes">merged</div>",
          "name": "accordionContentAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="accordionHeaderAttributes" data-state="open" aria-level="author-aria" role="presentation" class="primitive-accordionHeaderAttributes author-accordionHeaderAttributes">merged</div>",
          "name": "accordionHeaderAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="accordionItemAttributes" data-state="open" open class="primitive-accordionItemAttributes author-accordionItemAttributes">merged</div>",
          "name": "accordionItemAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="accordionRootAttributes" data-orientation="author-accordionRootAttributes" class="primitive-accordionRootAttributes author-accordionRootAttributes">merged</div>",
          "name": "accordionRootAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="accordionTriggerAttributes" data-state="open" aria-expanded="false" disabled tabIndex="1" type="author-accordionTriggerAttributes" aria-controls="author-aria-controls" id="author-accordionTriggerAttributes" class="primitive-accordionTriggerAttributes author-accordionTriggerAttributes">merged</div>",
          "name": "accordionTriggerAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="alertDialogActionAttributes" data-state="open" data-intent="author-alertDialogActionAttributes" disabled type="author-alertDialogActionAttributes" command="author-alertDialogActionAttributes" commandfor="author-commandfor" class="primitive-alertDialogActionAttributes author-alertDialogActionAttributes">merged</div>",
          "name": "alertDialogActionAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="alertDialogCancelAttributes" data-state="open" data-intent="author-alertDialogCancelAttributes" disabled type="author-alertDialogCancelAttributes" command="author-alertDialogCancelAttributes" commandfor="author-commandfor" class="primitive-alertDialogCancelAttributes author-alertDialogCancelAttributes">merged</div>",
          "name": "alertDialogCancelAttributes",
        },
        {
          "diagnostics": 5,
          "html": "<div data-gallery-merge-builder="alertDialogContentAttributes" data-state="open" aria-modal="false" open role="presentation" id="author-alertDialogContentAttributes" aria-labelledby="author-aria-labelledby" aria-describedby="author-aria-describedby" class="primitive-alertDialogContentAttributes author-alertDialogContentAttributes">merged</div>",
          "name": "alertDialogContentAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="alertDialogRootAttributes" data-state="open" class="primitive-alertDialogRootAttributes author-alertDialogRootAttributes">merged</div>",
          "name": "alertDialogRootAttributes",
        },
        {
          "diagnostics": 5,
          "html": "<div data-gallery-merge-builder="alertDialogTriggerAttributes" data-state="open" aria-expanded="false" aria-haspopup="author-aria" disabled type="author-alertDialogTriggerAttributes" aria-controls="author-aria-controls" command="author-alertDialogTriggerAttributes" commandfor="author-commandfor" class="primitive-alertDialogTriggerAttributes author-alertDialogTriggerAttributes">merged</div>",
          "name": "alertDialogTriggerAttributes",
        },
        {
          "diagnostics": 9,
          "html": "<div data-gallery-merge-builder="autocompleteInputAttributes" data-state="open" data-invalid="author-autocompleteInputAttributes" data-required="author-autocompleteInputAttributes" aria-autocomplete="author-aria" aria-expanded="false" autocomplete="author-autocompleteInputAttributes" disabled role="presentation" type="author-autocompleteInputAttributes" value="author-autocompleteInputAttributes" aria-activedescendant="author-aria-activedescendant" aria-controls="author-aria-controls" id="author-autocompleteInputAttributes" aria-labelledby="author-aria-labelledby" aria-describedby="author-aria-describedby" aria-invalid="false" name="author-autocompleteInputAttributes" placeholder="author-autocompleteInputAttributes" required class="primitive-autocompleteInputAttributes author-autocompleteInputAttributes">merged</div>",
          "name": "autocompleteInputAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="autocompleteListAttributes" data-state="open" data-invalid="author-autocompleteListAttributes" data-required="author-autocompleteListAttributes" id="author-autocompleteListAttributes" aria-labelledby="author-aria-labelledby" role="presentation" class="primitive-autocompleteListAttributes author-autocompleteListAttributes">merged</div>",
          "name": "autocompleteListAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="autocompleteOptionAttributes" data-state="unchecked" aria-selected="author-aria" role="presentation" id="author-autocompleteOptionAttributes" class="primitive-autocompleteOptionAttributes author-autocompleteOptionAttributes">merged</div>",
          "name": "autocompleteOptionAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="autocompleteRootAttributes" data-state="open" data-invalid="author-autocompleteRootAttributes" data-required="author-autocompleteRootAttributes" id="author-autocompleteRootAttributes" class="primitive-autocompleteRootAttributes author-autocompleteRootAttributes">merged</div>",
          "name": "autocompleteRootAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="autocompleteValueAttributes" id="author-autocompleteValueAttributes" class="primitive-autocompleteValueAttributes author-autocompleteValueAttributes">merged</div>",
          "name": "autocompleteValueAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="avatarFallbackAttributes" data-state="loaded" hidden data-delay="author-avatarFallbackAttributes" class="primitive-avatarFallbackAttributes author-avatarFallbackAttributes">merged</div>",
          "name": "avatarFallbackAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="avatarImageAttributes" data-state="loaded" decoding="author-avatarImageAttributes" src="author-avatarImageAttributes" class="primitive-avatarImageAttributes author-avatarImageAttributes">merged</div>",
          "name": "avatarImageAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="avatarRootAttributes" data-state="loaded" aria-label="author-aria" role="presentation" class="primitive-avatarRootAttributes author-avatarRootAttributes">merged</div>",
          "name": "avatarRootAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="checkboxGroupControlAttributes" data-state="checked" aria-checked="false" checked disabled tabIndex="1" type="author-checkboxGroupControlAttributes" value="author-checkboxGroupControlAttributes" id="author-checkboxGroupControlAttributes" name="author-checkboxGroupControlAttributes" required class="primitive-checkboxGroupControlAttributes author-checkboxGroupControlAttributes">merged</div>",
          "name": "checkboxGroupControlAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="checkboxGroupItemAttributes" data-state="checked" id="author-checkboxGroupItemAttributes" class="primitive-checkboxGroupItemAttributes author-checkboxGroupItemAttributes">merged</div>",
          "name": "checkboxGroupItemAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="checkboxGroupLabelAttributes" data-state="checked" for="author-for" id="author-checkboxGroupLabelAttributes" class="primitive-checkboxGroupLabelAttributes author-checkboxGroupLabelAttributes">merged</div>",
          "name": "checkboxGroupLabelAttributes",
        },
        {
          "diagnostics": 4,
          "html": "<div data-gallery-merge-builder="checkboxGroupRootAttributes" data-orientation="author-checkboxGroupRootAttributes" data-invalid="author-checkboxGroupRootAttributes" data-required="author-checkboxGroupRootAttributes" role="presentation" id="author-checkboxGroupRootAttributes" aria-describedby="author-aria-describedby" aria-invalid="false" aria-required="false" class="primitive-checkboxGroupRootAttributes author-checkboxGroupRootAttributes">merged</div>",
          "name": "checkboxGroupRootAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="checkboxRootAttributes" data-state="indeterminate" aria-checked="author-aria" disabled name="author-checkboxRootAttributes" required type="author-checkboxRootAttributes" value="author-checkboxRootAttributes" class="primitive-checkboxRootAttributes author-checkboxRootAttributes">merged</div>",
          "name": "checkboxRootAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="collapsibleContentAttributes" data-state="open" id="author-collapsibleContentAttributes" class="primitive-collapsibleContentAttributes author-collapsibleContentAttributes">merged</div>",
          "name": "collapsibleContentAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="collapsibleRootAttributes" data-state="open" open class="primitive-collapsibleRootAttributes author-collapsibleRootAttributes">merged</div>",
          "name": "collapsibleRootAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="collapsibleTriggerAttributes" data-state="open" aria-expanded="false" aria-controls="author-aria-controls" class="primitive-collapsibleTriggerAttributes author-collapsibleTriggerAttributes">merged</div>",
          "name": "collapsibleTriggerAttributes",
        },
        {
          "diagnostics": 9,
          "html": "<div data-gallery-merge-builder="comboboxInputAttributes" data-state="open" data-invalid="author-comboboxInputAttributes" data-required="author-comboboxInputAttributes" aria-autocomplete="author-aria" aria-expanded="false" role="presentation" type="author-comboboxInputAttributes" value="author-comboboxInputAttributes" aria-activedescendant="author-aria-activedescendant" aria-controls="author-aria-controls" id="author-comboboxInputAttributes" aria-labelledby="author-aria-labelledby" aria-describedby="author-aria-describedby" aria-invalid="false" disabled name="author-comboboxInputAttributes" placeholder="author-comboboxInputAttributes" required class="primitive-comboboxInputAttributes author-comboboxInputAttributes">merged</div>",
          "name": "comboboxInputAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="comboboxListboxAttributes" data-state="open" data-invalid="author-comboboxListboxAttributes" data-required="author-comboboxListboxAttributes" role="presentation" id="author-comboboxListboxAttributes" aria-labelledby="author-aria-labelledby" class="primitive-comboboxListboxAttributes author-comboboxListboxAttributes">merged</div>",
          "name": "comboboxListboxAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="comboboxOptionAttributes" data-state="checked" data-highlighted="author-comboboxOptionAttributes" aria-selected="false" role="presentation" id="author-comboboxOptionAttributes" label="author-comboboxOptionAttributes" value="author-comboboxOptionAttributes" class="primitive-comboboxOptionAttributes author-comboboxOptionAttributes">merged</div>",
          "name": "comboboxOptionAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="comboboxRootAttributes" data-state="open" data-invalid="author-comboboxRootAttributes" data-required="author-comboboxRootAttributes" id="author-comboboxRootAttributes" class="primitive-comboboxRootAttributes author-comboboxRootAttributes">merged</div>",
          "name": "comboboxRootAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="comboboxValueAttributes" id="author-comboboxValueAttributes" class="primitive-comboboxValueAttributes author-comboboxValueAttributes">merged</div>",
          "name": "comboboxValueAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="commandCloseAttributes" data-state="open" disabled type="author-commandCloseAttributes" command="author-commandCloseAttributes" commandfor="author-commandfor" class="primitive-commandCloseAttributes author-commandCloseAttributes">merged</div>",
          "name": "commandCloseAttributes",
        },
        {
          "diagnostics": 4,
          "html": "<div data-gallery-merge-builder="commandDialogAttributes" data-state="open" aria-modal="false" id="author-commandDialogAttributes" aria-describedby="author-aria-describedby" aria-labelledby="author-aria-labelledby" open class="primitive-commandDialogAttributes author-commandDialogAttributes">merged</div>",
          "name": "commandDialogAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="commandEmptyAttributes" data-empty="author-commandEmptyAttributes" hidden id="author-commandEmptyAttributes" class="primitive-commandEmptyAttributes author-commandEmptyAttributes">merged</div>",
          "name": "commandEmptyAttributes",
        },
        {
          "diagnostics": 8,
          "html": "<div data-gallery-merge-builder="commandInputAttributes" data-state="open" aria-autocomplete="author-aria" aria-expanded="false" autocomplete="author-commandInputAttributes" role="presentation" type="author-commandInputAttributes" value="author-commandInputAttributes" aria-activedescendant="author-aria-activedescendant" aria-controls="author-aria-controls" aria-describedby="author-aria-describedby" id="author-commandInputAttributes" aria-labelledby="author-aria-labelledby" disabled placeholder="author-commandInputAttributes" class="primitive-commandInputAttributes author-commandInputAttributes">merged</div>",
          "name": "commandInputAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="commandItemAttributes" data-state="active" data-selected="author-commandItemAttributes" data-highlighted="author-commandItemAttributes" aria-selected="false" role="presentation" tabIndex="1" id="author-commandItemAttributes" label="author-commandItemAttributes" value="author-commandItemAttributes" class="primitive-commandItemAttributes author-commandItemAttributes">merged</div>",
          "name": "commandItemAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="commandListboxAttributes" data-state="open" role="presentation" id="author-commandListboxAttributes" aria-labelledby="author-aria-labelledby" class="primitive-commandListboxAttributes author-commandListboxAttributes">merged</div>",
          "name": "commandListboxAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="commandRootAttributes" data-state="open" id="author-commandRootAttributes" class="primitive-commandRootAttributes author-commandRootAttributes">merged</div>",
          "name": "commandRootAttributes",
        },
        {
          "diagnostics": 6,
          "html": "<div data-gallery-merge-builder="commandTriggerAttributes" data-state="open" aria-expanded="false" aria-haspopup="author-aria" disabled type="author-commandTriggerAttributes" aria-controls="author-aria-controls" command="author-commandTriggerAttributes" commandfor="author-commandfor" id="author-commandTriggerAttributes" aria-labelledby="author-aria-labelledby" class="primitive-commandTriggerAttributes author-commandTriggerAttributes">merged</div>",
          "name": "commandTriggerAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="contextMenuContentAttributes" data-state="open" role="presentation" tabIndex="0" id="author-contextMenuContentAttributes" aria-labelledby="author-aria-labelledby" data-anchor-x="author-contextMenuContentAttributes" data-anchor-y="author-contextMenuContentAttributes" class="primitive-contextMenuContentAttributes author-contextMenuContentAttributes">merged</div>",
          "name": "contextMenuContentAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="contextMenuGroupAttributes" data-state="open" role="presentation" id="author-contextMenuGroupAttributes" aria-labelledby="author-aria-labelledby" class="primitive-contextMenuGroupAttributes author-contextMenuGroupAttributes">merged</div>",
          "name": "contextMenuGroupAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="contextMenuItemAttributes" data-state="active" data-highlighted="author-contextMenuItemAttributes" role="presentation" tabIndex="1" id="author-contextMenuItemAttributes" label="author-contextMenuItemAttributes" value="author-contextMenuItemAttributes" class="primitive-contextMenuItemAttributes author-contextMenuItemAttributes">merged</div>",
          "name": "contextMenuItemAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="contextMenuRootAttributes" data-state="open" id="author-contextMenuRootAttributes" class="primitive-contextMenuRootAttributes author-contextMenuRootAttributes">merged</div>",
          "name": "contextMenuRootAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="contextMenuSeparatorAttributes" role="presentation" id="author-contextMenuSeparatorAttributes" class="primitive-contextMenuSeparatorAttributes author-contextMenuSeparatorAttributes">merged</div>",
          "name": "contextMenuSeparatorAttributes",
        },
        {
          "diagnostics": 7,
          "html": "<div data-gallery-merge-builder="contextMenuTriggerAttributes" data-state="open" aria-expanded="false" aria-haspopup="author-aria" role="presentation" aria-controls="author-aria-controls" jiso-context-menu="author-jiso-context-menu" id="author-contextMenuTriggerAttributes" aria-labelledby="author-aria-labelledby" class="primitive-contextMenuTriggerAttributes author-contextMenuTriggerAttributes">merged</div>",
          "name": "contextMenuTriggerAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="dialogCloseAttributes" data-state="open" disabled type="author-dialogCloseAttributes" command="author-dialogCloseAttributes" commandfor="author-commandfor" class="primitive-dialogCloseAttributes author-dialogCloseAttributes">merged</div>",
          "name": "dialogCloseAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="dialogContentAttributes" data-state="open" open id="author-dialogContentAttributes" aria-labelledby="author-aria-labelledby" aria-describedby="author-aria-describedby" class="primitive-dialogContentAttributes author-dialogContentAttributes">merged</div>",
          "name": "dialogContentAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="dialogRootAttributes" data-state="open" class="primitive-dialogRootAttributes author-dialogRootAttributes">merged</div>",
          "name": "dialogRootAttributes",
        },
        {
          "diagnostics": 5,
          "html": "<div data-gallery-merge-builder="dialogTriggerAttributes" data-state="open" aria-expanded="false" aria-haspopup="author-aria" disabled type="author-dialogTriggerAttributes" aria-controls="author-aria-controls" command="author-dialogTriggerAttributes" commandfor="author-commandfor" class="primitive-dialogTriggerAttributes author-dialogTriggerAttributes">merged</div>",
          "name": "dialogTriggerAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="disclosureContentAttributes" data-state="open" id="author-disclosureContentAttributes" class="primitive-disclosureContentAttributes author-disclosureContentAttributes">merged</div>",
          "name": "disclosureContentAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="disclosureRootAttributes" data-state="open" class="primitive-disclosureRootAttributes author-disclosureRootAttributes">merged</div>",
          "name": "disclosureRootAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="disclosureTriggerAttributes" data-state="open" aria-expanded="false" disabled type="author-disclosureTriggerAttributes" aria-controls="author-aria-controls" class="primitive-disclosureTriggerAttributes author-disclosureTriggerAttributes">merged</div>",
          "name": "disclosureTriggerAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="dropdownMenuContentAttributes" data-state="open" role="presentation" tabIndex="0" id="author-dropdownMenuContentAttributes" aria-labelledby="author-aria-labelledby" class="primitive-dropdownMenuContentAttributes author-dropdownMenuContentAttributes">merged</div>",
          "name": "dropdownMenuContentAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="dropdownMenuGroupAttributes" data-state="open" role="presentation" id="author-dropdownMenuGroupAttributes" aria-labelledby="author-aria-labelledby" class="primitive-dropdownMenuGroupAttributes author-dropdownMenuGroupAttributes">merged</div>",
          "name": "dropdownMenuGroupAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="dropdownMenuItemAttributes" data-state="active" data-highlighted="author-dropdownMenuItemAttributes" role="presentation" tabIndex="1" id="author-dropdownMenuItemAttributes" label="author-dropdownMenuItemAttributes" value="author-dropdownMenuItemAttributes" class="primitive-dropdownMenuItemAttributes author-dropdownMenuItemAttributes">merged</div>",
          "name": "dropdownMenuItemAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="dropdownMenuRootAttributes" data-state="open" id="author-dropdownMenuRootAttributes" class="primitive-dropdownMenuRootAttributes author-dropdownMenuRootAttributes">merged</div>",
          "name": "dropdownMenuRootAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="dropdownMenuSeparatorAttributes" role="presentation" id="author-dropdownMenuSeparatorAttributes" class="primitive-dropdownMenuSeparatorAttributes author-dropdownMenuSeparatorAttributes">merged</div>",
          "name": "dropdownMenuSeparatorAttributes",
        },
        {
          "diagnostics": 5,
          "html": "<div data-gallery-merge-builder="dropdownMenuTriggerAttributes" data-state="open" aria-expanded="false" aria-haspopup="author-aria" disabled type="author-dropdownMenuTriggerAttributes" aria-controls="author-aria-controls" id="author-dropdownMenuTriggerAttributes" aria-labelledby="author-aria-labelledby" class="primitive-dropdownMenuTriggerAttributes author-dropdownMenuTriggerAttributes">merged</div>",
          "name": "dropdownMenuTriggerAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="fieldControlAttributes" data-invalid="author-fieldControlAttributes" data-required="author-fieldControlAttributes" aria-describedby="author-aria-describedby" aria-invalid="false" id="author-fieldControlAttributes" name="author-fieldControlAttributes" required class="primitive-fieldControlAttributes author-fieldControlAttributes">merged</div>",
          "name": "fieldControlAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="fieldDescriptionAttributes" data-invalid="author-fieldDescriptionAttributes" data-required="author-fieldDescriptionAttributes" id="author-fieldDescriptionAttributes" class="primitive-fieldDescriptionAttributes author-fieldDescriptionAttributes">merged</div>",
          "name": "fieldDescriptionAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="fieldErrorAttributes" data-invalid="author-fieldErrorAttributes" data-required="author-fieldErrorAttributes" id="author-fieldErrorAttributes" role="presentation" class="primitive-fieldErrorAttributes author-fieldErrorAttributes">merged</div>",
          "name": "fieldErrorAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="fieldLabelAttributes" data-invalid="author-fieldLabelAttributes" data-required="author-fieldLabelAttributes" id="author-fieldLabelAttributes" for="author-for" class="primitive-fieldLabelAttributes author-fieldLabelAttributes">merged</div>",
          "name": "fieldLabelAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="fieldRootAttributes" data-invalid="author-fieldRootAttributes" data-required="author-fieldRootAttributes" id="author-fieldRootAttributes" class="primitive-fieldRootAttributes author-fieldRootAttributes">merged</div>",
          "name": "fieldRootAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="fieldsetLegendAttributes" data-invalid="author-fieldsetLegendAttributes" data-required="author-fieldsetLegendAttributes" id="author-fieldsetLegendAttributes" class="primitive-fieldsetLegendAttributes author-fieldsetLegendAttributes">merged</div>",
          "name": "fieldsetLegendAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="fieldsetRootAttributes" data-invalid="author-fieldsetRootAttributes" data-required="author-fieldsetRootAttributes" aria-describedby="author-aria-describedby" aria-invalid="false" id="author-fieldsetRootAttributes" name="author-fieldsetRootAttributes" class="primitive-fieldsetRootAttributes author-fieldsetRootAttributes">merged</div>",
          "name": "fieldsetRootAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="hoverCardContentAttributes" data-state="open" id="author-hoverCardContentAttributes" popover="author-hoverCardContentAttributes" class="primitive-hoverCardContentAttributes author-hoverCardContentAttributes">merged</div>",
          "name": "hoverCardContentAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="hoverCardRootAttributes" data-state="open" class="primitive-hoverCardRootAttributes author-hoverCardRootAttributes">merged</div>",
          "name": "hoverCardRootAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="hoverCardTriggerAttributes" data-state="open" jiso-hover-card="author-jiso-hover-card" class="primitive-hoverCardTriggerAttributes author-hoverCardTriggerAttributes">merged</div>",
          "name": "hoverCardTriggerAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="menubarGroupAttributes" data-state="closed" data-orientation="author-menubarGroupAttributes" role="presentation" id="author-menubarGroupAttributes" class="primitive-menubarGroupAttributes author-menubarGroupAttributes">merged</div>",
          "name": "menubarGroupAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="menubarItemAttributes" data-state="active" data-highlighted="author-menubarItemAttributes" role="presentation" tabIndex="1" value="author-menubarItemAttributes" id="author-menubarItemAttributes" label="author-menubarItemAttributes" class="primitive-menubarItemAttributes author-menubarItemAttributes">merged</div>",
          "name": "menubarItemAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="menubarRootAttributes" data-state="closed" data-orientation="author-menubarRootAttributes" role="presentation" id="author-menubarRootAttributes" class="primitive-menubarRootAttributes author-menubarRootAttributes">merged</div>",
          "name": "menubarRootAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="menubarSeparatorAttributes" role="presentation" id="author-menubarSeparatorAttributes" class="primitive-menubarSeparatorAttributes author-menubarSeparatorAttributes">merged</div>",
          "name": "menubarSeparatorAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="menubarSubmenuAttributes" data-state="open" role="presentation" tabIndex="0" id="author-menubarSubmenuAttributes" class="primitive-menubarSubmenuAttributes author-menubarSubmenuAttributes">merged</div>",
          "name": "menubarSubmenuAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="meterRootAttributes" data-high="author-meterRootAttributes" data-low="author-meterRootAttributes" data-max="author-meterRootAttributes" data-min="author-meterRootAttributes" data-optimum="author-meterRootAttributes" data-state="optimum" data-value="author-meterRootAttributes" high="91" low="31" max="101" min="1" optimum="51" value="41" aria-valuetext="author-aria" class="primitive-meterRootAttributes author-meterRootAttributes">merged</div>",
          "name": "meterRootAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="navigationMenuContentAttributes" data-state="closed" role="presentation" tabIndex="0" id="author-navigationMenuContentAttributes" aria-labelledby="author-aria-labelledby" hidden class="primitive-navigationMenuContentAttributes author-navigationMenuContentAttributes">merged</div>",
          "name": "navigationMenuContentAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="navigationMenuIndicatorAttributes" data-state="open" id="author-navigationMenuIndicatorAttributes" class="primitive-navigationMenuIndicatorAttributes author-navigationMenuIndicatorAttributes">merged</div>",
          "name": "navigationMenuIndicatorAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="navigationMenuItemAttributes" data-state="active" data-highlighted="author-navigationMenuItemAttributes" role="presentation" id="author-navigationMenuItemAttributes" class="primitive-navigationMenuItemAttributes author-navigationMenuItemAttributes">merged</div>",
          "name": "navigationMenuItemAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="navigationMenuLinkAttributes" data-state="active" data-highlighted="author-navigationMenuLinkAttributes" tabIndex="1" value="author-navigationMenuLinkAttributes" href="author-navigationMenuLinkAttributes" id="author-navigationMenuLinkAttributes" label="author-navigationMenuLinkAttributes" class="primitive-navigationMenuLinkAttributes author-navigationMenuLinkAttributes">merged</div>",
          "name": "navigationMenuLinkAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="navigationMenuListAttributes" data-state="open" data-orientation="author-navigationMenuListAttributes" role="presentation" id="author-navigationMenuListAttributes" aria-labelledby="author-aria-labelledby" class="primitive-navigationMenuListAttributes author-navigationMenuListAttributes">merged</div>",
          "name": "navigationMenuListAttributes",
        },
        {
          "diagnostics": 5,
          "html": "<div data-gallery-merge-builder="navigationMenuRootAttributes" data-state="open" data-orientation="author-navigationMenuRootAttributes" role="presentation" id="author-navigationMenuRootAttributes" aria-label="author-aria" aria-labelledby="author-aria-labelledby" aria-describedby="author-aria-describedby" class="primitive-navigationMenuRootAttributes author-navigationMenuRootAttributes">merged</div>",
          "name": "navigationMenuRootAttributes",
        },
        {
          "diagnostics": 4,
          "html": "<div data-gallery-merge-builder="navigationMenuTriggerAttributes" data-state="open" data-highlighted="author-navigationMenuTriggerAttributes" aria-expanded="false" aria-haspopup="false" disabled tabIndex="1" type="author-navigationMenuTriggerAttributes" value="author-navigationMenuTriggerAttributes" aria-controls="author-aria-controls" id="author-navigationMenuTriggerAttributes" label="author-navigationMenuTriggerAttributes" class="primitive-navigationMenuTriggerAttributes author-navigationMenuTriggerAttributes">merged</div>",
          "name": "navigationMenuTriggerAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="navigationMenuViewportAttributes" data-state="open" id="author-navigationMenuViewportAttributes" class="primitive-navigationMenuViewportAttributes author-navigationMenuViewportAttributes">merged</div>",
          "name": "navigationMenuViewportAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="numberFieldDecrementAttributes" data-invalid="author-numberFieldDecrementAttributes" data-required="author-numberFieldDecrementAttributes" data-action="author-numberFieldDecrementAttributes" aria-label="author-aria" disabled type="author-numberFieldDecrementAttributes" id="author-numberFieldDecrementAttributes" class="primitive-numberFieldDecrementAttributes author-numberFieldDecrementAttributes">merged</div>",
          "name": "numberFieldDecrementAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="numberFieldIncrementAttributes" data-invalid="author-numberFieldIncrementAttributes" data-required="author-numberFieldIncrementAttributes" data-action="author-numberFieldIncrementAttributes" aria-label="author-aria" disabled type="author-numberFieldIncrementAttributes" id="author-numberFieldIncrementAttributes" class="primitive-numberFieldIncrementAttributes author-numberFieldIncrementAttributes">merged</div>",
          "name": "numberFieldIncrementAttributes",
        },
        {
          "diagnostics": 4,
          "html": "<div data-gallery-merge-builder="numberFieldInputAttributes" data-invalid="author-numberFieldInputAttributes" data-required="author-numberFieldInputAttributes" aria-describedby="author-aria-describedby" aria-invalid="false" aria-label="author-aria" aria-labelledby="author-aria-labelledby" disabled id="author-numberFieldInputAttributes" max="11" min="1" name="author-numberFieldInputAttributes" required step="2" type="author-numberFieldInputAttributes" value="5" class="primitive-numberFieldInputAttributes author-numberFieldInputAttributes">merged</div>",
          "name": "numberFieldInputAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="numberFieldRootAttributes" data-invalid="author-numberFieldRootAttributes" data-required="author-numberFieldRootAttributes" id="author-numberFieldRootAttributes" class="primitive-numberFieldRootAttributes author-numberFieldRootAttributes">merged</div>",
          "name": "numberFieldRootAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="otpFieldHiddenInputAttributes" data-invalid="author-otpFieldHiddenInputAttributes" data-required="author-otpFieldHiddenInputAttributes" aria-hidden="false" data-slot="author-otpFieldHiddenInputAttributes" autoComplete="author-otpFieldHiddenInputAttributes" disabled inputMode="author-otpFieldHiddenInputAttributes" maxLength="7" minLength="7" tabIndex="0" type="author-otpFieldHiddenInputAttributes" value="author-otpFieldHiddenInputAttributes" id="author-otpFieldHiddenInputAttributes" name="author-otpFieldHiddenInputAttributes" required class="primitive-otpFieldHiddenInputAttributes author-otpFieldHiddenInputAttributes">merged</div>",
          "name": "otpFieldHiddenInputAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="otpFieldInputAttributes" data-invalid="author-otpFieldInputAttributes" data-required="author-otpFieldInputAttributes" data-filled="author-otpFieldInputAttributes" aria-label="author-aria" data-slot="author-otpFieldInputAttributes" autoComplete="author-otpFieldInputAttributes" disabled inputMode="author-otpFieldInputAttributes" maxLength="2" type="author-otpFieldInputAttributes" value="author-otpFieldInputAttributes" id="author-otpFieldInputAttributes" required aria-invalid="false" class="primitive-otpFieldInputAttributes author-otpFieldInputAttributes">merged</div>",
          "name": "otpFieldInputAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="otpFieldRootAttributes" data-invalid="author-otpFieldRootAttributes" data-required="author-otpFieldRootAttributes" role="presentation" id="author-otpFieldRootAttributes" aria-describedby="author-aria-describedby" aria-invalid="false" class="primitive-otpFieldRootAttributes author-otpFieldRootAttributes">merged</div>",
          "name": "otpFieldRootAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="popoverContentAttributes" data-state="open" id="author-popoverContentAttributes" popover="author-popoverContentAttributes" class="primitive-popoverContentAttributes author-popoverContentAttributes">merged</div>",
          "name": "popoverContentAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="popoverRootAttributes" data-state="open" class="primitive-popoverRootAttributes author-popoverRootAttributes">merged</div>",
          "name": "popoverRootAttributes",
        },
        {
          "diagnostics": 4,
          "html": "<div data-gallery-merge-builder="popoverTriggerAttributes" data-state="open" aria-expanded="false" disabled type="author-popoverTriggerAttributes" aria-controls="author-aria-controls" popovertarget="author-popovertarget" popovertargetaction="author-popoverTriggerAttributes" class="primitive-popoverTriggerAttributes author-popoverTriggerAttributes">merged</div>",
          "name": "popoverTriggerAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="progressRootAttributes" data-max="author-progressRootAttributes" data-state="loading" max="101" data-value="author-progressRootAttributes" value="41" aria-valuetext="author-aria" class="primitive-progressRootAttributes author-progressRootAttributes">merged</div>",
          "name": "progressRootAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="radioGroupItemAttributes" data-state="checked" id="author-radioGroupItemAttributes" class="primitive-radioGroupItemAttributes author-radioGroupItemAttributes">merged</div>",
          "name": "radioGroupItemAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="radioGroupLabelAttributes" data-state="checked" for="author-for" id="author-radioGroupLabelAttributes" class="primitive-radioGroupLabelAttributes author-radioGroupLabelAttributes">merged</div>",
          "name": "radioGroupLabelAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="radioGroupRadioAttributes" data-state="checked" aria-checked="false" checked disabled tabIndex="1" type="author-radioGroupRadioAttributes" value="author-radioGroupRadioAttributes" id="author-radioGroupRadioAttributes" name="author-radioGroupRadioAttributes" required class="primitive-radioGroupRadioAttributes author-radioGroupRadioAttributes">merged</div>",
          "name": "radioGroupRadioAttributes",
        },
        {
          "diagnostics": 4,
          "html": "<div data-gallery-merge-builder="radioGroupRootAttributes" data-orientation="author-radioGroupRootAttributes" data-invalid="author-radioGroupRootAttributes" data-required="author-radioGroupRootAttributes" role="presentation" id="author-radioGroupRootAttributes" aria-describedby="author-aria-describedby" aria-invalid="false" aria-required="false" class="primitive-radioGroupRootAttributes author-radioGroupRootAttributes">merged</div>",
          "name": "radioGroupRootAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="scrollAreaCornerAttributes" data-scrollbars="author-scrollAreaCornerAttributes" data-state="visible" aria-hidden="false" id="author-scrollAreaCornerAttributes" class="primitive-scrollAreaCornerAttributes author-scrollAreaCornerAttributes">merged</div>",
          "name": "scrollAreaCornerAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="scrollAreaRootAttributes" data-scrollbars="author-scrollAreaRootAttributes" dir="author-scrollAreaRootAttributes" id="author-scrollAreaRootAttributes" class="primitive-scrollAreaRootAttributes author-scrollAreaRootAttributes">merged</div>",
          "name": "scrollAreaRootAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="scrollAreaScrollbarAttributes" data-scrollbars="author-scrollAreaScrollbarAttributes" data-orientation="author-scrollAreaScrollbarAttributes" data-state="visible" aria-hidden="false" id="author-scrollAreaScrollbarAttributes" class="primitive-scrollAreaScrollbarAttributes author-scrollAreaScrollbarAttributes">merged</div>",
          "name": "scrollAreaScrollbarAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="scrollAreaThumbAttributes" data-scrollbars="author-scrollAreaThumbAttributes" data-orientation="author-scrollAreaThumbAttributes" data-state="visible" aria-hidden="false" id="author-scrollAreaThumbAttributes" class="primitive-scrollAreaThumbAttributes author-scrollAreaThumbAttributes">merged</div>",
          "name": "scrollAreaThumbAttributes",
        },
        {
          "diagnostics": 4,
          "html": "<div data-gallery-merge-builder="scrollAreaViewportAttributes" data-scrollbars="author-scrollAreaViewportAttributes" tabIndex="1" aria-describedby="author-aria-describedby" role="presentation" aria-label="author-aria" aria-labelledby="author-aria-labelledby" id="author-scrollAreaViewportAttributes" class="primitive-scrollAreaViewportAttributes author-scrollAreaViewportAttributes">merged</div>",
          "name": "scrollAreaViewportAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="selectContentAttributes" data-state="open" data-invalid="author-selectContentAttributes" data-required="author-selectContentAttributes" id="author-selectContentAttributes" aria-labelledby="author-aria-labelledby" class="primitive-selectContentAttributes author-selectContentAttributes">merged</div>",
          "name": "selectContentAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="selectItemAttributes" data-state="checked" selected value="author-selectItemAttributes" label="author-selectItemAttributes" class="primitive-selectItemAttributes author-selectItemAttributes">merged</div>",
          "name": "selectItemAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="selectRootAttributes" data-state="open" data-invalid="author-selectRootAttributes" data-required="author-selectRootAttributes" id="author-selectRootAttributes" class="primitive-selectRootAttributes author-selectRootAttributes">merged</div>",
          "name": "selectRootAttributes",
        },
        {
          "diagnostics": 4,
          "html": "<div data-gallery-merge-builder="selectTriggerAttributes" data-state="open" data-invalid="author-selectTriggerAttributes" data-required="author-selectTriggerAttributes" aria-expanded="false" id="author-selectTriggerAttributes" aria-labelledby="author-aria-labelledby" aria-invalid="false" name="author-selectTriggerAttributes" required class="primitive-selectTriggerAttributes author-selectTriggerAttributes">merged</div>",
          "name": "selectTriggerAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="selectValueAttributes" id="author-selectValueAttributes" class="primitive-selectValueAttributes author-selectValueAttributes">merged</div>",
          "name": "selectValueAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="separatorRootAttributes" data-orientation="author-separatorRootAttributes" aria-orientation="author-aria" role="presentation" class="primitive-separatorRootAttributes author-separatorRootAttributes">merged</div>",
          "name": "separatorRootAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="sliderHiddenInputAttributes" disabled name="author-sliderHiddenInputAttributes" type="author-sliderHiddenInputAttributes" value="41" class="primitive-sliderHiddenInputAttributes author-sliderHiddenInputAttributes">merged</div>",
          "name": "sliderHiddenInputAttributes",
        },
        {
          "diagnostics": 4,
          "html": "<div data-gallery-merge-builder="sliderInputAttributes" data-orientation="author-sliderInputAttributes" data-invalid="author-sliderInputAttributes" data-required="author-sliderInputAttributes" data-max="author-sliderInputAttributes" data-min="author-sliderInputAttributes" data-value="author-sliderInputAttributes" aria-describedby="author-aria-describedby" aria-invalid="false" aria-labelledby="author-aria-labelledby" aria-valuetext="author-aria" disabled id="author-sliderInputAttributes" max="101" min="1" name="author-sliderInputAttributes" required step="2" type="author-sliderInputAttributes" value="41" class="primitive-sliderInputAttributes author-sliderInputAttributes">merged</div>",
          "name": "sliderInputAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="sliderRangeAttributes" data-orientation="author-sliderRangeAttributes" data-invalid="author-sliderRangeAttributes" data-required="author-sliderRangeAttributes" data-max="author-sliderRangeAttributes" data-min="author-sliderRangeAttributes" data-value="author-sliderRangeAttributes" aria-hidden="false" data-part="author-sliderRangeAttributes" data-value-ratio="author-sliderRangeAttributes" id="author-sliderRangeAttributes" class="primitive-sliderRangeAttributes author-sliderRangeAttributes">merged</div>",
          "name": "sliderRangeAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="sliderRootAttributes" data-orientation="author-sliderRootAttributes" data-invalid="author-sliderRootAttributes" data-required="author-sliderRootAttributes" data-max="author-sliderRootAttributes" data-min="author-sliderRootAttributes" data-value="author-sliderRootAttributes" id="author-sliderRootAttributes" class="primitive-sliderRootAttributes author-sliderRootAttributes">merged</div>",
          "name": "sliderRootAttributes",
        },
        {
          "diagnostics": 8,
          "html": "<div data-gallery-merge-builder="sliderThumbAttributes" data-orientation="author-sliderThumbAttributes" data-invalid="author-sliderThumbAttributes" data-required="author-sliderThumbAttributes" data-max="author-sliderThumbAttributes" data-min="author-sliderThumbAttributes" data-value="author-sliderThumbAttributes" aria-describedby="author-aria-describedby" aria-invalid="false" aria-labelledby="author-aria-labelledby" aria-valuemax="author-aria" aria-valuemin="author-aria" aria-valuenow="author-aria" aria-valuetext="author-aria" data-part="author-sliderThumbAttributes" data-value-ratio="author-sliderThumbAttributes" id="author-sliderThumbAttributes" role="presentation" tabIndex="1" class="primitive-sliderThumbAttributes author-sliderThumbAttributes">merged</div>",
          "name": "sliderThumbAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="sliderTrackAttributes" data-orientation="author-sliderTrackAttributes" data-invalid="author-sliderTrackAttributes" data-required="author-sliderTrackAttributes" data-max="author-sliderTrackAttributes" data-min="author-sliderTrackAttributes" data-value="author-sliderTrackAttributes" data-part="author-sliderTrackAttributes" data-value-ratio="author-sliderTrackAttributes" id="author-sliderTrackAttributes" class="primitive-sliderTrackAttributes author-sliderTrackAttributes">merged</div>",
          "name": "sliderTrackAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="switchRootAttributes" data-state="checked" aria-checked="false" checked disabled name="author-switchRootAttributes" role="presentation" required type="author-switchRootAttributes" value="author-switchRootAttributes" class="primitive-switchRootAttributes author-switchRootAttributes">merged</div>",
          "name": "switchRootAttributes",
        },
        {
          "diagnostics": 5,
          "html": "<div data-gallery-merge-builder="tabsListAttributes" data-orientation="author-tabsListAttributes" role="presentation" id="author-tabsListAttributes" aria-label="author-aria" aria-labelledby="author-aria-labelledby" aria-describedby="author-aria-describedby" aria-orientation="author-aria" class="primitive-tabsListAttributes author-tabsListAttributes">merged</div>",
          "name": "tabsListAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="tabsPanelAttributes" data-state="active" role="presentation" tabIndex="1" aria-labelledby="author-aria-labelledby" id="author-tabsPanelAttributes" class="primitive-tabsPanelAttributes author-tabsPanelAttributes">merged</div>",
          "name": "tabsPanelAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="tabsRootAttributes" data-orientation="author-tabsRootAttributes" id="author-tabsRootAttributes" class="primitive-tabsRootAttributes author-tabsRootAttributes">merged</div>",
          "name": "tabsRootAttributes",
        },
        {
          "diagnostics": 4,
          "html": "<div data-gallery-merge-builder="tabsTriggerAttributes" data-state="active" aria-selected="false" disabled role="presentation" tabIndex="1" type="author-tabsTriggerAttributes" value="author-tabsTriggerAttributes" aria-controls="author-aria-controls" id="author-tabsTriggerAttributes" class="primitive-tabsTriggerAttributes author-tabsTriggerAttributes">merged</div>",
          "name": "tabsTriggerAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="toastActionAttributes" data-state="open" data-variant="author-toastActionAttributes" data-action="author-toastActionAttributes" disabled type="author-toastActionAttributes" class="primitive-toastActionAttributes author-toastActionAttributes">merged</div>",
          "name": "toastActionAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="toastCloseAttributes" data-state="open" data-variant="author-toastCloseAttributes" data-dismiss="author-toastCloseAttributes" disabled type="author-toastCloseAttributes" class="primitive-toastCloseAttributes author-toastCloseAttributes">merged</div>",
          "name": "toastCloseAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="toastDescriptionAttributes" data-part="author-toastDescriptionAttributes" id="author-toastDescriptionAttributes" class="primitive-toastDescriptionAttributes author-toastDescriptionAttributes">merged</div>",
          "name": "toastDescriptionAttributes",
        },
        {
          "diagnostics": 6,
          "html": "<div data-gallery-merge-builder="toastRootAttributes" data-state="open" data-variant="author-toastRootAttributes" aria-atomic="false" aria-live="author-aria" aria-describedby="author-aria-describedby" aria-labelledby="author-aria-labelledby" id="author-toastRootAttributes" role="presentation" class="primitive-toastRootAttributes author-toastRootAttributes">merged</div>",
          "name": "toastRootAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="toastTitleAttributes" data-part="author-toastTitleAttributes" id="author-toastTitleAttributes" class="primitive-toastTitleAttributes author-toastTitleAttributes">merged</div>",
          "name": "toastTitleAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="toastViewportAttributes" data-placement="author-toastViewportAttributes" aria-label="author-aria" role="presentation" tabIndex="0" id="author-toastViewportAttributes" class="primitive-toastViewportAttributes author-toastViewportAttributes">merged</div>",
          "name": "toastViewportAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="toggleGroupButtonAttributes" data-state="pressed" aria-pressed="false" disabled tabIndex="1" type="author-toggleGroupButtonAttributes" value="author-toggleGroupButtonAttributes" id="author-toggleGroupButtonAttributes" class="primitive-toggleGroupButtonAttributes author-toggleGroupButtonAttributes">merged</div>",
          "name": "toggleGroupButtonAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="toggleGroupItemAttributes" data-state="pressed" id="author-toggleGroupItemAttributes" class="primitive-toggleGroupItemAttributes author-toggleGroupItemAttributes">merged</div>",
          "name": "toggleGroupItemAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="toggleGroupRootAttributes" data-orientation="author-toggleGroupRootAttributes" role="presentation" id="author-toggleGroupRootAttributes" class="primitive-toggleGroupRootAttributes author-toggleGroupRootAttributes">merged</div>",
          "name": "toggleGroupRootAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="toggleRootAttributes" data-state="pressed" aria-pressed="false" disabled type="author-toggleRootAttributes" class="primitive-toggleRootAttributes author-toggleRootAttributes">merged</div>",
          "name": "toggleRootAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="toolbarButtonAttributes" disabled tabIndex="1" type="author-toolbarButtonAttributes" value="author-toolbarButtonAttributes" id="author-toolbarButtonAttributes" class="primitive-toolbarButtonAttributes author-toolbarButtonAttributes">merged</div>",
          "name": "toolbarButtonAttributes",
        },
        {
          "diagnostics": 0,
          "html": "<div data-gallery-merge-builder="toolbarItemAttributes" id="author-toolbarItemAttributes" class="primitive-toolbarItemAttributes author-toolbarItemAttributes">merged</div>",
          "name": "toolbarItemAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="toolbarRootAttributes" data-orientation="author-toolbarRootAttributes" role="presentation" id="author-toolbarRootAttributes" class="primitive-toolbarRootAttributes author-toolbarRootAttributes">merged</div>",
          "name": "toolbarRootAttributes",
        },
        {
          "diagnostics": 2,
          "html": "<div data-gallery-merge-builder="tooltipContentAttributes" data-state="open" id="author-tooltipContentAttributes" role="presentation" class="primitive-tooltipContentAttributes author-tooltipContentAttributes">merged</div>",
          "name": "tooltipContentAttributes",
        },
        {
          "diagnostics": 1,
          "html": "<div data-gallery-merge-builder="tooltipRootAttributes" data-state="open" class="primitive-tooltipRootAttributes author-tooltipRootAttributes">merged</div>",
          "name": "tooltipRootAttributes",
        },
        {
          "diagnostics": 3,
          "html": "<div data-gallery-merge-builder="tooltipTriggerAttributes" data-state="open" jiso-tooltip="author-jiso-tooltip" aria-describedby="author-aria-describedby" class="primitive-tooltipTriggerAttributes author-tooltipTriggerAttributes">merged</div>",
          "name": "tooltipTriggerAttributes",
        },
      ]
    `);
  });
});
