/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Heading 6 icon (Lucide). https://lucide.dev/icons/heading-6 */
export function Heading6(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M4 12h8"></path>
      <path d="M4 18V6"></path>
      <path d="M12 18V6"></path>
      <circle cx="19" cy="16" r="2"></circle>
      <path d="M20 10c-2 2-3 3.5-3 6"></path>
    </svg>
  );
}
