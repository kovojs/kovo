/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Corner Up Left icon (Lucide). https://lucide.dev/icons/corner-up-left */
export function CornerUpLeft(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M20 20v-7a4 4 0 0 0-4-4H4"></path>
      <path d="M9 14 4 9l5-5"></path>
    </svg>
  );
}
