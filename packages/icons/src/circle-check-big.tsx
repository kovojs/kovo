/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Circle Check Big icon (Lucide). https://lucide.dev/icons/circle-check-big */
export function CircleCheckBig(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M21.801 10A10 10 0 1 1 17 3.335"></path>
      <path d="m9 11 3 3L22 4"></path>
    </svg>
  );
}
