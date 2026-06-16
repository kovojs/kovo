/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

export const PrimitiveAsChildCard = component({
  render: () => (
    <section data-case="primitive-as-child">
      <Primitive.Trigger
        asChild
        attrs={{
          'aria-controls': 'as-child-panel',
          'aria-label': 'Primitive help',
          class: 'primitive-trigger primitive-base',
          'data-state': 'closed',
          'on:click': '/client.ts#primitive',
          role: 'button',
          style: 'color: red;',
        }}
      >
        <button
          class="author-trigger author-base"
          data-case="primitive-as-child-trigger"
          on:click="/client.ts#author"
          style="background: blue;"
          type="submit"
        >
          Open account
        </button>
      </Primitive.Trigger>
      <div id="as-child-panel">Merged panel</div>
    </section>
  ),
});
