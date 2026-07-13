/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

const styles = style.create({ root: { color: 'rebeccapurple' } });

export const PoisonedStyle = component({
  name: 'poisoned-style',
  render: () => <article styles={styles.root}>Styled</article>,
});
