/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** File Axis 3d icon (Lucide). https://lucide.dev/icons/file-axis-3d */
export function FileAxis3d(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"></path>
      <path d="M14 2v5a1 1 0 0 0 1 1h5"></path>
      <path d="m8 18 4-4"></path>
      <path d="M8 10v8h8"></path>
    </svg>
  );
}
