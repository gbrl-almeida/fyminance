# Fyminance

Um app de finanças da casa que roda no seu computador. Ele junta a conta e o cartão de todo mundo num lugar só, separa os gastos por categoria e, uma vez por mês, conduz um fechamento curto: o que entrou, o que saiu, onde passou do ponto e qual a meta do mês seguinte.

Seus dados ficam no seu computador. Nada vai para servidor de ninguém, a não ser o que você mesmo ligar (Pluggy para puxar os bancos, OpenRouter para a IA de categorias).

## O que ele faz

- **Painel do mês.** Quanto sobrou, gasto por categoria comparado com a média dos meses anteriores, parcelas a vencer e faturas abertas.
- **Categoria automática.** Você ensina uma vez ("iFood é Delivery") e vira regra. Opcionalmente, uma IA barata sugere a categoria do que nenhuma regra pegou.
- **Fechamento do mês em 4 passos.** Dados, conciliação, metas e investimentos. Dá para fazer pelo celular.
- **Duas pessoas e a casa.** Cada gasto é da casa, da pessoa 1 ou da pessoa 2. Mora sozinho? Use só a pessoa 1.
- **Importar fatura.** Arquivo CSV da fatura do C6 ou do Nubank, direto pela tela.
- **Bancos no automático (opcional).** Pela Pluggy, que usa o Open Finance, o extrato e a fatura chegam sozinhos.
- **Conversar com os seus dados (opcional).** No Claude Code, dá para perguntar "quanto gastamos com delivery esse ano?" e ele responde consultando o banco de dados do app.

## Antes de começar

Você vai precisar de:

1. **Node.js 22 ou mais novo.** Baixe a versão LTS em [nodejs.org](https://nodejs.org) e instale com as opções padrão.
2. **Um terminal.** No Windows, abra o "Prompt de Comando" (procure por `cmd` no menu Iniciar). No Mac, o app "Terminal".
3. **Uns 15 minutos.**

Para conferir o Node, digite no terminal:

```bash
node --version
```

Tem que aparecer `v22` ou um número maior.

## 1. Instalar

1. Baixe o projeto [neste link](https://github.com/gbrl-almeida/fyminance/archive/refs/heads/main.zip) e descompacte num lugar fácil de achar, como Documentos. A pasta vem com o nome `fyminance-main`. Quem usa git pode clonar o repositório.
2. No terminal, entre na pasta: digite `cd` e um espaço, arraste a pasta para dentro da janela do terminal e aperte Enter. Fica parecido com isto:

   ```bash
   cd C:\Users\voce\Documents\fyminance-main
   ```

3. Instale o pnpm, o programa que baixa as peças do app. Só precisa fazer uma vez por computador:

   ```bash
   npm install -g pnpm
   ```

4. Baixe as peças do app:

   ```bash
   pnpm install
   ```

5. Crie o seu arquivo de configuração a partir do exemplo.

   No Windows:

   ```bash
   copy .env.example .env
   ```

   No Mac ou Linux:

   ```bash
   cp .env.example .env
   ```

## 2. Testar com dados de exemplo

Antes de pôr os seus dados, veja o app funcionando com dados inventados.

1. Crie o banco de exemplo:

   ```bash
   pnpm fy demo --dir demo
   ```

2. Abra o arquivo `.env` num editor de texto (Bloco de Notas serve) e tire o `#` do começo desta linha:

   ```
   FYMINANCE_DATA_DIR=demo
   ```

3. Monte o app e ligue:

   ```bash
   pnpm web:build
   ```

   ```bash
   pnpm web:start
   ```

4. Abra [http://localhost:3210](http://localhost:3210) no navegador. Entre como Pessoa 1, com a senha `demo-senha-123`.

Para desligar o app, volte ao terminal e aperte `Ctrl + C`.

## 3. Usar com os seus dados

1. No `.env`:
   - ponha o `#` de volta na linha `FYMINANCE_DATA_DIR=demo`, para os dados reais irem para a pasta padrão;
   - troque `Pessoa 1` e `Pessoa 2` pelos nomes de vocês.
2. Crie o banco de verdade:

   ```bash
   pnpm fy migrate
   ```

3. Crie a senha de cada pessoa. O comando pede a senha duas vezes, e ela não aparece enquanto você digita:

   ```bash
   pnpm fy user set-password pessoa1
   ```

   ```bash
   pnpm fy user set-password pessoa2
   ```

4. Monte de novo, para os nomes aparecerem, e ligue:

   ```bash
   pnpm web:build
   ```

   ```bash
   pnpm web:start
   ```

5. Entre em [http://localhost:3210](http://localhost:3210) e importe a primeira fatura.

### Importar a fatura do cartão

1. No app do banco, exporte a fatura em CSV. O app lê o CSV do **C6** e do **Nubank**.
2. No Fyminance, clique no ícone de envio, no canto de cima.
3. Escolha o arquivo e o cartão. Na primeira vez, dê um nome ao cartão, como "Nubank da Ana".

Faça isso todo mês com a fatura nova. Se a mesma compra vier duas vezes, o app pula a repetida.

### Ver no celular

Com o app ligado no computador e o celular no mesmo Wi-Fi, abra no celular `http://IP-DO-COMPUTADOR:3210`.

Para achar o IP no Windows, rode `ipconfig` e procure "Endereço IPv4", algo como `192.168.0.12`. No Mac, ele aparece em Ajustes, Wi-Fi, Detalhes.

O app pede login, mas não foi feito para ficar aberto na internet. Use só na rede de casa.

## 4. Opcional: ligar os bancos (Pluggy)

Com a Pluggy, o app puxa conta corrente, cartão e investimentos sem você exportar nada. Ela usa o Open Finance: você autoriza no app do seu banco, como em qualquer serviço desse tipo.

A Pluggy tem um caminho gratuito para uso pessoal, chamado Meu Pluggy. Os passos mudam de vez em quando, então siga o [guia oficial da Pluggy](https://docs.pluggy.ai). Em resumo:

1. Conecte os seus bancos no Meu Pluggy.
2. No painel da Pluggy (Dashboard), crie uma aplicação e copie o **Client ID** e o **Client Secret**.
3. No painel, conecte o Meu Pluggy à sua aplicação e copie o **itemId** de cada conexão.
4. No `.env`, preencha:

   ```
   PLUGGY_CLIENT_ID=o-client-id
   PLUGGY_CLIENT_SECRET=o-client-secret
   FYMINANCE_CONNECTIONS=pessoa1:Nubank:o-item-id
   ```

   Cada conexão é `pessoa:banco:itemId`, separadas por vírgula. O nome do banco é só para você reconhecer.

5. Puxe os dados:

   ```bash
   pnpm fy sync
   ```

Na primeira vez, vêm até 12 meses de histórico. Depois, rode o `sync` quando quiser dados novos, ou agende para rodar todo dia (Agendador de Tarefas no Windows, `cron` no Mac e no Linux).

Cada pessoa só conecta as próprias contas no Meu Pluggy. Se a pessoa 2 tiver a própria conta lá, use `PLUGGY_CLIENT_ID_PESSOA2` e `PLUGGY_CLIENT_SECRET_PESSOA2` para as conexões dela.

O consentimento do Open Finance vence (até 12 meses). Quando vencer, o app avisa e você renova no Meu Pluggy.

## 5. Opcional: IA para categorizar

As regras pegam a maior parte dos gastos. O que sobrar pode ir para uma IA barata, pelo [OpenRouter](https://openrouter.ai).

1. Crie uma conta no OpenRouter, ponha uns poucos dólares de crédito e gere uma chave.
2. No `.env`, preencha:

   ```
   OPENROUTER_API_KEY=sua-chave
   FYMINANCE_MODEL=google/gemini-2.5-flash-lite
   ```

Qualquer modelo do OpenRouter serve. `FYMINANCE_MODEL_MAX_COST_USD` limita quanto cada execução pode gastar, e o padrão é 0,50 dólar. Depois que você tiver umas categorias confirmadas, `pnpm fy eval-models --models modelo-a,modelo-b` mostra qual modelo acerta mais.

## 6. Opcional: conversar com o Claude Code

Se você usa o [Claude Code](https://claude.com/claude-code), abra ele dentro da pasta do projeto. Ele já encontra as ferramentas do Fyminance e pede permissão na primeira vez.

Exemplos do que dá para pedir:

- "Quanto a gente gastou com delivery por mês esse ano?"
- `/revisar-historico`: a primeira passada de categorias, do estabelecimento que mais gastou para o que menos gastou.
- `/fechar-mes`: o fechamento do mês, conversando, nos mesmos passos do app.

E se quiser mudar o app, peça para ele. Foi assim que este app foi feito.

## Comandos

| Comando | O que faz |
|---|---|
| `pnpm web:build` | Monta o app. Rode de novo depois de atualizar o código ou trocar os nomes. |
| `pnpm web:start` | Liga o app em http://localhost:3210. |
| `pnpm fy migrate` | Cria ou atualiza o banco de dados. |
| `pnpm fy user set-password pessoa1` | Cria ou troca a senha de uma pessoa. |
| `pnpm fy demo --dir demo` | Cria um banco com dados inventados. |
| `pnpm fy import arquivo.csv --account id --name "Nome"` | Importa uma fatura pelo terminal, em vez da tela. |
| `pnpm fy sync` | Puxa os bancos pela Pluggy e categoriza. |
| `pnpm fy reprocess` | Refaz as categorias com as regras atuais. |
| `pnpm fy status` | Mostra as últimas sincronizações e o que está pendente. |
| `pnpm fy accounts list` | Lista as contas. |
| `pnpm fy backup run` | Gera um backup criptografado (precisa do [age](https://age-encryption.org)). |

## Onde ficam os dados

Num arquivo só, `fyminance.db`, na pasta `.local/share/fyminance` dentro da sua pasta de usuário. No Windows, algo como `C:\Users\voce\.local\share\fyminance`. Para fazer backup simples, copie esse arquivo com o app desligado.

Os relatórios de cada mês fechado ficam na mesma pasta, em `relatorios`.

## Quando algo dá errado

**`pnpm` não é reconhecido.** Feche e abra o terminal de novo depois do `npm install -g pnpm`. No Windows, use o Prompt de Comando, não o PowerShell, que pode bloquear o pnpm.

**`node` não é reconhecido ou a versão é menor que 22.** Instale o Node de novo pelo [nodejs.org](https://nodejs.org) e reabra o terminal.

**A porta 3210 já está em uso.** O app já está ligado em outro terminal. Feche aquele ou use o que está aberto.

**Troquei os nomes e nada mudou.** Rode `pnpm web:build` de novo e ligue o app.

**"Banco não encontrado".** Rode `pnpm fy migrate`.

**Esqueci a senha.** Rode `pnpm fy user set-password pessoa1` de novo.

**O CSV não foi aceito.** Por enquanto o app lê só a fatura do C6 e do Nubank. Para outro banco, peça ao Claude Code um leitor novo, seguindo os que estão em `src/integrations/files`.

## Para quem programa

Next.js 16 e React 19 na tela, SQLite com Drizzle no banco, Vitest nos testes, servidor MCP em `src/mcp/server.ts`.

- `pnpm test`: testes de unidade.
- `pnpm typecheck`: checagem de tipos.
- `pnpm test:e2e`: monta o app e roda os testes no navegador, com dados de exemplo (precisa de `pnpm exec playwright install chromium` na primeira vez).
- `pnpm web:dev`: app com recarga automática.

As regras do código estão no `CLAUDE.md`.
