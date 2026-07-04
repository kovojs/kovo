import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

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
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create({
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
});
