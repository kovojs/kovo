/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Arrow Left To Line icon (Lucide). https://lucide.dev/icons/arrow-left-to-line */
export function ArrowLeftToLine(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M3 19V5"></path>
      <path d="m13 6-6 6 6 6"></path>
      <path d="M7 12h14"></path>
    </svg>
  );
}
