/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Arrow Up From Dot icon (Lucide). https://lucide.dev/icons/arrow-up-from-dot */
export function ArrowUpFromDot(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m5 9 7-7 7 7"></path>
      <path d="M12 16V2"></path>
      <circle cx="12" cy="21" r="1"></circle>
    </svg>
  );
}
