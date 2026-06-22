/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Dashed Bottom icon (Lucide). https://lucide.dev/icons/square-dashed-bottom */
export function SquareDashedBottom(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M5 21a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2"></path>
      <path d="M9 21h1"></path>
      <path d="M14 21h1"></path>
    </svg>
  );
}
