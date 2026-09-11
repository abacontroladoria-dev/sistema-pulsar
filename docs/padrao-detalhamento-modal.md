# Padrão de detalhamento em modal

**Este é o padrão de modal de detalhamento do sistema.** Modal novo que abre o
detalhe de uma linha de lista nasce daqui — não de um desenho próprio. Decidido
com o usuário em 11/09/2026, depois da terceira tela adotá-lo.

Como a **Análise de Evolução** (`/analise-tratativas`) foi redesenhada, escrito
para ser replicado em outra tela. Referência viva: commit `678cce7`, arquivos em
`frontend/components/central-terapeutas/tratativas/` e
`frontend/lib/remuneracao/evolucao.ts`.

## Telas que já seguem o padrão

Em ordem de adoção — a primeira é a referência, as outras mostram o que varia:

| Tela | Modal | O que essa adoção ensina |
|---|---|---|
| Análise de Evolução (`/analise-tratativas`) | `tratativas/ModalAnaliseTerapeuta.tsx` | A referência original: as três camadas, os buckets, a partição em abas. |
| Rem. Mês - Total (`/relacionamento-prestador/rp`) | `cronograma/remuneracao/ModalRemuneracaoRP.tsx` | Que o padrão aguenta **dinheiro** e uma fórmula de duas vias (base de sessões, depois valor). |
| PDI - Painel por Analista (`/terapeutico/pdi-painel-analista`) | `terapeutico/pdi/AnalistaDetalheModal.tsx` | Que a **composição é opcional**: quando os status são uma partição e não uma conta, a fila de `PassoConta`/`Conector` sai e ficam header + resultado + abas. Também o caso de **modal empilhado** (ver §3.13). |

Os auxiliares de apresentação (`PassoConta`, `Conector`, `ResultadoNumero`,
`CampoDetalhe`, `paginasVisiveis`) estão **duplicados** nos três arquivos, de
propósito e com comentário dizendo isso. A terceira adoção era o gatilho
combinado para extrair um kit compartilhado; quando isso for feito, é nos três
que se mexe, e esta tabela é a lista de chamada.

---

## 1. O padrão em uma frase

**Lista compacta + modal-workspace.** A lista responde *quem precisa de
atenção*; o modal responde *por quê* — com a conta explicada em cima, o
resultado no meio e **uma** tabela com abas embaixo. Nada de expandir a linha
para baixo, nada de accordion escondendo tabela.

### Quando usar

- A linha da lista tem um número que resume a pessoa/entidade, e por trás dele
  existe uma **conta** que alguém vai questionar.
- O detalhamento tem mais de ~15 linhas ou mais de 4 colunas.
- Existem categorias de exceção que mudam o denominador.

### Quando **não** usar

- O detalhe cabe em 3 campos → use um popover ou uma segunda linha.
- O detalhe é editável e faz parte de um fluxo → use uma rota própria; modal com
  formulário longo trava o usuário.

---

## 2. As três camadas

Separá-las é o que faz o padrão sobreviver a mudanças. A ordem é obrigatória:
**escreva a camada 1 antes de tocar em JSX.**

| Camada | Arquivo na referência | Responsabilidade |
|---|---|---|
| 1. Regra | `lib/remuneracao/evolucao.ts` | Parte os registros em buckets e devolve a composição (números + listas). **Zero import de runtime.** |
| 2. Vocabulário visual | `tratativas/chips.tsx` + `hooks/useToneColor.ts` | `TONE_CHIP`, `TONE_PANEL`, `StatusChip`, cor por tom ciente de tema. |
| 3. UI | `CardTratativas.tsx`, `ModalAnaliseTerapeuta.tsx`, `TratativasSkeleton.tsx` | Só apresenta. Não calcula nada. |

### Camada 1 — o formato que funciona

```ts
// Só tipos entram aqui: type-only import é apagado na compilação, então o
// módulo roda sob `node --test` sem arrastar o resto do sistema.
import type { Entidade, Registro } from "./fonte"

export type Bucket = "ok" | "assumido" | "pendente" | "foraDaConta" | "cedido" | "inconsistente"

/** UM registro → UM bucket. A ordem dos ifs é a regra de negócio. */
export function bucketDoRegistro(r: Registro): Bucket { /* … */ }

export type Composicao = {
  // números que a tela mostra
  previstos: number; foraDaConta: number; validos: number
  esperadas: number; feitas: number; pct: number
  // as listas, para as abas não recontarem nada
  porBucket: Record<Bucket, Registro[]>
  todas: Registro[]
}

export function composicao(e: Entidade): Composicao { /* … */ }
```

Duas propriedades que essa forma garante:

1. **A partição vem da classificação que já existe.** Na referência,
   `bucketDaSessao` lê `classificacao`, produzida por `classificarSessaoReal`, e
   cada `if` corresponde a um `contador++` de `calcularRemuneracaoReal`. Nada é
   reclassificado, então contagem da aba e número da composição não podem
   divergir: **é a mesma partição contada de dois jeitos.**
2. **Os totais fecham por construção.** Conte `previstos` a partir da própria
   partição, não de um contador que mora fora dela — assim
   `previstos − foraDaConta − cedidos = validos` continua exato mesmo se o
   cálculo de origem mudar.

---

## 3. As regras que sustentam o padrão

Cada uma existe porque a ausência dela produziu um bug real nesta tela.

### 3.1 Um número, uma fonte

Card e modal chamam a **mesma** função. Se a UI recalcula "só esse aqui", em uma
semana os dois discordam e ninguém sabe qual está certo.

### 3.2 Nunca dois números com o mesmo nome na mesma tela

Foi o erro que mais custou. A aba "Com evolução" mostrava 56 enquanto o KPI
"Com evolução" mostrava 60 (o KPI somava as substituições). Ou os dois números
são iguais, ou **um dos dois muda de nome** — a aba virou "Evolução própria",
e a nota dela diz a soma: *"somadas às 10 substituições, dão as 50 com evolução
do resultado acima"*.

### 3.3 Abas são uma partição

Cada registro em **exatamente uma** aba, e a soma das abas fecha com "Todos".
Antes, "Com evolução" incluía as substituições e a aba "Substituições" mostrava
as mesmas linhas de novo: a tira somava 77 com "Todos 73" e nenhuma contagem
estava errada isoladamente. Uma aba que é subconjunto de outra é uma armadilha
aritmética.

- "Todos" = **todos** os registros do período, inclusive o que não conta.
- Aba que ficaria sempre vazia (ex.: "Substituídas por outro" quando é 0) não é
  renderizada — mas só se as linhas dela seguirem alcançáveis em "Todos".

### 3.4 O que a tela não conta, a tela precisa dizer

O caso que originou isto: um agendamento com evolução de duas pessoas
(`tratativas_distintas = 2`) vira "conflito de autoria" e **não** credita
substituição. O modal mostrava `Substituições realizadas: 0` ao lado de uma
linha com `Origem: Substituição`. Os dois fatos verdadeiros, nada ligando um ao
outro — parece bug.

Correção em três pontos, sem mexer na conta:

1. o bloco da composição ganha nota em âmbar: **"1 em conferência"**;
2. a aba ganha faixa + botão **"Ver em Inconsistências"** (a contagem do badge
   continua igual ao número da composição; o atalho é o que torna a linha
   encontrável);
3. o detalhe da linha diz **por quê**: `Evoluções neste agendamento: 2 · de 2
   pessoas` e `Efeito na conta: fora das substituições até a autoria ser decidida`.

### 3.5 Um tom, um significado — e zero não tem cor

`Tone = green | amber | red | purple | blue | gray`, sempre via
`useToneColor()`/`TONE_CHIP`, nunca hex solto (um `B.amber` fixo já caiu para
3,57:1 no dark mode). O tom de um conceito é o mesmo no card, na composição, na
aba e na coluna da tabela.

Badge/número **colorido só quando > 0**; cinza no zero. "0 inconsistências" em
vermelho grita por um problema que não existe — e é o que impede duas abas
vermelhas (`Canceladas`, `Inconsistências`) de parecerem iguais no caso comum.

### 3.6 Dois sinais diferentes, duas cores diferentes

No card, o bloco numérico usa `statusTone` (o que mais urge nesta pessoa:
inconsistência → pendência → feito) e a barra usa `pctTone` (a leitura do
próprio percentual). Com um tom só, uma inconsistência pintava **90,9% de
vermelho** — dizendo "péssimo" sobre um número bom.

### 3.7 Eixos diferentes, colunas diferentes

`Origem` (agendamento × substituição) · `Situação` (aconteceu?) · `Evolução`
(consta?) são três perguntas. Colapsar em uma coluna é o que faz a tabela
precisar de legenda. Exemplo que só fecha com os três: *"Pendente retroativa"* =
Situação **Realizado** + Evolução **Pendente**.

### 3.8 Ruído técnico vive no detalhe secundário

Tabela principal: data, horário, quem, o quê, e os três eixos. ID, presenças,
autoria, timestamps e classificação vão no `<dl>` que abre no chevron da linha.

### 3.9 Estado de carregamento é parte do desenho

O corpo mostrava *"Sem sessões nesta grade"* — a mensagem de **não existe dado**
— enquanto o dado vinha do banco. O único sinal de vida era um spinner de 13px
no header. Isso se lê como tela quebrada.

- Sem dado na tela → **skeleton no formato do layout real** + frase do que está
  sendo lido (*"Lendo a grade de Julho de 2026…"*).
- Com dado na tela (recarga) → a lista **fica onde está** e aparece um
  "Atualizando…" discreto. Esconder o que a pessoa está lendo é pior que esperar.
- O vazio só aparece quando a carga terminou: `{!resultado && !carregando && …}`.

### 3.10 Rótulos não comparáveis não podem parecer comparáveis

Header dizia "14.788 registros"; o painel, "8.396 sessões". Ninguém compara sem
concluir que há erro. Não havia: um conta **o que foi lido**, o outro **o que
exige ação**. Renomeado para "linhas da grade", com a composição da diferença no
`title` dos dois números.

### 3.11 Filtro de uma tela não vaza para outra

A busca da lista escolhe **quem** aparece; dentro do modal a mesma string
esconderia o resto do período da pessoa. O modal abre sempre limpo e tem busca
própria. Corolário: se um estado só pode ser *herdado e removido*, nunca ligado,
ele está no lugar errado.

### 3.12 Estado nasce limpo por `key`, não por efeito

Trocar a entidade aberta reseta aba/página/detalhe **remontando** o modal:

```tsx
<ModalAnalise key={aberto ?? "fechado"} … />
```

`useEffect` que faz `setState` para resetar viola `react-hooks/set-state-in-effect`
e ainda pisca com o valor antigo.

### 3.13 Modal empilhado sobre este precisa furar o trap de foco

Quando uma linha da tabela abre **outro** modal por cima (no PDI, clicar no nome
abre a edição do paciente), os dois não convivem sozinhos: o `Dialog` do Radix
prende o foco na própria árvore, e o modal de cima costuma ser um
`createPortal` para o `document.body` — fora dela. Sem guarda, o trap disputa
cada clique e cada `Tab` com os campos do modal de cima, e um clique lá dentro
conta como "fora" e fecha o de baixo.

```tsx
<DialogContent
  onInteractOutside={e => e.preventDefault()}
  onPointerDownOutside={e => e.preventDefault()}
>
```

O empilhamento em si já funciona por `z-index` (o `Dialog` fica em `z-50`, e
`Z_MODAL_EMPILHADO` do `ScheduleModal` é `70`) — o que falta é só desarmar o
trap. Ver `AnalistaDetalheModal.tsx` + `PdiDetalheModal.tsx`.

---

## 4. Anatomia do modal

```
┌────────────────────────────────────────────────────────────┐
│ (avatar) Nome            Período analisado   %      [X]    │  header
├────────────────────────────────────────────────────────────┤
│ Composição da responsabilidade                             │
│  [50] − [3] = [47] + [8] = [55]                            │  a conta
├────────────────────────────────────────────────────────────┤
│ Feitas 55 │ ━━━━━━━━━━━━━━ 100,0% │ Pendentes 0 │ Inc. 2   │  resultado
├────────────────────────────────────────────────────────────┤
│ ╭Todos 58╮ Própria 47  Pend 0  Canc 3  Subst 8   [buscar]  │  abas-planilha
│ ├────────┴───────────────────────────────────────────────  │
│ nota da aba ativa                                          │
│ tabela (7 colunas) → linha expande em <dl> de detalhe      │
│ Mostrando 1 a 15 de 58        ‹ 1 2 3 … 4 ›                │
└────────────────────────────────────────────────────────────┘
```

### Casca

```tsx
<DialogContent
  showCloseButton={false}          // botão próprio, absoluto no mobile
  aria-describedby={undefined}
  className="h-[90vh] w-[90vw] max-w-350 gap-0 grid-rows-[auto_minmax(0,1fr)]
             overflow-hidden rounded-2xl bg-card p-0 sm:max-w-350"
>
  <header … />                      {/* linha auto do grid */}
  <div className="overflow-y-auto px-5 py-5 md:px-6">…</div>  {/* rola só aqui */}
</DialogContent>
```

`grid-rows-[auto_minmax(0,1fr)]` + `overflow-y-auto` no corpo = header fixo e
scroll interno. Sem o `minmax(0,…)` o corpo não encolhe e o modal cresce além da
viewport.

### A conta

Blocos compactos com conectores `−`, `=`, `+`, `=`; `destaque` (anel) marca o
que vem **depois de um `=`** — é o que distingue um resultado de um subtraendo
que dividem o mesmo cinza.

```tsx
<div className="flex flex-col items-stretch gap-1.5 sm:flex-row sm:flex-wrap" aria-hidden>
  <Passo tone="blue"   valor={c.previstos} titulo="Agendamentos previstos" />
  <Conector sinal="−" />
  <Passo tone="red"    valor={c.canceladas} titulo="Canceladas" nota="não exigem evolução" />
  <Conector sinal="=" />
  <Passo tone="gray"   valor={c.validos} titulo="Agendamentos válidos" destaque />
  …
</div>
<p className="sr-only">{/* a mesma fórmula em prosa */}</p>
```

Empilha no mobile (`flex-col … sm:flex-row`): em `flex-wrap` puro os conectores
caem sozinhos no começo de uma linha e a fórmula deixa de se ler. A linha visual
é `aria-hidden` e a versão `sr-only` carrega o texto.

### Barra + número

```tsx
<div className="flex items-center gap-3">
  <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full border border-border bg-muted">
    <div className="h-full w-full" style={{
      background: cor,
      clipPath: `inset(0 ${100 - pct}% 0 0)`,
      transition: "clip-path 500ms cubic-bezier(0.16, 1, 0.3, 1)",
    }} />
  </div>
  <span className="shrink-0 …" style={{ color: cor }}>{pct}%</span>
</div>
```

- `flex-1 min-w-0` na barra, **nunca `w-full`**: o número é `shrink-0` e precisa
  ser medido primeiro, senão a barra reserva a faixa toda e joga o número fora
  da tela em largura apertada.
- `clip-path` em vez de `width`/`scaleX`: não força reflow por frame e o
  arredondamento fica com o container.
- Sem denominador, o percentual é `"—"`, não `0,0%`.

### Abas em formato de planilha

```tsx
{/* tira levemente tonalizada; a aba ativa em bg-card parece levantada */}
<div className="flex flex-wrap items-end gap-x-4 gap-y-2 rounded-t-2xl
                border-b border-border bg-muted/30 px-2 pt-2">
  <div role="tablist" className="flex flex-1 flex-wrap items-end gap-1">
    <button role="tab" aria-selected={ativa}
      className={`relative -mb-px inline-flex items-center gap-1.5 rounded-t-lg
                  border px-3 py-2 text-xs ${ativa
        ? "border-border border-b-transparent bg-card font-bold text-foreground"
        : "border-transparent font-semibold text-muted-foreground hover:bg-card/60"}`}>
      {ativa && (
        // acento no TOPO: embaixo ele cortaria a emenda com o painel
        <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 rounded-t-lg"
              style={{ background: toneColor(tone) }} />
      )}
      <span className={TONE_CHIP[tone].text}>{icon}</span>
      {label}
      <span className={`… ${badge.bg} ${badge.text}`}>{sessoes.length}</span>
    </button>
  </div>
  <input type="search" … />   {/* busca própria do modal */}
</div>
```

`-mb-px` + `border-b-transparent` + `bg-card` é o que apaga a linha embaixo da
aba ativa e cria a emenda com o painel (o fundo do botão é pintado sob a borda
transparente e cobre a borda do container).

### Tabela

```tsx
<div className="overflow-x-auto">
  <table className="w-full min-w-215 text-xs">…</table>
</div>
```

`min-w-215` (860px) faz o container **rolar de lado** em tela estreita em vez de
comprimir "Paciente" em três linhas por célula. A linha de detalhe é um segundo
`<tr>` com `colSpan`, e o par precisa de `<Fragment key={…}>` — `<>` com keys nos
filhos dispara warning.

---

## 5. Anatomia da linha da lista

Uma linha = um `<button>` (`aria-haspopup="dialog"`), ~120 linhas de JSX:

```tsx
<button className="mb-3 flex w-full flex-col gap-4 rounded-xl bg-card px-5 py-4
                   text-left shadow-sm transition-colors hover:bg-muted/40
                   focus-visible:ring-2 focus-visible:ring-ring
                   xl:flex-row xl:items-center xl:gap-6">
  {/* 1. identificação — basis dá o piso, grow absorve a sobra: o nome cabe
         inteiro sem truncar e sem empurrar o resto */}
  <div className="flex items-center gap-3 xl:basis-72 xl:shrink-0 xl:grow">…</div>
  {/* 2. leitura principal (barra + %) — xl:shrink-0 */}
  {/* 3. métricas — xl:ml-auto xl:shrink-0, divide-x */}
  <ChevronRight className="hidden xl:block" />   {/* "abre detalhe" */}
</button>
```

`wrap-break-word` no nome, e a sobra de largura vai para a coluna de
identificação — não para a barra. Sem isso o nome quebra letra a letra
("Agatacr / yst / Moreira").

---

## 6. Checklist de replicação

1. **Ache a conta.** Onde a tela de origem calcula total, exceções e o
   percentual. Se estiver espalhada, é aqui que ela é centralizada.
2. **Extraia a camada 1** para `lib/<dominio>/<assunto>.ts`, pura, com
   `import type` apenas. Derive os buckets da classificação existente; não
   reclassifique.
3. **Escreva os testes antes da UI** (`node --test`, ver §7) com o caso que o
   usuário citar como verdade, mais: zero de tudo, exceção maior que a base,
   100%, abaixo de 100%, vazio.
4. **Nomeie em português, na voz do negócio**, e confira a regra 3.2: nenhum
   nome pode aparecer com dois valores diferentes na tela.
5. **Reuse `chips.tsx` e `useToneColor`.** Se precisar de um tom novo, ele entra
   no mapa — não no componente.
6. **Monte o modal** na ordem casca → conta → resultado → abas → tabela →
   detalhe → paginação. Compare com §4 antes de inventar layout.
7. **Enxugue a linha da lista** para: identificação, uma leitura principal, 3–4
   métricas, chevron. Todo o resto foi para o modal.
8. **Faça o skeleton** com o mesmo esqueleto do layout real e ligue o
   `carregando` **antes** de conferir na tela — é o estado que mais aparece e o
   que menos se testa.
9. **Confira a soma das abas** contra "Todos", na tela, com um caso que tenha
   todas as abas povoadas.
10. **Passe o pente:** `eslint`, `tsc --noEmit`, testes, e os três breakpoints.

---

## 7. Verificação

### Regra (sem instalar nada)

`vitest` está no `package.json` mas não instalado nesta base. Com a camada 1 pura,
o runner nativo do Node 24 resolve — ele apaga os tipos e roda o `.ts` direto:

```bash
node --test composicao.test.ts    # importa o módulo real por file:// URL absoluta
```

Toda asserção de caso vem acompanhada das **invariantes universais**, que valem
para qualquer entrada:

```ts
assert.equal(nosBuckets, total)              // ninguém fica fora de toda aba
assert.equal(c.todas.length, total)           // "Todos" lista tudo
assert.equal(c.validos, c.previstos - c.foraDaConta - c.cedidos)
assert.ok(c.feitas <= c.esperadas)            // numerador ⊆ denominador
assert.ok(c.pct <= 100)
```

### Visual, sem login e sem banco

`proxy.ts` libera `/tv` (`publicRoutes`), então uma rota **temporária** em
`app/tv/preview-<assunto>/page.tsx` com dado sintético renderiza a tela inteira
sem conta e sem consulta. Playwright vive no `node_modules` da **raiz** do repo e
é CJS:

```js
import pw from "file:///C:/…/sistema-pulsar/node_modules/playwright/index.js"
const { chromium } = pw
```

Rode em **1600 / 1280 / 390** e escute `console`/`pageerror`. Cada bug de layout
desta tela apareceu em screenshot, não em revisão de código.

**Apague a rota ao terminar** e confirme por `git status`.

### Ambiente

- `npx --no-install eslint <pasta>` e `npx --no-install tsc --noEmit`.
- O `tsc` já tem ruído pré-existente (`.next/types/**`, `calculoPEP.test.ts`
  pedindo `vitest`): filtre com
  `grep -Ev '^\.next/|calculoPEP\.test\.ts|^ '`.

---

## 8. Tailwind v4 nesta base

Um hook de diagnóstico cobra as utilitárias canônicas. Escala = `0.25rem` por
unidade, então **divida o pixel por 4**:

| Não | Sim |
|---|---|
| `max-w-[1400px]` | `max-w-350` |
| `min-w-[860px]` | `min-w-215` |
| `flex-shrink-0` | `shrink-0` |
| `break-words` | `wrap-break-word` |
| `bg-gradient-to-r` | `bg-linear-to-r` |

Animação sempre atrás de `motion-safe:` (`motion-safe:animate-pulse`,
`motion-safe:animate-spin`).

---

## 9. Armadilhas já pagas

| Sintoma | Causa | Correção |
|---|---|---|
| Percentual acima de 100% | numerador somava a exceção, denominador não | a exceção entra nos dois lados |
| Abas somam mais que "Todos" | uma aba era subconjunto de outra | partição (§3.3) |
| Número em 0 com linha visível daquele tipo | bucket de dúvida vence o papel | dizer "N em conferência" (§3.4) |
| `%` fora da tela no mobile | `w-full` na barra | `flex-1 min-w-0` |
| Conectores soltos no começo da linha | `flex-wrap` na fórmula | `flex-col … sm:flex-row` |
| Nome quebrando letra a letra | nome disputando linha com outro bloco | `flex-col … lg:flex-row` no header; `basis`+`grow` no card |
| Barra vermelha em número bom | um tom para dois sinais | `statusTone` × `pctTone` (§3.6) |
| "Realizado" numa linha contraditória | Situação lida só da classificação | ler também `statusFinal`/`statusCsv` |
| Tabela comprimida em 3 linhas por célula | falta de piso na `<table>` | `min-w-215` + `overflow-x-auto` |
| Modal abre filtrado | filtro herdado de outra tela | §3.11 |
| Tela parece quebrada ao abrir | vazio renderizado durante a carga | §3.9 |
| Warning de key | `<>` com keys nos filhos | `<Fragment key>` |
| Lint em efeito de reset | `setState` em `useEffect` | `key` na remontagem (§3.12) |
| Bordas penduradas no mobile | `divide-x` em container que quebra linha | borda por item com prefixo `sm:` |

---

## 10. O que **não** replicar sem pensar

- **A tela da referência nunca mostra R$.** Ela reusa a classificação do cálculo
  de remuneração alimentada com **taxas vazias** e sanitiza o resultado num tipo
  que só tem contagens — os campos monetários não existem no objeto entregue à
  UI, então não há como vazar nem por DevTools. Se a sua tela tem valor, esse
  aparato inteiro não se aplica; se não tem, copie-o (ver o cabeçalho de
  `lib/remuneracao/tratativas.ts`).
- **O agregado do topo não é a soma dos cards, de propósito.** O painel responde
  "quantas SESSÕES foram evoluídas" (cada uma uma vez); o card responde "quanto
  da RESPONSABILIDADE desta pessoa foi cumprida" (a substituição conta por
  pessoa). Somar os cards e comparar não fecha — e não deveria. Se a sua tela
  tem os dois níveis, escreva isso no código antes que alguém "corrija".
