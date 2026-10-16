import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let svg = fs.readFileSync(path.join(out, 'database/physical.svg'), 'utf8');
const start = svg.indexOf('<svg');
if (start < 0)
  throw new Error('Physical ERD is missing its SVG root. Run pnpm docs:database first.');
svg = svg.slice(start).replace(/width="[^"]+" height="[^"]+"/, 'width="100%" height="100%"');
const tableCount = [
  ...svg.matchAll(/<g\b[^>]*class="node"[^>]*>\s*<title>([^<]+)<\/title>/g),
].filter((match) => match[1] !== 'legend').length;
const foreignKeyCount = [...svg.matchAll(/<g\b[^>]*class="edge"[^>]*>/g)].length;
const dictionary = fs.readFileSync(path.join(out, 'database/data-dictionary.md'), 'utf8');
const dictionaryCount = Number(dictionary.match(/^# Từ điển dữ liệu vật lý — (\d+) bảng/m)?.[1]);
if (!tableCount || dictionaryCount !== tableCount)
  throw new Error(
    'Physical SVG and data dictionary table counts differ. Regenerate database documentation before exporting the viewer.',
  );
fs.writeFileSync(
  path.join(out, 'erd.html'),
  `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ERD ${tableCount} bảng — QR Ordering</title><style>*{box-sizing:border-box}body{margin:0;font:15px/1.6 "Segoe UI",Arial;color:#173f34;background:#f0f5ef}header{padding:12px 18px;border-bottom:1px solid #bccdc2;display:flex;gap:12px;align-items:center;flex-wrap:wrap}a{color:#175b49}button,select{font:inherit;padding:6px 10px;background:white;border:1px solid #bdcfc3;border-radius:5px}main{height:calc(100dvh - 170px);min-height:350px;background:white;overflow:hidden;touch-action:none;cursor:grab}svg{display:block}p{margin:8px 18px}#status{font-size:13px}.node.focus polygon,.node.focus path{stroke:#d55b1d!important;stroke-width:3!important}.edge.related path{stroke:#d55b1d!important;stroke-width:2!important}</style><header><a href="16-tu-dien-du-lieu.html">← Từ điển dữ liệu</a><strong>${tableCount} bảng - ${foreignKeyCount} khóa ngoại</strong><label>Đến bảng <select id="table"><option value="">Chọn một bảng…</option></select></label><button id="fit">Toàn cảnh</button><button id="plus" aria-label="Phóng to">＋</button><button id="minus" aria-label="Thu nhỏ">−</button></header><p><a href="database/physical.svg">SVG</a> - <a href="database/physical.dot">DOT</a> - <a href="database/data-dictionary.md">Từ điển vật lý</a>. Chọn bảng để đọc rõ; đường màu cam là quan hệ trực tiếp. Kéo để di chuyển, cuộn để phóng/thu. Mũi tên đi từ cha đến con.</p><main>${svg}</main><p id="status">Đang xem toàn cảnh. Bắt đầu với table_session hoặc order_item.</p><script>
const svg=document.querySelector('svg'),initial=svg.getAttribute('viewBox').split(/\\s+/).map(Number);let box=[...initial];
const paint=()=>svg.setAttribute('viewBox',box.join(' '));
const nodes=[...svg.querySelectorAll('g.node')].filter(n=>n.querySelector('title').textContent!=='legend').sort((a,b)=>a.querySelector('title').textContent.localeCompare(b.querySelector('title').textContent)),edges=[...svg.querySelectorAll('g.edge')],select=document.querySelector('#table');
for(const n of nodes){const name=n.querySelector('title').textContent;const o=document.createElement('option');o.value=name;o.textContent=name;select.append(o)}
function zoom(f){const [x,y,w,h]=box;box=[x+w*(1-f)/2,y+h*(1-f)/2,w*f,h*f];paint()}
document.querySelector('#fit').onclick=()=>{box=[...initial];paint()};document.querySelector('#plus').onclick=()=>zoom(.7);document.querySelector('#minus').onclick=()=>zoom(1.4);
select.onchange=()=>{const name=select.value,n=nodes.find(n=>n.querySelector('title').textContent===name);if(!n)return;nodes.forEach(v=>v.classList.toggle('focus',v===n));let count=0;edges.forEach(e=>{const match=e.querySelector('title').textContent.split('->').includes(name);e.classList.toggle('related',match);if(match)count++});const r=n.getBoundingClientRect(),matrix=svg.getScreenCTM().inverse();const a=new DOMPoint(r.left,r.top).matrixTransform(matrix),b=new DOMPoint(r.right,r.bottom).matrixTransform(matrix);const width=Math.max(500,(b.x-a.x)*3),height=Math.max(380,(b.y-a.y)*3);box=[(a.x+b.x-width)/2,(a.y+b.y-height)/2,width,height];paint();document.querySelector('#status').textContent=name+' · '+count+' quan hệ FK trực tiếp. Tra kiểu cột và ràng buộc chi tiết trong từ điển.'};
let drag;svg.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,box:[...box]};svg.setPointerCapture(e.pointerId)});svg.addEventListener('pointermove',e=>{if(!drag)return;const scale=Math.min(svg.clientWidth/box[2],svg.clientHeight/box[3]);box=[drag.box[0]-(e.clientX-drag.x)/scale,drag.box[1]-(e.clientY-drag.y)/scale,box[2],box[3]];paint()});svg.addEventListener('pointerup',()=>drag=null);svg.addEventListener('pointercancel',()=>drag=null);svg.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY>0?1.15:.87)},{passive:false});
</script></html>`,
);
console.log(
  `Prepared interactive ERD viewer with ${tableCount} tables and ${foreignKeyCount} foreign keys.`,
);
