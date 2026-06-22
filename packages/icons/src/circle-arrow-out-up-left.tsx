/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Circle Arrow Out Up Left icon (Lucide). https://lucide.dev/icons/circle-arrow-out-up-left */
export function CircleArrowOutUpLeft(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M2 8V2h6"></path>
      <path d="m2 2 10 10"></path>
      <path d="M12 2A10 10 0 1 1 2 12"></path>
    </svg>
  );
}
