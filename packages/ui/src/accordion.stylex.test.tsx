import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  Accordion,
  AccordionContent,
  AccordionHeader,
  AccordionItem,
  AccordionTrigger,
  accordionStyles,
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
      classes: [style.attrs(accordionStyles.root).class ?? ''] as const,
      contentClasses: [style.attrs(accordionStyles.content).class ?? ''] as const,
      headerClasses: [style.attrs(accordionStyles.header).class ?? ''] as const,
      itemClasses: [style.attrs(accordionStyles.item).class ?? ''] as const,
      open: Accordion.definition.render({
        children:
          AccordionItem.definition.render({
            ...shipping,
            children:
              AccordionHeader.definition.render({
                ...shipping,
                children: AccordionTrigger.definition.render({
                  ...shipping,
                  children: 'Shipping',
                  contentId: 'shipping-panel',
                  triggerId: 'shipping-trigger',
                }),
                level: 3,
              }) +
              AccordionContent.definition.render({
                ...shipping,
                children: 'Ships from the nearest warehouse.',
                contentId: 'shipping-panel',
                triggerId: 'shipping-trigger',
              }),
          }) +
          AccordionItem.definition.render({
            ...billing,
            children:
              AccordionHeader.definition.render({
                ...billing,
                children: AccordionTrigger.definition.render({
                  ...billing,
                  children: 'Billing',
                  contentId: 'billing-panel',
                  triggerId: 'billing-trigger',
                }),
                level: 3,
              }) +
              AccordionContent.definition.render({
                ...billing,
                children: 'Invoices remain available after checkout.',
                contentId: 'billing-panel',
                triggerId: 'billing-trigger',
              }),
          }),
        id: 'account-accordion',
        value: 'shipping',
      }),
      triggerClasses: [style.attrs(accordionStyles.trigger).class ?? ''] as const,
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create(
      {
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
      },
      { namespace: 'appAccordion', source: 'app-accordion.tsx' },
    );

    expect(
      Accordion.definition.render({
        children: AccordionItem.definition.render({
          itemValue: 'one',
          styles: { item: overrides.item },
          value: 'one',
          children:
            AccordionHeader.definition.render({
              itemValue: 'one',
              styles: { header: overrides.header },
              value: 'one',
              children: AccordionTrigger.definition.render({
                children: 'One',
                itemValue: 'one',
                styles: { trigger: overrides.trigger },
                value: 'one',
              }),
            }) +
            AccordionContent.definition.render({
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

  it('exports StyleX style groups', () => {
    expect({
      contentMarker: accordionStyles.content.$$css,
      headerMarker: accordionStyles.header.$$css,
      itemMarker: accordionStyles.item.$$css,
      keys: Object.keys(accordionStyles),
      rootMarker: accordionStyles.root.$$css,
      triggerMarker: accordionStyles.trigger.$$css,
    }).toMatchSnapshot();
  });
});
