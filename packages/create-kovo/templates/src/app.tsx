/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

const appStyles = style.create(
  {
    action: {
      backgroundColor: '#ecfdf5',
      borderColor: '#a7f3d0',
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      color: '#047857',
      fontWeight: 500,
      paddingBlock: 8,
      paddingInline: 16,
    },
    body: {
      fontSize: 16,
      lineHeight: 1.75,
      maxWidth: 576,
    },
    eyebrow: {
      color: '#52606d',
      fontSize: 14,
      fontWeight: 500,
      textTransform: 'uppercase',
    },
    heading: {
      color: '#0f8b8d',
      fontSize: 30,
      fontWeight: 600,
      letterSpacing: 0,
      lineHeight: 1.2,
      margin: 0,
    },
    root: {
      color: '#17202a',
      display: 'grid',
      marginInline: 'auto',
      maxWidth: 768,
      minHeight: '100dvh',
      paddingInline: 24,
      placeItems: 'center',
    },
    section: {
      display: 'grid',
      rowGap: 20,
    },
    status: {
      color: '#52606d',
      fontSize: 14,
    },
    toolbar: {
      alignItems: 'center',
      columnGap: 12,
      display: 'flex',
      flexWrap: 'wrap',
    },
  },
  { namespace: 'starterApp', source: 'src/app.tsx' },
);

export const starterAppStyleCss = style.emitAtomicCss(
  Object.values(appStyles).flatMap((entry) => entry.__rules ?? []),
);

export const App = component({
  state: () => ({ clicks: 0 }),
  render: () => (
    <main {...style.attrs(appStyles.root)} kovo-c="app-root" kovo-state='{"clicks":0}'>
      <section {...style.attrs(appStyles.section)}>
        <p {...style.attrs(appStyles.eyebrow)}>Routed by the app shell</p>
        <h1 {...style.attrs(appStyles.heading)}>Hello from Kovo</h1>
        <p {...style.attrs(appStyles.body)}>
          This page is declared as a Kovo route and served by the same request handler used for
          static export.
        </p>
        <div {...style.attrs(appStyles.toolbar)}>
          <button
            {...style.attrs(appStyles.action)}
            data-p-message="starter"
            on:click="/c/starter.client.js?v=starter-r7#Starter$announce"
            type="button"
          >
            Try interaction
          </button>
          <output {...style.attrs(appStyles.status)} id="starter-status">
            Ready for first interaction.
          </output>
        </div>
      </section>
    </main>
  ),
});
