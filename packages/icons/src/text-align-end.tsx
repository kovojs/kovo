/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Text Align End icon (Lucide). https://lucide.dev/icons/text-align-end */
export function TextAlignEnd(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M21 5H3"></path>
      <path d="M21 12H9"></path>
      <path d="M21 19H7"></path>
    </svg>
  );
}
