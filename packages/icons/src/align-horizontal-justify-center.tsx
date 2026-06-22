/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Align Horizontal Justify Center icon (Lucide). https://lucide.dev/icons/align-horizontal-justify-center */
export function AlignHorizontalJustifyCenter(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="6" height="14" x="2" y="5" rx="2"></rect>
      <rect width="6" height="10" x="16" y="7" rx="2"></rect>
      <path d="M12 2v20"></path>
    </svg>
  );
}
