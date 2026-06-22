/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Rows 2 icon (Lucide). https://lucide.dev/icons/rows-2 */
export function Rows2(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M3 12h18"></path>
    </svg>
  );
}
