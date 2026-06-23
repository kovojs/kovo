/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** User Round Arrow Left icon (Lucide). https://lucide.dev/icons/user-round-arrow-left */
export function UserRoundArrowLeft(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m19 16-3 3"></path>
      <path d="M2 21a8 8 0 0 1 12.664-6.5"></path>
      <path d="M22 19h-6l3 3"></path>
      <circle cx="10" cy="8" r="5"></circle>
    </svg>
  );
}
