/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Grid 2x2 icon (Lucide). https://lucide.dev/icons/grid-2x2 */
export function Grid2x2(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 3v18"></path>
      <path d="M3 12h18"></path>
      <rect x="3" y="3" width="18" height="18" rx="2"></rect>
    </svg>
  );
}
