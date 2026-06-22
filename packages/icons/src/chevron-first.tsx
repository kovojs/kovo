/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Chevron First icon (Lucide). https://lucide.dev/icons/chevron-first */
export function ChevronFirst(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m17 18-6-6 6-6"></path>
      <path d="M7 6v12"></path>
    </svg>
  );
}
