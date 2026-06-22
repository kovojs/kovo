/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Square icon (Lucide). https://lucide.dev/icons/square-square */
export function SquareSquare(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect x="3" y="3" width="18" height="18" rx="2"></rect>
      <rect x="8" y="8" width="8" height="8" rx="1"></rect>
    </svg>
  );
}
