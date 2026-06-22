/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Corner Right Up icon (Lucide). https://lucide.dev/icons/corner-right-up */
export function CornerRightUp(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m10 9 5-5 5 5"></path>
      <path d="M4 20h7a4 4 0 0 0 4-4V4"></path>
    </svg>
  );
}
