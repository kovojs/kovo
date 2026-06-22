/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Webcam icon (Lucide). https://lucide.dev/icons/webcam */
export function Webcam(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="10" r="8"></circle>
      <circle cx="12" cy="10" r="3"></circle>
      <path d="M7 22h10"></path>
      <path d="M12 22v-4"></path>
    </svg>
  );
}
