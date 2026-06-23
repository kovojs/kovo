/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Workflow icon (Lucide). https://lucide.dev/icons/workflow */
export function Workflow(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="8" height="8" x="3" y="3" rx="2"></rect>
      <path d="M7 11v4a2 2 0 0 0 2 2h4"></path>
      <rect width="8" height="8" x="13" y="13" rx="2"></rect>
    </svg>
  );
}
