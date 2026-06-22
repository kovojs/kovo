/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Chevron Up icon (Lucide). https://lucide.dev/icons/chevron-up */
export function ChevronUp(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m18 15-6-6-6 6"></path>
    </svg>
  );
}
