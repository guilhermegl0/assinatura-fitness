// Agendador de cobranca das assinaturas semanais.
// Rode periodicamente (ex.: 1x por dia) via Cron Job do Render: `node cobrar-assinaturas.js`.
// Ele cobra toda assinatura ativa cuja proxima_cobranca ja venceu, avanca a data
// em caso de sucesso e, apos MAX_TENTATIVAS falhas, desativa a assinatura.
import dotenv from "dotenv";
import { cobrancaOneStep, aprovada } from "./efi.js";
import {
  assinaturasParaCobrar, registrarCobrancaOk, registrarFalha, pool,
} from "./db.js";

dotenv.config();

const MAX_TENTATIVAS = Number(process.env.MAX_TENTATIVAS || "3");

async function main() {
  const pendentes = await assinaturasParaCobrar();
  console.log(`[${new Date().toISOString()}] Assinaturas a cobrar: ${pendentes.length}`);

  let ok = 0, falhas = 0;

  for (const a of pendentes) {
    try {
      const charge = await cobrancaOneStep({
        valor: a.valor,
        descricao: "Assinatura semanal",
        customer: a.customer,   // JSONB ja vem como objeto
        address: a.address,
        paymentToken: a.paymentToken,
      });

      if (aprovada(charge)) {
        await registrarCobrancaOk(a.assinatura_id);
        ok++;
        console.log(`OK    ${a.assinatura_id} (R$ ${(a.valor / 100).toFixed(2)})`);
      } else {
        await registrarFalha(a.assinatura_id, MAX_TENTATIVAS);
        falhas++;
        const d = charge.data?.data || charge.data || {};
        console.warn(`FALHA ${a.assinatura_id} status=${d.status || "?"}`);
      }
    } catch (err) {
      await registrarFalha(a.assinatura_id, MAX_TENTATIVAS).catch(() => {});
      falhas++;
      console.error(`ERRO  ${a.assinatura_id}:`, err.message);
    }
  }

  console.log(`Resumo: ${ok} cobradas, ${falhas} falhas.`);
  await pool.end();
}

main().catch((err) => {
  console.error("Falha no agendador:", err);
  process.exit(1);
});
