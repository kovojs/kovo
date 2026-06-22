/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Cigarette Off icon (Lucide). https://lucide.dev/icons/cigarette-off */
export function CigaretteOff(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 12H3a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h13"></path>
      <path d="M18 8c0-2.5-2-2.5-2-5"></path>
      <path d="m2 2 20 20"></path>
      <path d="M21 12a1 1 0 0 1 1 1v2a1 1 0 0 1-.5.866"></path>
      <path d="M22 8c0-2.5-2-2.5-2-5"></path>
      <path d="M7 12v4"></path>
    </svg>
  );
}
