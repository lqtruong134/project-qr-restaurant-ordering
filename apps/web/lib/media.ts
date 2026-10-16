import { menuPhotoCredits } from '../../../packages/contracts/src/menu-photo-credits';
export const media = {
  logo: '/images/brand/logo.webp',
  guestWelcome: '/images/brand/guest-welcome.webp',
  dishPlaceholder: '/images/placeholders/dish.svg',
  restaurantCover: '/images/brand/restaurant-cover.webp',
  guestCover: '/images/banners/guest.webp',
  loginCover: '/images/brand/internal-login.webp',
  roleCovers: {
    admin: '/images/banners/admin.webp',
    staff: '/images/banners/staff.webp',
    kitchen: '/images/banners/kitchen.webp',
  },
  sources: '/images/SOURCES.md',
};

/** The product URL is authoritative. Missing or failed images use the shared placeholder. */
export function dishImage(uploaded?: unknown) {
  const url = typeof uploaded === 'string' ? uploaded.trim() : '';
  return url || media.dishPlaceholder;
}

export function photoCredits(url: unknown) {
  return typeof url === 'string' ? menuPhotoCredits[url.trim()] : undefined;
}
