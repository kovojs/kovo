/** @jsxImportSource @kovojs/server */
import { BodyStart, Document, Head, HtmlAttrs, Meta, createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

const homeRoute = route('/', {
  meta: { title: 'Structured Document Shell' },
  page: () => `<main>
    <h1>Structured Document Shell</h1>
    <button type="button" on:click="/client.ts#mark">Run client handler</button>
    <output data-document-result>idle</output>
  </main>`,
});

export default defineFixture({
  app: createApp({
    document: (
      <Document lang="en-GB">
        <HtmlAttrs data-document="structured" />
        <Head>
          <Meta name="kovo-document" content="structured" />
        </Head>
        <BodyStart>
          <header role="banner">Custom Chrome</header>
        </BodyStart>
      </Document>
    ),
    routes: [homeRoute],
  }),
});
