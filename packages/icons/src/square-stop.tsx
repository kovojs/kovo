/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Square Stop icon (Lucide). https://lucide.dev/icons/square-stop */
export function SquareStop(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <rect x="9" y="9" width="6" height="6" rx="1"></rect>
    </svg>
  );
}
