import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Sends account emails (verify email, reset password) over SMTP.
 * Configure: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM.
 * Without SMTP_HOST the message is printed to the server console instead
 * (handy in development; the link still works).
 */
export const APP_URL = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

let transport: Transporter | null = null;

function getTransport() {
  if (!process.env.SMTP_HOST) return null;
  if (!transport) {
    const port = Number(process.env.SMTP_PORT || 587);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transport;
}

export async function sendMail(to: string, subject: string, text: string, html: string) {
  const t = getTransport();
  if (!t) {
    console.log(`\n[mail:dev] to=${to}\n[mail:dev] subject=${subject}\n[mail:dev] ${text}\n`);
    return;
  }
  await t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text, html });
}

function layout(title: string, body: string, buttonText: string, link: string) {
  return `<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:auto;padding:24px">
  <h2 style="color:#0f172a">${title}</h2>
  <p style="color:#475569;line-height:1.6">${body}</p>
  <p><a href="${link}" style="display:inline-block;background:#0284c7;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">${buttonText}</a></p>
  <p style="color:#94a3b8;font-size:12px">Or paste this link into your browser:<br>${link}</p>
  <p style="color:#94a3b8;font-size:12px">If you did not request this, you can ignore this email.</p></div>`;
}

export function sendVerificationEmail(to: string, token: string) {
  const link = `${APP_URL()}/verify-email?token=${token}`;
  return sendMail(
    to,
    'Verify your email for KABS Quotation AI',
    `Welcome to KABS Quotation AI. Verify your email: ${link} (valid 24 hours)`,
    layout('Verify your email', 'Thanks for signing up. Confirm your email address to activate your account. This link is valid for 24 hours.', 'Verify email', link)
  );
}

export function sendPasswordResetEmail(to: string, token: string) {
  const link = `${APP_URL()}/reset-password?token=${token}`;
  return sendMail(
    to,
    'Reset your KABS Quotation AI password',
    `Reset your password: ${link} (valid 1 hour)`,
    layout('Reset your password', 'We received a request to reset your password. This link is valid for 1 hour.', 'Reset password', link)
  );
}
