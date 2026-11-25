---
name: fechar-mes
description: Conduz o fechamento mensal das finanças do casal no Fyminance, nos mesmos quatro passos do app (dados, conciliação, metas e investimentos), e fecha o mês com o relatório. Use quando a pessoa pedir para fechar o mês ou chamar /fechar-mes.
---

# Fechamento do mês

Se a pessoa informou um mês (AAAA-MM) junto do comando, use esse mês; senão, use o mês anterior ao atual.

Fale em português, de forma direta. As ferramentas devolvem valores em centavos; mostre sempre em reais (R$ 1.234,56). Nos totais de gasto, gasto aparece positivo.

O fechamento é o mesmo do app: o que for feito aqui aparece lá, e vice-versa. Comece com `closing_status` para ver o que já foi feito, inclusive pela outra pessoa no app, e retome do primeiro passo pendente. Se o mês já estiver fechado, diga quando e por quem, e pare.

## 1. Dados atualizados

Chame `balances`. Para cada conexão com problemas, diga o que fazer (por exemplo, "reconectar o banco no Meu Pluggy") e pergunte se a pessoa quer resolver antes de seguir. Se a última sincronização tiver mais de um dia, sugira rodar `pnpm fy sync` antes de continuar.

## 2. Conciliação

Chame `pending_items` com o mês e `categories` para ter os ids.

**Fila de revisão.** Percorra `review` na ordem em que vem (maior valor primeiro), um grupo por vez:

- Mostre estabelecimento, motivo, quantidade, total e as descrições de exemplo. Se o grupo tem `lateFromMonth`, avise que ele chegou depois do fechamento daquele mês.
- Proponha uma categoria e, quando fizer sentido, o dono (casal, pessoa1 ou pessoa2). Só as exceções mudam de dono; o padrão é casal. Em `pix_person`, pergunte quem é a pessoa antes de propor.
- Em entradas (`direction: in`), lembre que uma categoria de gasto significa devolução e reduz aquele gasto.
- Com a confirmação, chame `categorize` com os `transactionIds` do grupo e `scope: "rule"`. Use `scope: "only_these"` quando a pessoa disser que é um caso isolado.
- Em `refund` (estorno?), o grupo traz em `refundOf` a compra de que o crédito parece ser estorno. Mostre a compra e, se a pessoa confirmar, chame `offset` com o crédito e a compra: o abatimento conta no mês da compra. Se não for estorno, siga como nas outras linhas.
- Em `pj_income`, cada entrada vem num grupo próprio, porque o PJ manda pró-labore e lucros pelo mesmo Pix e o valor muda de mês a mês. Pergunte qual é qual e chame `categorize` com `scope: "only_these"`, nunca com regra.

**Divergências.** Para cada item de `billDivergences` e `balanceDivergences` sem `explanation`, explique a diferença à pessoa e registre a explicação dela com `explain_divergence` (use a `key` do item). Não tente corrigir dado do banco. Se a diferença for um lançamento que faltou, diga que ele pode lançá-lo no app ("Lançar a diferença").

**Fora da Pluggy.** Pergunte se o valor do vale-alimentação do mês está certo e se houve gasto em dinheiro vivo. Lançamentos manuais e a correção do vale-alimentação são feitos no app; quando a pessoa confirmar, chame `confirm_check` com `key: "flash"` e com `key: "cash"`.

Chame `closing_status` de novo: a conciliação precisa estar completa para seguir.

## 3. Categorias e metas

Chame `goals` com o mês que fecha. Mostre, por categoria, o gasto do mês contra a média e a sugestão de meta, as anotações do mês seguinte e quanto deve sobrar. Metas e anotações são definidas no app; se ainda não foram, sugira que as duas pessoas façam isso lá.

## 4. Investimentos

Chame `investments` com o mês. Mostre total investido, rendimento, aportes contra a meta de aporte e, se faltou aporte, compare com a sobra do mês.

## 5. Fechar e observar

Chame `close_month` com o mês. Ele gera e salva o relatório do mês; se a conciliação não estiver completa, ele recusa e diz o motivo.

Depois, chame `read_document` com `relatorios/AAAA-MM.md`, escreva três observações objetivas sobre o mês e, com o ok da pessoa, salve-as com `save_report`: o texto vira a seção "Observações do Claude" do relatório, sem apagar o resto.
