'use client';
import { useState } from 'react';
import { PhotoCredit } from './photo-credit';
import { dishImage, media, photoCredits } from '../../lib/media';

export function DishImage({
  name,
  url,
  className,
  eager = false,
  poster = false,
}: {
  code: string;
  name: string;
  url?: unknown;
  className?: string;
  eager?: boolean;
  poster?: boolean;
}) {
  const source = dishImage(url);
  const [failed, setFailed] = useState('');
  const fallback = source === media.dishPlaceholder || source === failed;
  const credited = !fallback && Boolean(photoCredits(source));
  const visual = (
    <span
      className={'dish-media ' + (credited ? 'dish-media-credited ' : '') + (className || '')}
      data-placeholder={fallback}
      data-poster={!fallback && poster}
    >
      <img
        src={fallback ? media.dishPlaceholder : source}
        alt={fallback ? 'Chưa có ảnh thật của ' + name : name}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        width={640}
        height={480}
        onError={() => {
          if (!fallback) setFailed(source);
        }}
      />
      {fallback && <span className="photo-placeholder-label">Ảnh đang cập nhật</span>}
    </span>
  );
  return credited ? (
    <span className="dish-credit-frame">
      {visual}
      <PhotoCredit url={source} />
    </span>
  ) : (
    visual
  );
}
