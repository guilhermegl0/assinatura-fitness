// Cliente da API Cobrancas do Efi, reutilizavel pelo servidor e pelo agendador.
const {
  EFI_CLIENT_ID,
  EFI_CLIENT_SECRET,
  EFI_SANDBOX = "true",
} = process.env;

if (!EFI_CLIENT_ID || !EFI_CLIENT_SECRET) {
  console.error("Faltam EFI_CLIENT_ID e/ou EFI_CLIENT_SECRET no ambiente.");
  process.exit(1);
}

export const SANDBOX = EFI_SANDBOX === "true";
const BASE = SANDBOX
  ? "https://cobrancas-h.api.efipay.com.br"
  : "https://cobrancas.api.efipay.com.br";

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;
  const basic = "Basic " + Buffer.from(`${EFI_CLIENT_ID}:${EFI_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${BASE}/v1/authorize`, {
    method: "POST",
    headers: { Authorization: basic, "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error("Falha na autenticacao Efi: " + JSON.stringify(data));
  }
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (Number(data.expires_in) || 600) * 1000;
  return cachedToken;
}

async function efi(path, { method = "GET", body } = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export function cobrancaOneStep({ valor, descricao, customer, address, paymentToken }) {
  return efi("/v1/charge/one-step", {
    method: "POST",
    body: {
      items: [{ name: descricao, value: valor, amount: 1 }],
      payment: {
        credit_card: {
          customer,
          installments: 1,
          payment_token: paymentToken,
          ...(address ? { billing_address: address } : {}),
        },
      },
    },
  });
}

export function estornar(chargeId) {
  return efi(`/v1/charge/${chargeId}/cancel`, { method: "PUT" });
}

// True se a cobranca foi aprovada/paga.
export function aprovada(charge) {
  const d = charge.data?.data || charge.data || {};
  return charge.ok && ["approved", "paid"].includes(d.status);
}
