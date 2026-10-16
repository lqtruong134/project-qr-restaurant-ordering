import Image from 'next/image';
import type { ReactNode } from 'react';
import { media } from '../../lib/media';
import './role-visual.css';

type WorkspaceRole = 'admin' | 'staff' | 'kitchen';

/** A compact photograph beside the existing operational heading. */
export function RoleVisual({ role, children }: { role: WorkspaceRole; children: ReactNode }) {
  const covers = (media as typeof media & { roleCovers?: Record<WorkspaceRole, string> })
    .roleCovers;
  return (
    <div className={`role-visual role-visual-${role}`}>
      <div className="role-visual-content">{children}</div>
      <div className="role-visual-photo" aria-hidden="true">
        <Image
          src={covers?.[role] ?? media.restaurantCover}
          alt=""
          fill
          loading="eager"
          sizes="(max-width: 600px) 80px, (max-width: 1000px) 160px, 240px"
        />
      </div>
    </div>
  );
}
