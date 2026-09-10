'use client';
import {useEffect,useState,use} from 'react';
import Link from 'next/link';
type User={displayName:string;role:string;permissions:string[]};
const labels:Record<string,string>={staff:'Không gian nhân viên',kitchen:'Không gian bếp',admin:'Không gian quản trị'};
export default function Workspace({params}:{params:Promise<{area:string}>}){
 const {area}=use(params);const [user,setUser]=useState<User>();const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;
  async function load(){try{let res=await fetch('/api/workspaces/'+encodeURIComponent(area));
   if(res.status===401){const renew=await fetch('/api/auth/refresh',{method:'POST',headers:{'X-CSRF-Protection':'1'}});if(renew.ok)res=await fetch('/api/workspaces/'+encodeURIComponent(area));else{window.location.assign('/login');return;}}
   const data=await res.json();if(active){if(!res.ok)setError(data.userMessage??'Không tìm thấy chức năng.');else setUser(data.user);}
  }catch{if(active)setError('Chưa kết nối được máy chủ. Vui lòng tải lại trang.');}}
  void load();return()=>{active=false;};
 },[area]);
 async function logout(){setBusy(true);try{const res=await fetch('/api/auth/logout',{method:'POST',headers:{'X-CSRF-Protection':'1'}});if(res.ok)window.location.assign('/login');else setError('Chưa đăng xuất được. Vui lòng thử lại.');}catch{setError('Chưa kết nối được máy chủ.');}finally{setBusy(false);}}
 return <main className="workspace-shell"><header className="workspace-header"><Link href="/" className="brand-link">AN NHIÊN · QR ORDERING</Link><button className="secondary-button" onClick={logout} disabled={busy}>{busy?'Đang đăng xuất…':'Đăng xuất'}</button></header><section className="workspace-content"><p className="eyebrow">CA LÀM VIỆC CỦA BẠN</p><h1>{labels[area]??'Không gian nội bộ'}</h1>{error?<div role="alert" className="auth-card"><h2>Không thể truy cập</h2><p>{error}</p><Link href="/login">Quay lại đăng nhập</Link></div>:!user?<p role="status">Đang kiểm tra quyền truy cập…</p>:<><p>Xin chào, {user.displayName}.</p><div className="workspace-panel"><span className="access-badge">Đã xác thực quyền truy cập</span><h2>Sẵn sàng cho bước tiếp theo</h2><p>Tài khoản của bạn đã được kết nối với không gian phù hợp. Các chức năng vận hành sẽ được bổ sung trong các Sprint tiếp theo.</p><nav aria-label="Không gian được cấp quyền">{Object.entries(labels).filter(([key])=>user.permissions.includes(key+'.workspace')).map(([key,label])=><Link className="secondary-button" key={key} href={'/workspace/'+key}>{label}</Link>)}</nav></div></>}</section></main>;
}
