/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Briefcase Business icon (Lucide). https://lucide.dev/icons/briefcase-business */
export function BriefcaseBusiness(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 12h.01"></path>
      <path d="M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"></path>
      <path d="M22 13a18.15 18.15 0 0 1-20 0"></path>
      <rect width="20" height="14" x="2" y="6" rx="2"></rect>
    </svg>
  );
}
