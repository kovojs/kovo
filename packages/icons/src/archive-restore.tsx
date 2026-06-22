/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Archive Restore icon (Lucide). https://lucide.dev/icons/archive-restore */
export function ArchiveRestore(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="20" height="5" x="2" y="3" rx="1"></rect>
      <path d="M4 8v11a2 2 0 0 0 2 2h2"></path>
      <path d="M20 8v11a2 2 0 0 1-2 2h-2"></path>
      <path d="m9 15 3-3 3 3"></path>
      <path d="M12 12v9"></path>
    </svg>
  );
}
