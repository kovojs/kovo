/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Id Card icon (Lucide). https://lucide.dev/icons/id-card */
export function IdCard(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M16 10h2"></path>
      <path d="M16 14h2"></path>
      <path d="M6.17 15a3 3 0 0 1 5.66 0"></path>
      <circle cx="9" cy="11" r="2"></circle>
      <rect x="2" y="5" width="20" height="14" rx="2"></rect>
    </svg>
  );
}
