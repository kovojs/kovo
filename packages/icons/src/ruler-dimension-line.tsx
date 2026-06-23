/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Ruler Dimension Line icon (Lucide). https://lucide.dev/icons/ruler-dimension-line */
export function RulerDimensionLine(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M10 15v-3"></path>
      <path d="M14 15v-3"></path>
      <path d="M18 15v-3"></path>
      <path d="M2 8V4"></path>
      <path d="M22 6H2"></path>
      <path d="M22 8V4"></path>
      <path d="M6 15v-3"></path>
      <rect x="2" y="12" width="20" height="8" rx="2"></rect>
    </svg>
  );
}
