/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Square Code icon (Lucide). https://lucide.dev/icons/square-code */
export function SquareCode(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m10 9-3 3 3 3"></path>
      <path d="m14 15 3-3-3-3"></path>
      <rect x="3" y="3" width="18" height="18" rx="2"></rect>
    </svg>
  );
}
