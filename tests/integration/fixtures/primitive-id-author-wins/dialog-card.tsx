/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

export const PrimitiveIdAuthorWinsCard = component({
  render: () => (
    <section data-case="primitive-id-author-wins">
      <Primitive.DialogTrigger
        asChild
        attrs={{
          'aria-controls': 'primitive-account-dialog',
          'aria-haspopup': 'dialog',
          command: 'show-modal',
          commandfor: 'primitive-account-dialog',
          'data-state': 'closed',
          id: 'primitive-account-trigger',
          type: 'button',
        }}
      >
        <button class="author-trigger" data-case="primitive-open-trigger">
          Open account dialog
        </button>
      </Primitive.DialogTrigger>
      <Primitive.DialogContent
        asChild
        attrs={{
          'aria-labelledby': 'primitive-account-title',
          'data-state': 'closed',
          id: 'primitive-account-dialog',
        }}
      >
        <dialog class="author-dialog" data-case="primitive-dialog" id="authored-account-dialog">
          <h1 id="primitive-account-title">Account dialog</h1>
          <p>Authored dialog id should be the command target.</p>
          <button command="close" commandfor="authored-account-dialog" type="button">
            Close
          </button>
        </dialog>
      </Primitive.DialogContent>
    </section>
  ),
});
