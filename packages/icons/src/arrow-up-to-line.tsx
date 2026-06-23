/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Arrow Up To Line icon (Lucide). https://lucide.dev/icons/arrow-up-to-line */
export function ArrowUpToLine(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M5 3h14"></path>
      <path d="m18 13-6-6-6 6"></path>
      <path d="M12 7v14"></path>
    </svg>
  );
}
