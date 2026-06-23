/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Rows 3 icon (Lucide). https://lucide.dev/icons/rows-3 */
export function Rows3(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M21 9H3"></path>
      <path d="M21 15H3"></path>
    </svg>
  );
}
