import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import { Tabs, TabsList, TabsPanel, TabsTrigger, tabsStyles } from './tabs.js';

const items = [
  { label: 'Overview', value: 'overview' },
  { label: 'Billing', value: 'billing' },
] as const;

describe('@kovojs/ui Tabs StyleX slots', () => {
  it('renders headless tabs attrs with StyleX slot classes', () => {
    const state = {
      activeValue: 'overview',
      items,
      orientation: 'vertical' as const,
      value: 'overview',
    };
    const root = Tabs.definition.render({
      ...state,
      children: 'tabs body',
      disabled: true,
      id: 'account-tabs',
    }) as string;
    const list = TabsList.definition.render({
      ...state,
      label: 'Account sections',
    }) as string;
    const trigger = TabsTrigger.definition.render({
      ...state,
      children: 'Overview',
      itemValue: 'overview',
      panelId: 'overview-panel',
    }) as string;
    const inactivePanel = TabsPanel.definition.render({
      ...state,
      children: 'Billing',
      itemValue: 'billing',
      triggerId: 'billing-trigger',
    }) as string;

    expect(root).toContain('<div class="kv-tabs-fg-');
    expect(root).toContain('data-disabled="" data-orientation="vertical" id="account-tabs"');
    expect(root).toContain('data-style-src="tabs.tsx#root"');
    expect(list).toContain('role="tablist"');
    expect(list).toContain('aria-label="Account sections"');
    expect(list).toContain('aria-orientation="vertical"');
    expect(list).toContain('class="kv-tabs-align-');
    expect(trigger).toContain('aria-controls="overview-panel"');
    expect(trigger).toContain('aria-selected="true"');
    expect(trigger).toContain('data-state="active"');
    expect(trigger).toContain('role="tab" tabIndex="0" type="button" value="overview"');
    expect(inactivePanel).toContain('aria-labelledby="billing-trigger"');
    expect(inactivePanel).toContain('data-state="inactive" hidden');
    expect(inactivePanel).toContain('role="tabpanel"');
    expect(([style.attrs(tabsStyles.root).class ?? ''] as const).join(' ')).toContain('kv-tabs-w-');
    expect(([style.attrs(tabsStyles.list).class ?? ''] as const).join(' ')).toContain(
      'kv-tabs-flex-',
    );
    expect(([style.attrs(tabsStyles.trigger).class ?? ''] as const).join(' ')).toContain(
      'kv-tabs-bg-',
    );
    expect(([style.attrs(tabsStyles.panel).class ?? ''] as const).join(' ')).toContain(
      'kv-tabs-pad-',
    );
  });

  it('accepts per-slot StyleX override objects', () => {
    const overrides = style.create(
      {
        list: {
          backgroundColor: '#111827',
        },
        panel: {
          color: '#111827',
        },
        root: {
          color: '#1d4ed8',
        },
        trigger: {
          color: '#1d4ed8',
          '[data-state=active]': {
            color: '#1d4ed8',
          },
        },
      },
      { namespace: 'appTabs', source: 'app-tabs.tsx' },
    );

    const root = Tabs.definition.render({
      children: 'tabs body',
      styles: { root: overrides.root },
    }) as string;
    const list = TabsList.definition.render({
      styles: { list: overrides.list },
    }) as string;
    const trigger = TabsTrigger.definition.render({
      activeValue: 'overview',
      itemValue: 'overview',
      styles: { trigger: overrides.trigger },
      value: 'overview',
    }) as string;
    const panel = TabsPanel.definition.render({
      itemValue: 'overview',
      styles: { panel: overrides.panel },
      value: 'overview',
    }) as string;

    expect(root).toContain('kv-app-tabs-fg-');
    expect(list).toContain('kv-app-tabs-bg-');
    expect(trigger).toContain('kv-app-tabs-fg-');
    expect(panel).toContain('kv-app-tabs-fg-');
    expect(trigger).not.toContain('kv-tabs-fg-');
    expect(root).toContain('app-tabs.tsx#root');
    expect(list).toContain('app-tabs.tsx#list');
    expect(trigger).toContain('app-tabs.tsx#trigger');
    expect(panel).toContain('app-tabs.tsx#panel');
  });

  it('exports StyleX slot objects instead of variant helpers', () => {
    expect(tabsStyles.root.$$css).toBe(true);
    expect(tabsStyles.list.$$css).toBe(true);
    expect(tabsStyles.trigger.$$css).toBe(true);
    expect(tabsStyles.panel.$$css).toBe(true);
  });
});
