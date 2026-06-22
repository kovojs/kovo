/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** User Round Check icon (Lucide). https://lucide.dev/icons/user-round-check */
export function UserRoundCheck(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M2 21a8 8 0 0 1 13.292-6"></path>
      <circle cx="10" cy="8" r="5"></circle>
      <path d="m16 19 2 2 4-4"></path>
    </svg>
  );
}
