/* ══════════════════════════════════════════
   CONFIG — adjust as needed
══════════════════════════════════════════ */

// 1) Users — login username -> email / name / role (no passwords stored in this file)
//    Passwords are stored encrypted in Supabase. You can change the display names here.
// phone = WhatsApp number in international format without + (Qatar example: 974XXXXXXXX) — used for WhatsApp notifications
// role: 'accountant' = full access (create / edit / approve) — you, the bank-account manager & approver
//       'viewer'     = view-only (documentation & transparency) — the other partners see everything, no edits
// ⚠️ The email here MUST match the user account you create in Supabase Auth. The password itself is stored in Supabase.
const USER_MAP = {
  'admin':      { email:'admin@bionutritionmedical.com',      name:'Anas Ibrahim', name_en:'Anas Ibrahim', role:'accountant', dept:'Finance', dept_en:'Finance', phone:'' },
  // ── Partners (view-only) — each partner has their own account; they acknowledge vouchers ──
  'hassan':     { email:'hassan@bionutritionmedical.com',     name:'Hassan',      name_en:'Hassan',      role:'viewer', dept:'Partner', dept_en:'Partner', phone:'' },
  'abaza':      { email:'abaza@bionutritionmedical.com',      name:'Abaza',       name_en:'Abaza',       role:'viewer', dept:'Partner', dept_en:'Partner', phone:'' },
  'ahmednabel': { email:'ahmednabel@bionutritionmedical.com', name:'Ahmed Nabel', name_en:'Ahmed Nabel', role:'viewer', dept:'Partner', dept_en:'Partner', phone:'' },
};

// 2) Supabase — required for login and the ledger to work (this key is safe to place here)
const SUPABASE_URL = 'https://oespbopkwegkixzertpo.supabase.co';   // BioNutrition project URL
const SUPABASE_KEY = 'sb_publishable_qoHYcMTfxJs6AGXPwBMmXw_vzLLQDzt';   // anon / publishable key
const SB_ON = !!(SUPABASE_URL && SUPABASE_KEY);
const sb = SB_ON ? supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// 3) Push notifications — public key only (safe client-side, same trust level as SUPABASE_KEY above)
const VAPID_PUBLIC_KEY = 'BAbKXGr5PJk57lk-AkApqfsODVUGYK1irDs1ueYtXxEC-mHZmVkdRuGl6I5_IC6yt_F4iwAAnG4ydbU0zeifMII';

function urlBase64ToUint8Array(base64String){
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g,'+').replace(/_/g,'/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// Ask once per day at most — never on page load, only after the user is inside the app
async function maybeOfferPushNotifications(){
  if(!('Notification' in window) || !('serviceWorker' in navigator) || !VAPID_PUBLIC_KEY) return;
  if(Notification.permission !== 'default') return;
  const lastAsked = Number(localStorage.getItem('bnpv_push_asked_at') || 0);
  if(Date.now() - lastAsked < 24*60*60*1000) return;
  localStorage.setItem('bnpv_push_asked_at', String(Date.now()));

  setTimeout(async () => {
    const ok = await showConfirmDialog({
      title: 'Enable Notifications',
      message: 'Get notified instantly when a new voucher is created or acknowledged.',
      confirmText: 'Enable',
      cancelText: 'Not now',
    });
    if(!ok) return;
    try{
      const permission = await Notification.requestPermission();
      if(permission !== 'granted') return;
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      const json = sub.toJSON();
      await sb.from('push_subscriptions').upsert({
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        user_email: CURRENT.email,
        role: CURRENT.role,
        user_agent: navigator.userAgent,
      }, { onConflict: 'endpoint' });
    }catch(e){ console.error('Push subscribe failed', e); }
  }, 1500);
}

function sanitizeFileName(name){
  return String(name||'').trim()
    .replace(/[^a-zA-Z0-9_.-]/g,'_')
    .replace(/_+/g,'_')
    .replace(/^_+|_+$/g,'');
}
function isDataUrl(value){ return typeof value==='string' && value.startsWith('data:'); }
function isHttpUrl(value){ return typeof value==='string' && /^https?:\/\//i.test(value); }
function isStoragePath(value){ return typeof value==='string' && !isDataUrl(value) && !isHttpUrl(value) && value.length>0; }
function dataUrlToBlob(dataUrl){
  const [meta, data] = String(dataUrl||'').split(',',2);
  const mime = meta.match(/data:([^;]+);/)?.[1] || 'application/octet-stream';
  const binary = atob(data||'');
  const arr = new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++){ arr[i] = binary.charCodeAt(i); }
  return new Blob([arr], { type: mime });
}
async function resolveStorageUrl(path){
  if(!sb || !isStoragePath(path)) return null;
  const { data: signed, error: signedErr } = await sb.storage.from('request-attachments').createSignedUrl(path, 300);
  if(!signedErr && signed?.signedUrl){ return signed.signedUrl; }
  const { data } = sb.storage.from('request-attachments').getPublicUrl(path);
  if(data?.publicUrl){ return data.publicUrl; }
  return null;
}
async function openSourceInNewTab(src){
  if(!src){ alert('No file to display'); return; }
  if(isDataUrl(src)){
    const blob = dataUrlToBlob(src);
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(()=>URL.revokeObjectURL(url), 40000);
    return;
  }
  if(isHttpUrl(src)){
    window.open(src, '_blank');
    return;
  }
  if(isStoragePath(src)){
    const url = await resolveStorageUrl(src);
    if(url){ window.open(url, '_blank'); return; }
    alert('Could not access the file from storage.');
    return;
  }
  alert('Attachment source is undefined.');
}
function getCurrentAttachmentCount(){ return ATTACHED.length; }
async function uploadFileToStorage(file, folder='uploads'){
  if(!sb) throw new Error('Supabase not initialized');
  const name = sanitizeFileName(file.name);
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2,8);
  const filepath = `${folder.replace(/^\/+|\/+$/g,'')}/${timestamp}_${random}_${name}`;
  const { data, error } = await sb.storage.from('request-attachments').upload(filepath, file, { cacheControl:'3600', upsert:false });
  if(error){
    const msg = error.message || error.error_description || error.error || JSON.stringify(error);
    throw new Error(`Storage upload failed: ${msg}`);
  }
  return data?.path || filepath;
}
async function uploadAttachments(files, folder='uploads'){
  const paths = [];
  for(const f of files){ paths.push(await uploadFileToStorage(f, folder)); }
  return paths;
}
async function openAttachment(rowIndex, attIndex){
  const x = (window._arcRows||[])[rowIndex];
  if(!x){ alert('Could not open the voucher.'); return; }
  let atts = [];
  try{ atts = JSON.parse(x.attachments_data||'[]'); }catch(e){ atts = []; }
  const src = atts[attIndex];
  if(!src){ alert('No attachment.'); return; }
  await openSourceInNewTab(src);
}
async function downloadArchiveAttachment(rowIndex, attIndex){
  const x = (window._arcRows||[])[rowIndex];
  if(!x){ alert('Could not open the voucher.'); return; }
  let atts = [];
  try{ atts = JSON.parse(x.attachments_data||'[]'); }catch(e){ atts = []; }
  const src = atts[attIndex];
  if(!src){ alert('No attachment.'); return; }
  try{
    const bytes = await getAttachmentBytes(src);
    dl(new Blob([bytes], { type:getAttachmentMime(src) }), getAttachmentLabel(src));
  }catch(e){
    alert('Could not download the attachment.');
    console.error(e);
  }
}
async function printArchiveAttachment(rowIndex, attIndex){
  const x = (window._arcRows||[])[rowIndex];
  if(!x){ alert('Could not open the voucher.'); return; }
  let atts = [];
  try{ atts = JSON.parse(x.attachments_data||'[]'); }catch(e){ atts = []; }
  const src = atts[attIndex];
  if(!src){ alert('No attachment.'); return; }
  try{
    const bytes = await getAttachmentBytes(src);
    const blob = new Blob([bytes], { type:getAttachmentMime(src) });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if(!w){ alert('The browser blocked the print window. Allow popups and try again.'); return; }
    w.onload = function(){ try{ w.focus(); w.print(); }catch(e){} };
    setTimeout(()=>{ try{ w.focus(); w.print(); }catch(e){} }, 900);
  }catch(e){
    alert('Could not print the attachment.');
    console.error(e);
  }
}
async function bytesToPngBytes(bytes, mime){
  const blob = new Blob([bytes], { type:mime || 'image/*' });
  const url = URL.createObjectURL(blob);
  try{
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const pngBlob = await new Promise(resolve=>canvas.toBlob(resolve, 'image/png'));
    if(!pngBlob) throw new Error('Could not convert the image to PNG');
    return await pngBlob.arrayBuffer();
  }finally{
    URL.revokeObjectURL(url);
  }
}
async function addImageAttachmentToPdf(merged, bytes, mime){
  let image;
  const lowerMime = String(mime||'').toLowerCase();
  if(lowerMime.includes('jpeg') || lowerMime.includes('jpg')){
    image = await merged.embedJpg(bytes);
  } else if(lowerMime.includes('png')){
    image = await merged.embedPng(bytes);
  } else {
    const pngBytes = await bytesToPngBytes(bytes, mime);
    image = await merged.embedPng(pngBytes);
  }
  const page = merged.addPage([image.width, image.height]);
  page.drawImage(image, { x:0, y:0, width:image.width, height:image.height });
}
async function mergeArchiveAttachmentBytes(rowIndex){
  const x = (window._arcRows||[])[rowIndex];
  if(!x){ throw new Error('Could not open the voucher.'); }
  const atts = getArchiveRowAttachments(x);
  if(!atts.length){ throw new Error('No attachments to merge.'); }
  if(!window.PDFLib || !window.PDFLib.PDFDocument){
    throw new Error('PDF merge library is not available.');
  }
  const merged = await PDFLib.PDFDocument.create();
  for(let i=0;i<atts.length;i++){
    const att = atts[i];
    const bytes = await getAttachmentBytes(att);
    const mime = getAttachmentMime(att);
    if(mime === 'application/pdf'){
      const srcDoc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption:true });
      const pages = await merged.copyPages(srcDoc, srcDoc.getPageIndices());
      pages.forEach(page => merged.addPage(page));
    } else if(mime.startsWith('image/')){
      await addImageAttachmentToPdf(merged, bytes, mime);
    } else {
      throw new Error('Unsupported attachment type for merging: '+getAttachmentLabel(att));
    }
  }
  return await merged.save();
}
async function downloadArchiveAttachmentsMerged(rowIndex){
  const x = (window._arcRows||[])[rowIndex];
  if(!x){ alert('Could not open the voucher.'); return; }
  try{
    const bytes = await mergeArchiveAttachmentBytes(rowIndex);
    const reqNo = displayRequestNo(x.req_no) || 'request';
    dl(new Blob([bytes], { type:'application/pdf' }), `attachments_${reqNo}.pdf`);
  }catch(e){
    alert('Could not merge the attachments. Make sure they are PDFs or supported images.');
    console.error(e);
  }
}
async function printArchiveAttachmentsMerged(rowIndex){
  try{
    const bytes = await mergeArchiveAttachmentBytes(rowIndex);
    const blob = new Blob([bytes], { type:'application/pdf' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if(!w){ alert('The browser blocked the print window. Allow popups and try again.'); return; }
    w.onload = function(){ try{ w.focus(); w.print(); }catch(e){} };
    setTimeout(()=>{ try{ w.focus(); w.print(); }catch(e){} }, 900);
  }catch(e){
    alert('Could not merge the attachments for printing. Make sure they are PDFs or supported images.');
    console.error(e);
  }
}
async function openAttachmentByRow(rowIndex, field){
  const x = (window._arcRows||[])[rowIndex];
  if(!x){ alert('Could not open the voucher.'); return; }
  const src = x[field];
  if(!src){ alert('No file.'); return; }
  await openSourceInNewTab(src);
}

/* ══════════════════════════════════════════
   AUTH
══════════════════════════════════════════ */
let CURRENT = null;

function _mapUser(email){
  const k = Object.keys(USER_MAP).find(u => USER_MAP[u].email.toLowerCase() === (email||'').toLowerCase());
  return k ? { user:k, ...USER_MAP[k] } : null;
}

async function doLogin(){
  const uname = document.getElementById('login-user').value.trim().toLowerCase();
  const p     = document.getElementById('login-pass').value;
  const err   = document.getElementById('login-error');
  const btn   = document.querySelector('.login-btn');
  if(!SB_ON){
    err.textContent='Setup is incomplete — you must add your Supabase credentials first (see the setup guide).';
    err.style.display='block';
    return;
  }
  const info = USER_MAP[uname];
  if(!info){
    err.textContent='Incorrect username or password';
    err.style.display='block';
    document.getElementById('login-pass').value=''; document.getElementById('login-pass').focus();
    return;
  }
  const ob = btn ? btn.textContent : '';
  if(btn){ btn.disabled=true; btn.textContent='Signing in...'; }
  try{
    const { data, error } = await sb.auth.signInWithPassword({ email:info.email, password:p });
    if(error || !(data && data.session)){
      err.textContent='Incorrect username or password';
      err.style.display='block';
      document.getElementById('login-pass').value=''; document.getElementById('login-pass').focus();
    } else {
      CURRENT = { user:uname, ...info };
      err.style.display='none';
      enterApp();
    }
  }catch(e){
    err.textContent='Server connection error — try again';
    err.style.display='block';
    console.error(e);
  }
  if(btn){ btn.disabled=false; btn.textContent=ob; }
}

async function doLogout(){
  try{ if(sb) await sb.auth.signOut(); }catch(e){}
  CURRENT = null;
  document.getElementById('login-screen').style.display='flex';
  document.getElementById('app').style.display='none';
  document.getElementById('login-user').value='';
  document.getElementById('login-pass').value='';
}

function enterApp(){
  document.getElementById('login-screen').style.display='none';
  document.getElementById('app').style.display='block';
  document.getElementById('tb-name').textContent = CURRENT.name_en || CURRENT.name;
  document.getElementById('tb-role').textContent = CURRENT.dept_en || CURRENT.dept || '';
  // Name and department are auto-filled based on the account
  document.getElementById('d-name').value = CURRENT.name;
  document.getElementById('d-dept').value = CURRENT.dept || (CURRENT.role==='accountant'?'Accounts Dept.':'Sales Dept.');

  const isAcc = CURRENT.role==='accountant';
  const isViewer = CURRENT.role==='viewer';
  // Ledger is available to everyone: Sales sees their own requests (view only), the accountant sees all and manages them
  document.getElementById('nav-arc').style.display = '';
  // View-only account: full access to the Vouchers Ledger without create or edit
  document.getElementById('nav-disb').style.display   = isViewer ? 'none' : '';
  if(isViewer){
    setDocumentLocked('disb', true);
    showPage('arc');
  }
  // Accounts approval buttons show for the accountant only
  document.getElementById('disb-acc-btn-row').style.display = isAcc ? '' : 'none';
  const cAccRow = document.getElementById('cancel-acc-btn-row');
  if(cAccRow) cAccRow.style.display = 'none';
  // Copy the logo image to the duplicated header in the Cancellation & Refund voucher
  const sl = document.getElementById('src-logo');
  if(sl){ document.querySelectorAll('img.zlogo').forEach(i=>{ if(!i.src) i.src = sl.src; }); }
  // Load previous supplier names for autocomplete
  loadSupplierNames();
  refreshNextRequestNumbers();
  startArchiveAutoRefresh();
  // Notify the requester on portal open that their voucher was transferred
  notifyTransferredRequests();
  // Offer push notifications (new vouchers / acknowledgements) — asked once, never on page load
  maybeOfferPushNotifications();
}

// Notify the requester as soon as they open the portal that their voucher was transferred (transfer proof uploaded)
// Tracked per account via the transfer_seen column in Supabase (shown once regardless of device/browser)
async function notifyTransferredRequests(){
  if(!SB_ON || !CURRENT) return;
  // Notification is for the requester (Sales) only — the accountant is the one who uploads the transfer proof
  if(CURRENT.role !== 'sales') return;
  try{
    const { data:rows, error } = await sb.from('requests')
      .select('id,req_no,doc_type,created_by,transfer_image,transfer_seen,cancelled')
      .eq('created_by', CURRENT.name)
      .not('transfer_image','is',null)
      .or('transfer_seen.is.null,transfer_seen.eq.false')
      .order('id',{ascending:false}).limit(100);
    if(error || !Array.isArray(rows)) return;
    const fresh = rows.filter(r=>r.transfer_image && !r.cancelled && !r.transfer_seen);
    if(!fresh.length) return;
    const details = fresh.slice(0,8).map(r=>({
      label: r.doc_type==='cancel' ? 'Cancellation & Refund' : 'Payment Voucher',
      value: displayRequestNo(r.req_no) || '—',
      ltr:true
    }));
    if(fresh.length > 8) details.push({ label:'and other vouchers', value:'+' + (fresh.length-8) });
    showMessageDialog({
      title:'Your voucher was transferred ✅',
      subtitle:'Request Transferred',
      message: fresh.length===1
        ? 'Your voucher amount has been transferred and the transfer proof uploaded. You can view the proof in the Vouchers Ledger.'
        : `The amounts for ${fresh.length} of your vouchers have been transferred and the transfer proof uploaded. You can view them in the Vouchers Ledger.`,
      details,
      note:'Transferred vouchers appear in green inside the Vouchers Ledger.',
      confirmText:'Done'
    });
    // Mark vouchers as seen per account (won't show again on any device)
    const ids = fresh.map(r=>r.id);
    try{ await sb.from('requests').update({ transfer_seen:true }).in('id', ids); }catch(e){}
  }catch(e){ /* Notification is non-critical — does not affect the portal */ }
}

// Suggest supplier names from previous vouchers (autocomplete)
async function loadSupplierNames(){
  if(!SB_ON) return;
  try{
    const { data:rows } = await sb.from('requests')
      .select('supplier_invoices').eq('doc_type','disb')
      .order('id',{ascending:false}).limit(400);
    if(!Array.isArray(rows)) return;
    const names = new Set();
    rows.forEach(r=>{
      try{
        (JSON.parse(r.supplier_invoices||'[]')||[]).forEach(s=>{
          const n=(s.supplier||'').trim(); if(n) names.add(n);
        });
      }catch(e){}
    });
    const dl = document.getElementById('supplier-names');
    if(dl) dl.innerHTML = [...names].sort().map(n=>`<option value="${n.replace(/"/g,'&quot;')}">`).join('');
  }catch(e){ /* does not affect the form */ }
}

// Restore session if the user is already logged in
(async function(){
  if(!SB_ON) return;
  try{
    const { data } = await sb.auth.getSession();
    const u = data && data.session ? data.session.user : null;
    if(u){ const m=_mapUser(u.email); if(m){ CURRENT=m; enterApp(); } }
  }catch(e){}
})();

/* ══════════════════════════════════════════
   NAVIGATION
══════════════════════════════════════════ */
function showPage(p){
  ['disb','arc'].forEach(x=>{
    document.getElementById('page-'+x)?.classList.toggle('on', x===p);
    document.getElementById('nav-'+x)?.classList.toggle('on', x===p);
  });
  if (p==='arc') loadArchive();
  window.scrollTo(0,0);
}

/* ══════════════════════════════════════════
   DATES
══════════════════════════════════════════ */
const _t = new Date();
const _pad = n => String(n).padStart(2,'0');
const TODAY = _t.getFullYear()+'-'+_pad(_t.getMonth()+1)+'-'+_pad(_t.getDate());
document.getElementById('d-date').value = TODAY;

/* ══════════════════════════════════════════
   AMOUNT → WORDS (EN + AR)
══════════════════════════════════════════ */
const ones_en=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
const tens_en=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
function b1000_en(n){ if(n<20)return ones_en[n]; if(n<100)return tens_en[Math.floor(n/10)]+(n%10?' '+ones_en[n%10]:''); return ones_en[Math.floor(n/100)]+' Hundred'+(n%100?' '+b1000_en(n%100):''); }
function toEn(n){ if(n===0)return'Zero'; let r=''; if(n>=1000000){r+=b1000_en(Math.floor(n/1000000))+' Million ';n%=1000000;} if(n>=1000){r+=b1000_en(Math.floor(n/1000))+' Thousand ';n%=1000;} if(n>0)r+=b1000_en(n); return r.trim(); }

const ones_ar=['','واحد','اثنان','ثلاثة','أربعة','خمسة','ستة','سبعة','ثمانية','تسعة','عشرة','أحد عشر','اثنا عشر','ثلاثة عشر','أربعة عشر','خمسة عشر','ستة عشر','سبعة عشر','ثمانية عشر','تسعة عشر'];
const tens_ar=['','','عشرون','ثلاثون','أربعون','خمسون','ستون','سبعون','ثمانون','تسعون'];
const hund_ar=['','مائة','مائتان','ثلاثمائة','أربعمائة','خمسمائة','ستمائة','سبعمائة','ثمانمائة','تسعمائة'];
function b1000_ar(n){ if(n===0)return''; if(n<20)return ones_ar[n]; if(n<100){const t=tens_ar[Math.floor(n/10)];return n%10?ones_ar[n%10]+' و'+t:t;} const h=hund_ar[Math.floor(n/100)]; const r=n%100; return r?h+' و'+b1000_ar(r):h; }
function thou_ar(n){ if(n===1)return'ألف'; if(n===2)return'ألفان'; if(n<=10)return ones_ar[n]+' آلاف'; return b1000_ar(n)+' ألفاً'; }
function mil_ar(n){ if(n===1)return'مليون'; if(n===2)return'مليونان'; if(n<=10)return ones_ar[n]+' ملايين'; return b1000_ar(n)+' مليوناً'; }
function toAr(n){ if(n===0)return'صفر'; const p=[]; if(n>=1000000){p.push(mil_ar(Math.floor(n/1000000)));n%=1000000;} if(n>=1000){p.push(thou_ar(Math.floor(n/1000)));n%=1000;} if(n>0)p.push(b1000_ar(n)); return p.join(' و'); }

function fmtAmt(raw){ let c=raw.replace(/[^0-9.]/g,''); const d=c.indexOf('.'); let i=d>=0?c.slice(0,d):c; let dec=d>=0?c.slice(d+1,d+3):null; i=i.replace(/\B(?=(\d{3})+(?!\d))/g,','); return dec!==null?i+'.'+dec:i; }
function parseAmt(s){ const n=parseFloat(String(s).replace(/,/g,'')); return isNaN(n)?0:n; }
function limitPrintText(el){
  const max = parseInt(el.dataset.printMax || el.maxLength || '0', 10);
  if(max > 0 && el.value.length > max) el.value = el.value.slice(0, max);
}
function fitPrintText(value, max=85){
  return String(value == null ? '' : value).slice(0, max);
}

function handleAmt(el){
  const pos=el.selectionStart, oldLen=el.value.length;
  const f=fmtAmt(el.value); el.value=f;
  const np=Math.max(0,pos+(f.length-oldLen)); el.setSelectionRange(np,np);
  updateDisbWords(f);
}
function updateDisbWords(val){
  const we=document.getElementById('d-words-en'), wa=document.getElementById('d-words-ar'), wr=document.getElementById('d-words');
  const n=parseAmt(val);
  if(!val||n===0){ we.textContent=''; wa.textContent=''; wr.classList.add('empty'); return; }
  const whole=Math.floor(n), cents=Math.round((n-whole)*100);
  let e='QAR '+toEn(whole); if(cents>0)e+=' and '+cents+'/100'; e+=' Only';
  let a=toAr(whole); if(cents>0)a+=' و'+cents+' درهم'; a+=' ريال قطري فقط لا غير';
  we.textContent=e; wa.textContent=a; wr.classList.remove('empty');
}

/* ══════════════════════════════════════════
   CANCELLATION — checkboxes + refund total
══════════════════════════════════════════ */
document.querySelectorAll('#c-alloc .chk input').forEach(cb=>{
  cb.addEventListener('change',()=> cb.closest('.chk').classList.toggle('on', cb.checked));
});

/* ══════════════════════════════════════════
   DISBURSEMENT — supplier rows
══════════════════════════════════════════ */
const DISB_MAIN_PRINT_ROWS = 6;
const MAX_DISB_TABLE_ROWS = 24;
function getDisbTableRowsCount(){
  return document.querySelectorAll('#supplier-rows tr.item-row').length + document.querySelectorAll('#client-rows tr').length;
}
function canAddDisbTableRow(){
  if(getDisbTableRowsCount() < MAX_DISB_TABLE_ROWS) return true;
  alert(`You have reached the maximum number of entries.\n\nThe maximum is ${MAX_DISB_TABLE_ROWS} rows. Rows beyond ${DISB_MAIN_PRINT_ROWS} appear in the Invoice Details Appendix when printing.`);
  return false;
}
function ensureDisbRowsPrintable(){
  const count = getDisbTableRowsCount();
  if(count <= MAX_DISB_TABLE_ROWS) return true;
  alert(`Too many rows to print.\n\nCurrent: ${count}\nMaximum: ${MAX_DISB_TABLE_ROWS} rows.`);
  return false;
}
function getDisbSupplierRows(){
  return [...document.querySelectorAll('#supplier-rows tr.item-row')].map((tr, idx)=>({
    idx: idx + 1,
    supplier: tr.querySelector('.s-name')?.value || '',
    description: tr.querySelector('.s-desc')?.value || '',
    invoice: tr.querySelector('.s-inv')?.value || '',
    amount: tr.querySelector('.s-amt')?.value || '0.00',
    reason: tr.nextElementSibling?.querySelector('.s-reason')?.value || '',
    tr
  }));
}
function getDisbClientRows(){
  return [...document.querySelectorAll('#client-rows tr')].map((tr, idx)=>({
    idx: idx + 1,
    invoice: tr.querySelector('.c-inv')?.value || '',
    share: tr.querySelector('.c-amt')?.value || '0.00',
    tr
  }));
}
function clearDisbPrintAppendix(){
  document.getElementById('doc-disb')?.classList.remove('has-appendix','short-disb');
  document.querySelectorAll('#supplier-rows tr.item-row, #client-rows tr').forEach(tr=>tr.classList.remove('print-main-overflow'));
  setDisbMainTotalLabels(false);
  const appendix = document.getElementById('disb-appendix');
  if(appendix){
    appendix.classList.remove('on');
    appendix.innerHTML = '';
  }
}
function setDisbMainTotalLabels(hasAppendix){
  const supplierLabel = document.getElementById('supplier-total-label');
  const clientLabel = document.getElementById('client-total-label');
  if(supplierLabel){
    supplierLabel.textContent = hasAppendix ? 'All Rows Total' : 'Total';
  }
  if(clientLabel){
    clientLabel.textContent = hasAppendix ? 'All Rows Total' : 'Total Cost Center';
  }
}
function markDisbMainRowsForPrint(supplierRows, clientRows){
  let printed = 0;
  [...supplierRows, ...clientRows].forEach(row=>{
    printed += 1;
    row.tr.classList.toggle('print-main-overflow', printed > DISB_MAIN_PRINT_ROWS);
  });
}
function renderAppendixSupplierRows(rows){
  if(!rows.length) return '';
  return `
    <div class="sec-title"><span class="ar">Supplier Invoices - Full Details</span><span class="en">Supplier Invoices - Full Details</span></div>
    <table class="appendix-table">
      <thead><tr><th style="width:10%">#</th><th style="width:40%">Supplier</th><th style="width:28%">Invoice No.</th><th style="width:22%">Amount QAR</th></tr></thead>
      <tbody>${rows.map(r=>`
        <tr><td class="num">${r.idx}</td><td>${escapeHtml(r.supplier || '—')}</td><td>${escapeHtml(r.invoice || '—')}</td><td class="num">${escapeHtml(r.amount || '0.00')}</td></tr>
      `).join('')}</tbody>
      <tfoot><tr class="appendix-total"><td colspan="3">Total</td><td class="num">${escapeHtml(document.getElementById('supplier-total')?.textContent || '0.00')}</td></tr></tfoot>
    </table>`;
}
function renderAppendixClientRows(rows){
  if(!rows.length) return '';
  return `
    <div class="sec-title"><span class="ar">Cost Center - Full Details</span><span class="en">Cost Center - Full Details</span></div>
    <table class="appendix-table">
      <thead><tr><th style="width:10%">#</th><th style="width:58%"><span dir="rtl">Client Invoice No.</span> - <span dir="ltr">Odoo</span><small>Client Invoice No. - Odoo</small></th><th style="width:32%">Share QAR<small>Share QAR</small></th></tr></thead>
      <tbody>${rows.map(r=>`
        <tr><td class="num">${r.idx}</td><td>${escapeHtml(r.invoice || '—')}</td><td class="num">${escapeHtml(r.share || '0.00')}</td></tr>
      `).join('')}</tbody>
      <tfoot><tr class="appendix-total"><td colspan="2">Total Cost Center</td><td class="num">${escapeHtml(document.getElementById('client-total')?.textContent || '0.00')}</td></tr></tfoot>
    </table>`;
}
function prepareDisbPrintAppendix(){
  clearDisbPrintAppendix();
  const supplierRows = getDisbSupplierRows();
  const clientRows = getDisbClientRows();
  const totalRows = supplierRows.length + clientRows.length;
  const doc = document.getElementById('doc-disb');
  if(totalRows <= DISB_MAIN_PRINT_ROWS){
    doc?.classList.toggle('short-disb', totalRows <= 2);
    return;
  }
  markDisbMainRowsForPrint(supplierRows, clientRows);
  setDisbMainTotalLabels(true);
  doc?.classList.add('has-appendix');
  const appendix = document.getElementById('disb-appendix');
  if(!appendix) return;
  const reqNo = document.getElementById('d-reqno')?.value || 'PV';
  appendix.innerHTML = `
    <div class="appendix-head">
      <div><b>Invoice Details Appendix</b><small>Invoice Details Appendix</small></div>
      <span>${escapeHtml(reqNo)}</span>
    </div>
    ${renderAppendixSupplierRows(supplierRows)}
    ${renderAppendixClientRows(clientRows)}
  `;
  appendix.classList.add('on');
}
function addSupplierRow(supplier='',desc='',inv='',amt='',reason='', skipLimit=false){
  if(!skipLimit && !canAddDisbTableRow()) return;
  const tb=document.getElementById('supplier-rows');
  const tr=document.createElement('tr');
  tr.className='item-row';
  tr.innerHTML=`
    <td><input type="text" class="s-name" list="supplier-names" placeholder="Supplier name" value="${supplier}"></td>
    <td><input type="text" class="s-inv"  placeholder="Invoice No." value="${inv}"></td>
    <td class="amt-cell"><input type="text" class="s-amt" placeholder="0.00" value="${amt}" oninput="handleSupplierAmt(this)"></td>
    <td class="no-print"><button class="del-row" onclick="delSupplierRow(this)">✕</button></td>`;
  const rr=document.createElement('tr');
  rr.className='reason-row';
  rr.innerHTML=`<td colspan="3" class="reason-cell"><span class="reason-tag">Reason</span><input type="text" class="s-reason" placeholder="Reason / purpose for this line ..." value="${reason}"></td><td class="no-print"></td>`;
  tb.appendChild(tr); tb.appendChild(rr);
}
function delSupplierRow(btn){
  const r=btn.closest('tr'); const rr=r.nextElementSibling;
  if(rr && rr.classList.contains('reason-row')) rr.remove();
  r.remove(); recalcSupplier();
}
function handleSupplierAmt(el){
  const pos=el.selectionStart, oldLen=el.value.length;
  const f=fmtAmt(el.value); el.value=f;
  const np=Math.max(0,pos+(f.length-oldLen)); el.setSelectionRange(np,np);
  recalcSupplier();
}
function recalcSupplier(){
  let t=0;
  document.querySelectorAll('#supplier-rows .s-amt').forEach(i=> t+=parseAmt(i.value));
  const formatted = t.toLocaleString('en-US',{minimumFractionDigits:2});
  document.getElementById('supplier-total').textContent = formatted;
  // Total Amount to Pay = sum of all invoice amounts (auto)
  const amtEl=document.getElementById('d-amt');
  if(amtEl){ amtEl.value = formatted; updateDisbWords(formatted); }
}
addSupplierRow(); // start with one row


/* ══════════════════════════════════════════
   ATTACHMENTS
══════════════════════════════════════════ */
let ATTACHED = [];
const ATTACH_ICONS = {
  file:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path></svg>',
  clip:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21.4 11.6-8.5 8.5a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"></path></svg>'
};
function escapeHtml(value){
  return String(value||'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}
function getAttachmentLabel(attachment){
  if(typeof attachment==='string'){
    return attachment.split('/').pop() || attachment;
  }
  return attachment && attachment.name ? attachment.name : 'attachment.pdf';
}
function getAttachmentSize(attachment){
  if(attachment instanceof Blob && typeof attachment.size==='number'){
    return `${(attachment.size/1024).toFixed(0)} KB`;
  }
  return '(saved)';
}
function getAttachmentMime(attachment){
  if(attachment instanceof Blob && attachment.type) return attachment.type;
  const name = getAttachmentLabel(attachment).toLowerCase();
  if(name.endsWith('.pdf')) return 'application/pdf';
  if(/\.(jpe?g)$/i.test(name)) return 'image/jpeg';
  if(/\.png$/i.test(name)) return 'image/png';
  if(/\.gif$/i.test(name)) return 'image/gif';
  if(/\.webp$/i.test(name)) return 'image/webp';
  if(/\.bmp$/i.test(name)) return 'image/bmp';
  if(/\.svg$/i.test(name)) return 'image/svg+xml';
  if(/\.(heic|heif)$/i.test(name)) return 'image/heic';
  return 'application/octet-stream';
}
function isAllowedInvoiceAttachment(file){
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  return type === 'application/pdf'
    || type.startsWith('image/')
    || /\.(pdf|jpe?g|png|gif|webp|bmp|svg|heic|heif)$/i.test(name);
}
function addFiles(fileList){
  for (const f of fileList){
    if (isAllowedInvoiceAttachment(f)){
      ATTACHED.push(f);
    }
  }
  renderAttach();
}
function renderAttach(){
  const box=document.getElementById('attach-list');
  box.innerHTML = ATTACHED.map((f,i)=>`
    <div class="attach-item">
      <span class="ico">${typeof f==='string' ? ATTACH_ICONS.clip : ATTACH_ICONS.file}</span>
      <span class="nm">${escapeHtml(getAttachmentLabel(f))}</span>
      <span class="sz">${escapeHtml(getAttachmentSize(f))}</span>
      <div class="attach-actions no-print">
        <button class="att-btn" onclick="previewAttachment(${i})">Preview</button>
        <button class="att-btn" onclick="downloadAttachment(${i})">Download</button>
        <button class="rm" onclick="removeFile(${i})">✕</button>
      </div>
    </div>`).join('');
}
function removeFile(i){ ATTACHED.splice(i,1); renderAttach(); }
async function previewAttachment(i){
  const attachment = ATTACHED[i];
  if(!attachment){ alert('No attachment.'); return; }
  if(attachment instanceof Blob){
    const url = URL.createObjectURL(attachment);
    window.open(url, '_blank');
    setTimeout(()=>URL.revokeObjectURL(url), 40000);
    return;
  }
  await openSourceInNewTab(attachment);
}
async function downloadAttachment(i){
  const attachment = ATTACHED[i];
  if(!attachment){ alert('No attachment.'); return; }
  try{
    const bytes = await getAttachmentBytes(attachment);
    const name = getAttachmentLabel(attachment) || `attachment_${i+1}.pdf`;
    dl(new Blob([bytes], { type:getAttachmentMime(attachment) }), name);
  }catch(e){
    alert('Could not download the attachment.');
    console.error(e);
  }
}

/* ══════════════════════════════════════════
   ELECTRONIC SIGNATURE
══════════════════════════════════════════ */
let SIGNED = { cancel:null, disb:null };
let ACC_SIGN = { cancel:null, disb:null }; // Accounts approval is separate per voucher type
let EDIT_ID  = null;      // id of the voucher opened from the ledger (if any)
let EDIT_REQUEST = null;  // data of the voucher opened from the ledger
let VIEW_ONLY = false;    // Open the voucher for viewing only (no editing)
function getAccSign(kind){ return ACC_SIGN[kind] || null; }
function setAccSign(kind, value){ ACC_SIGN[kind] = value || null; }
function isApprovedRequest(x){ return !!(x && x.accounts_signed_by); }
function isOwnRequest(x){ return !!(CURRENT && x && x.created_by === CURRENT.name); }
function canCurrentEditRequest(x){
  if(CURRENT && CURRENT.role === 'viewer') return false;   // view-only account
  if(!x) return true;
  if(x.cancelled) return false;
  if(CURRENT && CURRENT.role === 'accountant') return true;
  return isOwnRequest(x) && !isApprovedRequest(x);
}
function setDocumentLocked(kind, locked){
  const doc = document.getElementById(kind === 'cancel' ? 'doc-cancel' : 'doc-disb');
  if(doc){
    doc.dataset.locked = locked ? '1' : '0';
    doc.querySelectorAll('input, textarea, select, button').forEach(el=>{
      if(el.classList.contains('no-lock')) return;
      el.disabled = !!locked;
    });
    doc.querySelectorAll('.attach-zone').forEach(el=>{
      el.style.pointerEvents = locked ? 'none' : '';
      el.style.opacity = locked ? '.55' : '';
    });
  }
  const saveBtn = document.getElementById(kind + '-save-btn');
  if(saveBtn) saveBtn.disabled = !!locked;
  const signBtn = document.getElementById(kind + '-sign-btn');
  if(signBtn) signBtn.disabled = !!locked;
  if(kind === 'disb' && typeof updateCostCenterDisabledUI === 'function') updateCostCenterDisabledUI();
}
function applyArchiveEditLock(kind, request){
  const locked = VIEW_ONLY || !!(request && !canCurrentEditRequest(request));
  setDocumentLocked(kind, locked);
  if(VIEW_ONLY){
    const status = document.getElementById(kind + '-pdf-status');
    if(status) status.textContent = 'You are viewing the voucher in read-only mode — choose "Edit voucher" from the ledger to edit it.';
    return;
  }
  if(locked && CURRENT && CURRENT.role !== 'accountant'){
    if(kind === 'disb'){
      const status = document.getElementById('disb-pdf-status');
      if(status) status.textContent = 'This voucher is approved by Accounts; it is available for printing only and cannot be edited.';
    }
  }
}

// First two letters of the name (signature monogram)
// Name map (Arabic or English) -> initials in English (for the handwritten signature)
const INITIALS_MAP = (function(){
  const m = {};
  Object.values(USER_MAP).forEach(u=>{
    const en = String(u.name_en||'').trim();
    const p  = en.split(/\s+/).filter(Boolean);
    const ini = dottedInitials(p);
    if(ini){ m[String(u.name||'').trim()] = ini; m[en] = ini; }
  });
  return m;
})();
// First two initials separated by a dot: e.g. "Anas Ibrahim" -> "A.I"
function dottedInitials(parts){
  return [parts[0]&&parts[0][0], parts[1]&&parts[1][0]]
    .filter(Boolean).map(c=>c.toUpperCase()).join('.');
}
function initials(name){
  const key = String(name||'').trim();
  if(INITIALS_MAP[key]) return INITIALS_MAP[key];
  const parts = key.split(/\s+/).filter(Boolean);
  // Initials from the first two words, always English (capitalized), dot-separated
  return dottedInitials(parts);
}
// Date and time in English: 05/06/2026 · 02:15 PM
function stampDate(d){
  d = d ? (d instanceof Date ? d : new Date(d)) : new Date();
  if(isNaN(d)) d = new Date();
  const p = n => String(n).padStart(2,'0');
  const dd=p(d.getDate()), mm=p(d.getMonth()+1), yy=d.getFullYear();
  let h=d.getHours(); const min=p(d.getMinutes()); const ap=h>=12?'PM':'AM';
  h=h%12; if(h===0) h=12;
  return `${dd}/${mm}/${yy} · ${p(h)}:${min} ${ap}`;
}

function signDoc(kind){
  if(!CURRENT) return;
  if(CURRENT.role==='viewer'){
    showMessageDialog({ title:'View-only permission', message:'Your account is for viewing and printing only; you cannot sign vouchers.', confirmText:'OK' });
    return;
  }
  const now=new Date();
  const dt = stampDate(now);
  SIGNED[kind] = { name:CURRENT.name, user:CURRENT.user, time:now.toISOString(), label:dt };
  document.getElementById(kind+'-sig-ph').style.display='none';
  document.getElementById(kind+'-sig-stamp').classList.add('on');
  document.getElementById(kind+'-sig-mono').textContent = initials(CURRENT.name);
  document.getElementById(kind+'-sig-name').textContent = CURRENT.name;
  document.getElementById(kind+'-sig-meta').textContent = dt;
  showMessageDialog({
    title:'Signed electronically',
    message:'Your electronic signature has been recorded on the voucher successfully.',
    details:[
      { label:'Signed by', value:CURRENT.name },
      { label:'Signed at', value:dt, ltr:true }
    ],
    note:'You can now submit or print the voucher as required.',
    confirmText:'OK'
  });
}
function signDisbDoc(){ return signDoc('disb'); }

// Accounts approval (accountant only) — from the form or the ledger, for Payment or Cancellation vouchers
async function signAccountsFor(kind){
  if(!CURRENT || CURRENT.role!=='accountant'){ alert('Accounts approval is available to the accountant only.'); return; }
  const pfx = kind === 'cancel' ? 'cancel' : 'disb';
  const now=new Date();
  const dt = stampDate(now);
  setAccSign(pfx, { name:CURRENT.name, time:now.toISOString(), label:dt });
  document.getElementById(pfx+'-acc-ph').style.display='none';
  document.getElementById(pfx+'-acc-stamp').classList.add('on');
  document.getElementById(pfx+'-acc-mono').textContent = initials(CURRENT.name);
  document.getElementById(pfx+'-acc-name').textContent = CURRENT.name;
  document.getElementById(pfx+'-acc-meta').textContent = dt;
  if(EDIT_ID && SB_ON){
    const btn=document.getElementById(pfx+'-acc-btn'); const o=btn?btn.textContent:'';
    if(btn){ btn.disabled=true; btn.textContent='Approving...'; }
    try{
      const { error } = await sb.from('requests').update({
        accounts_signed_by: CURRENT.name, accounts_signed_at: now.toISOString()
      }).eq('id', EDIT_ID);
      if(error){ console.error(error); alert('Could not save the approval — make sure the update policy is enabled in Supabase (see the SQL in the instructions).'); }
      else {
        if(EDIT_REQUEST){
          EDIT_REQUEST = { ...EDIT_REQUEST, accounts_signed_by: CURRENT.name, accounts_signed_at: now.toISOString() };
        }
        showMessageDialog({
          title:'Voucher approved',
          message:'The voucher has been approved by the Accounts Dept. and saved to the ledger.',
          details:[
            { label:'Voucher No.', value: displayRequestNo(EDIT_REQUEST?.req_no) || '—', ltr:true },
            { label:'Approved by', value: CURRENT.name },
            { label:'Approved at', value: dt, ltr:true }
          ],
          note:'The voucher is now available for printing.',
          confirmText:'OK'
        });
      }
    }catch(e){ alert('Supabase connection error.'); console.error(e); }
    if(btn){ btn.disabled=false; btn.textContent=o; }
  }
}
async function signDisbAccounts(){ return signAccountsFor('disb'); }

/* ══════════════════════════════════════════
   REQUEST PDF (attachments stay separate)
══════════════════════════════════════════ */
async function generateRequestPDF(docId='doc-disb'){
  commitValuesForPrint();
  await document.fonts.ready;
  const el=document.getElementById(docId);
  const hidden = [...el.querySelectorAll('.attach-zone, .attach-list, #attach-list, .attach-item, #disb-attach-sec, .add-row-btn')];
  const originalDisplay = hidden.map(node=>[node, node.style.display]);
  const originalStyles = {
    width: el.style.width,
    maxWidth: el.style.maxWidth,
    margin: el.style.margin,
    boxShadow: el.style.boxShadow,
    borderRadius: el.style.borderRadius,
    transform: el.style.transform,
  };
  hidden.forEach(node=>node.style.display='none');
  el.style.width = '210mm';
  el.style.maxWidth = '210mm';
  el.style.margin = '0 auto';
  el.style.boxShadow = 'none';
  el.style.borderRadius = '0';
  el.style.transform = 'none';
  const captureScale = 3;
  let canvas;
  try{
    await new Promise(requestAnimationFrame);
    canvas = await html2canvas(el,{scale:captureScale,backgroundColor:'#ffffff',useCORS:true,
      scrollX:0,
      scrollY:0,
      windowWidth:el.scrollWidth,
      windowHeight:el.scrollHeight,
      ignoreElements:(n)=>n.classList&&n.classList.contains('no-print')});
  }finally{
    originalDisplay.forEach(([node, value])=>{ node.style.display = value; });
    el.style.width = originalStyles.width;
    el.style.maxWidth = originalStyles.maxWidth;
    el.style.margin = originalStyles.margin;
    el.style.boxShadow = originalStyles.boxShadow;
    el.style.borderRadius = originalStyles.borderRadius;
    el.style.transform = originalStyles.transform;
  }
  const img = canvas.toDataURL('image/png');
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p','mm','a4');
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  const PX_TO_MM = 0.2645833333;
  const canvasWidthMm = canvas.width * PX_TO_MM;
  const canvasHeightMm = canvas.height * PX_TO_MM;
  const pdfScale = canvasWidthMm > 0 ? Math.min(1, pw / canvasWidthMm) : 1;
  const imgW = canvasWidthMm * pdfScale;
  const imgH = canvasHeightMm * pdfScale;
  const offsetX = Math.max(0, (pw - imgW) / 2);
  const totalPages = Math.ceil(imgH / ph);
  for(let pageIndex = 0; pageIndex < totalPages; pageIndex++){
    if(pageIndex > 0) pdf.addPage();
    pdf.addImage(img, 'PNG', offsetX, -ph * pageIndex, imgW, imgH);
  }
  return pdf.output('arraybuffer');
}
async function getAttachmentBytes(attachment){
  if(attachment instanceof Blob){
    return await attachment.arrayBuffer();
  }
  if(typeof attachment==='string'){
    if(isDataUrl(attachment)){
      return await dataUrlToBlob(attachment).arrayBuffer();
    }
    if(attachment.startsWith('blob:')){
      const res = await fetch(attachment);
      if(!res.ok) throw new Error('Failed to fetch the Blob URL');
      return await res.arrayBuffer();
    }
    if(isHttpUrl(attachment)){
      const res = await fetch(attachment);
      if(!res.ok) throw new Error('Failed to fetch the attachment URL');
      return await res.arrayBuffer();
    }
    if(isStoragePath(attachment)){
      const url = await resolveStorageUrl(attachment);
      if(!url) throw new Error('Failed to convert the storage path to a URL');
      const res = await fetch(url);
      if(!res.ok) throw new Error('Failed to fetch the storage file');
      return await res.arrayBuffer();
    }
  }
  if(attachment && typeof attachment.arrayBuffer==='function'){
    return await attachment.arrayBuffer();
  }
  throw new Error('Unsupported attachment type');
}
function dl(blob,name){ const u=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=u; a.download=name; a.click(); URL.revokeObjectURL(u); }

/* ══════════════════════════════════════════
   COLLECT + SAVE TO ARCHIVE
══════════════════════════════════════════ */
function collectDisb(){
  const accSign = getAccSign('disb');
  const sup=[...document.querySelectorAll('#supplier-rows tr.item-row')].map(tr=>({
    supplier: tr.querySelector('.s-name')?.value||'',
    description: tr.querySelector('.s-desc')?.value||'',
    invoice:  tr.querySelector('.s-inv')?.value||'',
    amount:   parseAmt(tr.querySelector('.s-amt')?.value||0),
    reason:   tr.nextElementSibling?.querySelector('.s-reason')?.value||'',
  })).filter(r=>r.supplier||r.invoice||r.amount);
  return {
    doc_type:'disb',
    req_no: document.getElementById('d-reqno').value,
    req_date: document.getElementById('d-date').value||null,
    name: document.getElementById('d-name').value||null,
    department: document.getElementById('d-dept').value||null,
    project: document.getElementById('d-project')?.value||null,
    notes: JSON.stringify({method:document.getElementById('d-pay-method')?.value||'',date:document.getElementById('d-pay-date')?.value||'',bank:document.getElementById('d-pay-bank')?.value||'',ref:document.getElementById('d-pay-ref')?.value||''}),
    beneficiary: (sup[0] && sup[0].supplier) || null,
    supplier_invoices: JSON.stringify(sup),
    amount: parseAmt(document.getElementById('d-amt').value)||null,
    attachments_count: getCurrentAttachmentCount(),
    created_by: CURRENT?.name||null,
    signed_by: SIGNED.disb?.name||null,
    signed_at: SIGNED.disb?.time||null,
    accounts_signed_by: accSign?.name||null,
    accounts_signed_at: accSign?.time||null,
  };
}

function requestPrefix(kind){ return kind === 'cancel' ? 'RR' : 'PV'; }
function requestInputId(kind){ return kind === 'cancel' ? 'c-reqno' : 'd-reqno'; }
function formatRequestNo(kind, num){
  return `${requestPrefix(kind)}-${String(num).padStart(4,'0')}`;
}
function extractRequestNoNumber(kind, value){
  const m = displayRequestNo(value).match(new RegExp(`^${requestPrefix(kind)}-(\\d+)$`, 'i'));
  return m ? parseInt(m[1], 10) || 0 : 0;
}
function displayRequestNo(value){
  return String(value||'').trim().replace(/__cancelled_\d+$/i, '');
}
function cancelledStorageRequestNo(row){
  const base = displayRequestNo(row?.req_no);
  if(!base) return row?.req_no || null;
  if(String(row?.req_no||'').includes('__cancelled_')) return row.req_no;
  return `${base}__cancelled_${row?.id || Date.now()}`;
}
async function releaseCancelledRequestNo(reqNo){
  if(!SB_ON || !reqNo) return;
  const base = displayRequestNo(reqNo);
  const { data:rows, error } = await sb.from('requests')
    .select('id,req_no,cancelled')
    .eq('req_no', base)
    .eq('cancelled', true)
    .limit(20);
  if(error) throw error;
  for(const row of (Array.isArray(rows) ? rows : [])){
    const { error:updateError } = await sb.from('requests')
      .update({ req_no: cancelledStorageRequestNo(row) })
      .eq('id', row.id);
    if(updateError) throw updateError;
  }
}
async function getNextRequestNo(kind){
  if(!SB_ON) return formatRequestNo(kind, 1);
  const docType = kind === 'cancel' ? 'cancel' : 'disb';
  const { data, error } = await sb.from('requests')
    .select('req_no')
    .eq('doc_type', docType)
    .or('cancelled.is.null,cancelled.eq.false')
    .not('req_no', 'is', null)
    .limit(1000);
  if(error) throw error;
  // Currently used active voucher numbers (cancelled ones are excluded by the query above)
  const used = new Set(
    (Array.isArray(data) ? data : [])
      .map(row => extractRequestNoNumber(kind, row.req_no))
      .filter(n => n > 0)
  );
  // Smallest available number: fills gaps left by cancelled vouchers so their number is reused
  let next = 1;
  while(used.has(next)) next++;
  return formatRequestNo(kind, next);
}
async function assignNextRequestNo(kind, rec){
  if(EDIT_ID) return rec.req_no;
  const next = await getNextRequestNo(kind);
  rec.req_no = next;
  const input = document.getElementById(requestInputId(kind));
  if(input) input.value = next;
  return next;
}
async function refreshNextRequestNo(kind){
  if(EDIT_ID) return;
  const input = document.getElementById(requestInputId(kind));
  if(!input) return;
  try{ input.value = await getNextRequestNo(kind); }catch(e){}
}
function refreshNextRequestNumbers(){
  refreshNextRequestNo('cancel');
  refreshNextRequestNo('disb');
}

async function persistRequestRecord(kind, rec){
  if(CURRENT && CURRENT.role==='viewer'){
    showMessageDialog({ title:'View-only permission', message:'Your account is for viewing and printing only; you cannot submit or edit vouchers.', confirmText:'OK' });
    return;
  }
  // Cannot submit without an electronic signature
  if(!rec.signed_by){
    showMessageDialog({
      title:'Signature Required',
      subtitle:'Signature Required',
      message:'The voucher cannot be submitted before signing electronically. Please click the "Electronic Signature" button first, then submit.',
      confirmText:'OK'
    });
    return;
  }
  const btn = document.getElementById(kind+'-save-btn');
  if(!SB_ON){
    alert('Cloud save is not enabled — the voucher is ready for printing, download and sharing on Teams. To enable the ledger, add your Supabase credentials in the file settings.');
    return;
  }
  if(EDIT_ID && EDIT_REQUEST?.cancelled){
    EDIT_ID = null;
    EDIT_REQUEST = null;
  }
  if(EDIT_ID && !canCurrentEditRequest(EDIT_REQUEST)){
    alert('This voucher cannot be edited.\n\nIt has been approved by the Accounts Dept. or you do not have permission to edit it.');
    return;
  }
  btn.disabled=true; const o=btn.textContent; btn.textContent='Submitting...';
  try{
    if(!EDIT_ID){
      await assignNextRequestNo(kind, rec);
      await releaseCancelledRequestNo(rec.req_no);
    }
    const result = EDIT_ID
      ? await sb.from('requests').update(rec).eq('id', EDIT_ID)
      : await sb.from('requests').insert([rec]).select('id').single();
    const { data, error } = result;
    if(!error){
      showMessageDialog({
        title: EDIT_ID ? 'Voucher updated' : 'Voucher submitted',
        message: EDIT_ID
          ? 'The voucher data has been updated successfully, and the changes are now available in the Vouchers Ledger.'
          : 'The voucher has been submitted successfully and is now available in the Vouchers Ledger.',
        details:[
          { label:'Voucher No.', value: rec.req_no || '—', ltr:true }
        ],
        confirmText:'OK'
      });
      if(EDIT_ID && EDIT_REQUEST) EDIT_REQUEST = { ...EDIT_REQUEST, ...rec };
      if(!EDIT_ID && data?.id){
        EDIT_ID = data.id;
        EDIT_REQUEST = { ...rec, id:data.id };
      }
    }
    else { console.error(error); 
      let msg = 'Could not save — make sure you are logged in and the requests table is configured in Supabase.';
      if(error.message && error.message.includes('column')){ msg += '\n\nA database column is missing — please contact the administrator.'; }
      if(error.code === '23505' || /duplicate|unique/i.test(error.message||'')){
        msg += '\n\nThere is an old cancelled voucher with the same number. Click Save again after refreshing the page, and if the error persists, open the cancelled voucher from the ledger and cancel it again to release the number.';
      }
      alert(msg); 
    }
  }catch(e){ alert('Supabase connection error.'); console.error(e); }
  btn.disabled=false; btn.textContent=o;
}


// Required fields for the Payment Voucher — returns a list of what is missing
function validateDisbRequest(){
  const errs = [];
  // 1) Electronic signature
  if(!SIGNED.disb) errs.push('sign electronically');
  // 2) A complete supplier invoice (name + invoice no. + amount)
  const supRows = [...document.querySelectorAll('#supplier-rows tr.item-row')].map(tr=>({
    name: (tr.querySelector('.s-name')?.value||'').trim(),
    inv:  (tr.querySelector('.s-inv')?.value||'').trim(),
    amt:  parseAmt(tr.querySelector('.s-amt')?.value||0),
  }));
  if(!supRows.some(r=> r.name && r.inv && r.amt>0))
    errs.push('add a complete supplier invoice (supplier name, invoice no. and amount)');
  // 4) Total amount to be paid
  if(!(parseAmt(document.getElementById('d-amt')?.value||0) > 0))
    errs.push('enter the total amount to be paid');
  return errs;
}

async function saveDisbDoc(){
  const errs = validateDisbRequest();
  if(errs.length){
    showMessageDialog({
      title:'Missing Required Fields',
      subtitle:'Required Fields',
      message:'The voucher cannot be submitted before completing the following:\n\n'
        + errs.map((e,i)=>`${i+1}- You must ${e}`).join('\n'),
      confirmText:'OK'
    });
    return;
  }
  const rec = collectDisb();
  // Always approved — the single signatory (admin) is the sole authority
  rec.accounts_signed_by = rec.accounts_signed_by || rec.signed_by || (CURRENT && CURRENT.name) || null;
  rec.accounts_signed_at = rec.accounts_signed_at || rec.signed_at || null;
  const savedPaths = ATTACHED.filter(a=>typeof a==='string');
  const newFiles = ATTACHED.filter(a=>a instanceof Blob);
  if(newFiles.length>0){
    try{
      const paths = await uploadAttachments(newFiles, 'request-attachments');
      rec.attachments_data = JSON.stringify([...savedPaths, ...paths]);
    }catch(e){
      console.error(e);
      alert(`Could not upload the attachments.\n\nError:\n${e.message || e}\n\nYou likely need to make sure a bucket named request-attachments exists in Supabase Storage and that the upload policy is enabled for logged-in users.`);
      return;
    }
  } else {
    // ATTACHED is the source of truth: if attachments remain we save them; if all removed, attachments are truly empty
    rec.attachments_data = savedPaths.length>0 ? JSON.stringify(savedPaths) : null;
  }
  return persistRequestRecord('disb', rec);
}

/* ══════════════════════════════════════════
   ARCHIVE
══════════════════════════════════════════ */
let ARC_TAB='all';
const ARC_COLS = 9;
const ARC_ICONS = {
  comment:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
  view:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"></path><circle cx="12" cy="12" r="2.5"></circle></svg>',
  download:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg>',
  print:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8V3h10v5"></path><path d="M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><path d="M7 14h10v7H7z"></path></svg>',
  upload:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21V10"></path><path d="m7 15 5-5 5 5"></path><path d="M5 5h14"></path></svg>',
  file:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path></svg>',
  paperclip:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21.4 11.6-8.5 8.5a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"></path></svg>',
  clock:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>',
  hourglass:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h12"></path><path d="M6 22h12"></path><path d="M7 2v6l5 4 5-4V2"></path><path d="M7 22v-6l5-4 5 4v6"></path></svg>',
  more:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5"></circle><circle cx="12" cy="12" r="1.5"></circle><circle cx="19" cy="12" r="1.5"></circle></svg>',
  sign:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>',
  trash:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M6 6l1 16h10l1-16"></path></svg>'
};
function setArcTab(t){
  if(t === 'cancelled' && (!CURRENT || CURRENT.role !== 'accountant')) t = 'all';
  ARC_TAB=t;
  ['all','cancel','disb','cancelled'].forEach(x=>{
    const tab = document.getElementById('atab-'+x);
    if(tab) tab.classList.toggle('on',x===t);
  });
  loadArchive();
}
function formatArchiveDateTime(value){
  if(!value) return '—';
  const d = new Date(value);
  if(Number.isNaN(d.getTime())) return value || '—';
  const p = n => String(n).padStart(2,'0');
  return `${p(d.getDate())}-${p(d.getMonth()+1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function escAttr(value){
  return String(value ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function showConfirmDialog({ title, message, details=[], note='', confirmText='Confirm', cancelText='Back', danger=false, showCancel=true, subtitle }){
  return new Promise(resolve=>{
    const old = document.getElementById('app-confirm-overlay');
    if(old) old.remove();
    const overlay = document.createElement('div');
    overlay.id = 'app-confirm-overlay';
    overlay.dir = 'ltr';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(15,27,43,.55);display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);';
    const accent = danger ? 'var(--red)' : 'var(--teal)';
    const accentSoft = danger ? 'rgba(224,82,107,.28)' : 'rgba(21,36,56,.28)';
    const caption = subtitle !== undefined ? subtitle : (showCancel ? 'Confirmation' : 'Notification');
    const detailsHtml = details.length ? `<div class="acd-details">${details.map((d, idx)=>`
      <div class="acd-row"${idx === details.length - 1 ? '' : ' data-sep="1"'}>
        <span class="acd-row-label">${escapeHtml(d.label)}</span>
        <b class="acd-row-value" style="direction:${d.ltr?'ltr':'rtl'};">${escapeHtml(d.value || '—')}</b>
      </div>`).join('')}</div>` : '';
    overlay.innerHTML = `
      <style>
        @keyframes acdFade{from{opacity:0}to{opacity:1}}
        @keyframes acdPop{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:none}}
        #app-confirm-overlay{animation:acdFade .18s ease both;}
        #app-confirm-overlay .acd-card{width:min(460px,100%);background:#fff;border-radius:20px;box-shadow:0 1px 1px rgba(15,27,43,.04),0 18px 48px -12px rgba(15,27,43,.32),0 40px 80px -24px rgba(15,27,43,.22);overflow:hidden;font-family:'Plus Jakarta Sans','Cairo','Montserrat',sans-serif;animation:acdPop .26s cubic-bezier(.2,.8,.25,1) both;}
        #app-confirm-overlay .acd-head{position:relative;padding:22px 24px 20px;background:linear-gradient(120deg,var(--indigo) 0%,var(--teal) 48%,var(--indigo) 100%);color:#fff;}
        #app-confirm-overlay .acd-head::after{content:"";position:absolute;left:0;right:0;bottom:0;height:3px;background:linear-gradient(90deg,rgba(255,255,255,.0),rgba(255,255,255,.35),rgba(255,255,255,.0));}
        #app-confirm-overlay .acd-title{font-size:18px;font-weight:800;line-height:1.45;}
        #app-confirm-overlay .acd-cap{font-family:'Plus Jakarta Sans','Montserrat',sans-serif;font-size:10px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;opacity:.72;margin-top:3px;}
        #app-confirm-overlay .acd-body{padding:20px 24px 6px;}
        #app-confirm-overlay .acd-msg{font-size:14.5px;font-weight:600;color:var(--ink);line-height:1.9;white-space:pre-line;}
        #app-confirm-overlay .acd-details{margin-top:16px;border:1px solid var(--bg);border-radius:14px;background:var(--tint);overflow:hidden;}
        #app-confirm-overlay .acd-row{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:11px 14px;}
        #app-confirm-overlay .acd-row[data-sep]{border-bottom:1px solid var(--bg);}
        #app-confirm-overlay .acd-row-label{font-size:11.5px;font-weight:700;color:var(--gray);}
        #app-confirm-overlay .acd-row-value{font-size:13px;font-weight:800;color:var(--indigo);}
        #app-confirm-overlay .acd-note{margin-top:14px;color:var(--gray);font-size:12px;line-height:1.75;}
        #app-confirm-overlay .acd-foot{display:flex;gap:10px;justify-content:flex-start;padding:18px 24px 22px;}
        #app-confirm-overlay .acd-btn{border:none;border-radius:12px;padding:11px 24px;font-family:'Plus Jakarta Sans','Cairo',sans-serif;font-size:13.5px;font-weight:800;cursor:pointer;transition:transform .12s ease,box-shadow .15s ease,background .15s ease;}
        #app-confirm-overlay .acd-btn:active{transform:translateY(1px);}
        #app-confirm-overlay .acd-btn:focus-visible{outline:2px solid ${accent};outline-offset:2px;}
        #app-confirm-overlay .acd-confirm{background:${accent};color:#fff;box-shadow:0 10px 22px -6px ${accentSoft};}
        #app-confirm-overlay .acd-confirm:hover{filter:brightness(1.05);box-shadow:0 14px 28px -8px ${accentSoft};}
        #app-confirm-overlay .acd-cancel{background:#fff;border:1.5px solid var(--border);color:var(--indigo);}
        #app-confirm-overlay .acd-cancel:hover{background:var(--tint);border-color:#C7D3E1;}
      </style>
      <div class="acd-card" role="dialog" aria-modal="true">
        <div class="acd-head">
          <div class="acd-title">${escapeHtml(title)}</div>
          ${caption ? `<div class="acd-cap">${escapeHtml(caption)}</div>` : ''}
        </div>
        <div class="acd-body">
          <div class="acd-msg">${escapeHtml(message)}</div>
          ${detailsHtml}
          ${note ? `<div class="acd-note">${escapeHtml(note)}</div>` : ''}
        </div>
        <div class="acd-foot">
          ${showCancel ? `<button data-action="cancel" class="acd-btn acd-cancel">${escapeHtml(cancelText)}</button>` : ''}
          <button data-action="confirm" class="acd-btn acd-confirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>`;
    const close = value => { document.removeEventListener('keydown', onKey); overlay.remove(); resolve(value); };
    overlay.addEventListener('click', e=>{ if(e.target === overlay) close(false); });
    overlay.querySelector('[data-action="cancel"]')?.addEventListener('click', ()=>close(false));
    overlay.querySelector('[data-action="confirm"]').addEventListener('click', ()=>close(true));
    const onKey = e=>{
      if(e.key === 'Escape') close(false);
      if(e.key === 'Enter') close(true);
    };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    (overlay.querySelector(showCancel ? '[data-action="cancel"]' : '[data-action="confirm"]')).focus();
  });
}
function showMessageDialog({ title, message, details=[], note='', confirmText='Done', subtitle }){
  return showConfirmDialog({ title, message, details, note, confirmText, subtitle, showCancel:false, danger:false });
}
function getArchiveSubmittedDateRange(){
  const value = document.getElementById('arc-submitted-date')?.value;
  if(!value) return null;
  const start = new Date(value + 'T00:00:00');
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start:start.toISOString(), end:end.toISOString() };
}
function closeArchiveTimePopover(){
  const pop = document.getElementById('arc-time-pop');
  if(pop) pop.classList.remove('on');
}
function closeArchiveMenu(){
  const pop = document.getElementById('arc-menu-pop');
  if(pop) pop.classList.remove('on');
}
function positionArchivePopover(pop, btn){
  const r = btn.getBoundingClientRect();
  const width = pop.offsetWidth || 240;
  const height = pop.offsetHeight || 0;
  let left = r.right - width;
  left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
  pop.style.left = left + 'px';
  const spaceBelow = window.innerHeight - r.bottom;
  let top;
  if(height && spaceBelow < height + 16 && r.top > spaceBelow){
    top = Math.max(12, r.top - height - 10);              // not enough room below → open upward
  } else {
    top = r.bottom + 10;
    if(height) top = Math.min(top, Math.max(12, window.innerHeight - height - 12)); // keep inside the viewport
  }
  pop.style.top = top + 'px';
}
function showArchiveTimePopover(btn, submittedAt, approvedAt){
  const pop = document.getElementById('arc-time-pop');
  if(!pop) return;
  closeArchiveMenu();
  pop.innerHTML = `
    <div class="pop-title"><span>Timeline</span><small>Timeline</small></div>
    <div class="arc-time-row"><span>Submitted</span><b>${submittedAt || '—'}</b></div>
    <div class="arc-time-row"><span>Accounts Approval</span><b>${approvedAt || 'Not approved yet'}</b></div>
  `;
  pop.classList.add('on');
  positionArchivePopover(pop, btn);
}
function archiveMenuButton(label, icon, action, danger=false){
  return `<button class="arc-menu-item${danger?' danger':''}" onclick="${action}; closeArchiveMenu();"><span>${label}</span>${icon}</button>`;
}
function showArchiveMenu(btn, title, subtitle, html){
  const pop = document.getElementById('arc-menu-pop');
  if(!pop) return;
  closeArchiveTimePopover();
  pop.innerHTML = `<div class="pop-title"><span>${title}</span><small>${subtitle||'Actions'}</small></div>${html}`;
  pop.classList.add('on');
  positionArchivePopover(pop, btn);
}
function getArchiveRowAttachments(row){
  if(!row || !row.attachments_data) return [];
  try{
    const atts = JSON.parse(row.attachments_data);
    return Array.isArray(atts) ? atts : [];
  }catch(e){
    return [];
  }
}
/* ══════════════════════════════════════════
   Voucher Comments — with visibility levels
══════════════════════════════════════════ */
// Visibility levels: the author always sees their own comment
//  all   = Everyone
//  mgmt  = Management only  -> accountant + management team (viewer)
//  staff = Staff          -> accountant + sales
const COMMENT_VIS = {
  all:   { label:'Everyone',      hint:'Shown to all users' },
  mgmt:  { label:'Management only', hint:'Accountant and management team only' },
  staff: { label:'Staff',    hint:'Accountant and sales only' },
};
let COMMENT_EDIT = null; // id of the comment being edited (inside the comments dialog)

// Comments are a simple public thread now: anyone signed in can write, everyone sees all.
function getRequestComments(row){ return (row && window._commentsByReq && window._commentsByReq[row.id]) || []; }
function getVisibleComments(row){ return getRequestComments(row); }
function canAddComment(row){ return !!(CURRENT && row && !row.cancelled); }
function canModifyComment(row, c){ return !!(CURRENT && c && c.email && CURRENT.email && String(c.email).toLowerCase()===String(CURRENT.email).toLowerCase() && row && !row.cancelled); }
function commentRoleLabel(role){ return role==='accountant' ? 'Finance' : role==='viewer' ? 'Partner' : ''; }
function commentVisBadge(){ return ''; }
function openCommentsDialog(i){
  const x = (window._arcRows||[])[i];
  if(!x){ alert('Could not open the voucher.'); return; }
  COMMENT_EDIT = null;
  renderCommentsOverlay(i);
}
function closeCommentsOverlay(){
  COMMENT_EDIT = null;
  document.getElementById('app-comments-overlay')?.remove();
}
function renderCommentsOverlay(i){
  const x = (window._arcRows||[])[i];
  if(!x) return;
  document.getElementById('app-comments-overlay')?.remove();
  const visible = getVisibleComments(x);
  const canAdd = canAddComment(x);
  const reqNo = displayRequestNo(x.req_no) || 'Request';

  const listHtml = visible.length ? visible.map(c=>{
    const when = formatArchiveDateTime(c.at);
    const editing = COMMENT_EDIT === c.id && canModifyComment(x, c);
    if(editing){
      return `
        <div class="cmt-item editing">
          <div class="cmt-item-hd"><div class="cmt-who"><b>${escapeHtml(c.by||'—')}</b><span class="cmt-role">${escapeHtml(commentRoleLabel(c.role))}</span></div>${commentVisBadge(c.visibility)}</div>
          <textarea id="cmt-edit-input" dir="auto" rows="3" maxlength="500" class="cmt-edit-area">${escapeHtml(c.text||'')}</textarea>
          <div class="cmt-foot"><span class="cmt-time">${escapeHtml(when)}</span>
            <span class="cmt-actions">
              <button class="cmt-link save" onclick="saveEditComment(${i}, '${escAttr(c.id)}')">Save</button>
              <button class="cmt-link" onclick="cancelEditComment(${i})">Cancel</button>
            </span>
          </div>
        </div>`;
    }
    const canMod = canModifyComment(x, c);
    return `
      <div class="cmt-item">
        <div class="cmt-item-hd"><div class="cmt-who"><b>${escapeHtml(c.by||'—')}</b><span class="cmt-role">${escapeHtml(commentRoleLabel(c.role))}</span></div>${commentVisBadge(c.visibility)}</div>
        <div class="cmt-text" dir="auto">${escapeHtml(c.text||'')}</div>
        <div class="cmt-foot"><span class="cmt-time">${escapeHtml(when)}</span>
          ${canMod ? `<span class="cmt-actions">
            <button class="cmt-link" onclick="startEditComment(${i}, '${escAttr(c.id)}')">Edit</button>
            <button class="cmt-link danger" onclick="deleteComment(${i}, '${escAttr(c.id)}')">Delete</button>
          </span>` : ''}
        </div>
      </div>`;
  }).join('') : `<div class="cmt-empty">No comments${canAdd ? ' yet — add the first comment below.' : '.'}</div>`;

  const addHtml = canAdd ? `
    <div class="cmt-add">
      <textarea id="cmt-input" dir="auto" rows="3" maxlength="500" placeholder="Write your comment here ..."></textarea>
      <button class="cmt-submit" onclick="addComment(${i})">Add comment</button>
    </div>` : `<div class="cmt-locked">${x.cancelled ? 'This voucher is cancelled' : 'This voucher is approved'} — comments are read-only.</div>`;

  const overlay = document.createElement('div');
  overlay.id = 'app-comments-overlay';
  overlay.dir = 'ltr';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(15,27,43,.55);display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);';
  overlay.innerHTML = `
    <style>
      @keyframes cmtFade{from{opacity:0}to{opacity:1}}
      @keyframes cmtPop{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:none}}
      #app-comments-overlay{animation:cmtFade .18s ease both;font-family:'Plus Jakarta Sans','Cairo','Montserrat',sans-serif;}
      #app-comments-overlay .cmt-card{width:min(520px,100%);max-height:88vh;display:flex;flex-direction:column;background:#fff;border-radius:20px;box-shadow:0 1px 1px rgba(15,27,43,.04),0 18px 48px -12px rgba(15,27,43,.32),0 40px 80px -24px rgba(15,27,43,.22);overflow:hidden;animation:cmtPop .26s cubic-bezier(.2,.8,.25,1) both;}
      #app-comments-overlay .cmt-head{position:relative;padding:20px 24px 18px;background:linear-gradient(120deg,var(--indigo) 0%,var(--teal) 48%,var(--indigo) 100%);color:#fff;display:flex;justify-content:space-between;align-items:center;gap:12px;}
      #app-comments-overlay .cmt-head::after{content:"";position:absolute;left:0;right:0;bottom:0;height:3px;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.35),rgba(255,255,255,0));}
      #app-comments-overlay .cmt-htitle{font-size:17px;font-weight:800;}
      #app-comments-overlay .cmt-hcap{font-family:'Plus Jakarta Sans','Montserrat',sans-serif;font-size:10px;font-weight:700;letter-spacing:1.4px;opacity:.72;margin-top:2px;direction:ltr;}
      #app-comments-overlay .cmt-x{background:rgba(255,255,255,.16);border:none;color:#fff;width:32px;height:32px;border-radius:10px;font-size:18px;cursor:pointer;line-height:1;transition:background .15s ease;}
      #app-comments-overlay .cmt-x:hover{background:rgba(255,255,255,.28);}
      #app-comments-overlay .cmt-body{padding:16px 20px;overflow-y:auto;display:flex;flex-direction:column;gap:12px;background:var(--tint);}
      #app-comments-overlay .cmt-empty{text-align:center;color:var(--gray);font-size:13px;font-weight:600;padding:22px 8px;}
      #app-comments-overlay .cmt-item{background:#fff;border:1px solid var(--bg);border-radius:14px;padding:12px 14px;}
      #app-comments-overlay .cmt-item.editing{border-color:var(--teal);box-shadow:0 0 0 3px rgba(21,36,56,.12);}
      #app-comments-overlay .cmt-item-hd{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:7px;}
      #app-comments-overlay .cmt-who b{font-size:13px;font-weight:800;color:var(--indigo);}
      #app-comments-overlay .cmt-role{font-size:11px;color:var(--gray);margin-inline-start:8px;}
      #app-comments-overlay .cmt-vis-badge{font-size:10.5px;font-weight:800;padding:3px 9px;border-radius:999px;white-space:nowrap;}
      #app-comments-overlay .cmt-all{background:var(--bg);color:var(--gray);}
      #app-comments-overlay .cmt-mgmt{background:var(--tint-i);color:var(--teal);}
      #app-comments-overlay .cmt-staff{background:var(--tint-g);color:var(--green);}
      #app-comments-overlay .cmt-text{font-size:13.5px;font-weight:600;color:var(--ink);line-height:1.85;white-space:pre-wrap;word-break:break-word;}
      #app-comments-overlay .cmt-foot{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:8px;}
      #app-comments-overlay .cmt-time{font-size:11px;color:#94A3B8;direction:ltr;}
      #app-comments-overlay .cmt-actions{display:flex;gap:6px;}
      #app-comments-overlay .cmt-link{background:none;border:none;font-family:'Plus Jakarta Sans','Cairo',sans-serif;font-size:12px;font-weight:800;color:var(--teal);cursor:pointer;padding:3px 7px;border-radius:8px;}
      #app-comments-overlay .cmt-link:hover{background:var(--tint);}
      #app-comments-overlay .cmt-link.danger{color:var(--red);}
      #app-comments-overlay .cmt-link.danger:hover{background:var(--stamp-red-tint);}
      #app-comments-overlay textarea{width:100%;box-sizing:border-box;border:1.5px solid var(--border);border-radius:12px;padding:10px 12px;font-family:'Plus Jakarta Sans','Cairo',sans-serif;font-size:13.5px;resize:vertical;outline:none;background:#fff;}
      #app-comments-overlay textarea:focus{border-color:var(--teal);box-shadow:0 0 0 3px rgba(21,36,56,.12);}
      #app-comments-overlay .cmt-add{border-top:1px solid var(--bg);padding:14px 20px 18px;background:#fff;display:flex;flex-direction:column;gap:10px;}
      #app-comments-overlay .cmt-vis-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;}
      #app-comments-overlay .cmt-vis-lbl{font-size:12px;font-weight:800;color:var(--gray);}
      #app-comments-overlay .cmt-vis-opt{display:flex;align-items:center;gap:5px;font-size:12.5px;font-weight:700;color:var(--indigo);background:var(--tint);border:1.5px solid var(--bg);border-radius:10px;padding:6px 11px;cursor:pointer;}
      #app-comments-overlay .cmt-vis-opt:has(input:checked){border-color:var(--teal);background:var(--tint-g);color:var(--green);}
      #app-comments-overlay .cmt-vis-opt input{accent-color:var(--teal);}
      #app-comments-overlay .cmt-submit{align-self:flex-start;background:var(--teal);color:#fff;border:none;border-radius:12px;padding:10px 22px;font-family:'Plus Jakarta Sans','Cairo',sans-serif;font-size:13.5px;font-weight:800;cursor:pointer;box-shadow:0 10px 22px -6px rgba(21,36,56,.28);transition:filter .15s ease;}
      #app-comments-overlay .cmt-submit:hover{filter:brightness(1.06);}
      #app-comments-overlay .cmt-locked{border-top:1px solid var(--bg);padding:16px 20px;background:#fff;color:var(--gray);font-size:12.5px;font-weight:700;text-align:center;}
    </style>
    <div class="cmt-card" role="dialog" aria-modal="true">
      <div class="cmt-head">
        <div><div class="cmt-htitle">Voucher Comments</div><div class="cmt-hcap">${escAttr(reqNo)} · COMMENTS</div></div>
        <button class="cmt-x" onclick="closeCommentsOverlay()" aria-label="Close">✕</button>
      </div>
      <div class="cmt-body">${listHtml}</div>
      ${addHtml}
    </div>`;
  overlay.addEventListener('click', e=>{ if(e.target === overlay) closeCommentsOverlay(); });
  document.body.appendChild(overlay);
  const focusEl = COMMENT_EDIT ? overlay.querySelector('#cmt-edit-input') : overlay.querySelector('#cmt-input');
  if(focusEl){ focusEl.focus(); }
}
// Fetches the latest comments from the server before writing — prevents overwriting comments others added
async function addComment(i){
  const x=(window._arcRows||[])[i]; if(!x) return;
  if(!canAddComment(x)){ alert('Cannot add a comment to this voucher.'); return; }
  const ta = document.getElementById('cmt-input');
  const text = (ta?.value || '').trim();
  if(!text){ ta?.focus(); return; }
  try{
    const { error } = await sb.from('voucher_comments').insert([{ request_id:x.id, author_email:CURRENT.email, author_name:CURRENT.name, author_role:CURRENT.role, body:text }]);
    if(error){ alert('Could not save the comment.\n\nMake sure the comments SQL was run in Supabase.\n\n'+(error.message||'')); return; }
  }catch(e){ console.error(e); return; }
  COMMENT_EDIT = null;
  await loadArchive(true);
  renderCommentsOverlay(i);
}
function startEditComment(i, id){ COMMENT_EDIT = id; renderCommentsOverlay(i); }
function cancelEditComment(i){ COMMENT_EDIT = null; renderCommentsOverlay(i); }
async function saveEditComment(i, id){
  const x=(window._arcRows||[])[i]; if(!x) return;
  const text = (document.getElementById('cmt-edit-input')?.value || '').trim();
  if(!text){ alert('The comment cannot be left empty.'); return; }
  const c = getRequestComments(x).find(k=>String(k.id)===String(id));
  if(!c || !canModifyComment(x, c)){ alert('This comment cannot be edited.'); COMMENT_EDIT=null; renderCommentsOverlay(i); return; }
  try{ await sb.from('voucher_comments').update({ body:text }).eq('id', id).eq('author_email', CURRENT.email); }catch(e){ console.error(e); }
  COMMENT_EDIT = null;
  await loadArchive(true);
  renderCommentsOverlay(i);
}
async function deleteComment(i, id){
  const x=(window._arcRows||[])[i]; if(!x) return;
  const c = getRequestComments(x).find(k=>String(k.id)===String(id));
  if(!c || !canModifyComment(x, c)){ alert('You cannot delete this comment.'); return; }
  const ok = await showConfirmDialog({ title:'Delete comment', message:'Do you want to permanently delete this comment?', confirmText:'Delete', cancelText:'Undo', danger:true });
  if(!ok){ renderCommentsOverlay(i); return; }
  try{ await sb.from('voucher_comments').delete().eq('id', id).eq('author_email', CURRENT.email); }catch(e){ console.error(e); }
  COMMENT_EDIT = null;
  await loadArchive(true);
  renderCommentsOverlay(i);
}

function showArchiveAttachmentsMenu(btn, rowIndex){
  const row = (window._arcRows||[])[rowIndex];
  const atts = getArchiveRowAttachments(row);
  const isAcc = CURRENT && CURRENT.role==='accountant';
  const canManage = isAcc && row && !row.cancelled && SB_ON;
  let html = '';
  if(atts.length){
    html += archiveMenuButton('Download All PDF', ARC_ICONS.download, `downloadArchiveAttachmentsMerged(${rowIndex})`);
    html += archiveMenuButton('Print All PDF', ARC_ICONS.print, `printArchiveAttachmentsMerged(${rowIndex})`);
  }
  if(canManage){
    if(atts.length) html += '<div class="arc-menu-sep"></div>';
    html += archiveMenuButton('Add attachments', ARC_ICONS.upload, `addArchiveAttachments(${rowIndex})`);
    if(atts.length){
      html += '<div class="arc-menu-sep"></div>';
      html += atts.map((p,idx)=>`
        <div class="arc-menu-file">
          <span class="amf-name" title="${escAttr(getAttachmentLabel(p))}">${escapeHtml(getAttachmentLabel(p))}</span>
          <button class="amf-ico" title="Preview" aria-label="Preview attachment" onclick="previewArchiveAttachment(${rowIndex}, ${idx}); closeArchiveMenu();">${ARC_ICONS.view}</button>
          <button class="amf-ico danger" title="Delete" aria-label="Delete attachment" onclick="deleteArchiveAttachment(${rowIndex}, ${idx}); closeArchiveMenu();">${ARC_ICONS.trash}</button>
        </div>`).join('');
    }
  }
  if(!html) return;
  showArchiveMenu(btn, 'Attachments', `${atts.length} file${atts.length!==1?'s':''}`, html);
}
// Preview one stored attachment by its index (accountant, from the ledger)
async function previewArchiveAttachment(rowIndex, idx){
  const p = getArchiveRowAttachments((window._arcRows||[])[rowIndex])[idx];
  if(!p){ alert('No file.'); return; }
  await openSourceInNewTab(p);
}
// Add one or more attachments to an existing voucher (accountant only)
async function addArchiveAttachments(rowIndex){
  if(!CURRENT || CURRENT.role!=='accountant'){ alert('This feature is for the accountant only.'); return; }
  const x=(window._arcRows||[])[rowIndex]; if(!x) return;
  if(!SB_ON){ alert('The ledger is not enabled.'); return; }
  const inp=document.createElement('input');
  inp.type='file'; inp.accept='application/pdf,image/*'; inp.multiple=true;
  inp.onchange=async function(){
    const files=[...(inp.files||[])].filter(isAllowedInvoiceAttachment); if(!files.length) return;
    try{
      const paths = await uploadAttachments(files, 'request-attachments');
      const all = [...getArchiveRowAttachments(x), ...paths];
      const { error } = await sb.from('requests').update({ attachments_data: JSON.stringify(all), attachments_count: all.length }).eq('id', x.id);
      if(error){ console.error(error); alert('Could not save the attachments. Please try again.'); return; }
      loadArchive();
      await showMessageDialog({ title:'Attachments added ✅', message: files.length>1?`${files.length} files were added to the voucher.`:'The attachment was added to the voucher.', confirmText:'Done' });
    }catch(e){ console.error(e); await showMessageDialog({ title:'Connection error', message:'Could not upload. Check your connection and try again.', confirmText:'OK' }); }
  };
  inp.click();
}
// Delete one attachment from an existing voucher (accountant only)
async function deleteArchiveAttachment(rowIndex, idx){
  if(!CURRENT || CURRENT.role!=='accountant'){ await showMessageDialog({ title:'Not allowed', message:'This feature is for the accountant only.', confirmText:'OK' }); return; }
  const x=(window._arcRows||[])[rowIndex]; if(!x || !SB_ON) return;
  const atts = getArchiveRowAttachments(x);
  if(idx<0 || idx>=atts.length) return;
  const ok = await showConfirmDialog({
    title:'Delete attachment',
    message:`Do you want to delete "${getAttachmentLabel(atts[idx])}"? You can add another instead.`,
    details:[{ label:'Voucher No.', value: displayRequestNo(x.req_no)||'—', ltr:true }],
    confirmText:'Delete', cancelText:'Back', danger:true
  });
  if(!ok) return;
  try{
    const next = atts.filter((_,k)=>k!==idx);
    const { error } = await sb.from('requests').update({ attachments_data: next.length?JSON.stringify(next):null, attachments_count: next.length }).eq('id', x.id);
    if(error){ console.error(error); await showMessageDialog({ title:'Delete failed', message:'An error occurred while deleting. Try again.', confirmText:'OK' }); return; }
    loadArchive();
    await showMessageDialog({ title:'Deleted ✅', message:'The attachment has been deleted.', confirmText:'Done' });
  }catch(e){ console.error(e); await showMessageDialog({ title:'Connection error', message:'Could not delete. Check your connection and try again.', confirmText:'OK' }); }
}
function showArchiveActionsMenu(btn, rowIndex){
  const x = (window._arcRows||[])[rowIndex];
  if(!x) return;
  const isAcc = CURRENT && CURRENT.role==='accountant';
  const canEdit = isAcc || canCurrentEditRequest(x);
  let html = '';
  // View voucher (read only) + print voucher are always available
  html += archiveMenuButton('View voucher', ARC_ICONS.view, `viewFromArchive(${rowIndex})`);
  html += archiveMenuButton('Print voucher', ARC_ICONS.print, `reprintFromArchive(${rowIndex})`);
  // Edit voucher then cancel voucher (for those with edit permission only)
  if(canEdit){
    html += '<div class="arc-menu-sep"></div>';
    html += archiveMenuButton('Edit voucher', ARC_ICONS.sign, `editFromArchive(${rowIndex})`);
    html += archiveMenuButton('Cancel voucher', ARC_ICONS.trash, `cancelRequest(${rowIndex})`, true);
  }
  showArchiveMenu(btn, 'Voucher actions', escAttr(displayRequestNo(x.req_no) || 'Request'), html);
}
document.addEventListener('click', e=>{
  if(e.target.closest('.arc-time-btn') || e.target.closest('#arc-time-pop')) return;
  closeArchiveTimePopover();
  if(e.target.closest('.arc-menu-btn') || e.target.closest('#arc-menu-pop')) return;
  closeArchiveMenu();
});
// Auto-refresh the Vouchers Ledger every 30 seconds to show new vouchers — quietly and unobtrusively
let ARC_AUTO_REFRESH = null;
function startArchiveAutoRefresh(){
  if(ARC_AUTO_REFRESH) return;
  ARC_AUTO_REFRESH = setInterval(()=>{
    if(!CURRENT || !SB_ON) return;
    if(!document.getElementById('page-arc')?.classList.contains('on')) return;       // only when the ledger is open
    // do not refresh while a menu or dialog is open so it doesn't break or close
    if(document.getElementById('app-comments-overlay') || document.getElementById('app-confirm-overlay')) return;
    if(document.getElementById('arc-menu-pop')?.classList.contains('on')) return;
    if(document.getElementById('arc-time-pop')?.classList.contains('on')) return;
    loadArchive(true);   // silent refresh
  }, 30000);
}
async function loadArchive(silent=false){
  const body=document.getElementById('arc-body');
  const note=document.getElementById('arc-note-slot');
  closeArchiveTimePopover();
  closeArchiveMenu();
  note.innerHTML='';
  const isAcc = CURRENT && CURRENT.role==='accountant';
  // Who sees all vouchers (including cancelled): accountant + view-only account
  const canSeeAll = isAcc || (CURRENT && CURRENT.role==='viewer');
  const cancelledTab = document.getElementById('atab-cancelled');
  if(cancelledTab) cancelledTab.style.display = canSeeAll ? '' : 'none';
  if(!canSeeAll && ARC_TAB === 'cancelled') ARC_TAB = 'all';
  ['all','cancel','disb','cancelled'].forEach(x=>{
    const tab = document.getElementById('atab-'+x);
    if(tab) tab.classList.toggle('on',x===ARC_TAB);
  });
  if(!SB_ON){
    note.innerHTML='<div class="arc-note">The cloud ledger is not enabled yet. Vouchers still work, print, and download normally.<br>To save vouchers and show them here for everyone, add your Supabase URL and key at the top of the file.</div>';
    body.innerHTML=`<tr><td colspan="${ARC_COLS}" class="arc-empty">— Ledger not enabled —</td></tr>`;
    return;
  }
  if(!silent) body.innerHTML=`<tr><td colspan="${ARC_COLS}" class="arc-empty">Loading...</td></tr>`;
  try{
    let qy = sb.from('requests').select('*').order('id',{ascending:false}).limit(200);
    if(ARC_TAB==='cancelled') qy = qy.eq('cancelled', true);
    else if(ARC_TAB!=='all') qy = qy.eq('doc_type', ARC_TAB);
    // Sales see only each other's vouchers (view/print/download) — not the accountant's; editing is for the voucher owner only
    // Accountant and view-only account see all. Cancelled vouchers are for accountant and view-only only (filtered below)
    if(CURRENT && CURRENT.role === 'sales'){
      const salesNames = Object.values(USER_MAP).filter(u=>u.role==='sales').map(u=>u.name);
      qy = qy.in('created_by', salesNames);
    }
    const submittedRange = getArchiveSubmittedDateRange();
    if(submittedRange) qy = qy.gte('created_at', submittedRange.start).lt('created_at', submittedRange.end);
    const search=document.getElementById('arc-search').value.trim();
    if(search) qy = qy.or(`name.ilike.*${search}*,created_by.ilike.*${search}*,signed_by.ilike.*${search}*,req_no.ilike.*${search}*,beneficiary.ilike.*${search}*,supplier_invoices.ilike.*${search}*`);
    const { data:rows, error } = await qy;
    if(error){ 
      console.error(error); 
      let errMsg = 'Connection error';
      if(error.message && error.message.includes('column')){
        errMsg = 'A database column is missing. Please contact the administrator.';
        note.innerHTML = `<div class="arc-note">${errMsg}</div>`;
      }
      body.innerHTML=`<tr><td colspan="${ARC_COLS}" class="arc-empty">Connection error</td></tr>`; return; 
    }
    if(!Array.isArray(rows)||rows.length===0){ body.innerHTML=`<tr><td colspan="${ARC_COLS}" class="arc-empty">No vouchers</td></tr>`; return; }
    // Cancelled vouchers appear only in the "Cancelled / Withdrawn" tab; other tabs exclude them
    const reqNum = r => extractRequestNoNumber(r.doc_type==='cancel' ? 'cancel' : 'disb', r.req_no);
    const list = (ARC_TAB==='cancelled' ? rows.filter(x=>x.cancelled) : rows.filter(x=>!x.cancelled))
      .slice()
      .sort((a,b)=> (reqNum(b)-reqNum(a)) || ((b.id||0)-(a.id||0)));   // Sort by number: newest on top, oldest at the bottom
    if(list.length===0){ body.innerHTML=`<tr><td colspan="${ARC_COLS}" class="arc-empty">No vouchers</td></tr>`; return; }
    window._arcRows = list;
    // Load partner acknowledgements for the visible vouchers
    let acksByReq = {};
    try{
      const ids = list.map(r=>r.id).filter(Boolean);
      if(ids.length){
        const { data:acks } = await sb.from('voucher_acks').select('*').in('request_id', ids);
        (acks||[]).forEach(a=>{ (acksByReq[a.request_id]=acksByReq[a.request_id]||[]).push(a); });
      }
    }catch(e){ /* acknowledge.sql may not be run yet — degrade to 0 */ }
    window._acksByReq = acksByReq;
    // Load comments (public thread) for the visible vouchers
    let commentsByReq = {};
    try{
      const ids = list.map(r=>r.id).filter(Boolean);
      if(ids.length){
        const { data:cms } = await sb.from('voucher_comments').select('*').in('request_id', ids).order('created_at',{ascending:true});
        (cms||[]).forEach(c=>{ (commentsByReq[c.request_id]=commentsByReq[c.request_id]||[]).push({ id:c.id, text:c.body, by:c.author_name, email:c.author_email, role:c.author_role, at:c.created_at }); });
      }
    }catch(e){ /* comments.sql may not be run yet */ }
    window._commentsByReq = commentsByReq;
    body.innerHTML=list.map((x,i)=>{
      // Transfer proof column
      let imgCol = '';
      const _tx = txImages(x);
      if(_tx.length){
        // Clicking the icon opens a menu: Preview each / Download / Add / Delete
        imgCol = `<button class="arc-mini ${_tx.length>1?'arc-file-pill':'icon-only'} transferred arc-menu-btn" onclick="showTransferProofMenu(this, ${i})" title="Transfer proof (${_tx.length})" aria-label="Transfer proof (${_tx.length})">${ARC_ICONS.file}${_tx.length>1?`<b>${_tx.length}</b>`:''}</button>`;
      } else if(isAcc && x.accounts_signed_by && !x.cancelled){
        imgCol = `<button class="arc-mini icon-only" onclick="uploadTransferImage(${i})" title="Upload transfer proof" aria-label="Upload transfer proof">${ARC_ICONS.upload}</button>`;
      } else {
          imgCol = '<span class="arc-empty-mark">—</span>';
      }
      // Attachments column (PDF): a quiet summary instead of many buttons inside the row
      const atts = getArchiveRowAttachments(x);
      let attachCol;
      if(atts.length){
        attachCol = `<button class="arc-mini arc-file-pill arc-menu-btn" onclick="showArchiveAttachmentsMenu(this, ${i})" title="View attachments" aria-label="View ${atts.length} of the attachments">${ARC_ICONS.paperclip}<b>${atts.length}</b></button>`;
      } else if(isAcc && !x.cancelled){
        attachCol = `<button class="arc-mini icon-only arc-menu-btn" onclick="showArchiveAttachmentsMenu(this, ${i})" title="Add attachments" aria-label="Add attachments">${ARC_ICONS.upload}</button>`;
      } else {
        attachCol = '<span class="arc-empty-mark">—</span>';
      }
      // Comments column: icon only (with a counter of comments visible to the current user)
      const visComments = getVisibleComments(x);
      const commentCol = `<button class="arc-mini ${visComments.length?'arc-file-pill':'icon-only'}" onclick="openCommentsDialog(${i})" title="Voucher Comments" aria-label="Voucher Comments${visComments.length?' ('+visComments.length+')':''}">${ARC_ICONS.comment}${visComments.length?`<b>${visComments.length}</b>`:''}</button>`;
      // Actions
      let act;
      if(!isAcc){
        if(x.accounts_signed_by){
          // Approved voucher for Sales: print only, no editing.
          act = `<button class="arc-mini icon-only arc-menu-btn" onclick="showArchiveActionsMenu(this, ${i})" title="Voucher actions" aria-label="Voucher actions">${ARC_ICONS.more}</button>`;
        } else {
          // Unapproved voucher: Sales can open and edit or cancel.
          act = `<button class="arc-mini icon-only arc-menu-btn" onclick="showArchiveActionsMenu(this, ${i})" title="Voucher actions" aria-label="Voucher actions">${ARC_ICONS.more}</button>`;
        }
      } else if(x.cancelled){
        act = '<span style="color:var(--red);font-size:11px;font-weight:700">Cancelled</span>';
      } else {
        act = `<button class="arc-mini icon-only arc-menu-btn" onclick="showArchiveActionsMenu(this, ${i})" title="Voucher actions" aria-label="Voucher actions">${ARC_ICONS.more}</button>`;
      }
      let ref;
      if(x.doc_type==='cancel'){ ref = escapeHtml(x.invoice_ref||'—'); }
      else {
        let _sup = x.beneficiary||''; let _inv='';
        try{ const _sa=JSON.parse(x.supplier_invoices||'[]'); if(Array.isArray(_sa)&&_sa.length){ if(!_sup)_sup=_sa[0].supplier||''; _inv=_sa.map(s=>s.invoice).filter(Boolean).join(', '); } }catch(e){}
        ref = `<div class="arc-ref-name">${escapeHtml(_sup||'—')}</div>${_inv?`<div class="arc-ref-inv">Inv: ${escapeHtml(_inv)}</div>`:''}`;
      }
      const _ackN = ((window._acksByReq && window._acksByReq[x.id]) || []).length;
      const _fullAck = totalPartnerCount()>0 && _ackN >= totalPartnerCount() && !x.cancelled;
      const _rc = [];
      if(x.transfer_image && !x.cancelled) _rc.push('arc-transferred');
      if(_fullAck) _rc.push('arc-fully-acked');
      const rowClass = _rc.length ? ` class="${_rc.join(' ')}"` : '';
      return `<tr${rowClass}${x.cancelled?' style="opacity:.55"':''}>
        <td data-label="Voucher No."><b style="color:var(--indigo);font-size:13px">${displayRequestNo(x.req_no)||'—'}</b></td>
        <td data-label="Date">${x.req_date||'—'}</td>
        <td class="arc-ref" data-label="Invoice / Supplier">${ref}</td>
        <td class="arc-amount" data-label="Amount (QAR)">${x.amount?Number(x.amount).toLocaleString('en-US',{minimumFractionDigits:2}):'—'}</td>
        <td style="text-align:center" data-label="Transfer Proof">${imgCol}</td>
        <td class="arc-files-cell" style="text-align:center" data-label="Attachments">${attachCol}</td>
        <td style="text-align:center" data-label="Comments">${commentCol}</td>
        <td data-label="Actions"><div class="arc-act">${act}</div></td>
        <td style="text-align:center" data-label="Acknowledged">${ackCellHtml(x, i)}</td>
      </tr>`;
    }).join('');
  }catch(e){ body.innerHTML=`<tr><td colspan="${ARC_COLS}" class="arc-empty">Connection error</td></tr>`; }
}

/* ══════════════════════════════════════════
   Open a voucher from the ledger (view / print / approve)
══════════════════════════════════════════ */
// View a voucher from the ledger, read only (no editing)
/* ── Partner acknowledgements ── */
function totalPartnerCount(){ return Object.values(USER_MAP).filter(u=>u.role==='viewer').length; }
function ackCellHtml(x, i){
  const TOTAL = totalPartnerCount();
  const list = (window._acksByReq && window._acksByReq[x.id]) || [];
  const count = list.length;
  const who = list.map(a=>`• ${a.partner_name||a.partner_email}${a.acked_at?' — '+formatArchiveDateTime(a.acked_at):''}`).join('\n');
  const title = count ? `Acknowledged by ${count}/${TOTAL}:\n${who}` : 'Not acknowledged by any partner yet';
  const cls = (TOTAL>0 && count>=TOTAL) ? 'ack-full' : (count>0 ? 'ack-partial' : 'ack-none');
  const badge = `<button class="ack-badge ${cls}" onclick="showAcksDialog(${i})" title="Click to see who acknowledged and when" aria-label="${escAttr(title)}">✓ ${count}/${TOTAL}</button>`;
  if(CURRENT && CURRENT.role==='viewer' && !x.cancelled){
    const mine = list.some(a=>a.partner_email && CURRENT.email && a.partner_email.toLowerCase()===CURRENT.email.toLowerCase());
    if(mine){
      return `<div class="ack-cell">${badge}<span class="arc-ack-you" title="You acknowledged this transfer — this is permanent and cannot be removed">✓ You</span></div>`;
    }
    return `<div class="ack-cell">${badge}<button class="arc-ack-btn" onclick="acknowledgeFromArchive(${i})" title="Acknowledge you saw this transfer">Acknowledge</button></div>`;
  }
  return badge;
}
async function acknowledgeFromArchive(i){
  if(!sb || !CURRENT){ return; }
  const x = (window._arcRows||[])[i]; if(!x || !x.id){ return; }
  try{
    const { error } = await sb.from('voucher_acks').insert([{ request_id:x.id, partner_email:CURRENT.email, partner_name:CURRENT.name }]);
    if(error && !String(error.message||'').toLowerCase().includes('duplicate')){
      alert('Could not save the acknowledgement.\n\nMake sure acknowledge.sql was run in Supabase.\n\n'+(error.message||''));
      return;
    }
  }catch(e){ console.error(e); }
  await loadArchive(true);
}
// Click the acknowledgement badge -> show each partner's name + the exact time they acknowledged
function showAcksDialog(i){
  const x = (window._arcRows||[])[i]; if(!x){ return; }
  const list = ((window._acksByReq && window._acksByReq[x.id]) || [])
    .slice().sort((a,b)=> new Date(a.acked_at||0) - new Date(b.acked_at||0));
  const TOTAL = totalPartnerCount();
  const details = list.map(a=>({ label: a.partner_name || a.partner_email, value: a.acked_at ? formatArchiveDateTime(a.acked_at) : '—', ltr:true }));
  showMessageDialog({
    title:`Acknowledgements — ${list.length}/${TOTAL}`,
    subtitle: displayRequestNo(x.req_no) || '',
    message: list.length ? 'Partners who confirmed they saw this transfer, with the exact time of each acknowledgement' : 'No partner has acknowledged this voucher yet.',
    details,
    confirmText:'Close'
  });
}

function viewFromArchive(i){
  VIEW_ONLY = true;
  openFromArchive(i);
}

// Edit a voucher from the ledger (with a warning that saving replaces the current data)
async function editFromArchive(i){
  const x = (window._arcRows||[])[i];
  if(!x){ alert('Could not open the voucher.'); return; }
  if(CURRENT && CURRENT.role !== 'accountant' && !canCurrentEditRequest(x)){
    showMessageDialog({
      title:'Cannot edit',
      message: x.cancelled
        ? 'This voucher is cancelled and cannot be edited.'
        : 'This voucher is approved by the Accounts Dept.; it is available for printing only and cannot be edited.',
      confirmText:'OK'
    });
    return;
  }
  const ok = await showConfirmDialog({
    title:'Edit voucher',
    message:'You are about to open the voucher for editing. Any change you save will replace the current voucher data in the ledger.',
    details:[
      { label:'Voucher No.', value: displayRequestNo(x.req_no) || '—', ltr:true }
    ],
    note:'Make sure the changes are correct before saving.',
    confirmText:'Continue editing',
    cancelText:'Back',
    danger:true
  });
  if(!ok) return;
  VIEW_ONLY = false;
  openFromArchive(i);
}

function openFromArchive(i){
  if(!CURRENT){ return; }
  const x = (window._arcRows||[])[i];
  if(!x){ alert('Could not open the voucher.'); return; }
  if(!VIEW_ONLY && CURRENT.role !== 'accountant' && !canCurrentEditRequest(x)){
    alert('This voucher is approved by Accounts; it is available for printing only and cannot be edited.');
    return;
  }
  loadDisbFromRow(x); showPage('disb');
}

// Reprint a voucher from the ledger (available to the Sales staff)
function reprintFromArchive(i){
  VIEW_ONLY = true;
  const x = (window._arcRows||[])[i];
  if(!x){ alert('Could not open the voucher.'); return; }
  const isAcc = CURRENT && CURRENT.role==='accountant';
  loadDisbFromRow(x);
  showPage('disb');
  setTimeout(()=>printDoc(x.doc_type, displayRequestNo(x.req_no)), 400);
}

// Upload transfer proof (accountant only, after approval)
// Transfer proof can hold multiple images — stored as a JSON array in the transfer_image column.
// Backward compatible: an old single-path string is treated as a one-item list.
function txImages(x){
  if(!x || !x.transfer_image) return [];
  const v = x.transfer_image;
  if(typeof v !== 'string') return Array.isArray(v) ? v.filter(Boolean) : [];
  const s = v.trim();
  if(s.startsWith('[')){ try{ const a = JSON.parse(s); return Array.isArray(a) ? a.filter(Boolean) : []; }catch(e){ return [s]; } }
  return [s];
}
async function uploadTransferImage(i){
  if(!CURRENT || CURRENT.role!=='accountant'){ alert('This feature is for the accountant only.'); return; }
  const x=(window._arcRows||[])[i]; if(!x) return;
  if(!SB_ON){ alert('The ledger is not enabled.'); return; }
  // Create a hidden file input (multiple images allowed)
  const inp = document.createElement('input');
  inp.type='file'; inp.accept='image/*,application/pdf'; inp.multiple=true;
  inp.onchange=async function(){
    const files=[...(inp.files||[])]; if(!files.length) return;
    for(const f of files){
      if(f.size>2*1024*1024){
        await showMessageDialog({ title:'File too large', message:`"${f.name}" exceeds the allowed size (2 MB). Please choose smaller files.`, confirmText:'OK' });
        return;
      }
    }
    try{
      const paths = [];
      for(const f of files){ paths.push(await uploadFileToStorage(f, 'transfer-images')); }
      const all = txImages(x).concat(paths);
      const { error } = await sb.from('requests').update({ transfer_image: JSON.stringify(all) }).eq('id', x.id);
      if(error){ console.error(error);
        alert('Could not save the transfer proof. Please try again.');
        return;
      }
      loadArchive();
      await showMessageDialog({
        title:'Transfer proof uploaded ✅',
        subtitle:'Transfer Proof Uploaded',
        message: files.length>1 ? `${files.length} transfer images were saved successfully.` : 'The transfer proof has been saved successfully, and the requester was notified that their voucher was transferred.',
        confirmText:'Done'
      });
    }catch(e){ await showMessageDialog({ title:'Connection error', message:'Could not upload the transfer proof. Check your connection and try again.', confirmText:'OK' }); console.error(e); }
  };
  inp.click();
}

// Transfer proof menu: Preview each image / Download all / Add another / Delete (accountant)
function showTransferProofMenu(btn, rowIndex){
  const x = (window._arcRows||[])[rowIndex];
  const imgs = txImages(x);
  if(!imgs.length) return;
  const isAcc = CURRENT && CURRENT.role==='accountant';
  const many = imgs.length>1;
  let html = imgs.map((p,idx)=> archiveMenuButton(many?`Preview image ${idx+1}`:'Preview', ARC_ICONS.view, `openTransferImage(${rowIndex}, ${idx})`)).join('');
  html += '<div class="arc-menu-sep"></div>'
    + archiveMenuButton(many?'Download all':'Download', ARC_ICONS.download, `downloadTransferImage(${rowIndex})`);
  if(isAcc && !x.cancelled){
    html += '<div class="arc-menu-sep"></div>'
      + archiveMenuButton('Add another image', ARC_ICONS.upload, `uploadTransferImage(${rowIndex})`)
      + archiveMenuButton(many?'Delete all':'Delete', ARC_ICONS.trash, `deleteTransferImage(${rowIndex})`, true);
  }
  showArchiveMenu(btn, 'Transfer Proof', many?`${imgs.length} images`:'Transfer Proof', html);
}
// Open a single transfer image by its index
async function openTransferImage(rowIndex, idx){
  const imgs = txImages((window._arcRows||[])[rowIndex]);
  const src = imgs[idx];
  if(!src){ alert('No file.'); return; }
  await openSourceInNewTab(src);
}

// Download transfer proof(s)
async function downloadTransferImage(rowIndex){
  const imgs = txImages((window._arcRows||[])[rowIndex]);
  if(!imgs.length){ return; }
  try{
    for(const p of imgs){
      const bytes = await getAttachmentBytes(p);
      dl(new Blob([bytes], { type:getAttachmentMime(p) }), getAttachmentLabel(p));
    }
  }catch(e){ console.error(e); await showMessageDialog({ title:'Download failed', message:'An error occurred while downloading the transfer proof.', confirmText:'OK' }); }
}

// Delete transfer proof (accountant only) — allows uploading another
async function deleteTransferImage(rowIndex){
  if(!CURRENT || CURRENT.role!=='accountant'){ await showMessageDialog({ title:'Not allowed', message:'This feature is for the accountant only.', confirmText:'OK' }); return; }
  const x = (window._arcRows||[])[rowIndex];
  if(!x || !x.transfer_image || !SB_ON) return;
  const _n = txImages(x).length;
  const ok = await showConfirmDialog({
    title:'Delete transfer proof',
    message: _n>1 ? `Do you want to delete all ${_n} transfer images? You can then upload new ones.` : 'Do you want to delete the current transfer proof? You can then upload a new one.',
    details:[{ label:'Voucher No.', value: displayRequestNo(x.req_no)||'—', ltr:true }],
    confirmText:'Delete', cancelText:'Back', danger:true
  });
  if(!ok) return;
  try{
    const { error } = await sb.from('requests').update({ transfer_image:null, transfer_seen:false }).eq('id', x.id);
    if(error){ console.error(error); await showMessageDialog({ title:'Delete failed', message:'An error occurred while deleting. Try again.', confirmText:'OK' }); return; }
    loadArchive();
    await showMessageDialog({ title:'Deleted ✅', message:'The transfer proof has been deleted. You can now upload a new one.', confirmText:'Done' });
  }catch(e){ console.error(e); await showMessageDialog({ title:'Connection error', message:'Could not delete. Check your connection and try again.', confirmText:'OK' }); }
}

// Cancel a voucher — the accountant can cancel, and Sales can cancel their own voucher only before Accounts approval.
async function cancelRequest(i){
  if(!CURRENT){ alert('You must log in first.'); return; }
  const x=(window._arcRows||[])[i]; if(!x) return;
  const isAcc = CURRENT.role === 'accountant';
  const canSalesCancel = isOwnRequest(x) && !isApprovedRequest(x) && !x.cancelled;
  if(!isAcc && !canSalesCancel){
    alert('This voucher cannot be cancelled.\n\nSales can only cancel a voucher before Accounts approval.');
    return;
  }
  const ok = await showConfirmDialog({
    title:'Confirm Voucher Cancellation',
    message:'Do you want to cancel this voucher?',
    details:[
      { label:'Voucher No.', value:displayRequestNo(x.req_no), ltr:true },
      { label:'Requested By', value:x.name || x.created_by || '—' },
      { label:'Voucher type', value:x.doc_type === 'cancel' ? 'Cancellation & Refund' : 'Payment Voucher' }
    ],
    note:'The voucher will be kept in the ledger marked as cancelled.',
    confirmText:'Cancel voucher',
    cancelText:'Undo',
    danger:true
  });
  if(!ok) return;
  if(!SB_ON){ alert('The ledger is not enabled.'); return; }
  try{
    const { error } = await sb.from('requests').update({
      cancelled:true,
      req_no: cancelledStorageRequestNo(x)
    }).eq('id', x.id);
    if(error){ console.error(error); alert('Could not cancel — make sure the cancelled column is added to the requests table (see the instructions) and the update policy is enabled.'); return; }
    x.cancelled = true;
    x.req_no = cancelledStorageRequestNo(x);
    if(EDIT_ID === x.id){
      EDIT_ID = null;
      EDIT_REQUEST = null;
      setDocumentLocked(x.doc_type === 'cancel' ? 'cancel' : 'disb', false);
    }
    loadArchive();
    refreshNextRequestNo(x.doc_type === 'cancel' ? 'cancel' : 'disb');
  }catch(e){ alert('Supabase connection error.'); console.error(e); }
}

// Approve the voucher directly from the ledger — accountant only — without opening the form or changing the page
// Revoke Accounts approval — accountant only — returns the voucher to "not approved" and unlocks it
function loadDisbFromRow(x){
  EDIT_ID = x.id || null;
  EDIT_REQUEST = x;
  const set=(id,v)=>{ const el=document.getElementById(id); if(el) el.value = v==null?'':v; };
  set('d-reqno', displayRequestNo(x.req_no));
  set('d-date',  x.req_date);
  set('d-name',  x.name);
  set('d-dept',  x.department);
  set('d-project', x.project);
  try{ const _pay=JSON.parse(x.notes||'{}'); if(_pay&&typeof _pay==='object'){ set('d-pay-method',_pay.method); set('d-pay-date',_pay.date); set('d-pay-bank',_pay.bank); set('d-pay-ref',_pay.ref); } }catch(e){}
  set('d-amt', x.amount!=null ? fmtAmt(String(x.amount)) : '');
  // Supplier invoices
  const sup=document.getElementById('supplier-rows'); sup.innerHTML='';
  let sarr=[]; try{ sarr=JSON.parse(x.supplier_invoices||'[]'); }catch(e){ sarr=[]; }
  if(!Array.isArray(sarr)||!sarr.length) sarr=[{supplier:'',invoice:'',amount:''}];
  sarr.forEach(s=>addSupplierRow(s.supplier||'', s.description||'', s.invoice||'', s.amount?fmtAmt(String(s.amount)):'', s.reason||'', true));
  recalcSupplier();
  // Saved attachments — loaded directly so ATTACHED is the single source of truth (allows correct deletion)
  ATTACHED = [];
  try{ const _atts = JSON.parse(EDIT_REQUEST?.attachments_data || '[]'); if(Array.isArray(_atts)) ATTACHED = _atts.slice(); }catch(e){ ATTACHED = []; }
  renderAttach();
  window.LAST_REQUEST_PDF = null; updateRequestPdfStatus();
  // Requester signature
  if(x.signed_by){
    SIGNED.disb={ name:x.signed_by, time:x.signed_at, label:stampDate(x.signed_at) };
    document.getElementById('disb-sig-ph').style.display='none';
    document.getElementById('disb-sig-stamp').classList.add('on');
    document.getElementById('disb-sig-mono').textContent = initials(x.signed_by);
    document.getElementById('disb-sig-name').textContent = x.signed_by;
    document.getElementById('disb-sig-meta').textContent = stampDate(x.signed_at);
  } else {
    SIGNED.disb=null;
    document.getElementById('disb-sig-stamp').classList.remove('on');
    document.getElementById('disb-sig-ph').style.display='block';
  }
  // Accounts approval
  if(x.accounts_signed_by){
    setAccSign('disb', { name:x.accounts_signed_by, time:x.accounts_signed_at, label:stampDate(x.accounts_signed_at) });
    document.getElementById('disb-acc-ph').style.display='none';
    document.getElementById('disb-acc-stamp').classList.add('on');
    document.getElementById('disb-acc-mono').textContent = initials(x.accounts_signed_by);
    document.getElementById('disb-acc-name').textContent = x.accounts_signed_by;
    document.getElementById('disb-acc-meta').textContent = stampDate(x.accounts_signed_at);
  } else {
    setAccSign('disb', null);
    document.getElementById('disb-acc-stamp').classList.remove('on');
    document.getElementById('disb-acc-ph').style.display='block';
  }
  // The approve button shows for the accountant only and only if not yet approved
  const row=document.getElementById('disb-acc-btn-row');
  if(row) row.style.display = (CURRENT && CURRENT.role==='accountant' && !x.accounts_signed_by) ? 'flex' : 'none';
  applyArchiveEditLock('disb', x);
}


/* ══════════════════════════════════════════
   CLEAR
══════════════════════════════════════════ */
function clearDisb(){
  VIEW_ONLY = false;
  setDocumentLocked('disb', false);
  ['d-project','d-pay-date','d-pay-bank','d-pay-ref','d-amt'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const _pm=document.getElementById('d-pay-method'); if(_pm)_pm.selectedIndex=0;
  document.getElementById('d-name').value = CURRENT?.name||'';
  document.getElementById('d-dept').value = CURRENT?.dept||'';
  document.getElementById('d-date').value=TODAY;
  document.getElementById('d-reqno').value='PV-0001';
  document.getElementById('supplier-rows').innerHTML=''; addSupplierRow(); recalcSupplier();
  ATTACHED=[]; renderAttach();
  clearDisbPrintAppendix();
  window.LAST_REQUEST_PDF = null; updateRequestPdfStatus();
  updateDisbWords('');
  SIGNED.disb=null;
  document.getElementById('disb-sig-stamp').classList.remove('on');
  document.getElementById('disb-sig-ph').style.display='block';
  // Reset Accounts approval
  setAccSign('disb', null);
  document.getElementById('disb-acc-stamp').classList.remove('on');
  document.getElementById('disb-acc-ph').style.display='block';
  const row=document.getElementById('disb-acc-btn-row');
  if(row) row.style.display = (CURRENT && CURRENT.role==='accountant') ? 'flex' : 'none';
  EDIT_ID=null;
  EDIT_REQUEST=null;
  refreshNextRequestNo('disb');
}

function getPrintFilename(type, reqNo){
  const fallback = type === 'cancel' ? 'RR' : 'PV';
  const value = reqNo || document.getElementById(type === 'cancel' ? 'c-reqno' : 'd-reqno')?.value || fallback;
  return value ? value.replace(/\s+/g,'_') : fallback;
}
function restoreTitleLater(title){
  setTimeout(()=>{ document.title = title; }, 1000);
}

/* === Printing the Cancellation voucher: a path completely separate from the Payment Voucher PDF === */

/* === Printing the Payment Voucher: it alone prepares the voucher PDF and the separate attachments === */
async function printDisbDoc(reqNo){
  if(!ensureDisbRowsPrintable()) return;
  const origTitle = document.title;
  document.title = getPrintFilename('disb', reqNo);
  commitValuesForPrint();
  prepareDisbPrintAppendix();
  if(getDisbTableRowsCount() <= DISB_MAIN_PRINT_ROWS){
    try{
      window.LAST_REQUEST_PDF = await generateRequestPDF('doc-disb');
      updateRequestPdfStatus();
    }catch(e){
      console.warn('Could not pre-generate disbursement PDF:', e);
    }
  } else {
    window.LAST_REQUEST_PDF = null;
    updateRequestPdfStatus();
  }
  window.print();
  restoreTitleLater(origTitle);
}

/* Compatibility bridge for the ledger and any legacy calls */
async function printDoc(type, reqNo){
  return printDisbDoc(reqNo);
}

function updateRequestPdfStatus(){
  const note = document.getElementById('disb-pdf-status');
  if(!note) return;
  if(window.LAST_REQUEST_PDF){
    note.textContent = 'The voucher copy is ready to download as a separate PDF. Attachments are available from the attachments menu.';
  } else {
    note.textContent = '';
  }
}

document.addEventListener('input', function(event){
  if(!event.target.closest || !event.target.closest('#doc-disb')) return;
  if(window.LAST_REQUEST_PDF){
    window.LAST_REQUEST_PDF = null;
    updateRequestPdfStatus();
  }
});
window.addEventListener('beforeprint', ()=>{
  if(document.getElementById('page-disb')?.classList.contains('on')){
    prepareDisbPrintAppendix();
  }
});
window.addEventListener('afterprint', ()=>{
  clearDisbPrintAppendix();
});

/* === Extra safeguard at print time ===
   Before any print we lock the value the user typed into the value attribute itself,
   so even if the page is re-rendered or copied, what was typed stays visible in the print.
   This, together with hiding the placeholder in CSS, ensures an empty voucher prints empty,
   and a filled voucher prints all its data without showing "zero" or a phantom value. */
function commitValuesForPrint(){
  document.querySelectorAll('input, textarea, select').forEach(function(el){
    if(el.type==='checkbox' || el.type==='radio'){
      if(el.checked) el.setAttribute('checked','checked'); else el.removeAttribute('checked');
      return;
    }
    if(el.tagName==='TEXTAREA'){ el.textContent = el.value; return; }
    if(el.tagName==='SELECT'){
      Array.prototype.forEach.call(el.options, function(o){
        if(o.selected) o.setAttribute('selected','selected'); else o.removeAttribute('selected');
      });
      return;
    }
    el.setAttribute('value', el.value);
  });
}
window.addEventListener('beforeprint', commitValuesForPrint);
