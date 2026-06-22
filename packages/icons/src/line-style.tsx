/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Line Style icon (Lucide). https://lucide.dev/icons/line-style */
export function LineStyle(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M11 5h2"></path>
      <path d="M15 12h6"></path>
      <path d="M19 5h2"></path>
      <path d="M3 12h6"></path>
      <path d="M3 19h18"></path>
      <path d="M3 5h2"></path>
    </svg>
  );
}
