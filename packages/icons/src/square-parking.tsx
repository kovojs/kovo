/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Square Parking icon (Lucide). https://lucide.dev/icons/square-parking */
export function SquareParking(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M9 17V7h4a3 3 0 0 1 0 6H9"></path>
    </svg>
  );
}
