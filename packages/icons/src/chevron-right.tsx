/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Chevron Right icon (Lucide). https://lucide.dev/icons/chevron-right */
export function ChevronRight(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m9 18 6-6-6-6"></path>
    </svg>
  );
}
