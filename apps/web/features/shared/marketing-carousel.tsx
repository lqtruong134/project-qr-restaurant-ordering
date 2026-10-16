'use client';
import { useEffect, useState, type CSSProperties } from 'react';
import { Icon } from './primitives';
import { PhotoCredit } from './photo-credit';

export type MarketingSlide = {
  id: string;
  image: string;
  imageWidth?: number;
  imageHeight?: number;
  alt: string;
  eyebrow: string;
  title: string;
  description?: string;
  actionLabel?: string;
  href?: string;
  target?: string;
  imageNote?: string;
  presentation?: 'poster';
};

/** Promotion copy lives in HTML so replacing a photograph never changes menu prices. */
export function MarketingCarousel({
  slides,
  onSelect,
  label = 'Gợi ý từ thực đơn',
  className = '',
}: {
  slides: MarketingSlide[];
  onSelect?: (target: string) => void;
  label?: string;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [selection, setSelection] = useState(0);
  const [jumping, setJumping] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const visual = slides.length > 1 ? Math.min(index, slides.length) : 0;
  const active = visual === slides.length ? 0 : visual;
  const trackSlides = slides.length > 1 ? [...slides, slides[0]!] : slides;
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotion = () => setReducedMotion(motion.matches);
    const syncVisibility = () => setHidden(document.hidden);
    syncMotion();
    syncVisibility();
    motion.addEventListener('change', syncMotion);
    document.addEventListener('visibilitychange', syncVisibility);
    return () => {
      motion.removeEventListener('change', syncMotion);
      document.removeEventListener('visibilitychange', syncVisibility);
    };
  }, []);
  useEffect(() => {
    if (slides.length < 2 || reducedMotion || hidden) return;
    const timer = setTimeout(() => {
      setIndex((current) => (current >= slides.length ? 1 : current + 1));
    }, 3000);
    return () => clearTimeout(timer);
  }, [active, selection, slides.length, reducedMotion, hidden]);
  useEffect(() => {
    if (slides.length < 2 || index < slides.length) return;
    const timer = setTimeout(
      () => {
        setJumping(true);
        setIndex(0);
      },
      reducedMotion ? 0 : 650,
    );
    return () => clearTimeout(timer);
  }, [index, slides.length, reducedMotion]);
  useEffect(() => {
    if (!jumping) return;
    let secondFrame = 0;
    const frame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setJumping(false));
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(secondFrame);
    };
  }, [jumping]);
  if (!slides.length) return null;
  const select = (next: number) => {
    setSelection((current) => current + 1);
    setIndex((next + slides.length) % slides.length);
  };
  return (
    <section
      className={'marketing-carousel ' + className}
      aria-label={label}
      aria-roledescription="trình chiếu"
      data-reduced-motion={reducedMotion}
    >
      <div className="marketing-carousel-window">
        <div
          className="marketing-carousel-track"
          data-jumping={jumping}
          style={{ transform: `translateX(-${visual * 100}%)` }}
        >
          {trackSlides.map((slide, slideIndex) => (
            <article
              className="marketing-slide"
              data-presentation={slide.presentation ?? 'photo'}
              data-clone={slideIndex === slides.length ? true : undefined}
              key={slide.id + (slideIndex === slides.length ? '-loop' : '')}
              style={
                {
                  '--slide-offset': `${slideIndex * 100}%`,
                  '--promotion-aspect-ratio':
                    (slide.imageWidth ?? 1600) / (slide.imageHeight ?? 800),
                } as CSSProperties
              }
              aria-hidden={slideIndex !== visual}
              inert={slideIndex !== visual}
              aria-label={`${slideIndex === slides.length ? 1 : slideIndex + 1} / ${slides.length}`}
              aria-roledescription="ảnh giới thiệu"
            >
              <div className="marketing-slide-photo">
                {!failed[slide.id] && (
                  <img
                    src={slide.image}
                    alt={slide.alt}
                    width={slide.imageWidth ?? 1600}
                    height={slide.imageHeight ?? 800}
                    decoding="async"
                    loading={slideIndex === 0 ? 'eager' : 'lazy'}
                    fetchPriority={slideIndex === 0 ? 'high' : 'auto'}
                    onError={() => setFailed((values) => ({ ...values, [slide.id]: true }))}
                  />
                )}
              </div>
              <div className="marketing-slide-copy">
                <div className="marketing-slide-details">
                  <p className="eyebrow">{slide.eyebrow}</p>
                  <h2>{slide.title}</h2>
                  {slide.description && <p>{slide.description}</p>}
                </div>
                {slide.actionLabel && slide.target && onSelect ? (
                  <button
                    className="marketing-slide-action"
                    onClick={() => {
                      onSelect(slide.target!);
                    }}
                  >
                    {slide.actionLabel} <Icon name="arrow" size={17} />
                  </button>
                ) : slide.actionLabel && slide.href ? (
                  <a className="marketing-slide-action" href={slide.href}>
                    {slide.actionLabel} <Icon name="arrow" size={17} />
                  </a>
                ) : null}
              </div>
              <PhotoCredit url={slide.image} className="marketing-slide-photo-credit" />
              {slide.imageNote && (
                <small className="marketing-slide-image-note">{slide.imageNote}</small>
              )}
            </article>
          ))}
        </div>
      </div>
      {slides.length > 1 && (
        <div className="marketing-carousel-controls">
          <div className="marketing-carousel-dots" role="group" aria-label="Chọn ảnh giới thiệu">
            {slides.map((slide, slideIndex) => (
              <button
                key={slide.id}
                aria-label={`Xem ảnh ${slideIndex + 1}: ${slide.title}`}
                aria-pressed={slideIndex === active}
                onClick={() => select(slideIndex)}
              >
                <span />
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
