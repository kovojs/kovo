import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import { createWithSource } from '@kovojs/style/internal';

import {
  Accordion,
  AccordionContent,
  AccordionHeader,
  AccordionItem,
  AccordionTrigger,
} from './accordion.js';

describe('@kovojs/ui Accordion StyleX styles', () => {
  it('matches accordion states with StyleX output', () => {
    const shipping = {
      itemValue: 'shipping',
      value: 'shipping',
    };
    const billing = {
      itemValue: 'billing',
      value: 'shipping',
    };

    expect({
      open: renderUiComponent(Accordion, {
        children:
          renderUiComponent(AccordionItem, {
            ...shipping,
            children:
              renderUiComponent(AccordionHeader, {
                ...shipping,
                children: renderUiComponent(AccordionTrigger, {
                  ...shipping,
                  children: 'Shipping',
                  contentId: 'shipping-panel',
                  triggerId: 'shipping-trigger',
                }),
                level: 3,
              }) +
              renderUiComponent(AccordionContent, {
                ...shipping,
                children: 'Ships from the nearest warehouse.',
                contentId: 'shipping-panel',
                triggerId: 'shipping-trigger',
              }),
          }) +
          renderUiComponent(AccordionItem, {
            ...billing,
            children:
              renderUiComponent(AccordionHeader, {
                ...billing,
                children: renderUiComponent(AccordionTrigger, {
                  ...billing,
                  children: 'Billing',
                  contentId: 'billing-panel',
                  triggerId: 'billing-trigger',
                }),
                level: 3,
              }) +
              renderUiComponent(AccordionContent, {
                ...billing,
                children: 'Invoices remain available after checkout.',
                contentId: 'billing-panel',
                triggerId: 'billing-trigger',
              }),
          }),
        id: 'account-accordion',
        value: 'shipping',
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = createWithSource('accordion.stylex.test.tsx')({
      content: {
        paddingTop: 12,
      },
      header: {
        fontWeight: 700,
      },
      item: {
        borderColor: '#2563eb',
      },
      root: {
        rowGap: 12,
      },
      trigger: {
        backgroundColor: '#dbeafe',
      },
    });

    expect(
      renderUiComponent(Accordion, {
        children: renderUiComponent(AccordionItem, {
          itemValue: 'one',
          styles: { item: overrides.item },
          value: 'one',
          children:
            renderUiComponent(AccordionHeader, {
              itemValue: 'one',
              styles: { header: overrides.header },
              value: 'one',
              children: renderUiComponent(AccordionTrigger, {
                children: 'One',
                itemValue: 'one',
                styles: { trigger: overrides.trigger },
                value: 'one',
              }),
            }) +
            renderUiComponent(AccordionContent, {
              children: 'Panel one',
              itemValue: 'one',
              styles: { content: overrides.content },
              value: 'one',
            }),
        }),
        styles: { root: overrides.root },
        value: 'one',
      }),
    ).toMatchSnapshot();
  });
});
