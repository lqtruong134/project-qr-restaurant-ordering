import {
  demoIngredients,
  demoMenu,
  demoStaff,
  ingredientLocation as existingIngredientLocation,
  restaurantCombos,
} from './demo-data.js';
import { restaurantProductCategoryIndex } from './menu-categories.js';
export {
  restaurantCategories,
  restaurantCategorySortOrder,
  restaurantProductCategoryCodes,
} from './menu-categories.js';
import {
  restaurantCatalogIngredientLocation,
  restaurantCatalogIngredients,
  restaurantCatalogMenu,
} from './restaurant-catalog-extension.js';

/** One canonical catalogue; bootstrap and administrative writes use the same database entities. */
export const restaurantStaff = demoStaff;
export const restaurantIngredients = [...demoIngredients, ...restaurantCatalogIngredients];
export const restaurantMenu = [...demoMenu, ...restaurantCatalogMenu].map((dish) => ({
  ...dish,
  category: restaurantProductCategoryIndex(dish.code),
}));
const newIngredientCodes = new Set<string>(restaurantCatalogIngredients.map((row) => row[0]));
export const restaurantIngredientLocation = (code: string) =>
  newIngredientCodes.has(code)
    ? restaurantCatalogIngredientLocation(code)
    : existingIngredientLocation(code);
export { restaurantCombos };
