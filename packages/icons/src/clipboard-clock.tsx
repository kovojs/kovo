/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Clipboard Clock icon (Lucide). https://lucide.dev/icons/clipboard-clock */
export function ClipboardClock(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M16 14v2.2l1.6 1"></path>
      <path d="M16 4h2a2 2 0 0 1 2 2v.832"></path>
      <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h2"></path>
      <circle cx="16" cy="16" r="6"></circle>
      <rect x="8" y="2" width="8" height="4" rx="1"></rect>
    </svg>
  );
}
