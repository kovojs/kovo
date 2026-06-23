/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Archive X icon (Lucide). https://lucide.dev/icons/archive-x */
export function ArchiveX(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="20" height="5" x="2" y="3" rx="1"></rect>
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"></path>
      <path d="m9.5 17 5-5"></path>
      <path d="m9.5 12 5 5"></path>
    </svg>
  );
}
