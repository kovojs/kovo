/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** User Round Minus icon (Lucide). https://lucide.dev/icons/user-round-minus */
export function UserRoundMinus(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M2 21a8 8 0 0 1 13.292-6"></path>
      <circle cx="10" cy="8" r="5"></circle>
      <path d="M22 19h-6"></path>
    </svg>
  );
}
