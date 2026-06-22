/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Arrow Down A Z icon (Lucide). https://lucide.dev/icons/arrow-down-a-z */
export function ArrowDownAZ(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m3 16 4 4 4-4"></path>
      <path d="M7 20V4"></path>
      <path d="M20 8h-5"></path>
      <path d="M15 10V6.5a2.5 2.5 0 0 1 5 0V10"></path>
      <path d="M15 14h5l-5 6h5"></path>
    </svg>
  );
}
