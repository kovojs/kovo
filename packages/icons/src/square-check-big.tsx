/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Check Big icon (Lucide). https://lucide.dev/icons/square-check-big */
export function SquareCheckBig(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M21 10.656V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.344"></path>
      <path d="m9 11 3 3L22 4"></path>
    </svg>
  );
}
