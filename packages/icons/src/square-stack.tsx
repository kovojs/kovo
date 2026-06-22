/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Stack icon (Lucide). https://lucide.dev/icons/square-stack */
export function SquareStack(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M4 10c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2"></path>
      <path d="M10 16c-1.1 0-2-.9-2-2v-4c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2"></path>
      <rect width="8" height="8" x="14" y="14" rx="2"></rect>
    </svg>
  );
}
