# Plano — visual pastel nas seções da tela Entregas PEP

**Origem:** pedido de 02/10/2026, depois do redesenho do painel "O que precisa de você"
(branch `feat/pep-painel-precisa-de-voce`). Levar o mesmo visual para:

1. **O que está no SharePoint agora** (com o painel "Evidências esperadas" dentro)
2. **Ver o que foi lido** (o botão e a gaveta que ele abre)
3. **Quem fez o apurado**
4. **Situação das entregas**
5. **Para onde vai o teto**

Tela: `/relacionamento-prestador/pep/` → `PepEntregasTab` → `RoboNaPep` (seções 1–2) e
`VisaoGeralPep` (seções 3–5).

---

## Regras que valem para todas as fases

- **Só a camada visual.** Nenhum número, cálculo, consulta, RPC ou texto de regra muda.
  Os dados continuam vindo de `useRoboSharepoint`, `obterResumoExecucao`,
  `resumoPepCompetencia`, `situacaoEntregasPorAnalista` etc.
- **Mesmos tokens do painel pronto:** `.pp`, `.pp-tom`, `.pp-t-*`, `.pp-cartao`, `.pp-pilula`,
  `.pp-selo`, `.pp-btn` em `frontend/app/globals.css`. Nada de cor solta em hex no componente.
- **Pastel com texto escuro.** Nunca texto branco sobre tinta (DESIGN.md §2, âmbar sem forma cheia).
- **Sentido das cores na PEP não muda** (DESIGN.md, "Status Lock Rule" e §"robô × pessoa"):
  violeta = robô · azul = pessoa · verde = liberado/feito · âmbar = esperando/faltando ·
  vermelho/rosa = descontado · cinza = sem conferência · aço (217) = ação aqui.
- **Não mexer em peças compartilhadas com outras telas.** `visaoGeral/pecas.tsx`
  (`Card`, `BarraEmpilhada`, `Metric`) também serve a `VisaoGeralIndividual`; `Drawer`,
  `Blocos.tsx`, `ExploradorPastas` e `ListaArquivos` também servem `/admin/robo-sharepoint`.
  As versões pastéis nascem em peças novas ou entram atrás de uma prop (`simples`).
- **Componentes padrão continuam:** `MultiSearchCombobox` (filtro de profissionais),
  `InfoTooltip`, `SegmentedTabs` só se não houver equivalente pastel aprovado.
- Tema claro e escuro (`.dark`), `prefers-reduced-motion`, foco visível, contraste ≥ 4,5:1,
  `@container` para 4 → 2 → 1 colunas, sem rolagem horizontal.

---

## Fase 0 — Kit pastel compartilhado (base de tudo)

**Objetivo:** tirar as peças de `roboSharepoint/precisaDeVoce/pecas.tsx` do painel e torná-las
reaproveitáveis nas cinco seções.

- Mover para `frontend/components/ui/pastel/` (ou nome a definir):
  - `tom()`, tipo `Tom`, `AnelProgresso`, `BotaoAjuda` (agora recebendo as linhas por prop),
    `Fluxo`, `Comemoracao`, `confete`, `avisoFeito`.
- Peças novas:
  - **`CabecalhoPastel`** — título 22/800 + "?" + elemento à direita (anel, número, ação).
  - **`NumeroPastel`** — cartão de número grande (ícone em quadrado, valor 34–44/800, rótulo
    curto, marca d'água do ícone). Substitui `Numero`, `Metric`, os `dl` do esperado.
  - **`BarraPastel`** — barra empilhada pastel (trilha `--pp-muted`, segmentos `--c-medio`
    de cada tom) com legenda em pílulas. Substitui `BarraEmpilhada` *só na PEP*.
  - **`PilulaFiltro`** — `button.pp-pilula` com `aria-pressed` (já existe o CSS).
- Tons novos em `globals.css`: `pp-t-robo` (295, alias do violeta), `pp-t-pessoa` (255),
  `pp-t-vermelho` (10, descontado), `pp-t-cinza` (croma 0).
- **Correção do painel pronto:** o selo "Nome?" usa azul (255), que na PEP é **pessoa**.
  Trocar por outro matiz (ver decisão D1).
- `FilaNaoReconhecidos` passa a importar do kit (sem mudar o visual).

**Pronto quando:** painel "O que precisa de você" idêntico ao de hoje, importando do kit.

---

## Fase 1 — "O que está no SharePoint agora" (`DestaqueLeitura.tsx`)

Hoje: faixa degradê no topo, ícone + título + data, chip "todos os arquivos…", botão aço cheio
"Ver o que foi lido", três números cinza empilhados e o painel de esperadas ao lado.

**Novo:**
- Sai a faixa degradê. Cabeçalho `CabecalhoPastel`: "O que está no SharePoint agora" + "?"
  (o "retrato da leitura de …" e "todos os arquivos de todos os prestadores" vão para o "?";
  no cabeçalho fica só "há 3 h").
- **Três `NumeroPastel` lado a lado** (empilham no celular):
  arquivos na pasta (aço) · evidências na pasta (verde) · pastas no site (cinza).
  O subtítulo longo vira `title`.
- **"Ver o que foi lido" vira uma aba-cartão de ação** (mesma anatomia de `.pp-aba`: ícone 56,
  título, meta "prestador por prestador", seta →), tom aço, cheio.
- Estados do ramo antigo (sem a migration): **lendo** = cartão aço suave com `Loader2` e
  "Lendo o site…"; **erro** = cartão vermelho suave; **nunca leu** = cartão cinza.
- **Painel "Evidências esperadas" (`PainelEsperadas` + `EsperadasChart`):**
  - Título + selo do período em pílula; "Como o esperado é calculado" continua no `InfoTooltip`.
  - Mês/Ano: duas `PilulaFiltro` (ou `SegmentedTabs` com classe pastel — decisão D4);
    filtro de profissionais continua `MultiSearchCombobox`.
  - Os três quadros (na pasta / no padrão / não contam) → `NumeroPastel` cinza / verde / âmbar.
  - "X de Y" → `AnelProgresso` com o % no centro.
  - Barras por sigla: **mesmo matiz de hoje para cada sigla**, em versão pastel (trilha
    `--c-suave`, cheio `--c-medio`, selo da sigla `--c` com texto escuro). Resolve de quebra o
    selo branco sobre `#eda100` (PIC), que hoje fica abaixo de 4,5:1.
  - Linha TOTAL em destaque: cartão aço suave.

## Fase 2 — "Ver o que foi lido" (gaveta `DetalheExecucaoDrawer` em `simples`)

Só quando `simples` (tela PEP). A gaveta de `/admin/robo-sharepoint` fica como está
(ver decisão D2).

- Raiz do conteúdo ganha `.pp`.
- **Resumo do topo:** sai a faixa degradê; número grande "N arquivos na pasta" em
  `NumeroPastel` aço + pílulas "N pastas" e "N evidências" (as métricas contando continuam).
- **`AbaListar` (simples):** o `Lead` vira uma linha curta; cada `Bloco` vira seção pastel
  (título 17/800 + contagem em selo).
  - "Todas as pastas, prestador por prestador": filtros Todos / Com arquivo / Sem arquivo →
    `PilulaFiltro`. **`ExploradorPastas`**: linhas de prestador como cartões pastel
    (avatar com iniciais, nº de arquivos em selo, botão-ícone de abrir no SharePoint);
    níveis de baixo como lista recuada leve. Recebe prop `pastel`.
  - "Onde estão os arquivos": cada prestador vira um cartão pequeno em grade
    (nome, nº grande, mini barra evidências/fora do PEP/outros em pastel). Toque continua
    filtrando a lista de baixo (`aria-pressed`, contorno `--c-medio`).
  - "Os N arquivos, um por um" (**`ListaArquivos`**): fichas de tipo → `PilulaFiltro` com
    contagem; cada arquivo como linha-cartão pastel (selo da sigla, nome, trilha em cinza,
    situação em selo no tom do status). Recebe prop `pastel`.
- `ModalArquivo`: fora desta fase (só herda os tokens; decisão D3).

## Fase 3 — "Quem fez o apurado" (`VisaoGeralPep.tsx`)

- `CabecalhoPastel` com "?" (a frase "Cada entrega vale a parte dela…" vai para o "?").
- Três `.pp-cartao` lado a lado:
  **Robô SharePoint** (tom robô/violeta, avatar `Bot`) · **Pessoas da equipe** (tom pessoa/azul,
  avatar `User`) · **Pessoas desfizeram** (cinza, avatar `Undo2`). Valor em R$ 34/800, linha de
  apoio curta ("12 entregas marcadas"). No cartão "desfizeram", o "acertou 94%" vira
  mini `AnelProgresso`.
- Barra robô × pessoas → `BarraPastel` (violeta/azul pastel).
- `LegendaOrigem` → duas pílulas (Robô / Pessoa) — só na Visão geral; o `LegendaOrigem` usado
  em outras partes da PEP não muda.
- "Arquivos no SharePoint neste mês" → três pílulas: verde "N seguem o padrão",
  âmbar "N fora do padrão", cinza "N repetidos".

## Fase 4 — "Situação das entregas"

- Cabeçalho com **`AnelProgresso` "N/M liberados"** (liberados ÷ analistas) à direita.
- Barra por status → `BarraPastel` nos tons de hoje (verde liberado, azul conferido,
  cinza completas, âmbar faltam).
- A lista de 4 status com texto longo → **grade 2×2 de `NumeroPastel`** (ícone + nº grande +
  rótulo curto). O texto `nota` de cada status vai para `title` e para o "?" da seção
  (hoje já existe `ExplicacaoStatus`; reaproveitar o mesmo texto).
- Status zerado: número cinza, cartão sem cor (a cor nunca é o único sinal: rótulo sempre).

## Fase 5 — "Para onde vai o teto"

- Cabeçalho: "Para onde vai o teto" + **teto do mês em destaque** (R$ grande) +
  "N pacientes × R$ X" como apoio.
- Três linhas-cartão com **mini barra proporcional ao teto**:
  Apurado (verde, "vai ser pago") · Descontado (vermelho pastel) · Não apurado (âmbar,
  "N pacientes sem apuração").
- Detalhe dos descontos (recorrentes, semestrais, saldo, devolução): dentro do cartão
  Descontado, em lista curta; com mais de 2 itens, recolhido num "ver detalhe".
- Modo teste e "sem valor por paciente": cartão âmbar suave com ícone, uma frase.
- Fases 4 e 5 continuam lado a lado no desktop (`md:grid-cols-2`) e empilham no celular.

## Fase 6 — Conferência e entrega

1. `npx tsc --noEmit`, `npx eslint` nos arquivos tocados, `npx vitest run` (lib/remuneracao e
   lib/roboSharepoint).
2. Prévia com dados fictícios numa rota temporária pública (o Playwright não loga):
   screenshots claro / escuro / 390 px de cada seção, com estados vazio, carregando e erro.
   **Apagar a rota antes do commit.**
3. Conferir `/admin/robo-sharepoint` e `VisaoGeralIndividual` sem mudança.
4. Usuário valida no `localhost:3000` (banco de produção — nada nesta tela grava, exceto o
   "Escolher" do painel já pronto).
5. Commit por fase na branch; merge só depois da validação do usuário; redeploy pelo usuário
   no Coolify.

---

## Ordem e tamanho

| Fase | O quê | Arquivos principais | Tamanho |
|---|---|---|---|
| 0 | Kit pastel + correção "Nome?" | `components/ui/pastel/*`, `globals.css`, `FilaNaoReconhecidos` | P |
| 1 | SharePoint agora + Esperadas | `DestaqueLeitura`, `PainelEsperadas`, `EsperadasChart` | M |
| 2 | Ver o que foi lido (gaveta) | `DetalheExecucaoDrawer`, `AbaListar`, `ExploradorPastas`, `ListaArquivos` | G |
| 3 | Quem fez o apurado | `VisaoGeralPep` | P |
| 4 | Situação das entregas | `VisaoGeralPep` | P |
| 5 | Para onde vai o teto | `VisaoGeralPep` | P |
| 7 | Resto da tela | `VisaoGeralPep`, `AvisosEvidencias`, `ModalArquivo` | M |
| 6 | Conferência (ao fim de cada fase e no final) | — | P |

Ordem de entrega: **0 → 3 → 4 → 5 → 7** (Visão geral, rápido e visível), depois **1**, por
último **2** (a maior e a única que encosta em peças do painel técnico).

## Fase 7 — o resto da tela (incluído por decisão D3)

Mesmo tratamento, para a tela não ficar metade nova, metade antiga:

- **Topo "apurado de teto"** (hero da `VisaoGeralPep`): sai a faixa degradê; R$ apurado 44/800 em
  verde, "de R$ teto" como apoio, `AnelProgresso` com o % do teto; as 4 métricas (analistas,
  pacientes, por analista, valor por paciente) em `NumeroPastel` pequenos; a barra
  apurado/descontado/não apurado em `BarraPastel`.
- **"Analistas do mês"**: busca no padrão `.pp-busca`; cada analista vira linha-cartão pastel
  (avatar com iniciais no tom do status, nome, apoio curto, R$ robô/pessoa em pílulas, selo do
  status). Desktop mantém as colunas (pacientes, teto, apurado, % teto); celular empilha.
- **`AvisosEvidencias`** (entregas que mudaram porque a evidência saiu da pasta): cartões pastel
  âmbar/vermelho com ícone e uma linha.
- **`ModalArquivo`**: só quando aberto pela gaveta da PEP (prop `pastel`); no admin, igual.
- **"Linhas fora da grade"**: cartão âmbar suave recolhível.

## Decisões (respondidas em 02/10/2026)

- **D1 — "Nome?"** passa para **verde-azulado (matiz 185)**. Azul fica só para "pessoa".
- **D2 — gaveta "Ver o que foi lido"**: visual pastel **só na PEP** (`simples`). O admin não muda.
- **D3 — resto da tela**: **incluir já** (Fase 7 acima).
- **D4 — Mês/Ano do esperado**: pílulas pastéis (`PilulaFiltro`), padrão das outras seções.
- **D5 — commit**: painel pronto commitado antes de começar; uma fase por commit, merge só após
  validação.
