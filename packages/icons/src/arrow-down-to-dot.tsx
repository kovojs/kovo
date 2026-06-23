/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Arrow Down To Dot icon (Lucide). https://lucide.dev/icons/arrow-down-to-dot */
export function ArrowDownToDot(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 2v14"></path>
      <path d="m19 9-7 7-7-7"></path>
      <circle cx="12" cy="21" r="1"></circle>
    </svg>
  );
}
