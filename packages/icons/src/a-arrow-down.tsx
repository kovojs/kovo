/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** A Arrow Down icon (Lucide). https://lucide.dev/icons/a-arrow-down */
export function AArrowDown(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m14 12 4 4 4-4"></path>
      <path d="M18 16V7"></path>
      <path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16"></path>
      <path d="M3.304 13h6.392"></path>
    </svg>
  );
}
