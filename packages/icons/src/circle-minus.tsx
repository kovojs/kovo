/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Circle Minus icon (Lucide). https://lucide.dev/icons/circle-minus */
export function CircleMinus(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M8 12h8"></path>
    </svg>
  );
}
