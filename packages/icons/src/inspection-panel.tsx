/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Inspection Panel icon (Lucide). https://lucide.dev/icons/inspection-panel */
export function InspectionPanel(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M7 7h.01"></path>
      <path d="M17 7h.01"></path>
      <path d="M7 17h.01"></path>
      <path d="M17 17h.01"></path>
    </svg>
  );
}
