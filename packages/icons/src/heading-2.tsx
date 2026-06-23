/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Heading 2 icon (Lucide). https://lucide.dev/icons/heading-2 */
export function Heading2(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M4 12h8"></path>
      <path d="M4 18V6"></path>
      <path d="M12 18V6"></path>
      <path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"></path>
    </svg>
  );
}
