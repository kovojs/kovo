/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** User Round X icon (Lucide). https://lucide.dev/icons/user-round-x */
export function UserRoundX(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M2 21a8 8 0 0 1 11.873-7"></path>
      <circle cx="10" cy="8" r="5"></circle>
      <path d="m17 17 5 5"></path>
      <path d="m22 17-5 5"></path>
    </svg>
  );
}
