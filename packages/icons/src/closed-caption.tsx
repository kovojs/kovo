/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Closed Caption icon (Lucide). https://lucide.dev/icons/closed-caption */
export function ClosedCaption(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M10 9.17a3 3 0 1 0 0 5.66"></path>
      <path d="M17 9.17a3 3 0 1 0 0 5.66"></path>
      <rect x="2" y="5" width="20" height="14" rx="2"></rect>
    </svg>
  );
}
