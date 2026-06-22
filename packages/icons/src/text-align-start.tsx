/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Text Align Start icon (Lucide). https://lucide.dev/icons/text-align-start */
export function TextAlignStart(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M21 5H3"></path>
      <path d="M15 12H3"></path>
      <path d="M17 19H3"></path>
    </svg>
  );
}
