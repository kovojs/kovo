/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Mouse Pointer icon (Lucide). https://lucide.dev/icons/mouse-pointer */
export function MousePointer(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12.586 12.586 19 19"></path>
      <path d="M3.688 3.037a.497.497 0 0 0-.651.651l6.5 15.999a.501.501 0 0 0 .947-.062l1.569-6.083a2 2 0 0 1 1.448-1.479l6.124-1.579a.5.5 0 0 0 .063-.947z"></path>
    </svg>
  );
}
