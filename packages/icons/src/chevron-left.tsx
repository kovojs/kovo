/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Chevron Left icon (Lucide). https://lucide.dev/icons/chevron-left */
export function ChevronLeft(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m15 18-6-6 6-6"></path>
    </svg>
  );
}
