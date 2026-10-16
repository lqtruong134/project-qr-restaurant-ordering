/** Refuse to export an incomplete or extra physical catalogue as the application's schema. */
export function validateDatabaseDocumentationTables(
  tableNames: readonly string[],
  schemaSource: string,
): number {
  const expected = Array.from(
    schemaSource.matchAll(/^model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)^\}/gm),
    ([, modelName, definition]) => {
      const mapped = definition!.match(/@@map\(\s*("(?:[^"\\]|\\.)*")\s*\)/)?.[1];
      const namespace = definition!.match(/@@schema\(\s*"([^"]+)"\s*\)/)?.[1];
      return namespace && namespace !== 'public'
        ? null
        : mapped
          ? (JSON.parse(mapped) as string)
          : modelName!;
    },
  ).filter((name): name is string => name !== null);
  if (!expected.length) throw new Error('Không tìm thấy model nghiệp vụ trong schema.prisma.');
  const wanted = new Set(expected);
  const actual = new Set(tableNames);
  if (wanted.size !== expected.length || actual.size !== tableNames.length)
    throw new Error('Danh sách bảng vật lý có tên trùng nhau; chưa xuất tài liệu.');
  const missing = expected.filter((name) => !actual.has(name));
  const extra = tableNames.filter((name) => !wanted.has(name));
  if (missing.length || extra.length)
    throw new Error(
      'Metadata public chưa khớp schema.prisma; chưa xuất tài liệu.' +
        (missing.length ? ' Thiếu bảng: ' + missing.join(', ') + '.' : '') +
        (extra.length ? ' Bảng ngoài schema: ' + extra.join(', ') + '.' : ''),
    );
  return tableNames.length;
}
