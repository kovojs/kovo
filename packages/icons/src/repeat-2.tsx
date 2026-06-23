/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Repeat 2 icon (Lucide). https://lucide.dev/icons/repeat-2 */
export function Repeat2(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m2 9 3-3 3 3"></path>
      <path d="M13 18H7a2 2 0 0 1-2-2V6"></path>
      <path d="m22 15-3 3-3-3"></path>
      <path d="M11 6h6a2 2 0 0 1 2 2v10"></path>
    </svg>
  );
}
