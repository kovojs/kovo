/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Upload icon (Lucide). https://lucide.dev/icons/upload */
export function Upload(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 3v12"></path>
      <path d="m17 8-5-5-5 5"></path>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
    </svg>
  );
}
