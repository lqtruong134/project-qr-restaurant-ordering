'use client';
import { useState } from 'react';
import { Icon, Modal } from '../shared/primitives';
export function SessionCode({ code }: { code: string }) {
  const [info, setInfo] = useState(false);
  return (
    <>
      <div className="session-code">
        <span>
          <small>Mã vào bàn</small>
          <strong>{code}</strong>
        </span>
        <button
          type="button"
          className="icon-button"
          title="Lưu ý khi chia sẻ mã vào bàn"
          aria-label="Lưu ý khi chia sẻ mã vào bàn"
          onClick={() => setInfo(true)}
        >
          <Icon name="info" size={18} />
        </button>
      </div>
      {info && (
        <Modal title="Chia sẻ mã với người cùng bàn" close={() => setInfo(false)}>
          <p>Chỉ đọc mã cho người đang ngồi cùng bàn để họ tham gia và gọi món.</p>
          <p>
            Không gửi mã cho người ngoài bàn hoặc đăng công khai. Người có mã có thể thêm món vào
            hóa đơn của bàn.
          </p>
          <p>
            Mã chỉ dùng cho lượt khách hiện tại. Khi bàn kết thúc, lượt khách tiếp theo sẽ nhận mã
            mới.
          </p>
        </Modal>
      )}
    </>
  );
}
