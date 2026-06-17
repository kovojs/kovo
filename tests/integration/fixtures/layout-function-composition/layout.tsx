/** @jsxImportSource @kovojs/server */

export function AppLayout(props: { children?: unknown; section: string }): string {
  return (
    <main data-layout-section={props.section}>
      <header>
        <h1>Workspace</h1>
        <nav aria-label="Primary">
          <a href="/">Home</a>
          <a href="/reports">Reports</a>
        </nav>
      </header>
      <details>
        <summary>Layout drawer</summary>
        <p>Open state belongs to this document.</p>
      </details>
      <section aria-label="page content">{props.children}</section>
    </main>
  );
}

export function HomePage(): string {
  return <article data-route="home">Home document</article>;
}

export function ReportsPage(): string {
  return <article data-route="reports">Reports document</article>;
}
