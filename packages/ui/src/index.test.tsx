import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { Badge, Button, Card, Sheet, buttonClasses, sheetContentClasses } from './index.js';

const sourceDir = dirname(fileURLToPath(import.meta.url));

function readSource(name: string): string {
  return readFileSync(join(sourceDir, name), 'utf8');
}

describe('@jiso/ui styled package foundation', () => {
  it('exports pure-markup button, badge, and card TSX components', () => {
    expect(Button.name).toBe('button');
    expect(Badge.name).toBe('badge');
    expect(Card.name).toBe('card');

    expect(
      Button.definition.render({
        children: 'Save',
        class: ['tracking-wide', { uppercase: true }],
        disabled: true,
        size: 'sm',
        type: 'submit',
        variant: 'secondary',
      }),
    ).toContain(
      '<button class="inline-flex items-center justify-center rounded-md border text-sm font-medium transition-colors',
    );
    expect(Button.definition.render({ children: 'Save', disabled: true })).toContain(
      ' disabled type="button"',
    );
    expect(Button.definition.render({ children: 'Save', size: 'sm' })).toContain('h-8 gap-1.5');
    expect(Badge.definition.render({ children: 'Live', variant: 'success' })).toContain(
      'bg-emerald-50',
    );
    expect(Card.definition.render({ children: '<p>Total</p>' })).toBe(
      '<section class="rounded-lg border border-neutral-200 bg-white p-4 text-neutral-950 shadow-sm"><p>Total</p></section>',
    );
    expect(buttonClasses).toContain('h-9 gap-2 px-3');
  });

  it('wraps the headless dialog primitive for a bounded sheet component', () => {
    const rendered = Sheet.definition.render({
      children: 'Sheet body',
      contentId: 'account-sheet',
      description: 'Manage account settings',
      open: true,
      side: 'left',
      title: 'Account',
      trigger: 'Settings',
    });

    expect(rendered).toContain('aria-controls="account-sheet"');
    expect(rendered).toContain('command="show-modal" commandfor="account-sheet"');
    expect(rendered).toContain('<dialog aria-describedby="account-sheet-description"');
    expect(rendered).toContain('id="account-sheet" open>');
    expect(rendered).toContain('left-0 border-r');
    expect(rendered).toContain('command="request-close" commandfor="account-sheet"');
    expect(sheetContentClasses).toContain('right-0 border-l');
  });

  it('keeps vendorable component sources TSX-authored with no lowered IR stamps', () => {
    const sources = ['button.tsx', 'badge.tsx', 'card.tsx', 'sheet.tsx'].map(readSource).join('\n');

    expect(sources).toContain('/** @jsxImportSource @jiso/server */');
    expect(sources).toContain("import { component } from '@jiso/core';");
    expect(sources).toContain("from '@jiso/headless-ui'");
    expect(sources).not.toContain('fw-c=');
    expect(sources).not.toContain('data-bind');
    expect(sources).not.toContain('@jiso-ir');
  });
});
