// ═══════════════════════════════════════════════════════════════
//  Supabase Edge Function: notify
//  إشعارات (إيميل + واتساب) عند 3 أحداث على جدول requests (Database Webhook):
//   1) INSERT لطلب صرف (disb)             → إشعار المحاسب
//   2) UPDATE برفع transfer_image          → إشعار صاحب الطلب (تم التحويل)
//   3) UPDATE باعتماد المحاسب (accounts_signed_by) → إشعار الإدارة (إبراهيم)
//  بدون أي مرفقات ملفات — إشعارات نصية + تصميم زمزم فقط.
// ═══════════════════════════════════════════════════════════════

import nodemailer from "npm:nodemailer@6.9.16";
import { Buffer } from "node:buffer";

type User = { email: string; phone: string; wa_apikey: string; role: "accountant" | "sales" | "viewer" };
const DIRECTORY: Record<string, User> = {
  "أنس إبراهيم":  { email: "acc_zamzam@outlook.com",     phone: "97455989981", wa_apikey: "2538268", role: "accountant" },
  // ↓ أحمد وعمرو: ضيف phone و wa_apikey بعد تفعيل CallMeBot على موبايل كل واحد
  "أحمد طه":      { email: "ahmed_yo_333@yahoo.com",     phone: "97477330803", wa_apikey: "5794125", role: "sales" },
  "عمرو محمد":    { email: "a.mosaed007@gmail.com",      phone: "97450400878", wa_apikey: "9677900", role: "sales" },
  "إبراهيم سبل":  { email: "contact.zamzamqa@gmail.com", phone: "", wa_apikey: "", role: "viewer" },
};
const ACCOUNTANTS = Object.values(DIRECTORY).filter((u) => u.role === "accountant");
const VIEWERS     = Object.values(DIRECTORY).filter((u) => u.role === "viewer");

const WEBHOOK_SECRET     = Deno.env.get("WEBHOOK_SECRET") ?? "";
const GMAIL_USER         = Deno.env.get("GMAIL_USER") ?? "";
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD") ?? "";
const EMAIL_FROM_NAME    = Deno.env.get("EMAIL_FROM_NAME") ?? "Zamzam Hajj & Umrah";
const PORTAL_URL         = Deno.env.get("PORTAL_URL") ?? "https://zamzamportal.netlify.app/";
const LOGO_URL           = "https://zamzamportal.netlify.app/assets/images/image-5fa147e6c3d5.png";
// شريط تدرّج زمزم — PNG مدمج (يظهر فورًا بدون استضافة ولا حجب)
const BANNER_B64 = "iVBORw0KGgoAAAANSUhEUgAABLAAAAAuCAIAAAC3YHe4AAAExUlEQVR42u3X504UURgAUN7IigoLiL0rKvbee6MtZatPLmQ3YZm5zHwTc/+d5LzEmToy7DQzyKbfzajXwNGmutl0ehnt5LSdzVY/o80GjjXVzmZjkNF6TmvZrA4zWmngeCN/cvr9N6Nf/+dnwI+RYdmJSd8DvgV8LRsUfQn4vOdkrU8V+mMfAz4EvE+YLnu3q1fjbcCbgNcF3bJTr2JeBryo0Bl7HvDsgNNJT2Oe7NR7HPCoypmRhwXbaQ8ClgPuH2Zr372xmQp3Y5Zqbc7cCbidNjvpVsDNSe1D3Qi4HnCt3UrYOOBqzJWAy7XWW5eK5souBlyIOT+yVuVcjfldiwFnk1aLFgLmA+b2LSSs7GkFzCZMCaEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQCqEQpkL4D3EF7kA1l3qWAAAAAElFTkSuQmCC";

// قيمة الطلب: المبلغ الرئيسي، وإلا إجمالي فواتير الموردين
function requestAmount(record: any): number | null {
  const main = parseFloat(String(record?.amount ?? "").replace(/[^\d.]/g, ""));
  if (main > 0) return main;
  try {
    const arr = JSON.parse(record?.supplier_invoices || "[]");
    const sum = (Array.isArray(arr) ? arr : []).reduce(
      (t: number, s: any) => t + (parseFloat(String(s?.amount ?? "").replace(/[^\d.]/g, "")) || 0), 0);
    if (sum > 0) return sum;
  } catch (_e) { /* ignore */ }
  return null;
}

// أسماء الموردين من بيانات الطلب
function supplierNames(record: any): string {
  try {
    const arr = JSON.parse(record?.supplier_invoices || "[]");
    const names = (Array.isArray(arr) ? arr : []).map((s: any) => (s?.supplier || "").trim()).filter(Boolean);
    if (names.length) return [...new Set(names)].join(", ");
  } catch (_e) { /* ignore */ }
  return record?.beneficiary || "";
}

// ── الإيميل: Gmail SMTP عبر nodemailer ──
let _mailer: ReturnType<typeof nodemailer.createTransport> | null = null;
function getMailer() {
  if (!_mailer && GMAIL_USER && GMAIL_APP_PASSWORD) {
    _mailer = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });
  }
  return _mailer;
}

// اللوجو والشريط (تصميم الإيميل) يُدمجوا inline — مش مرفقات ملفات
let _inline: any[] | undefined;
async function getInlineAttachments() {
  if (_inline !== undefined) return _inline;
  const out: any[] = [{ filename: "zamzam-band.png", content: Buffer.from(BANNER_B64, "base64"), cid: "zamzamgrad" }];
  try {
    const r = await fetch(LOGO_URL);
    if (r.ok) out.unshift({ filename: "zamzam-logo.png", content: Buffer.from(await r.arrayBuffer()), cid: "zamzamlogo" });
  } catch (_e) { /* اللوجو اختياري */ }
  _inline = out;
  return _inline;
}

async function sendEmail(to: string, subject: string, html: string, text: string) {
  const m = getMailer();
  if (!m || !to) return;
  try {
    await m.sendMail({ from: `"${EMAIL_FROM_NAME}" <${GMAIL_USER}>`, to, subject, text, html, attachments: await getInlineAttachments() });
  } catch (e) { console.error("Gmail error:", e); }
}

// ── الواتساب: CallMeBot ──
async function sendWhatsApp(phone: string, apikey: string, body: string) {
  if (!phone || !apikey) return;
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(body)}&apikey=${encodeURIComponent(apikey)}`;
  const res = await fetch(url);
  if (!res.ok) console.error("CallMeBot error:", res.status, await res.text());
}

// قالب الإيميل: لوجو + شريط تدرّج زمزم + عنوان + محتوى + زر
function buildEmail(title: string, lines: string[]) {
  const btn = PORTAL_URL
    ? `<tr><td dir="ltr" align="center" style="padding:14px 24px 28px"><a href="${PORTAL_URL}" style="background-color:#2F817C;color:#ffffff;text-decoration:none;padding:14px 42px;display:inline-block;font-weight:bold;font-size:15px;border-radius:8px"><span style="color:#ffffff;text-decoration:none">Open Portal</span></a></td></tr>`
    : "";
  const html = `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EEF1F6;padding:26px 12px;font-family:Arial,Helvetica,sans-serif"><tr><td align="center">
  <table width="480" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid #D7E0EA;border-radius:10px;overflow:hidden;max-width:480px;width:100%">
    <tr><td align="center" style="padding:24px 24px 14px;background:#ffffff"><img src="cid:zamzamlogo" width="66" alt="Zamzam Hajj &amp; Umrah" style="display:block;border:0;width:66px;height:auto;margin:0 auto" /></td></tr>
    <tr><td style="font-size:0;line-height:0"><img src="cid:zamzamgrad" width="1200" height="46" alt="" style="display:block;border:0;width:100%;height:46px" /></td></tr>
    <tr><td dir="ltr" align="center" style="padding:22px 26px 2px"><div style="color:#2C2A55;font-size:19px;font-weight:bold;letter-spacing:.2px">${title}</div></td></tr>
    <tr><td dir="ltr" style="padding:12px 26px 6px;color:#1B2233;font-size:15px;line-height:1.7;text-align:left">${lines.map((l) => `<div style="margin:0 0 12px">${l}</div>`).join("")}</td></tr>
    ${btn}
    <tr><td dir="ltr" align="center" style="padding:14px 24px;color:#64748B;font-size:12px;border-top:1px solid #D7E0EA">Zamzam Hajj &amp; Umrah &nbsp;·&nbsp; زمزم للحج والعمرة</td></tr>
  </table>
</td></tr></table>`;
  const text = title + "\n\n" + lines.map((l) => l.replace(/<[^>]+>/g, "")).join("\n")
    + (PORTAL_URL ? `\n\nOpen Portal: ${PORTAL_URL}` : "") + "\n\nZamzam Hajj & Umrah";
  return { html, text };
}

Deno.serve(async (req) => {
  if (WEBHOOK_SECRET && req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }
  let payload: any;
  try { payload = await req.json(); } catch { return new Response("bad json", { status: 400 }); }

  const record = payload?.record ?? {};
  const oldRecord = payload?.old_record ?? {};
  if (record?.cancelled) return new Response("skip", { status: 200 });

  const reqNo = record.req_no ?? "—";
  const amtVal = requestAmount(record);
  const amount = amtVal != null ? amtVal.toLocaleString("en-US", { minimumFractionDigits: 2 }) : "—";
  const supplier = supplierNames(record);
  const tasks: Promise<unknown>[] = [];

  // 1) طلب صرف جديد → المحاسب
  if (payload?.type === "INSERT" && record.doc_type === "disb") {
    const creator = record.created_by ?? record.name ?? "موظف";
    const subject = `New Payment Request Pending Approval — ${reqNo}`;
    const lines = [
      `Dear Accounts Team,`,
      `A new payment request has been submitted by <b>${creator}</b> and is awaiting your approval.`,
      `<b>Request No:</b> ${reqNo}`,
    ];
    if (supplier) lines.push(`<b>Supplier:</b> ${supplier}`);
    lines.push(`<b>Amount:</b> ${amount} QAR`, `Kindly review and approve this request through the portal.`, `Best regards,<br/>Zamzam Hajj &amp; Umrah`);
    const mail = buildEmail("New Payment Request", lines);
    const wa = `🔔 *New Payment Request - waiting for your approval*\nRequested by: ${creator}`
      + (supplier ? `\nSupplier: ${supplier}` : "") + `\nRequest No: ${reqNo}\nAmount: ${amount} QAR\n\n${PORTAL_URL}`;
    for (const acc of ACCOUNTANTS) {
      if (acc.email) tasks.push(sendEmail(acc.email, subject, mail.html, mail.text));
      tasks.push(sendWhatsApp(acc.phone, acc.wa_apikey, wa));
    }
  }

  // 2) رفع إثبات التحويل → صاحب الطلب
  if (payload?.type === "UPDATE" && record.transfer_image && !oldRecord?.transfer_image) {
    const user = DIRECTORY[record.created_by ?? ""];
    if (user) {
      const subject = `Payment Transferred — ${reqNo}`;
      const lines = [
        `Dear ${record.created_by},`,
        `We are pleased to inform you that the amount for your request has been successfully transferred.`,
        `<b>Request No:</b> ${reqNo}`,
      ];
      if (supplier) lines.push(`<b>Supplier:</b> ${supplier}`);
      lines.push(`<b>Amount:</b> ${amount} QAR`, `You can view the transfer proof anytime under Requests Management.`, `Best regards,<br/>Zamzam Hajj &amp; Umrah`);
      const mail = buildEmail("Payment Transferred", lines);
      const wa = `✅ *Your request has been transferred*`
        + (supplier ? `\nSupplier: ${supplier}` : "") + `\nRequest No: ${reqNo}\nAmount: ${amount} QAR\nThe transfer proof is available in Requests Management.\n\n${PORTAL_URL}`;
      if (user.email) tasks.push(sendEmail(user.email, subject, mail.html, mail.text));
      tasks.push(sendWhatsApp(user.phone, user.wa_apikey, wa));
    }
  }

  // 3) اعتماد المحاسب → الإدارة (إبراهيم)
  if (payload?.type === "UPDATE" && record.doc_type === "disb" && record.accounts_signed_by && !oldRecord?.accounts_signed_by) {
    const subject = `Payment Request Approved — Ready for Transfer — ${reqNo}`;
    const lines = [
      `Dear Management Team,`,
      `A payment request has been approved by the Accounts Department and is now ready for transfer.`,
      `<b>Request No:</b> ${reqNo}`,
    ];
    if (supplier) lines.push(`<b>Supplier:</b> ${supplier}`);
    lines.push(`<b>Amount:</b> ${amount} QAR`, `<b>Approved by:</b> ${record.accounts_signed_by}`, `Kindly proceed with the transfer.`, `Best regards,<br/>Zamzam Hajj &amp; Umrah`);
    const mail = buildEmail("Payment Request Approved", lines);
    for (const v of VIEWERS) {
      if (v.email) tasks.push(sendEmail(v.email, subject, mail.html, mail.text));
    }
  }

  await Promise.allSettled(tasks);
  return new Response(JSON.stringify({ ok: true, sent: tasks.length }), { headers: { "Content-Type": "application/json" } });
});
