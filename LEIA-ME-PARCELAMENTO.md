# Compras parceladas no cartão

Esta atualização acrescenta o campo **Número de parcelas** ao cadastro de gastos no crédito. Informe o valor total da compra, escolha a data da primeira parcela e indique de 1 a 48 parcelas. O app cria um lançamento por mês, nomeado com a parcela (por exemplo, `Compra (1/6)`), e divide centavos restantes entre as primeiras parcelas para que a soma bata exatamente com o total informado.

Para atualizar, substitua `index.html`, `styles.css` e `app.js` no repositório e publique. **Não é necessária uma nova alteração SQL** para o parcelamento. Se você também estiver usando a integração do Atalhos/Apple Wallet, mantenha o arquivo e os passos `supabase-wallet-shortcut.sql` e `LEIA-ME-ATALHO.md` do pacote.

Cada parcela é um lançamento separado no histórico. Se editar ou excluir uma parcela, isso altera somente aquela parcela.
