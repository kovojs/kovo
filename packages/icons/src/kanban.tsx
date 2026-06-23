/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Kanban icon (Lucide). https://lucide.dev/icons/kanban */
export function Kanban(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M5 3v14"></path>
      <path d="M12 3v8"></path>
      <path d="M19 3v18"></path>
    </svg>
  );
}
