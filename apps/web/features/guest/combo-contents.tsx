import type { Product } from '../shared/components';

export function ComboContents({
  components,
  compact = false,
}: {
  components?: Product['components'];
  compact?: boolean;
}) {
  if (!components?.length) return null;
  if (compact)
    return (
      <p className="combo-contents-compact">
        {components.map((item) => `${item.quantity} × ${item.name}`).join(' · ')}
      </p>
    );
  return (
    <div className="combo-contents">
      <strong>Có trong combo</strong>
      <ul>
        {components.map((item) => (
          <li key={item.product_id}>
            <span>{item.name}</span>
            <strong>{item.quantity} phần</strong>
          </li>
        ))}
      </ul>
      <small>
        Thành phần cố định. Nếu cần đổi món hoặc có dị ứng, vui lòng hỏi nhân viên trước khi gọi.
      </small>
    </div>
  );
}
