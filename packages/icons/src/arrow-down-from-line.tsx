/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Arrow Down From Line icon (Lucide). https://lucide.dev/icons/arrow-down-from-line */
export function ArrowDownFromLine(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M19 3H5"></path>
      <path d="M12 21V7"></path>
      <path d="m6 15 6 6 6-6"></path>
    </svg>
  );
}
