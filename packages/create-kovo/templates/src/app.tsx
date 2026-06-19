/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

const appStyles = style.create({
  action: {
    backgroundColor: style.tokens.customColor('success').colorContainer,
    borderColor: style.tokens.customColor('success').color,
    borderRadius: style.tokens.sys.shape.cornerMedium,
    borderStyle: 'solid',
    borderWidth: 1,
    color: style.tokens.customColor('success').onColorContainer,
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
    color: style.tokens.sys.color.onSurfaceVariant,
    fontSize: 14,
    fontWeight: 500,
    textTransform: 'uppercase',
  },
  heading: {
    color: style.tokens.sys.color.primary,
    fontSize: 30,
    fontWeight: 600,
    letterSpacing: 0,
    lineHeight: 1.2,
    margin: 0,
  },
  root: {
    color: style.tokens.sys.color.onSurface,
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
    color: style.tokens.sys.color.onSurfaceVariant,
    fontSize: 14,
  },
  toolbar: {
    alignItems: 'center',
    columnGap: 12,
    display: 'flex',
    flexWrap: 'wrap',
  },
});

export const App = component({
  props: { cartCount: Number },
  state: () => ({ clicks: 0 }),
  render: ({ cartCount }: { cartCount: number }) => (
    <main {...style.attrs(appStyles.root)} kovo-c="app-root" kovo-state='{"clicks":0}'>
      <section {...style.attrs(appStyles.section)}>
        <p {...style.attrs(appStyles.eyebrow)}>Routed by the app shell</p>
        <h1 {...style.attrs(appStyles.heading)}>Hello from Kovo</h1>
        <p {...style.attrs(appStyles.body)}>
          This page is declared as a Kovo route and served by the same request handler used for
          static export.
        </p>
        <p {...style.attrs(appStyles.status)}>Starter cart count: {cartCount}</p>
        <div {...style.attrs(appStyles.toolbar)}>
          <button
            {...style.attrs(appStyles.action)}
            data-p-message="starter"
            on:click="/c/__v/starter-r7/starter.client.js#Starter$announce"
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
