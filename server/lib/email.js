// email.js — transactional email via Resend (used for address verification).
// No-op when RESEND_API_KEY is unset, so local dev and self-hosters without a
// Resend account are unaffected. All sends are best-effort: a failure never
// breaks signup — the user can re-send from the dashboard.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'NotesBridge <onboarding@resend.dev>';

export const emailEnabled = !!RESEND_API_KEY;

// Skip obviously-undeliverable addresses (test/demo/local TLDs) so throwaway and
// reviewer accounts don't generate bounces against the Resend reputation.
const UNDELIVERABLE_TLD = /\.(test|demo|local|example|invalid)$/i;
export function isSendableEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !UNDELIVERABLE_TLD.test(e);
}

async function send({ to, subject, html, text }) {
  if (!emailEnabled) return { ok: false, skipped: 'no RESEND_API_KEY' };
  if (!isSendableEmail(to)) return { ok: false, skipped: 'undeliverable address' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html, text }),
    });
    if (!r.ok) return { ok: false, error: `resend ${r.status}: ${(await r.text()).slice(0, 200)}` };
    const j = await r.json().catch(() => ({}));
    return { ok: true, id: j.id };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function sendVerificationEmail(to, verifyUrl) {
  const subject = 'Verify your NotesBridge email';
  const html = `<!doctype html><html><body style="margin:0;background:#0f1115;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table role="presentation" style="max-width:480px;margin:0 auto;background:#181b22;border:1px solid #2a2f3a;border-radius:14px">
    <tr><td style="padding:28px 26px">
      <div style="font-size:20px;font-weight:700;color:#e8eaf0;margin-bottom:6px">Notes<span style="color:#f5b942">Bridge</span></div>
      <p style="color:#9aa1af;font-size:15px;line-height:1.5;margin:0 0 20px">Confirm this email to finish setting up your NotesBridge account.</p>
      <a href="${verifyUrl}" style="display:inline-block;background:#f5b942;color:#111;font-weight:600;font-size:15px;text-decoration:none;padding:12px 22px;border-radius:8px">Verify email</a>
      <p style="color:#6b7280;font-size:12px;line-height:1.6;margin:22px 0 0">Or paste this link into your browser:<br><span style="color:#9aa1af">${verifyUrl}</span></p>
      <p style="color:#6b7280;font-size:12px;margin:18px 0 0">If you didn't create a NotesBridge account, you can ignore this email. This link expires in 24 hours.</p>
    </td></tr>
  </table></body></html>`;
  const text = `Verify your NotesBridge email by opening this link (expires in 24h):\n${verifyUrl}\n\nIf you didn't sign up, ignore this email.`;
  return send({ to, subject, html, text });
}
