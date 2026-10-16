import { supportTypes } from '@thesis/contracts';
// Access-code assistance is available before joining, not a guest support-menu choice.
export const supportLabels: Record<string, string> = {
  ...supportTypes,
  ACCESS_CODE: 'Cấp mã tham gia bàn',
};
