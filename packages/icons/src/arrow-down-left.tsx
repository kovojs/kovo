/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Arrow Down Left icon (Lucide). https://lucide.dev/icons/arrow-down-left */
export function ArrowDownLeft(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M17 7 7 17"></path>
      <path d="M17 17H7V7"></path>
    </svg>
  );
}
