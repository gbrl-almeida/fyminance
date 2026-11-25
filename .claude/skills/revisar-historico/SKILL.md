---
name: revisar-historico
description: Primeira passada de categorização pelos 12 meses importados no Fyminance, do estabelecimento de maior gasto para o menor, até cobrir 80% do valor, ajustando a lista de categorias. Use depois da primeira sincronização ou quando a pessoa pedir para revisar o histórico.
---

# Revisão do histórico

Fale em português, de forma direta. Valores das ferramentas vêm em centavos; mostre em reais.

## Preparação

1. Chame `categories` para conhecer os ids e caminhos.
2. Chame `spending` com `groupBy: "merchant"` cobrindo os últimos 12 meses. Some o total: é a base dos 80%.

## Revisão

Percorra os estabelecimentos do maior para o menor valor. Para cada um:

1. Chame `transactions` com o `merchantKey` para ver descrições, valores, categoria atual e de onde ela veio.
2. Se a categoria atual estiver certa e tiver vindo de regra ou decisão manual, siga em frente.
3. Senão, proponha categoria e dono e, com a confirmação, chame `categorize` com `merchantKey` e `scope: "rule"`. Se o estabelecimento tiver entradas e saídas com sentidos diferentes (Pix de e para a mesma pessoa), use `transactionIds` das saídas e depois das entradas, separadamente.
4. A cada 20 estabelecimentos, diga quanto do total já está coberto.

Quando uma categoria não servir, proponha a mudança com `edit_category` (criar, renomear, mover ou arquivar) e só aplique com o ok da pessoa.

Pare ao cobrir 80% do valor ou quando a pessoa pedir.

## Fechamento

Resuma: percentual coberto, regras criadas e categorias alteradas. Sugira rodar `pnpm fy eval-models --models <candidatos>` para escolher o modelo de categorização a partir do que foi confirmado.
