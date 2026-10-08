# Registrar compras da Apple Wallet no Meu Controle Financeiro

## O que esta integração faz

Uma automação pessoal do iPhone envia ao Supabase o valor, o estabelecimento e a data que o Atalhos disponibilizar para a transação. O app registra o lançamento como gasto no cartão, pagamento **Crédito Apple Pay** e categoria **Outros**. A integração não acessa a conta do banco nem a fatura; funciona somente para transações que acionem o gatilho do Atalhos e cujos dados possam ser selecionados na automação.

## Instalação

1. No repositório do app, substitua `index.html`, `styles.css` e `app.js` pelos arquivos deste pacote e publique.
2. No Supabase, abra o **SQL Editor**, cole e execute todo o arquivo `supabase-wallet-shortcut.sql`.
3. Entre no app, vá até **Compras da Carteira da Apple** e toque em **Gerar token do Atalho**. Copie o token. Ele só é mostrado nessa tela no momento da criação; se perder, gere outro. Gerar um novo substitui o anterior.
4. No iPhone, abra **Atalhos > Automação > Nova Automação > Transação** (o nome pode variar conforme a versão do iOS), escolha o cartão e configure para executar imediatamente, se essa opção aparecer.
5. Na automação, use as variáveis de transação fornecidas pelo Atalhos para preencher valor, estabelecimento e data. Gere um UUID para cada execução e envie a chamada abaixo usando **Obter Conteúdo do URL**, método `POST`.

## Chamada HTTP

URL:

`https://dqvapavughrriimcjsdj.supabase.co/rest/v1/rpc/record_wallet_purchase`

Cabeçalhos:

- `apikey`: o valor `SUPABASE_KEY` que já está no `app.js` (chave publicável do projeto)
- `Authorization`: `Bearer ` seguido do mesmo valor `SUPABASE_KEY`
- `Content-Type`: `application/json`

Corpo JSON (substitua os valores por variáveis do Atalhos):

```json
{
  "p_token": "COLE_AQUI_O_TOKEN_GERADO_NO_APP",
  "p_request_id": "UUID_UNICO_DA_EXECUCAO",
  "p_amount": 12.34,
  "p_merchant": "Nome do estabelecimento",
  "p_date": "2026-10-05",
  "p_card_name": "Nome do cartão"
}
```

No Atalhos, `p_amount` deve ser numérico (sem `R$`), `p_date` deve estar no formato `AAAA-MM-DD` e `p_request_id` deve ser um UUID diferente em cada execução. A repetição do mesmo UUID não cria outro lançamento.

## Segurança e limites

- O app guarda somente o hash do token; a chave de acesso em texto é mostrada uma vez e fica guardada no Atalho do seu iPhone. Não envie esse token para ninguém.
- O botão **Revogar acesso** invalida o token imediatamente; gere outro para voltar a usar.
- A automação só será disparada para as transações cobertas pelo gatilho da Carteira. Compras online, em apps ou cartões não selecionados podem não ser incluídos.
- Confira um lançamento de teste e a disponibilidade das variáveis no seu iPhone antes de depender da automação. O formato e os dados disponíveis podem variar com o iOS e com o cartão.
