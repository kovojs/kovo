/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Move Up Right icon (Lucide). https://lucide.dev/icons/move-up-right */
export function MoveUpRight(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M13 5H19V11"></path>
      <path d="M19 5L5 19"></path>
    </svg>
  );
}
