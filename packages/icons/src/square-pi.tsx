/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Square Pi icon (Lucide). https://lucide.dev/icons/square-pi */
export function SquarePi(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M7 7h10"></path>
      <path d="M10 7v10"></path>
      <path d="M16 17a2 2 0 0 1-2-2V7"></path>
    </svg>
  );
}
