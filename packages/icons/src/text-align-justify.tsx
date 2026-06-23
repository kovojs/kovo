/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Text Align Justify icon (Lucide). https://lucide.dev/icons/text-align-justify */
export function TextAlignJustify(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M3 5h18"></path>
      <path d="M3 12h18"></path>
      <path d="M3 19h18"></path>
    </svg>
  );
}
