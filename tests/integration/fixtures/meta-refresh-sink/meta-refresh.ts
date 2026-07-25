import { renderHtmlValue } from '@kovojs/server/internal/html';
import { jsx } from '@kovojs/server/jsx-runtime';

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

// This fixture targets the runtime's pair-dependent attribute sanitizer directly. It deliberately
// bypasses authored TSX because SPEC §5.2 requires the compiler to reject this opaque spread before
// it can reach that defense-in-depth sink in an application component.
export function renderMetaRefreshProbe(page: MetaRefreshPage): string {
  return renderHtmlValue(jsx('meta', page.remoteMeta));
}
