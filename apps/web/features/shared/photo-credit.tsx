import { photoCredits } from '../../lib/media';
export function PhotoCredit({ url, className = '' }: { url: unknown; className?: string }) {
  const credit = photoCredits(url);
  if (!credit) return null;
  return (
    <small className={'dish-photo-credit ' + className}>
      Ảnh:{' '}
      <a href={credit.sourceUrl} target="_blank" rel="noopener noreferrer">
        {credit.author}
      </a>{' '}
      -{' '}
      <a href={credit.licenseUrl} target="_blank" rel="noopener noreferrer">
        {credit.license}
      </a>
    </small>
  );
}
