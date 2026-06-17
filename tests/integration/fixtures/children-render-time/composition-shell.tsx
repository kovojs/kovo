/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

function Panel(props: { children?: unknown; footer?: unknown }): string {
  return (
    <section aria-label="server composed panel">
      <div data-slot="body">{props.children}</div>
      <footer data-slot="footer">{props.footer}</footer>
    </section>
  );
}

export const CompositionShell = component({
  render: () => (
    <composition-shell>
      <h1>Server composition</h1>
      <Panel footer="Named slot rendered on the server">
        Children rendered on the server
      </Panel>
    </composition-shell>
  ),
});
