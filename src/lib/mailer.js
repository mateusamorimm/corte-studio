import nodemailer from "nodemailer";
import { env, isProd, smtpConfigurado } from "../config/env.js";

let transporte = null;
if (smtpConfigurado) {
  transporte = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT || 587,
    secure: (env.SMTP_PORT || 587) === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
}

// Caixa de saída em memória para testes automatizados.
export const caixaDeTeste = [];

export async function enviarEmail({ para, assunto, texto, html }) {
  if (env.NODE_ENV === "test") {
    caixaDeTeste.push({ para, assunto, texto });
    return;
  }
  if (!transporte) {
    if (isProd) {
      console.warn(`[email] SMTP não configurado: e-mail "${assunto}" não enviado.`);
    } else {
      console.log(`\n[email:dev] SMTP não configurado — conteúdo exibido apenas no console\n  Para: ${para}\n  Assunto: ${assunto}\n  ${texto}\n`);
    }
    return;
  }
  await transporte.sendMail({ from: env.SMTP_FROM || env.SMTP_USER, to: para, subject: assunto, text: texto, html });
}
