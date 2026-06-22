/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Undo Dot icon (Lucide). https://lucide.dev/icons/undo-dot */
export function UndoDot(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M21 17a9 9 0 0 0-15-6.7L3 13"></path>
      <path d="M3 7v6h6"></path>
      <circle cx="12" cy="17" r="1"></circle>
    </svg>
  );
}
