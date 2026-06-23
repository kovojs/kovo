/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Arrow Up Left icon (Lucide). https://lucide.dev/icons/arrow-up-left */
export function ArrowUpLeft(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M7 17V7h10"></path>
      <path d="M17 17 7 7"></path>
    </svg>
  );
}
