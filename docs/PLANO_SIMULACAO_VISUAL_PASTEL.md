# 🎨 Planejamento de Redesign Pastel — Simulação de Solicitações

O presente documento estabelece as bases conceituais, os mapeamentos de componentes e a metodologia a ser aplicada na modernização visual da aba **"Simulação de Novo Prestador"** (`relacionamento-prestador/solicitacoes/?tab=simulacao`). O alvo é equiparar esta página ao requintado padrão de experiência do usuário (UX) e interface (UI) já adotado no painel PEP, utilizando nosso Kit Pastel compartilhado.

---

## ⚠️ DIRETRIZES INVIOLÁVEIS E CONDUTA OPERACIONAL

Antes de procedermos ao desdobramento das tarefas de design, é imperativo reforçar as regras do jogo:

1. **Criação Obrigatória de Branch**: 
   A primeira ação técnica do executor deverá ser **criar uma branch e se deslocar para ela**. (Exemplo: `git checkout -b feat/simulacao-visual-pastel`). Em nenhuma hipótese o código será editado diretamente na `main`. Toda a transição será feita de forma isolada.
   
2. **Preservação Lógica e Estrutural Absoluta**: 
   Nós não alteraremos a inteligência da página. Isso significa que **toda a ordem dos itens, a nomenclatura, a disposição estrutural de leitura, e absolutamente todos os cálculos** devem permanecer idênticos. Apenas o "tecido" visual e as formatações nativas de CSS (Tailwind) serão traduzidos para os tokens do novo design system (`.pp`, `--pp-surface`, etc.).

---

## 🏗️ 1. Abordagem Geral: Envelopamento do Tema Pastel

- Todo o perímetro da aba `SimulacaoNovoPrestadorTab` e de seus componentes irmãos deverá ser contido sob a classe `.pp`, que serve como ativadora das variáveis de cores.
- Trocaremos a sintaxe nativa fria do Tailwind, como `border-border`, `bg-card` e `text-muted-foreground`, pelas variáveis orgânicas e quentes definidas no globals.css: `border-[var(--pp-border)]`, `bg-[var(--pp-surface)]`, `text-[var(--pp-ink)]` e `text-[var(--pp-ink-muted)]`.
- As seções principais deixarão de usar meras `div` e adotarão o componente `SecaoPastel` (ou sua estrutura análoga com bordas e sombras).
- Os cabeçalhos de bloco passarão a utilizar o `CabecalhoPastel` e suas configurações de ícones unificados (`Icone={...}`).

Abaixo, detalho minunciosamente a tradução para os sete polos do painel indicados:

---

## 🔍 2. Mapeamento das Seções e Componentes

### 1. Sugestões Automáticas de Contratação
Localizado no `SugestoesContratacaoPanel.tsx`. 
- **Cabeçalho:** A descrição "Sugestões de encaixe automático" ou equivalente passará a usar um `<CabecalhoPastel>` para introduzir a área com suavidade.
- **Moldura:** O bloco todo ganhará o sombreamento embutido característico (`shadow-[var(--pp-sombra)]`).
- **Cartões de Sugestão:** Cada bloco de especialidade/vaga sugerida deixará de ter traços agressivos e utilizará o fundo `bg-[var(--pp-muted)]` para se sobressair.

### 2. Parâmetros da Simulação
Área central onde o profissional hipotético é construído.
- Os *inputs* (combobox de Especialidade e seletores numéricos) perderão a borda seca do `border-border`. Eles serão estilizados como `.pp-busca` ou com `bg-[var(--pp-surface)] border-[var(--pp-border)]`.
- Os "Dias e turnos afetados" (seletores de manhã e tarde por dia da semana) mudarão os botões de rádio para o aspecto de pílula arredondada do pastel. A seleção verde "viva" adotará os tokens suaves (`var(--pp-verde)` do kit) para harmonizar, sem perder a legibilidade.

### 3. Onde Encaixar esse Profissional
O gráfico/distribuição de unidades viáveis.
- **Estrutura:** O bloco será circundado pelo componente de base do design system ou uma divisão estilizada de `bg-[var(--c-suave)]` quando houver predominância de tom.
- O componente passará a utilizar as "Pílulas de Filtro" (`<PilulaFiltro>`) caso existam alternâncias ou os estilos de botões `.pp-btn-suave` para destacar as ações disponíveis na área.
- Etiquetas que demonstrem as unidades e status serão convertidas em `<span className="pp-selo ...">`.

### 4. Projeção Financeira - Ponto de Equilíbrio (Break Even)
Área altamente densa numericamente.
- O componente base (`LinhaEquilibrio`) terá suas classes de cor ajustadas. Em vez das classes `text-emerald-700` e `text-rose-600` padrão, adotaremos as leituras pastéis que provaram ter maior legibilidade ou a utilização do subconjunto nativo (ex: `var(--pp-verde)` e `var(--pp-vermelho)` se aplicável).
- Os agrupamentos matemáticos e resumos financeiros adotarão os cartões do design (`.pp-cartao`).
- Os ícones associados aos valores usarão o invólucro quadrado de base do Pastel, garantindo que o olho não se canse na leitura.

### 5. Detalhamento — Realengo (Ou unidade específica selecionada)
Apresentação profunda da unidade destacada pela simulação.
- **Métricas:** Toda estatística, como Vagas Livres, Previsão e Candidatos serão exibidas usando o `<NumeroPastel>`. 
- Isso permitirá apresentar um ícone quadrado flutuante da mesma cor da importância do número (ex: verde para pacientes preenchidos, cinza para fora do escopo, âmbar para excedentes).
- O fundo desta área acompanhará o tom de destaque, mantendo bordas generosas e um visual arredondado de cartões suspensos.

### 6. Agenda do Novo Profissional
Visão macro das lacunas preenchidas pelo profissional simulado.
- Os blocos de dia/horário sofrerão amolecimento visual (arredondamento e redução de cores fortes) em prol do sistema `.pp-tom`.
- As etiquetas de horários cobertos e lacunas ociosas (`Gap` vs `Vaga Livre`) utilizarão a lógica base do pastel com `.pp-selo-motivo`, definindo a cor (teal, cinza, pessoa) conforme dita o glossário `DESIGN.md`.

### 7. Sessões e Candidatos em Formato Lista
Exibição granular (Sessão a sessão).
- Em vez de uma tabela rígida cinza comum, cada candidato passará a ser renderizado na clássica caixa `.pp-cartao`.
- Caso haja um motor de busca na lista, ele será o `.pp-busca`.
- O nome do paciente será renderizado no padrão forte do kit (font-extrabold e cor de tinta específica), mantendo as tags laterais como `.pp-pilula-bola` para métricas menores ou contagens.

---

## 🛠️ Conclusão e Próximos Passos
Esta reestruturação foi meticulosamente planejada. O objetivo primordial alcançado é: o sistema manterá todos os seus cálculos e estruturas originais intocadas, mas com o painel inteiramente vestido sob as diretrizes pastéis do PEP.

Quando o desenvolvedor estiver preparado para o avanço, a execução deverá começar rigorosamente após o `git checkout -b` de uma nova branch. Estarei monitorando atenciosamente, componente a componente.
