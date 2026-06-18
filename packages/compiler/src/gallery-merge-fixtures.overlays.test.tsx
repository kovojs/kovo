/** @jsxImportSource @kovojs/server */
import { describe, expect, it } from 'vitest';

import {
  alertDialogActionAttributes,
  alertDialogCancelAttributes,
  alertDialogContentAttributes,
  alertDialogTriggerAttributes,
} from '@kovojs/headless-ui/alert-dialog';
import { dialogCloseAttributes, dialogRootAttributes } from '@kovojs/headless-ui/dialog';
import {
  hoverCardContentAttributes,
  hoverCardTriggerAttributes,
} from '@kovojs/headless-ui/hover-card';
import { popoverContentAttributes, popoverTriggerAttributes } from '@kovojs/headless-ui/popover';
import {
  toastActionAttributes,
  toastCloseAttributes,
  toastDescriptionAttributes,
  toastRootAttributes,
  toastTitleAttributes,
  toastViewportAttributes,
} from '@kovojs/headless-ui/toast';
import { mergeCompilerPrimitiveAttrs } from './gallery-merge-fixtures-oracle.js';

describe('gallery G5 primitive merge fixtures', () => {
  it('renders a golden toast merge with live-region roles and action buttons', () => {
    const state = { id: 'gallery-toast', open: true };
    const viewport = mergeCompilerPrimitiveAttrs(
      {
        ...toastViewportAttributes({
          id: 'gallery-toast-viewport',
          label: 'Gallery notifications',
          placement: 'top-end',
        }),
        class: 'toast-viewport',
      },
      {
        'aria-label': 'Author notifications',
        class: 'toast-viewport fixed',
        role: 'log',
        tabIndex: 0,
      },
    );
    const root = mergeCompilerPrimitiveAttrs(
      {
        ...toastRootAttributes({
          ...state,
          descriptionId: 'gallery-toast-description',
          politeness: 'assertive',
          titleId: 'gallery-toast-title',
          variant: 'error',
        }),
        class: 'toast-root',
      },
      {
        'aria-live': 'polite',
        class: 'toast-root border',
        'data-state': 'author-open',
        role: 'status',
      },
    );
    const action = mergeCompilerPrimitiveAttrs(
      {
        ...toastActionAttributes({ ...state, actionValue: 'retry' }),
        class: 'toast-action',
      },
      {
        class: 'toast-action underline',
        disabled: true,
        type: 'submit',
      },
    );
    const close = mergeCompilerPrimitiveAttrs(
      {
        ...toastCloseAttributes(state),
        class: 'toast-close',
      },
      {
        class: 'toast-close absolute',
        'data-dismiss': 'author-dismiss',
      },
    );

    expect(viewport.diagnostics).toEqual([
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
    expect(root.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-live',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
    ]);
    expect(action.diagnostics).toEqual([]);
    expect(close.diagnostics).toEqual([]);
    expect(
      <section data-gallery-merge="toast">
        <div {...viewport.attrs}>
          <article {...root.attrs}>
            <button {...action.attrs}>Retry</button>
            <button {...close.attrs}>Dismiss</button>
          </article>
        </div>
      </section>,
    ).toBe(
      '<section data-gallery-merge="toast"><div data-placement="top-end" aria-label="Author notifications" role="log" tabIndex="0" id="gallery-toast-viewport" class="toast-viewport fixed"><article data-state="open" data-variant="error" aria-atomic="true" aria-live="polite" aria-describedby="gallery-toast-description" aria-labelledby="gallery-toast-title" id="gallery-toast" role="status" class="toast-root border"><button data-state="open" data-variant="default" data-action="" disabled type="submit" value="retry" class="toast-action underline">Retry</button><button data-state="open" data-variant="default" data-dismiss="author-dismiss" type="button" class="toast-close absolute">Dismiss</button></article></div></section>',
    );
  });

  it('renders a golden alert-dialog merge with command wiring and action intents', () => {
    const trigger = mergeCompilerPrimitiveAttrs(
      {
        ...alertDialogTriggerAttributes({
          contentId: 'gallery-delete-dialog',
          open: true,
        }),
        class: 'alert-dialog-trigger',
      },
      {
        'aria-expanded': 'false',
        class: 'alert-dialog-trigger destructive',
        commandfor: 'author-delete-dialog',
        'data-state': 'author-open',
      },
    );
    const content = mergeCompilerPrimitiveAttrs(
      {
        ...alertDialogContentAttributes({
          contentId: 'gallery-delete-dialog',
          descriptionId: 'gallery-delete-description',
          open: true,
          titleId: 'gallery-delete-title',
        }),
        class: 'alert-dialog-panel',
      },
      {
        'aria-describedby': 'author-delete-description',
        class: 'alert-dialog-panel shadow-xl',
        id: 'author-delete-dialog',
        role: 'dialog',
      },
    );
    const cancel = mergeCompilerPrimitiveAttrs(
      {
        ...alertDialogCancelAttributes({
          autoFocus: true,
          contentId: 'gallery-delete-dialog',
          open: true,
        }),
        class: 'alert-dialog-cancel',
      },
      {
        autofocus: false,
        class: 'alert-dialog-cancel muted',
        commandfor: 'author-delete-dialog',
        type: 'submit',
      },
    );
    const action = mergeCompilerPrimitiveAttrs(
      {
        ...alertDialogActionAttributes({
          contentId: 'gallery-delete-dialog',
          intent: 'destructive',
          open: true,
        }),
        class: 'alert-dialog-action',
      },
      {
        class: 'alert-dialog-action danger',
        'data-intent': 'author-danger',
        disabled: true,
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
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'commandfor',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(content.diagnostics).toEqual([
      {
        attr: 'role',
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-describedby',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(cancel.diagnostics).toEqual([
      {
        attr: 'commandfor',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(action.diagnostics).toEqual([]);
    expect(
      <section data-gallery-merge="alert-dialog">
        <button {...trigger.attrs}>Delete</button>
        <dialog {...content.attrs}>
          <button {...cancel.attrs}>Cancel</button>
          <button {...action.attrs}>Confirm</button>
        </dialog>
      </section>,
    ).toBe(
      '<section data-gallery-merge="alert-dialog"><button data-state="open" aria-expanded="false" aria-haspopup="dialog" type="button" aria-controls="gallery-delete-dialog" command="show-modal" commandfor="author-delete-dialog" class="alert-dialog-trigger destructive">Delete</button><dialog data-state="open" aria-modal="true" open role="dialog" id="author-delete-dialog" aria-labelledby="gallery-delete-title" aria-describedby="author-delete-description" class="alert-dialog-panel shadow-xl"><button data-state="open" data-intent="cancel" type="submit" command="request-close" commandfor="author-delete-dialog" class="alert-dialog-cancel muted">Cancel</button><button data-state="open" data-intent="author-danger" disabled type="button" command="request-close" commandfor="gallery-delete-dialog" class="alert-dialog-action danger">Confirm</button></dialog></section>',
    );
  });

  it('renders a golden popover merge with native popover target conflicts', () => {
    const trigger = mergeCompilerPrimitiveAttrs(
      {
        ...popoverTriggerAttributes({
          contentId: 'gallery-account-popover',
          open: false,
        }),
        class: 'popover-trigger',
      },
      {
        'aria-controls': 'author-account-popover',
        'aria-expanded': 'true',
        class: 'popover-trigger compact',
        'data-state': 'author-open',
        popovertarget: 'author-account-popover',
        type: 'submit',
      },
    );
    const content = mergeCompilerPrimitiveAttrs(
      {
        ...popoverContentAttributes({
          contentId: 'gallery-account-popover',
          open: false,
        }),
        class: 'popover-content',
      },
      {
        class: 'popover-content min-w-48',
        id: 'author-account-popover',
        popover: 'manual',
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
        code: 'KV232',
        message: 'Author override of primitive ARIA/role attribute per SPEC.md section 4.6',
      },
      {
        attr: 'aria-controls',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
      {
        attr: 'popovertarget',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(content.diagnostics).toEqual([]);
    expect(
      <section data-gallery-merge="popover">
        <button {...trigger.attrs}>Account</button>
        <div {...content.attrs}>Menu</div>
      </section>,
    ).toBe(
      '<section data-gallery-merge="popover"><button data-state="closed" aria-expanded="true" type="submit" aria-controls="author-account-popover" popovertarget="author-account-popover" popovertargetaction="toggle" class="popover-trigger compact">Account</button><div data-state="closed" id="author-account-popover" popover="manual" class="popover-content min-w-48">Menu</div></section>',
    );
  });

  it('renders a golden hover-card merge with package-prefixed behavior IDREFs', () => {
    const trigger = mergeCompilerPrimitiveAttrs(
      {
        ...hoverCardTriggerAttributes({
          contentId: 'gallery-profile-card',
          open: true,
        }),
        class: 'hover-card-trigger',
      },
      {
        'aria-controls': 'author-profile-card',
        'aria-expanded': 'false',
        class: 'hover-card-trigger underline',
        'data-state': 'author-open',
        'kovo-hover-card': 'author-profile-card',
      },
    );
    const content = mergeCompilerPrimitiveAttrs(
      {
        ...hoverCardContentAttributes({
          contentId: 'gallery-profile-card',
          open: false,
        }),
        class: 'hover-card-content',
      },
      {
        class: 'hover-card-content w-64',
        hidden: false,
        id: 'author-profile-card',
        popover: 'auto',
      },
    );

    expect(trigger.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
      {
        attr: 'kovo-hover-card',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(content.diagnostics).toEqual([]);
    expect(
      <section data-gallery-merge="hover-card">
        <a {...trigger.attrs}>Ada</a>
        <aside {...content.attrs}>Profile</aside>
      </section>,
    ).toBe(
      '<section data-gallery-merge="hover-card"><a data-state="open" kovo-hover-card="author-profile-card" class="hover-card-trigger underline" aria-controls="author-profile-card" aria-expanded="false">Ada</a><aside data-state="closed" id="author-profile-card" popover="auto" class="hover-card-content w-64">Profile</aside></section>',
    );
  });

  it('renders golden dialog root and close merges with native command relationships', () => {
    const state = {
      contentId: 'gallery-profile-dialog',
      descriptionId: 'gallery-profile-description',
      open: true,
      titleId: 'gallery-profile-title',
    };
    const root = mergeCompilerPrimitiveAttrs(
      { ...dialogRootAttributes(state), class: 'dialog-root' },
      { class: 'dialog-root isolate', 'data-state': 'author-open', id: 'author-dialog-root' },
    );
    const close = mergeCompilerPrimitiveAttrs(
      { ...dialogCloseAttributes(state), class: 'dialog-close' },
      {
        class: 'dialog-close top-2',
        commandfor: 'author-profile-dialog',
        disabled: true,
        type: 'submit',
      },
    );

    expect(root.diagnostics).toEqual([
      {
        attr: 'data-state',
        code: 'KV232',
        message: 'Author override of primitive-owned state attribute per SPEC.md section 4.6',
      },
    ]);
    expect(close.diagnostics).toEqual([
      {
        attr: 'commandfor',
        code: 'KV231',
        message: 'Unmergeable primitive IDREF conflict per SPEC.md section 4.6',
      },
    ]);
    expect(
      <section data-gallery-merge="dialog-close">
        <div {...root.attrs}>
          <button {...close.attrs}>Close</button>
        </div>
      </section>,
    ).toBe(
      '<section data-gallery-merge="dialog-close"><div data-state="open" class="dialog-root isolate" id="author-dialog-root"><button data-state="open" disabled type="submit" command="request-close" commandfor="author-profile-dialog" class="dialog-close top-2">Close</button></div></section>',
    );
  });

  it('renders golden toast title and description merges with part attrs', () => {
    const title = mergeCompilerPrimitiveAttrs(
      { ...toastTitleAttributes({ id: 'gallery-toast-title' }), class: 'toast-title' },
      {
        class: 'toast-title font-medium',
        'data-part': 'author-title',
        id: 'author-toast-title',
      },
    );
    const description = mergeCompilerPrimitiveAttrs(
      {
        ...toastDescriptionAttributes({ id: 'gallery-toast-description' }),
        class: 'toast-description',
      },
      {
        class: 'toast-description text-sm',
        'data-part': 'author-description',
        id: 'author-toast-description',
      },
    );

    expect(title.diagnostics).toEqual([]);
    expect(description.diagnostics).toEqual([]);
    expect(
      <article data-gallery-merge="toast-parts">
        <h2 {...title.attrs}>Synced</h2>
        <p {...description.attrs}>Changes are available offline.</p>
      </article>,
    ).toBe(
      '<article data-gallery-merge="toast-parts"><h2 data-part="author-title" id="author-toast-title" class="toast-title font-medium">Synced</h2><p data-part="author-description" id="author-toast-description" class="toast-description text-sm">Changes are available offline.</p></article>',
    );
  });
});
