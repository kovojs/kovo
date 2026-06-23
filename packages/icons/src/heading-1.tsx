/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Heading 1 icon (Lucide). https://lucide.dev/icons/heading-1 */
export function Heading1(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M4 12h8"></path>
      <path d="M4 18V6"></path>
      <path d="M12 18V6"></path>
      <path d="m17 12 3-2v8"></path>
    </svg>
  );
}
