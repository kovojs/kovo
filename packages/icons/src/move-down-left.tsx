/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Move Down Left icon (Lucide). https://lucide.dev/icons/move-down-left */
export function MoveDownLeft(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M11 19H5V13"></path>
      <path d="M19 5L5 19"></path>
    </svg>
  );
}
