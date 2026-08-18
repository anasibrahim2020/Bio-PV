// ═══════════════════════════════════════════════════════════════
//  Supabase Edge Function: push-notify
//  Web Push (VAPID) notifications for two Database Webhook events:
//   1) INSERT on `requests`       → notify the 3 partners (viewers)
//   2) INSERT on `voucher_acks`   → notify the admin (accountant)
//
//  Wire this up in Dashboard → Database → Webhooks:
//    table `requests`,      event INSERT → Edge Function push-notify
//    table `voucher_acks`,  event INSERT → Edge Function push-notify
//
//  Secrets required (Dashboard → Edge Functions → Secrets):
//    VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
//    (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided automatically)
//    Optional: WEBHOOK_SECRET (must match the header the webhook sends)
// ═══════════════════════════════════════════════════════════════

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const VAPID_PUBLIC_KEY     = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY    = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT        = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@bionutritionmedical.com";
const WEBHOOK_SECRET       = Deno.env.get("WEBHOOK_SECRET") ?? "";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function fmtAmount(record: any): string {
  const main = parseFloat(String(record?.amount ?? "").replace(/[^\d.]/g, ""));
  if (main > 0) return main.toLocaleString("en-US", { minimumFractionDigits: 2 });
  try {
    const arr = JSON.parse(record?.supplier_invoices || "[]");
    const sum = (Array.isArray(arr) ? arr : []).reduce(
      (t: number, s: any) => t + (parseFloat(String(s?.amount ?? "").replace(/[^\d.]/g, "")) || 0), 0);
    return sum.toLocaleString("en-US", { minimumFractionDigits: 2 });
  } catch { return "0.00"; }
}

// Sends to every row for the given role; drops subscriptions the push
// service reports as gone (404/410) so the table stays self-cleaning.
async function notifyRole(role: "accountant" | "viewer", payload: Record<string, unknown>) {
  const { data: subs } = await sb.from("push_subscriptions").select("*").eq("role", role);
  const body = JSON.stringify(payload);
  const tasks = (subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
      );
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      }
    }
  });
  await Promise.allSettled(tasks);
}

Deno.serve(async (req) => {
  if (WEBHOOK_SECRET && req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }
  let payload: any;
  try { payload = await req.json(); } catch { return new Response("bad json", { status: 400 }); }

  const table  = payload?.table;
  const type   = payload?.type;
  const record = payload?.record ?? {};

  // 1) New payment voucher → the 3 partners
  if (table === "requests" && type === "INSERT" && !record.cancelled) {
    const reqNo   = record.req_no ?? "—";
    const amount  = fmtAmount(record);
    const creator = record.name ?? record.created_by ?? "Accounts";
    await notifyRole("viewer", {
      title: "New Payment Voucher",
      body: `${reqNo} — QAR ${amount}, requested by ${creator}`,
      url: "./index.html#arc",
      tag: `voucher-${record.id}`,
    });
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }

  // 2) Partner acknowledgement → the admin
  if (table === "voucher_acks" && type === "INSERT") {
    const { data: reqRow } = await sb.from("requests").select("req_no").eq("id", record.request_id).single();
    const reqNo = reqRow?.req_no ?? `#${record.request_id}`;
    await notifyRole("accountant", {
      title: "Voucher Acknowledged",
      body: `${record.partner_name ?? "A partner"} acknowledged ${reqNo}`,
      url: "./index.html#arc",
      tag: `ack-${record.id}`,
    });
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: { "Content-Type": "application/json" } });
});
