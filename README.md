# Assinatura semanal de R$ 8,00 com Efí Bank

Como a API de Assinaturas do Efí só trabalha com intervalo em **meses**, a
recorrência **semanal** é feita aqui com "cartão salvo" + um **agendador**:
guardamos o `payment_token` reutilizável e cobramos R$ 8,00 a cada 7 dias.

## Componentes
- `efi.js` — cliente da API Cobranças do Efí (auth, cobrança One Step, estorno).
- `db.js` — PostgreSQL: tabelas `cartoes` e `assinaturas`.
- `mail.js` — envio de e-mail (SMTP). Sem SMTP configurado, só registra no log.
- `server.js` — site + endpoints `/assinar` e `/cancelar`.
- `cobrar-assinaturas.js` — agendador que cobra as assinaturas vencidas.
- `public/checkout.html` — tela de assinatura (com aviso de recorrência e cancelamento).

## Fluxo
1. O cliente preenche o cartão; o navegador tokeniza com `reuse: true`
   (o número do cartão não passa pelo servidor).
2. `POST /assinar`: o backend faz a **1ª cobrança de R$ 8,00**. Ela serve como
   validação do cartão E como primeira semana. Se for recusada, nada é salvo.
3. Se aprovada, salva o cartão e cria a assinatura com `proxima_cobranca` em +7 dias.
4. O agendador (`cobrar-assinaturas.js`), rodando 1x por dia, cobra toda
   assinatura ativa cuja data já venceu, avança a data em +7 dias no sucesso e,
   após `MAX_TENTATIVAS` falhas, desativa a assinatura.

> Por que não a 1ª cobrança de R$ 1 + estorno? Porque aqui a 1ª cobrança real de
> R$ 8,00 já valida o cartão — não faz sentido cobrar duas vezes no cadastro.

## Rodar (local)
Precisa de um PostgreSQL. Rápido com Docker:
```bash
docker run --name efi-pg -e POSTGRES_PASSWORD=senha -e POSTGRES_DB=efi -p 5432:5432 -d postgres
```
Depois:
```bash
npm install
cp .env.example .env     # preencha credenciais Efí, payee_code e DATABASE_URL
npm start                # sobe o site (cria as tabelas no 1o start)
```
Abra http://localhost:3000/checkout.html

Para testar o agendador manualmente (cobra o que estiver vencido agora):
```bash
npm run cobrar-assinaturas
```

### Cartões de teste (Homologação, EFI_SANDBOX=true)
O resultado depende do último dígito: final 1/2/3 = recusado; demais = aprovado.

## Produção no Render
1. PostgreSQL: New -> PostgreSQL. Copie a *Internal Database URL*.
2. Web Service (o site): conecte o repo, defina as variáveis do `.env`
   (incluindo `DATABASE_URL`). Start: `npm start`.
3. Cron Job (o agendador): New -> Cron Job, mesmo repo, comando
   `npm run cobrar-assinaturas`, agenda diária (ex.: `0 9 * * *`). Use as mesmas
   variáveis de ambiente do Web Service.
4. Comece com `EFI_SANDBOX=true`; troque para `false` só quando for produção real.

## Importante
- O **número do cartão nunca é gravado** — só o `payment_token`, dados do cliente e endereço.
- Cobrança semanal recorrente é cobrança real e legítima do seu cliente; isto NÃO
  é um verificador de cartões de terceiros.
- LGPD: você guarda CPF e dados de pagamento. Guarde só o necessário, restrinja
  acesso ao banco e tenha política de retenção/exclusão.
- Nunca exponha `Client_Secret` no front-end nem suba o `.env` (o `.gitignore` cuida disso).
- Avise o cliente sobre a recorrência (valor, frequência) e ofereça cancelamento —
  exigência das bandeiras para cobranças recorrentes. Isto já está na tela
  (aviso + botão Cancelar) e nos e-mails de confirmação/cancelamento.
