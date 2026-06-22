/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Heading 3 icon (Lucide). https://lucide.dev/icons/heading-3 */
export function Heading3(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M4 12h8"></path>
      <path d="M4 18V6"></path>
      <path d="M12 18V6"></path>
      <path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2"></path>
      <path d="M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2"></path>
    </svg>
  );
}
