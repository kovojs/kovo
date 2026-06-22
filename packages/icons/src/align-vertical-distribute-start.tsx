/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Align Vertical Distribute Start icon (Lucide). https://lucide.dev/icons/align-vertical-distribute-start */
export function AlignVerticalDistributeStart(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="14" height="6" x="5" y="14" rx="2"></rect>
      <rect width="10" height="6" x="7" y="4" rx="2"></rect>
      <path d="M2 14h20"></path>
      <path d="M2 4h20"></path>
    </svg>
  );
}
