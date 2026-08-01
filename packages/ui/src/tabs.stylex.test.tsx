import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';
import { createWithSource } from '@kovojs/style/internal';
import { Tabs, TabsList, TabsPanel, TabsTrigger } from './tabs.js';
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
    const root = String(
      renderUiComponent(Tabs, {
        ...state,
        children: 'tabs body',
        disabled: true,
        id: 'account-tabs',
      }),
    );
    const list = String(
      renderUiComponent(TabsList, {
        ...state,
        label: 'Account sections',
      }),
    );
    const trigger = String(
      renderUiComponent(TabsTrigger, {
        ...state,
        children: 'Overview',
        itemValue: 'overview',
        panelId: 'overview-panel',
      }),
    );
    const inactivePanel = String(
      renderUiComponent(TabsPanel, {
        ...state,
        children: 'Billing',
        itemValue: 'billing',
        triggerId: 'billing-trigger',
      }),
    );
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
  });
  it('accepts per-slot StyleX override objects', () => {
    const overrides = createWithSource('tabs.stylex.test.tsx')({
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
    });
    const root = String(
      renderUiComponent(Tabs, {
        children: 'tabs body',
        styles: { root: overrides.root },
      }),
    );
    const list = String(
      renderUiComponent(TabsList, {
        styles: { list: overrides.list },
      }),
    );
    const trigger = String(
      renderUiComponent(TabsTrigger, {
        activeValue: 'overview',
        itemValue: 'overview',
        styles: { trigger: overrides.trigger },
        value: 'overview',
      }),
    );
    const panel = String(
      renderUiComponent(TabsPanel, {
        itemValue: 'overview',
        styles: { panel: overrides.panel },
        value: 'overview',
      }),
    );
    expect(root).toContain('kv-tabs-stylex-test-fg-');
    expect(list).toContain('kv-tabs-stylex-test-bg-');
    expect(trigger).toContain('kv-tabs-stylex-test-fg-');
    expect(panel).toContain('kv-tabs-stylex-test-fg-');
    expect(trigger).not.toContain('kv-tabs-fg-');
    expect(root).toContain('tabs.stylex.test.tsx#root');
    expect(list).toContain('tabs.stylex.test.tsx#list');
    expect(trigger).toContain('tabs.stylex.test.tsx#trigger');
    expect(panel).toContain('tabs.stylex.test.tsx#panel');
  });
});
