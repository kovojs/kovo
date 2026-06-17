/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { describe, expect, it } from 'vitest';

import { renderComponent } from './component-render.js';

describe('renderComponent', () => {
  it('passes SPEC §4.5 render-time children and named slots to component render', () => {
    const Card = component({
      render: (
        { title }: { title: string },
        _state,
        { children, footer }: { children?: unknown; footer?: unknown },
      ) => (
        <section>
          <h2>{title}</h2>
          <div data-slot="body">{children}</div>
          <footer>{footer}</footer>
        </section>
      ),
    });

    expect(
      renderComponent(
        Card,
        { title: 'Cart' },
        { slots: { children: <p>Ready</p>, footer: 'Done' } },
      ),
    ).toBe(
      '<section><h2>Cart</h2><div data-slot="body"><p>Ready</p></div><footer>Done</footer></section>',
    );
  });
});
