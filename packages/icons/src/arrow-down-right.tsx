/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Arrow Down Right icon (Lucide). https://lucide.dev/icons/arrow-down-right */
export function ArrowDownRight(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m7 7 10 10"></path>
      <path d="M17 7v10H7"></path>
    </svg>
  );
}
