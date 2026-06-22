/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Arrows Up From Line icon (Lucide). https://lucide.dev/icons/arrows-up-from-line */
export function ArrowsUpFromLine(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m4 6 3-3 3 3"></path>
      <path d="M7 17V3"></path>
      <path d="m14 6 3-3 3 3"></path>
      <path d="M17 17V3"></path>
      <path d="M4 21h16"></path>
    </svg>
  );
}
