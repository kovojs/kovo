/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Redo Dot icon (Lucide). https://lucide.dev/icons/redo-dot */
export function RedoDot(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="17" r="1"></circle>
      <path d="M21 7v6h-6"></path>
      <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"></path>
    </svg>
  );
}
