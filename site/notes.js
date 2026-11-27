// =====================================================================
//  หมายเหตุ / การติดตาม รายบุคคล (เก็บถาวรใน Firebase Realtime Database)
//  - ทุกคนอ่านได้ (ข้อความ + ภาพ) · เพิ่ม/แก้/ลบได้เฉพาะบัญชีที่ล็อกอิน และอยู่ใน bp-dashboard/editors
//  - ผูกกับคน (ประเภท + ชื่อ) ไม่ผูกกับเดือน → เดือนถัดไปไม่ต้องลงซ้ำ
//  - ภาพย่อเป็น JPEG แล้วเก็บในฐานข้อมูล (Firebase Storage ต้องใช้แพลนเสียเงิน จึงไม่ใช้)
//  โครงสร้าง:
//    bp-dashboard/notes/<คน>/<id>      = { kind, date, appt?, text?, images, by, byUid, at, editedBy?, editedAt? }
//    bp-dashboard/noteImages/<คน>/<id> = { i0: "data:image/jpeg;base64,...", i1: ... }
//    bp-dashboard/editors/<uid>        = true   (ผู้ดูแลเพิ่มเองใน Firebase Console)
// =====================================================================
(() => {
'use strict';
const ROOT = 'bp-dashboard';
const SDK = 'https://cdn.jsdelivr.net/npm/firebase@10.12.2/';
const MAX_IMAGES = 4, MAX_SIDE = 1400, MAX_DATAURL = 650000;   // ~480 KB ต่อภาพ (ต้องไม่เกินที่ Rules กำหนด)

// ---- โหลด Firebase SDK ครั้งเดียว ใช้ร่วมกับตัวนับคน online
const loadScript = src => new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });
let fbPromise = null;
window.bpLoadFirebase = () => fbPromise || (fbPromise = loadScript(SDK + 'firebase-app-compat.js')
  .then(() => Promise.all([loadScript(SDK + 'firebase-database-compat.js'), loadScript(SDK + 'firebase-auth-compat.js')]))
  .then(() => window.firebase)
  .catch(e => { fbPromise = null; throw e; }));
window.bpFirebaseApp = () => window.bpLoadFirebase().then(fb => fb.apps.find(a => a.name === 'bp') || fb.initializeApp(window.BP_FIREBASE_CONFIG, 'bp'));

const KINDS = [
  { k: 'med',     icon: '💊', label: 'รักษาแล้ว · ทานยาความดันอยู่', short: 'ทานยาอยู่', hint: 'เช่น ชื่อยา / โรงพยาบาลที่รักษา' },
  { k: 'appt',    icon: '📅', label: 'รอพบแพทย์ตามใบนัด',          short: 'รอพบแพทย์', hint: 'เช่น โรงพยาบาล / แผนก' },
  { k: 'seen',    icon: '🏥', label: 'พบแพทย์แล้ว · ให้ติดตามอาการ', short: 'พบแพทย์แล้ว', hint: 'แพทย์แนะนำว่าอะไร' },
  { k: 'advised', icon: '🗣️', label: 'แจ้งให้ไปพบแพทย์แล้ว',         short: 'แจ้งให้พบแพทย์', hint: 'แจ้งเมื่อไร / โดยใคร' },
  { k: 'recheck', icon: '🔁', label: 'วัดซ้ำแล้ว ค่ากลับมาปกติ',     short: 'วัดซ้ำปกติ', hint: 'เช่น วัดซ้ำได้ 132/84' },
  { k: 'other',   icon: '📝', label: 'อื่นๆ (ระบุเอง)',               short: 'หมายเหตุ', hint: 'พิมพ์รายละเอียด (จำเป็น)' },
];
const KIND = Object.fromEntries(KINDS.map(k => [k.k, k]));

let opts = { esc: s => String(s), onChange: () => {} };
let app = null, db = null, auth = null;
let state = 'off';            // off | loading | ready | denied | error
let NOTES = {};               // คน → { id → note }
let user = null, isEditor = false;
let mounted = null;           // { d, el, key } คนที่แสดงอยู่ในหน้ารายบุคคล
let IMGS = {};                // id → [dataURL]  (ของคนที่แสดงอยู่)
let form = null;              // ฟอร์มที่เปิดอยู่ { id?, kind, images: [dataURL] }

const esc = s => opts.esc(s == null ? '' : s);
// วันที่/เวลาเป็นเวลาไทยเสมอ (เครื่องที่ตั้งโซนเวลาอื่นก็แสดงตรงกัน)
const TZ = 'Asia/Bangkok';
const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const dmy = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '';
function parseDmy(s) {   // DD/MM/YYYY (รับปี พ.ศ.) → ISO หรือ ''
  const m = String(s || '').trim().match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/); if (!m) return '';
  let [, d, mo, y] = m.map(Number); if (y > 2400) y -= 543;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : '';
}
const whenTxt = ms => { if (!ms) return ''; const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`; };

// คีย์ของคน: ประเภท + ชื่อ (ไม่รวมกะ เพราะย้ายกะได้) · ตัดช่องว่างซ้ำ และอักขระที่ Firebase ห้ามใช้ในคีย์
const key = d => `${d.group || 'TPT'}|${String(d.name || '').replace(/\s+/g, ' ').trim()}`.replace(/[.#$\[\]\/\x00-\x1f\x7f]/g, '_').slice(0, 120);
const list = d => Object.entries(NOTES[key(d)] || {}).map(([id, n]) => Object.assign({ id }, n))
  .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.at || 0) - (a.at || 0));
const latest = d => list(d)[0] || null;
const overdue = n => n && n.kind === 'appt' && n.appt && n.appt < todayIso();

function friendly(e) {
  const c = (e && (e.code || e.message)) || '';
  if (/PERMISSION_DENIED|permission/i.test(c)) return 'ไม่มีสิทธิ์บันทึก — บัญชีนี้ยังไม่ได้รับสิทธิ์ หรือผู้ดูแลยังไม่ได้ตั้งค่า Rules';
  if (/invalid-credential|wrong-password|user-not-found|invalid-email|invalid-login/i.test(c)) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
  if (/too-many-requests/i.test(c)) return 'ลองผิดหลายครั้งเกินไป — รอสักครู่แล้วลองใหม่';
  if (/network/i.test(c)) return 'เชื่อมต่ออินเทอร์เน็ตไม่ได้ — ตรวจเน็ตแล้วลองใหม่';
  if (/user-disabled/i.test(c)) return 'บัญชีนี้ถูกปิดใช้งาน';
  return 'เกิดข้อผิดพลาด — ลองใหม่อีกครั้ง';
}

// ---------------------------------------------------------------- เริ่มทำงาน
function init(o) {
  Object.assign(opts, o || {});
  const cfg = window.BP_FIREBASE_CONFIG;
  if (!cfg || !cfg.databaseURL || !cfg.apiKey) { state = 'off'; return; }
  state = 'loading'; paint();
  window.bpFirebaseApp().then(a => {
    app = a; db = app.database(); auth = app.auth();
    db.ref(`${ROOT}/notes`).on('value', snap => { NOTES = snap.val() || {}; state = 'ready'; syncImages(); changed(); },
      () => { state = 'denied'; changed(); });
    auth.onAuthStateChanged(u => {
      user = u; isEditor = false; changed();
      if (u) db.ref(`${ROOT}/editors/${u.uid}`).once('value').then(s => { isEditor = s.val() === true; changed(); }).catch(() => changed());
    });
  }).catch(() => { state = 'error'; changed(); });
}
function changed() { paint(); try { opts.onChange(); } catch (e) {} }

// ---------------------------------------------------------------- ป้ายสั้น (ตาราง/แจ้งเตือน/รายงาน)
function badge(d) {
  const n = latest(d); if (!n) return '';
  const K = KIND[n.kind] || KIND.other, od = overdue(n);
  const tip = `${K.label}${n.appt ? ' · นัด ' + dmy(n.appt) : ''}${n.text ? ' · ' + n.text : ''} (บันทึก ${dmy(n.date)})`;
  return ` <span class="nb${od ? ' warn' : ''}" title="${esc(tip)}">${K.icon} ${esc(od ? 'เลยวันนัด ' + dmy(n.appt) : K.short + (n.kind === 'appt' && n.appt ? ' ' + dmy(n.appt).slice(0, 5) : ''))}${n.images ? ' 📷' : ''}</span>`;
}
function summary(d) {
  const n = latest(d); if (!n) return '';
  const K = KIND[n.kind] || KIND.other;
  return `${K.label}${n.appt ? ' (นัด ' + dmy(n.appt) + (overdue(n) ? ' — เลยวันนัดแล้ว' : '') + ')' : ''}${n.text ? ': ' + n.text : ''} [บันทึก ${dmy(n.date)}]`;
}

// ---------------------------------------------------------------- การ์ดในหน้ารายบุคคล
function mount(d, el) {
  if (!el) return;
  const k = key(d);
  if (mounted && mounted.key === k && mounted.el === el && el.firstChild) return;   // คนเดิม: ไม่วาดใหม่ (ไม่ล้างฟอร์มที่พิมพ์ค้าง)
  mounted = { d, el, key: k }; form = null; IMGS = {};
  el.innerHTML = `<h2>📝 หมายเหตุ / การติดตาม</h2>
    <div class="desc">บันทึกครั้งเดียว ใช้ต่อได้ทุกเดือน — เช่น รักษาแล้ว ทานยาอยู่ / รอพบแพทย์ตามใบนัด (แนบภาพได้)</div>
    <div class="nt-auth" data-r="auth"></div>
    <div data-r="form"></div>
    <div class="nt-list" data-r="list" aria-live="polite"></div>`;
  loadImages(k);
  paint();
}
// ภาพของคนที่แสดงอยู่ยังไม่ครบ (เปิดหน้าก่อนต่อฐานข้อมูลเสร็จ / มีคนแนบภาพจากเครื่องอื่น) → โหลดใหม่
function syncImages() {
  if (!mounted) return;
  const miss = Object.entries(NOTES[mounted.key] || {}).some(([id, n]) => n.images && (IMGS[id] || []).length !== n.images);
  if (miss) loadImages(mounted.key);
}
let imgLoading = null;
function loadImages(k) {
  if (!db) return Promise.resolve();
  if (imgLoading && imgLoading.k === k) return imgLoading.p;
  const p = db.ref(`${ROOT}/noteImages/${k}`).once('value').then(s => {
    if (!mounted || mounted.key !== k) return;
    const v = s.val() || {}; IMGS = Object.fromEntries(Object.entries(v).map(([id, o]) => [id, Object.keys(o || {}).sort().map(x => o[x])]));
    paintList();
  }).catch(() => {}).finally(() => { if (imgLoading && imgLoading.p === p) imgLoading = null; });
  imgLoading = { k, p };
  return p;
}
const $r = r => mounted && mounted.el.querySelector(`[data-r="${r}"]`);
function paint() { paintHeader(); if (!mounted || !mounted.el.isConnected) return; paintAuth(); paintList(); if (form && !isEditor) closeForm(); }

// มุมขวาบนของหัวเว็บ: ปุ่มเข้าสู่ระบบ / ชื่อบัญชี + ออกจากระบบ
function paintHeader() {
  const box = document.getElementById('authBox'); if (!box) return;
  const usable = state === 'ready' || state === 'denied';
  box.classList.toggle('hidden', !usable);
  if (!usable) return;
  const sig = user ? 'in:' + user.uid : 'out';
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  box.innerHTML = user
    ? `<span class="auth-who" title="${esc(user.email || user.uid)}">👤 ${esc(user.email || user.uid)}</span><button type="button" class="auth-btn" data-a="logout">ออกจากระบบ</button>`
    : `<button type="button" class="auth-btn" data-a="login">🔐 เข้าสู่ระบบ</button>`;
  const b = box.querySelector('[data-a]');
  b.onclick = user ? () => auth.signOut() : openLogin;
}
// การ์ดหมายเหตุ: สถานะการเชื่อมต่อ / ปุ่มเพิ่ม / แจ้งว่ายังไม่มีสิทธิ์
function paintAuth() {
  const box = $r('auth'); if (!box) return;
  if (state === 'off' || state === 'error') { box.innerHTML = `<div class="nt-msg">ระบบหมายเหตุใช้งานไม่ได้ตอนนี้ (เชื่อมต่อฐานข้อมูลไม่ได้)</div>`; return; }
  if (state === 'denied') { box.innerHTML = `<div class="nt-msg">ระบบหมายเหตุยังไม่พร้อม — ผู้ดูแลต้องตั้งค่า Rules ใน Firebase ก่อน (ดู README)</div>`; return; }
  if (!user) {
    box.innerHTML = `<span class="nt-who">ต้องการเพิ่มหมายเหตุ? กด <b>🔐 เข้าสู่ระบบ</b> ที่มุมขวาบนของหน้า</span>`;
    return;
  }
  box.innerHTML = isEditor ? `<button type="button" class="nt-btn" data-a="add"${form ? ' disabled' : ''}>＋ เพิ่มหมายเหตุ</button>`
    : `<div class="nt-msg">บัญชี ${esc(user.email || '')} ยังไม่มีสิทธิ์บันทึก — ส่งรหัสนี้ให้ผู้ดูแลเพิ่มสิทธิ์: <code>${esc(user.uid)}</code></div>`;
  const add = box.querySelector('[data-a="add"]'); if (add) add.onclick = () => openForm(null);
}
// หน้าต่างเข้าสู่ระบบ (เปิดจากปุ่มมุมขวาบน)
let loginDlg = null;
function openLogin() {
  if (!auth) return;
  if (!loginDlg) {
    loginDlg = document.createElement('dialog'); loginDlg.className = 'nt-dlg'; loginDlg.setAttribute('aria-labelledby', 'ntLoginT');
    loginDlg.innerHTML = `<h2 id="ntLoginT">🔐 เข้าสู่ระบบ</h2><div class="desc">สำหรับผู้ที่ได้รับสิทธิ์บันทึกหมายเหตุ</div>
      <form class="nt-login" novalidate>
        <label>อีเมล <input type="email" name="email" autocomplete="username" required></label>
        <label>รหัสผ่าน <input type="password" name="pw" autocomplete="current-password" required></label>
        <div class="nt-err" role="alert"></div>
        <div class="row"><button type="button" class="nt-btn ghost" data-a="cancel">ยกเลิก</button><button type="submit" class="nt-btn">เข้าสู่ระบบ</button></div>
      </form>`;
    document.body.appendChild(loginDlg);
    const f = loginDlg.querySelector('form');
    f.querySelector('[data-a="cancel"]').onclick = () => loginDlg.close();
    f.onsubmit = e => {
      e.preventDefault();
      const em = f.email.value.trim(), pw = f.pw.value, err = f.querySelector('.nt-err');
      if (!em || !pw) { err.textContent = 'กรอกอีเมลและรหัสผ่าน'; return; }
      const btn = f.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'กำลังเข้าสู่ระบบ…'; err.textContent = '';
      auth.signInWithEmailAndPassword(em, pw).then(() => { f.pw.value = ''; loginDlg.close(); })
        .catch(x => { err.textContent = friendly(x); })
        .finally(() => { btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ'; });
    };
  }
  loginDlg.querySelector('.nt-err').textContent = '';
  if (loginDlg.showModal) loginDlg.showModal(); else loginDlg.setAttribute('open', '');
  loginDlg.querySelector('[name=email]').focus();
}

function paintList() {
  const box = $r('list'); if (!box) return;
  if (state === 'loading') { box.innerHTML = '<div class="nt-empty">กำลังโหลดหมายเหตุ…</div>'; return; }
  if (state !== 'ready') { box.innerHTML = ''; return; }
  const items = list(mounted.d);
  box.innerHTML = items.length ? items.map(n => {
    const K = KIND[n.kind] || KIND.other, imgs = IMGS[n.id] || [];
    return `<article class="nt-item${overdue(n) ? ' warn' : ''}">
      <div class="nt-head"><span class="nt-kind">${K.icon} ${esc(K.label)}</span><span class="nt-date">${esc(dmy(n.date))}</span>
        ${n.kind === 'appt' && n.appt ? `<span class="nt-appt${overdue(n) ? ' warn' : ''}">นัด ${esc(dmy(n.appt))}${overdue(n) ? ' · เลยวันนัดแล้ว' : ''}</span>` : ''}</div>
      ${n.text ? `<div class="nt-text">${esc(n.text)}</div>` : ''}
      ${n.images ? `<div class="nt-imgs">${imgs.length ? imgs.map((src, i) => `<button type="button" class="nt-thumb" data-id="${esc(n.id)}" data-i="${i}" aria-label="ดูภาพที่ ${i + 1} ขนาดใหญ่"><img src="${esc(src)}" alt="ภาพแนบ ${i + 1}" loading="lazy"></button>`).join('')
        : `<span class="nt-empty">กำลังโหลดภาพ ${n.images} ภาพ…</span>`}</div>` : ''}
      <div class="nt-foot">บันทึกโดย ${esc(n.by || '–')} · ${esc(whenTxt(n.at))}${n.editedAt ? ` · แก้ไขล่าสุด ${esc(whenTxt(n.editedAt))}${n.editedBy && n.editedBy !== n.by ? ' โดย ' + esc(n.editedBy) : ''}` : ''}
        ${isEditor ? `<span class="nt-acts"><button type="button" class="nt-link" data-edit="${esc(n.id)}">แก้ไข</button><button type="button" class="nt-link danger" data-del="${esc(n.id)}">ลบ</button></span>` : ''}</div>
    </article>`; }).join('')
    : '<div class="nt-empty">ยังไม่มีหมายเหตุสำหรับคนนี้</div>';
  box.querySelectorAll('.nt-thumb').forEach(b => b.onclick = () => view((IMGS[b.dataset.id] || [])[+b.dataset.i]));
  box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openForm(b.dataset.edit));
  box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => del(b.dataset.del));
}

// ---------------------------------------------------------------- ฟอร์มเพิ่ม/แก้ไข
function openForm(id) {
  if (!isEditor || !mounted) return;
  const n = id ? (NOTES[mounted.key] || {})[id] : null;
  // แก้ไขโน้ตที่มีภาพ แต่ภาพยังโหลดไม่เสร็จ → รอโหลดก่อน ไม่งั้นบันทึกแล้วภาพเดิมหาย
  if (n && n.images && (IMGS[id] || []).length !== n.images) { loadImages(mounted.key).then(() => { if ((IMGS[id] || []).length === n.images) openForm(id); else flash('โหลดภาพเดิมไม่สำเร็จ — ลองใหม่อีกครั้ง', true); }); return; }
  form = { id, kind: n ? n.kind : 'med', images: id ? (IMGS[id] || []).slice() : [] };
  const box = $r('form');
  box.innerHTML = `<form class="nt-form" novalidate>
    <fieldset class="nt-kinds"><legend>สถานะ</legend>
      ${KINDS.map(K => `<label class="nt-kopt"><input type="radio" name="kind" value="${K.k}"${form.kind === K.k ? ' checked' : ''}> ${K.icon} ${esc(K.label)}</label>`).join('')}
    </fieldset>
    <div class="nt-row">
      <label>วันที่บันทึก <input type="text" name="date" inputmode="numeric" placeholder="DD/MM/YYYY" maxlength="10" value="${esc(dmy(n ? n.date : todayIso()))}"></label>
      <label class="nt-apptf">วันนัดพบแพทย์ <input type="text" name="appt" inputmode="numeric" placeholder="DD/MM/YYYY" maxlength="10" value="${esc(dmy(n && n.appt))}"></label>
    </div>
    <label class="nt-textf">รายละเอียด <textarea name="text" rows="3" maxlength="1000">${esc(n && n.text)}</textarea></label>
    <div class="nt-imgf">
      <label class="nt-btn ghost nt-file">📷 แนบภาพ (สูงสุด ${MAX_IMAGES} ภาพ)<input type="file" accept="image/*" multiple></label>
      <div class="nt-prev"></div>
    </div>
    <div class="nt-actions"><button type="submit" class="nt-btn">💾 บันทึก</button> <button type="button" class="nt-btn ghost" data-a="cancel">ยกเลิก</button>
      <span class="nt-status" role="status" aria-live="polite"></span></div>
  </form>`;
  const f = box.querySelector('form');
  const sync = () => { form.kind = f.kind.value; const K = KIND[form.kind];
    f.querySelector('.nt-apptf').classList.toggle('hidden', form.kind !== 'appt');
    f.text.placeholder = K.hint; f.querySelector('.nt-textf').firstChild.textContent = form.kind === 'other' ? 'รายละเอียด (จำเป็น) ' : 'รายละเอียด (ถ้ามี) '; };
  f.querySelectorAll('[name=kind]').forEach(r => r.onchange = sync); sync();
  f.querySelector('input[type=file]').onchange = e => addFiles(e.target, f);
  f.querySelector('[data-a="cancel"]').onclick = closeForm;
  f.onsubmit = e => { e.preventDefault(); save(f); };
  paintPreview(f); paintAuth();
  f.querySelector('[name=kind]:checked').focus();
}
function closeForm() { form = null; const b = $r('form'); if (b) b.innerHTML = ''; paintAuth(); }
function paintPreview(f) {
  const p = f.querySelector('.nt-prev');
  p.innerHTML = form.images.map((src, i) => `<span class="nt-pv"><img src="${esc(src)}" alt="ภาพที่ ${i + 1}"><button type="button" data-rm="${i}" aria-label="เอาภาพที่ ${i + 1} ออก">✕</button></span>`).join('');
  p.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { form.images.splice(+b.dataset.rm, 1); paintPreview(f); });
  f.querySelector('.nt-file').classList.toggle('disabled', form.images.length >= MAX_IMAGES);
  f.querySelector('input[type=file]').disabled = form.images.length >= MAX_IMAGES;
}
function addFiles(input, f) {
  const files = [...input.files].slice(0, MAX_IMAGES - form.images.length); input.value = '';
  const st = f.querySelector('.nt-status'); if (!files.length) return;
  st.textContent = 'กำลังย่อภาพ…';
  Promise.all(files.map(x => compress(x).catch(() => null))).then(rs => {
    const okImgs = rs.filter(Boolean); form.images.push(...okImgs); paintPreview(f);
    st.textContent = okImgs.length < files.length ? 'บางภาพเปิดไม่ได้ (ลองถ่าย/บันทึกเป็น JPG หรือ PNG)' : '';
  });
}
// ย่อด้านยาวสุดไม่เกิน MAX_SIDE แล้วบีบเป็น JPEG จนขนาดไม่เกิน MAX_DATAURL
function compress(file) {
  return new Promise((ok, bad) => {
    if (!/^image\//.test(file.type)) return bad(new Error('type'));
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let side = MAX_SIDE, q = 0.78, out = '';
      for (let i = 0; i < 6; i++) {
        const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        out = c.toDataURL('image/jpeg', q);
        if (out.length <= MAX_DATAURL) return ok(out);
        q = Math.max(0.5, q - 0.1); side = Math.round(side * 0.82);
      }
      bad(new Error('size'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); bad(new Error('decode')); };
    img.src = url;
  });
}
function save(f) {
  const st = f.querySelector('.nt-status'), btn = f.querySelector('[type=submit]');
  const kind = f.kind.value, date = parseDmy(f.date.value), appt = kind === 'appt' ? parseDmy(f.appt.value) : '', text = f.text.value.trim();
  f.date.setAttribute('aria-invalid', String(!date));
  if (!date) { st.textContent = 'วันที่บันทึกไม่ถูกต้อง (DD/MM/YYYY)'; f.date.focus(); return; }
  if (kind === 'appt' && f.appt.value.trim() && !appt) { st.textContent = 'วันนัดไม่ถูกต้อง (DD/MM/YYYY)'; f.appt.setAttribute('aria-invalid', 'true'); f.appt.focus(); return; }
  if (kind === 'other' && !text) { st.textContent = 'สถานะ "อื่นๆ" ต้องพิมพ์รายละเอียด'; f.text.focus(); return; }
  const k = mounted.key, ref = db.ref(`${ROOT}/notes/${k}`), id = form.id || ref.push().key;
  const old = form.id ? (NOTES[k] || {})[form.id] || {} : null;
  const TS = window.firebase.database.ServerValue.TIMESTAMP, who = user.email || user.uid;
  const note = Object.assign({ kind, date, images: form.images.length, by: old ? old.by || who : who, byUid: old ? old.byUid || user.uid : user.uid, at: old ? old.at || TS : TS },
    appt ? { appt } : {}, text ? { text } : {}, old ? { editedBy: who, editedByUid: user.uid, editedAt: TS } : {});
  const imgs = form.images.length ? Object.fromEntries(form.images.map((s, i) => [`i${i}`, s])) : null;
  btn.disabled = true; st.textContent = 'กำลังบันทึก…';
  const slow = setTimeout(() => { st.textContent = 'ยังส่งไม่สำเร็จ — ตรวจอินเทอร์เน็ต (ระบบจะส่งให้อัตโนมัติเมื่อเชื่อมต่อได้)'; }, 10000);
  db.ref(ROOT).update({ [`notes/${k}/${id}`]: note, [`noteImages/${k}/${id}`]: imgs })
    .then(() => { clearTimeout(slow); IMGS[id] = form.images.slice(); closeForm(); paintList(); flash('บันทึกหมายเหตุแล้ว ✓'); })
    .catch(e => { clearTimeout(slow); btn.disabled = false; st.textContent = friendly(e); });
}
function del(id) {
  const n = (NOTES[mounted.key] || {})[id]; if (!n) return;
  const K = KIND[n.kind] || KIND.other;
  if (!window.confirm(`ลบหมายเหตุ "${K.label}" (${dmy(n.date)}) ?\nลบแล้วกู้คืนไม่ได้`)) return;
  const k = mounted.key;
  db.ref(ROOT).update({ [`notes/${k}/${id}`]: null, [`noteImages/${k}/${id}`]: null })
    .then(() => flash('ลบหมายเหตุแล้ว')).catch(e => flash(friendly(e), true));
}
function flash(msg, bad) {
  const box = $r('list'); if (!box) return;
  const m = document.createElement('div'); m.className = 'nt-flash' + (bad ? ' bad' : ''); m.setAttribute('role', 'status'); m.textContent = msg;
  box.parentNode.insertBefore(m, box); setTimeout(() => m.remove(), 3500);
}

// ---------------------------------------------------------------- ดูภาพขนาดใหญ่
let viewer = null;
function view(src) {
  if (!src) return;
  if (!viewer) {
    viewer = document.createElement('dialog'); viewer.className = 'nt-viewer'; viewer.setAttribute('aria-label', 'ภาพแนบ');
    viewer.innerHTML = '<button type="button" class="nt-close" aria-label="ปิด">✕</button><img alt="ภาพแนบขนาดใหญ่">';
    viewer.querySelector('.nt-close').onclick = () => viewer.close();
    viewer.onclick = e => { if (e.target === viewer) viewer.close(); };
    document.body.appendChild(viewer);
  }
  viewer.querySelector('img').src = src;
  if (viewer.showModal) viewer.showModal(); else viewer.setAttribute('open', '');
}

window.BPNotes = { init, key, latest, list, badge, summary, mount, KINDS, when: whenTxt, get state() { return state; }, get editor() { return isEditor; } };
})();
