/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** User Round Key icon (Lucide). https://lucide.dev/icons/user-round-key */
export function UserRoundKey(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M19 11v6"></path>
      <path d="M19 13h2"></path>
      <path d="M2 21a8 8 0 0 1 12.868-6.349"></path>
      <circle cx="10" cy="8" r="5"></circle>
      <circle cx="19" cy="19" r="2"></circle>
    </svg>
  );
}
