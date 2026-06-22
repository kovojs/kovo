/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Move Down Right icon (Lucide). https://lucide.dev/icons/move-down-right */
export function MoveDownRight(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M19 13V19H13"></path>
      <path d="M5 5L19 19"></path>
    </svg>
  );
}
