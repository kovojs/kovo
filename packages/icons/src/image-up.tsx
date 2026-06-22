/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Image Up icon (Lucide). https://lucide.dev/icons/image-up */
export function ImageUp(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M10.3 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10l-3.1-3.1a2 2 0 0 0-2.814.014L6 21"></path>
      <path d="m14 19.5 3-3 3 3"></path>
      <path d="M17 22v-5.5"></path>
      <circle cx="9" cy="9" r="2"></circle>
    </svg>
  );
}
