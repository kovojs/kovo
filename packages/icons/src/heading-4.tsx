/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Heading 4 icon (Lucide). https://lucide.dev/icons/heading-4 */
export function Heading4(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 18V6"></path>
      <path d="M17 10v3a1 1 0 0 0 1 1h3"></path>
      <path d="M21 10v8"></path>
      <path d="M4 12h8"></path>
      <path d="M4 18V6"></path>
    </svg>
  );
}
