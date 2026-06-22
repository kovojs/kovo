/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Link 2 icon (Lucide). https://lucide.dev/icons/link-2 */
export function Link2(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M9 17H7A5 5 0 0 1 7 7h2"></path>
      <path d="M15 7h2a5 5 0 1 1 0 10h-2"></path>
      <line x1="8" x2="16" y1="12" y2="12"></line>
    </svg>
  );
}
