/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Baseline icon (Lucide). https://lucide.dev/icons/baseline */
export function Baseline(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M4 20h16"></path>
      <path d="m6 16 6-12 6 12"></path>
      <path d="M8 12h8"></path>
    </svg>
  );
}
