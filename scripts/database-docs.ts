import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createDatabase } from '../packages/database/src/index.js';

const db = createDatabase(process.env.DATABASE_URL!);
const esc = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const cell = (s: string | null) => (s ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' ');
try {
  const tables = (
    await db.pool.query<{ name: string; description: string | null }>(
      `SELECT c.relname name,obj_description(c.oid) description FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname<>'_prisma_migrations' ORDER BY c.relname`,
    )
  ).rows;
  if (tables.length !== 45) throw new Error('Expected exactly 45 business tables');
  const md = [
    '# Từ điển dữ liệu vật lý — 45 bảng',
    '',
    'Sinh từ metadata PostgreSQL bằng `pnpm docs:database`, không chứa bản ghi nghiệp vụ hay thông tin đăng nhập. Kiểu, giá trị mặc định và các ràng buộc bên dưới lấy trực tiếp từ database đã migrate.',
    '',
    'Đường nối sơ đồ là khóa ngoại thực tế. Đầu cha là `1` nếu toàn bộ cột tham chiếu bắt buộc, ngược lại là `0..1`; đầu con là `0..1` khi có khóa duy nhất toàn phần phù hợp, ngược lại là `0..N`. Unique có điều kiện chỉ giới hạn tập con (ví dụ phiên đang mở), không biến quan hệ lịch sử thành 1:1. CHECK bổ sung cần đọc ở từng bảng.',
    '',
  ];
  const dot = [
    'digraph ERD {',
    'graph [rankdir=LR,bgcolor="#fafbf8",pad="0.5",nodesep="0.55",ranksep="1.3",label="QR RESTAURANT • PHYSICAL ERD • 45 TABLES",labelloc=t,fontname="DejaVu Sans",fontsize=22];',
    'node [shape=plain,fontname="DejaVu Sans"];',
    'edge [color="#638478",fontname="DejaVu Sans",fontsize=9,arrowsize=0.6,labeldistance=2.5];',
  ];
  for (const table of tables) {
    const cols = (
      await db.pool.query<{
        name: string;
        type: string;
        required: boolean;
        default_value: string | null;
        description: string | null;
        pk: boolean;
        fk: boolean;
      }>(
        `SELECT a.attname name,format_type(a.atttypid,a.atttypmod) type,a.attnotnull required,pg_get_expr(d.adbin,d.adrelid) default_value,col_description(a.attrelid,a.attnum) description,
       EXISTS(SELECT 1 FROM pg_constraint k WHERE k.conrelid=a.attrelid AND k.contype='p' AND a.attnum=ANY(k.conkey)) pk,
       EXISTS(SELECT 1 FROM pg_constraint k WHERE k.conrelid=a.attrelid AND k.contype='f' AND a.attnum=ANY(k.conkey)) fk
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,
        [table.name],
      )
    ).rows;
    const constraints = (
      await db.pool.query<{ name: string; definition: string }>(
        'SELECT conname name,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid=$1::regclass ORDER BY contype,conname',
        [table.name],
      )
    ).rows;
    const indexes = (
      await db.pool.query<{ indexdef: string }>(
        "SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1 ORDER BY indexname",
        [table.name],
      )
    ).rows;
    md.push(
      '## ' + table.name,
      '',
      table.description ?? '',
      '',
      '| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |',
      '|---|---|---|---|---|---|',
    );
    for (const c of cols)
      md.push(
        `| ${c.name} | ${c.type} | ${c.required ? 'Có' : 'Không'} | ${[c.pk ? 'PK' : '', c.fk ? 'FK' : ''].filter(Boolean).join(', ')} | ${cell(c.default_value)} | ${cell(c.description)} |`,
      );
    md.push(
      '',
      '### Ràng buộc',
      '```sql',
      ...constraints.map((c) => c.name + ': ' + c.definition),
      '```',
      '',
      '### Chỉ mục',
      '```sql',
      ...indexes.map((i) => i.indexdef + ';'),
      '```',
      '',
    );
    dot.push(
      '"' +
        table.name +
        '" [label=<<TABLE BORDER="0" CELLBORDER="1" CELLSPACING="0" CELLPADDING="5" COLOR="#b7c8bd"><TR><TD COLSPAN="2" BGCOLOR="#21583e"><FONT COLOR="white"><B>' +
        esc(table.name) +
        '</B></FONT></TD></TR>' +
        cols
          .map(
            (c) =>
              '<TR><TD ALIGN="LEFT" BGCOLOR="white">' +
              esc(c.name) +
              (c.pk ? ' [PK]' : '') +
              (c.fk ? ' [FK]' : '') +
              '</TD><TD ALIGN="LEFT" BGCOLOR="white">' +
              esc(c.type) +
              (c.required ? '' : ' ?') +
              '</TD></TR>',
          )
          .join('') +
        '</TABLE>>];',
    );
    const fks = (
      await db.pool.query<{
        target: string;
        columns: string;
        required: boolean;
        unique_child: boolean;
        definition: string;
      }>(
        `SELECT k.confrelid::regclass::text target,pg_get_constraintdef(k.oid) definition,
       (SELECT string_agg(a.attname,', ' ORDER BY u.ord) FROM unnest(k.conkey) WITH ORDINALITY u(num,ord) JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=u.num) columns,
       (SELECT bool_and(a.attnotnull) FROM pg_attribute a WHERE a.attrelid=k.conrelid AND a.attnum=ANY(k.conkey)) required,
       EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=k.conrelid AND i.indisunique AND i.indisvalid AND i.indpred IS NULL AND i.indexprs IS NULL AND ARRAY(SELECT x.num FROM unnest(i.indkey) WITH ORDINALITY x(num,ord) WHERE x.ord<=i.indnkeyatts)::smallint[] <@ k.conkey) unique_child
       FROM pg_constraint k WHERE k.conrelid=$1::regclass AND k.contype='f' ORDER BY k.conname`,
        [table.name],
      )
    ).rows;
    for (const fk of fks)
      dot.push(
        '"' +
          fk.target +
          '" -> "' +
          table.name +
          '" [taillabel="' +
          (fk.required ? '1' : '0..1') +
          '",headlabel="' +
          (fk.unique_child ? '0..1' : '0..N') +
          '",label="' +
          fk.columns +
          '",tooltip="' +
          esc(fk.definition) +
          '"];',
      );
  }
  dot.push(
    'legend [label="? nullable • PK/FK from database constraints\nPartial unique limits active rows, not all history",shape=box,fontname="DejaVu Sans",fontsize=12];',
    '}',
  );
  writeFileSync('docs/database/data-dictionary.md', md.join('\n').trimEnd() + '\n');
  writeFileSync('docs/database/physical.dot', dot.join('\n') + '\n');
  execFileSync('dot', ['-Tsvg', 'docs/database/physical.dot', '-o', 'docs/database/physical.svg']);
  console.log('Exported data dictionary and physical ERD from 45 live tables.');
} finally {
  await db.close();
}
