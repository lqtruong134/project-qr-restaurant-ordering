import { describe, expect, it } from 'vitest';
import { validateDatabaseDocumentationTables } from '../../../scripts/database-doc-inventory';

const schema = `model Product {
  id String @id
  @@map("product")
}
model menu_promotion {
  id String @id
}
model Outside {
  id String @id
  @@schema("archive")
}`;
describe('database documentation physical catalogue', () => {
  it('derives table names from the current schema and supports mapped names without a fixed count', () => {
    expect(validateDatabaseDocumentationTables(['menu_promotion', 'product'], schema)).toBe(2);
    expect(
      validateDatabaseDocumentationTables(['product'], schema.split('model menu_promotion')[0]!),
    ).toBe(1);
  });
  it('refuses missing migrations and extra shadow catalogues before exporting documentation', () => {
    expect(() => validateDatabaseDocumentationTables(['product'], schema)).toThrow(
      'Thiếu bảng: menu_promotion',
    );
    expect(() =>
      validateDatabaseDocumentationTables(['product', 'menu_promotion', 'product_shadow'], schema),
    ).toThrow('Bảng ngoài schema: product_shadow');
    expect(() => validateDatabaseDocumentationTables([], '')).toThrow('Không tìm thấy model');
  });
});
