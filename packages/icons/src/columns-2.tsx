/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Columns 2 icon (Lucide). https://lucide.dev/icons/columns-2 */
export function Columns2(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M12 3v18"></path>
    </svg>
  );
}
