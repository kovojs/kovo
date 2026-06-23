/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Folder Clock icon (Lucide). https://lucide.dev/icons/folder-clock */
export function FolderClock(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M16 14v2.2l1.6 1"></path>
      <path d="M7 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2"></path>
      <circle cx="16" cy="16" r="6"></circle>
    </svg>
  );
}
