/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Bell Minus icon (Lucide). https://lucide.dev/icons/bell-minus */
export function BellMinus(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M10.268 21a2 2 0 0 0 3.464 0"></path>
      <path d="M15 8h6"></path>
      <path d="M16.243 3.757A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673A9.4 9.4 0 0 1 18.667 12"></path>
    </svg>
  );
}
