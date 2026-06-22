/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Between Vertical Start icon (Lucide). https://lucide.dev/icons/between-vertical-start */
export function BetweenVerticalStart(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="7" height="13" x="3" y="8" rx="1"></rect>
      <path d="m15 2-3 3-3-3"></path>
      <rect width="7" height="13" x="14" y="8" rx="1"></rect>
    </svg>
  );
}
