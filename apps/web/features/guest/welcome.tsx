'use client';
import { useState } from 'react';
import { Icon, Empty } from '../shared/primitives';
import { JoinForm } from './join-form';
import { media } from '../../lib/media';

export function GuestWelcome({
  token,
  table,
  loading,
  error,
  showPolicy,
  joined,
}: {
  token: string;
  table?: { table_name: string; area_name: string };
  loading: boolean;
  error: string;
  showPolicy: () => void;
  joined: () => Promise<void>;
}) {
  const [photoFailed, setPhotoFailed] = useState(false);
  return (
    <section className="guest-welcome guest-welcome-refresh">
      <div className="guest-welcome-scene">
        {!photoFailed && (
          <img
            src={media.guestWelcome}
            alt="Bữa ăn Việt với các món nóng và rau tươi dùng chung tại bàn"
            width={1200}
            height={1400}
            decoding="async"
            fetchPriority="high"
            onError={() => setPhotoFailed(true)}
          />
        )}
        <div className="guest-welcome-story">
          <p className="eyebrow">QUYẾT TRƯỜNG BISTRO</p>
          <h1>
            Món Việt ngon.
            <br />
            Bữa ăn cùng nhau.
          </h1>
          <p>Mời bạn chọn món. Bếp sẽ lo phần còn lại.</p>
          <span>
            <Icon name="leaf" size={17} /> Từ món cuốn đến bữa cơm, nồi lẩu dùng chung.
          </span>
        </div>
      </div>
      <div className="guest-welcome-panel">
        {table && (
          <div className="guest-welcome-table">
            <Icon name="table" size={22} />
            <div>
              <strong>{table.table_name}</strong>
              <small>{table.area_name}</small>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {loading ? (
          <p role="status" className="guest-welcome-loading">
            Đang kiểm tra thông tin bàn…
          </p>
        ) : token && table ? (
          <>
            <p className="guest-welcome-intro">
              Để gọi món, nhập tên và mã 4 số của bàn. Không cần tạo tài khoản.
            </p>
            <JoinForm token={token} showPolicy={showPolicy} joined={joined} />
          </>
        ) : (
          <>
            <Empty title="Quét QR tại bàn để bắt đầu" icon="table">
              Mở camera và quét mã đặt trên bàn. Nhân viên luôn sẵn sàng hỗ trợ bạn.
            </Empty>
            <a className="secondary-button guest-welcome-home" href="/">
              Khám phá món Việt <Icon name="arrow" size={17} />
            </a>
          </>
        )}
      </div>
    </section>
  );
}
