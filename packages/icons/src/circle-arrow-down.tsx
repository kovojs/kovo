/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Circle Arrow Down icon (Lucide). https://lucide.dev/icons/circle-arrow-down */
export function CircleArrowDown(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M12 8v8"></path>
      <path d="m8 12 4 4 4-4"></path>
    </svg>
  );
}
