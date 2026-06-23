/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Arrow Left From Line icon (Lucide). https://lucide.dev/icons/arrow-left-from-line */
export function ArrowLeftFromLine(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m9 6-6 6 6 6"></path>
      <path d="M3 12h14"></path>
      <path d="M21 19V5"></path>
    </svg>
  );
}
