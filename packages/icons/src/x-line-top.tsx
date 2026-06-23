/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** X Line Top icon (Lucide). https://lucide.dev/icons/x-line-top */
export function XLineTop(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M18 4H6"></path>
      <path d="M18 8 6 20"></path>
      <path d="m6 8 12 12"></path>
    </svg>
  );
}
