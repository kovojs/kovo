/** @jsxImportSource @kovojs/server */
import { component, type ComponentChild } from '@kovojs/core';

interface MatchedCartState {
  count: number;
  email: string;
  open: boolean;
  ordered: boolean;
}

// SPEC §4.4 and §7-§8: this real L1 island is the capability that installs Kovo's deferred
// runtime and enhanced navigation. The L0 sibling contains no client marker and stays zero-JS.
export const MatchedL1Shell = component({
  state: (): MatchedCartState => ({
    count: 0,
    email: 'checkout@example.test',
    open: false,
    ordered: false,
  }),
  render: ({ children }: { children?: ComponentChild }, state: MatchedCartState) => (
    <div class="shell" data-benchmark-lane="matched-l1">
      <nav class="nav">
        <a class="brand" href="/matched/l1">
          Benchmark Supply
        </a>
        <button
          class="cart-button"
          type="button"
          aria-label={`Open cart with ${state.count} items`}
          onClick={() => {
            state.open = true;
          }}
        >
          Cart ({state.count})
        </button>
      </nav>
      {children}
      <div class="modal-backdrop" hidden={!state.open}>
        <section
          class="cart-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="matched-l1-cart-title"
        >
          <header>
            <div>
              <h2 id="matched-l1-cart-title">Review cart</h2>
              <p>Mutable cart, email, and order state are owned by this client island.</p>
            </div>
            <button
              class="secondary-button"
              type="button"
              onClick={() => {
                state.open = false;
              }}
            >
              Close
            </button>
          </header>
          <div class="cart-lines">
            <div class="cart-line">
              <span>Benchmark item x {state.count}</span>
              <strong>$148.00</strong>
            </div>
          </div>
          <button
            class="secondary-button"
            type="button"
            onClick={() => {
              state.count += 1;
              state.ordered = false;
            }}
          >
            Add benchmark item
          </button>
          <form class="checkout">
            <label>
              Name
              <input name="name" autocomplete="name" />
            </label>
            <label>
              Email
              <input
                name="email"
                type="email"
                autocomplete="email"
                value={state.email}
                readOnly={true}
              />
            </label>
            <button
              class="secondary-button"
              type="button"
              onClick={() => {
                state.email = 'alternate@example.test';
                state.ordered = false;
              }}
            >
              Use alternate email
            </button>
            <button
              class="primary-button"
              type="button"
              onClick={() => {
                state.ordered = true;
              }}
            >
              Place order
            </button>
          </form>
          <p class="confirmation" role="status" hidden={!state.ordered}>
            Order placed. Confirmation sent to <span>{state.email}</span>.
          </p>
        </section>
      </div>
    </div>
  ),
});
