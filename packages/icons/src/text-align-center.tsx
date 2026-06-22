/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Text Align Center icon (Lucide). https://lucide.dev/icons/text-align-center */
export function TextAlignCenter(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M21 5H3"></path>
      <path d="M17 12H7"></path>
      <path d="M19 19H5"></path>
    </svg>
  );
}
