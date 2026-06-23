/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Square Power icon (Lucide). https://lucide.dev/icons/square-power */
export function SquarePower(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 7v4"></path>
      <path d="M7.998 9.003a5 5 0 1 0 8-.005"></path>
      <rect x="3" y="3" width="18" height="18" rx="2"></rect>
    </svg>
  );
}
