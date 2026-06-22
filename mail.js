// Envio de e-mail via SMTP. Se as variaveis SMTP nao estiverem definidas,
// apenas registra no log (util em desenvolvimento/homologacao).
import nodemailer from "nodemailer";

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;

let transport = null;
if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

export async function enviarEmail({ to, subject, text }) {
  if (!to) return;
  if (!transport) {
    console.log(`[e-mail nao configurado] Para: ${to} | Assunto: ${subject}`);
    return;
  }
  try {
    await transport.sendMail({ from: MAIL_FROM || SMTP_USER, to, subject, text });
  } catch (err) {
    console.error("Falha ao enviar e-mail:", err.message);
  }
}
