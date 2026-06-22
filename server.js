import express from "express";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import { cobrancaOneStep, aprovada, SANDBOX } from "./efi.js";
import {
  initDb, salvarCartao, criarAssinatura, listarAssinaturas,
  buscarAssinatura, cancelarAssinatura,
} from "./db.js";
import { enviarEmail } from "./mail.js";

dotenv.config();

const {
  EFI_PAYEE_CODE,
  VALOR_SEMANAL = "800", // R$ 8,00 em centavos
  INTERVALO_DIAS = "7",
  PORT = "3000",
} = process.env;

if (!EFI_PAYEE_CODE) {
  console.error("Falta EFI_PAYEE_CODE no ambiente.");
  process.exit(1);
}

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "10kb" }));
app.use(express.static("public"));

app.get("/healthz", (_req, res) => res.json({ status: "ok" }));
app.get("/config", (_req, res) => res.json({ payeeCode: EFI_PAYEE_CODE, sandbox: SANDBOX }));

const limiter = rateLimit({
  windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { erro: "Muitas tentativas. Aguarde alguns instantes." },
});

function daquiADias(dias) {
  return new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10); // YYYY-MM-DD
}

// ASSINAR: a 1a cobranca de R$ 8,00 valida o cartao E inicia a assinatura.
// Se a 1a cobranca for recusada, nada e salvo (padrao "only charge on success").
app.post("/assinar", limiter, async (req, res) => {
  const { paymentToken, cardMask, customer, address } = req.body || {};

  if (!paymentToken || typeof paymentToken !== "string") {
    return res.status(400).json({ erro: "paymentToken ausente ou invalido." });
  }
  if (!customer?.name || !customer?.cpf || !customer?.email) {
    return res.status(400).json({ erro: "Dados do cliente incompletos (nome, cpf, email)." });
  }

  try {
    const valor = Number(VALOR_SEMANAL);

    // 1) Primeira cobranca (vale como validacao + 1a semana).
    const charge = await cobrancaOneStep({
      valor, descricao: "Assinatura semanal", customer, address, paymentToken,
    });

    if (!aprovada(charge)) {
      const d = charge.data?.data || charge.data || {};
      const motivo = d?.refusal?.reason || charge.data?.error_description || `status: ${d.status || "desconhecido"}`;
      console.warn("1a cobranca recusada:", motivo, JSON.stringify(charge.data));
      return res.status(402).json({ erro: "Cartao recusado.", motivo });
    }

    // 2) Salva o cartao e cria a assinatura (proxima cobranca em +INTERVALO_DIAS).
    const cartaoId = crypto.randomUUID();
    await salvarCartao({ id: cartaoId, customer, address: address || null, paymentToken, cardMask });

    const assinaturaId = crypto.randomUUID();
    await criarAssinatura({
      id: assinaturaId, cartaoId, valor,
      intervaloDias: Number(INTERVALO_DIAS),
      proximaCobranca: daquiADias(Number(INTERVALO_DIAS)),
    });

    const d = charge.data?.data || charge.data || {};

    const reais = (valor / 100).toFixed(2).replace(".", ",");
    await enviarEmail({
      to: customer.email,
      subject: "Assinatura confirmada",
      text:
        `Ola, ${customer.name}!\n\n` +
        `Sua assinatura foi confirmada. Voce sera cobrado R$ ${reais} ` +
        `a cada ${Number(INTERVALO_DIAS)} dias, ate cancelar.\n` +
        `Proxima cobranca: ${daquiADias(Number(INTERVALO_DIAS))}.\n\n` +
        `Para cancelar a qualquer momento, acesse sua conta ou responda este e-mail.`,
    });

    res.json({
      ok: true, assinaturaId, nome: customer.name, cardMask: cardMask || null,
      primeiraCobranca: { chargeId: d.charge_id, status: d.status, total: d.total },
      proximaCobranca: daquiADias(Number(INTERVALO_DIAS)),
    });
  } catch (err) {
    console.error("Erro em /assinar:", err);
    res.status(500).json({ erro: "Erro interno ao criar a assinatura." });
  }
});

app.get("/assinaturas", async (_req, res) => {
  try {
    res.json(await listarAssinaturas());
  } catch (err) {
    console.error("Erro em /assinaturas:", err);
    res.status(500).json({ erro: "Erro ao listar." });
  }
});

// CANCELAR uma assinatura: nao havera mais cobrancas.
app.post("/cancelar", limiter, async (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ erro: "id ausente." });

  try {
    const assinatura = await buscarAssinatura(id);
    if (!assinatura) return res.status(404).json({ erro: "Assinatura nao encontrada." });

    const cancelou = await cancelarAssinatura(id);
    if (!cancelou) return res.json({ ok: true, jaInativa: true });

    await enviarEmail({
      to: assinatura.email,
      subject: "Assinatura cancelada",
      text:
        `Ola, ${assinatura.nome}!\n\n` +
        `Sua assinatura foi cancelada e nao havera mais cobrancas.\n` +
        `Se foi engano, e so assinar novamente.`,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("Erro em /cancelar:", err);
    res.status(500).json({ erro: "Erro ao cancelar." });
  }
});

initDb()
  .then(() => app.listen(Number(PORT), () =>
    console.log(`Servidor em http://localhost:${PORT} | Efi ${SANDBOX ? "HOMOLOGACAO" : "PRODUCAO"}`)))
  .catch((err) => { console.error("Falha ao iniciar o banco:", err); process.exit(1); });
