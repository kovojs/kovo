/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** User Round Search icon (Lucide). https://lucide.dev/icons/user-round-search */
export function UserRoundSearch(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="10" cy="8" r="5"></circle>
      <path d="M2 21a8 8 0 0 1 10.434-7.62"></path>
      <circle cx="18" cy="18" r="3"></circle>
      <path d="m22 22-1.9-1.9"></path>
    </svg>
  );
}
