/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { query, type QueryLoadContext } from '@kovojs/server';

export interface MetaRefreshPage extends Record<string, unknown> {
  remoteMeta: Record<string, unknown>;
}

export function metaRefreshPage(url: URL): MetaRefreshPage {
  const target = url.searchParams.get('target') ?? '/';
  const order = url.searchParams.get('order');

  if (order === 'attack-first') {
    return {
      remoteMeta: {
        'HTTP-EQUIV': 'refresh',
        'http-equiv': 'not-refresh',
        content: `0; url=${target}`,
      },
    };
  }
  if (order === 'safe-first') {
    return {
      remoteMeta: {
        'http-equiv': 'not-refresh',
        'HTTP-EQUIV': 'refresh',
        content: `0; url=${target}`,
      },
    };
  }
  return {
    remoteMeta: {
      'http-equiv': 'refresh',
      content: `0; url=${target}`,
    },
  };
}

export const metaRefreshQuery = query({
  reads: [],
  load: (_input: unknown, context?: QueryLoadContext<Request>) =>
    metaRefreshPage(new URL(context?.request.url ?? 'http://app.test/')),
});

export const MetaRefreshProbe = component({
  disableServerRefresh: true,
  queries: { page: metaRefreshQuery },
  render: ({ page }: { page: MetaRefreshPage }) => <meta {...page.remoteMeta} />,
});
