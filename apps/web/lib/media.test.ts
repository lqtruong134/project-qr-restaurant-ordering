import { describe, expect, it } from 'vitest';
import { dishImage, media, photoCredits } from './media';
describe('database-owned dish images', () => {
  it('uses the stored URL and displays a placeholder when the product has no image', () => {
    const url = '/api/menu-images/12345678-1234-4234-8234-123456789abc.webp';
    expect(dishImage(url)).toBe(url);
    expect(dishImage(null)).toBe(media.dishPlaceholder);
    expect(dishImage('')).toBe(media.dishPlaceholder);
    expect(dishImage('   ')).toBe(media.dishPlaceholder);
  });
  it('keeps only site identity and placeholders in fixed client media configuration', () => {
    expect('menuPromotions' in media).toBe(false);
    expect(media.logo).toBe('/images/brand/logo.webp');
    expect(media.dishPlaceholder).toBe('/images/placeholders/dish.svg');
  });
  it('keeps required photo credits after product renames and does not attribute unrelated uploads', () => {
    expect(photoCredits('/api/menu-images/5c63ea2f-6d20-8157-9fdd-366d32a1f0dc.jpg')?.author).toBe(
      'Takeaway',
    );
    expect(photoCredits('/api/menu-images/ba74d017-10ce-80b2-bf7f-23ffc334dffb.jpg')?.author).toBe(
      'Jpatokal',
    );
    expect(
      photoCredits('/api/menu-images/89834677-fcc4-8a5c-adea-125ce567ca1c.jpg')?.sourceUrl,
    ).toContain('/how-to-make-thit-heo-kho-voi-trung-');
    expect(
      photoCredits('/api/menu-images/12345678-1234-4234-8234-123456789abc.webp'),
    ).toBeUndefined();
    expect(photoCredits(null)).toBeUndefined();
  });
});
