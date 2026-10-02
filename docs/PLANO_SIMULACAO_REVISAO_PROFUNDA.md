# Plano de Revisão Profunda: Simulação de Novo Prestador

**Objetivo:** Refazer o envelopamento visual completo da tela de Simulação de Novo Prestador (`relacionamento-prestador/solicitacoes/?tab=simulacao`) e seus componentes anexos, baseando-se estritamente no padrão de excelência de design da tela de PEP (`relacionamento-prestador/pep/`).

**Regra de Ouro Inquebrável:** NENHUM cálculo, nomenclatura, ordem de elementos ou lógica condicional deve ser alterado. O trabalho é pura e estritamente visual (CSS, classes, agrupamentos estéticos).

---

## 0. Preparação e Regras de Versionamento

> [!WARNING]
> **É ESTRITAMENTE PROIBIDO ALTERAR O CÓDIGO DIRETAMENTE NA BRANCH `main`.**
> 
> Antes de tocar em qualquer arquivo, crie e acesse uma nova branch:
> ```bash
> git checkout -b feat/redesign-simulacao-pastel-profundo
> ```

A abordagem deve ser de extrema cautela, trabalhando de forma lenta, prolixa e detalhista, garantindo um resultado elegante e alinhado ao Pastel Design System.

---

## 1. Filtros de Simulação (`FiltrosContratacao.tsx`)

Atualmente, elementos como "Ocupação", "Faixa", e "Especialidades" apresentam estilos antigos que destoam do novo sistema.

### O que faremos:
- **Agrupamentos:** Substituir contêineres padrões e sombras por `.pp-cartao` e `.SecaoPastel`.
- **Botões de Rádio / Alternância ("Manhã + tarde juntos", "Melhor turno isolado"):** Utilizar a estilização de *pills* interativas (Selo/Botão Pastel), removendo fundos pesados e aplicando `pp-tom bg-[var(--c-suave)] text-[var(--c-tinta)]` para os itens selecionados, garantindo contraste suave.
- **Faixas (≥ 70%, ≥ 60%, ≥ 50%):** Envolver cada opção em uma `CabecalhoPastel` ou estrutura similar de tag suave para afastar a aparência de formulário "cru".
- **Especialidades:** Assegurar que os Selects/Dropdowns sigam a estética do `MultiSearchCombobox` padronizada na regra, com fundos pastéis e bordas sutis `var(--pp-border)`.

---

## 2. Sugestões Automáticas (`SugestoesContratacaoPanel.tsx` -> `CardSugestao`)

As opções de sugestões de contratação precisam ser modernizadas para evitar cortes de texto e confusão hierárquica.

### O que faremos:
- **Card Principal:** Transição para um contêiner `.pp-cartao` genuíno, com `var(--pp-muted)` e hover actions leves.
- **Cabeçalho (Ocupação e Especialidade):**
  - **"92% ocupação":** Adaptar o componente de ocupação (`BadgeOcupacao`) para usar os estilos de anel de progresso da página do PEP (`AnelProgresso`), ou pílulas pastel (`pp-pilula-bola`).
  - **Identificadores (Psicologia ABA / Fazendinha):** Tratar o alinhamento para que a leitura seja linear e contígua. Evitar estilos brutos e utilizar os tons pastéis da própria disciplina.
  - **Grade de Dias (S T Q Q S / M T):** Repaginar a mini grade de dias (`IndicadorDiaTurno`). Os turnos marcados usarão cores pastéis de forte presença, mas arredondados e bem espaçados, parecidos com as barras do PEP.
- **Metadados (12 vagas · 14 pacientes | Adjacência/Remanejamento | Salas):**
  - Estes rodapés ou *tags* não devem parecer botões perdidos. Eles serão transformados em `ChipOrigem` similares aos usados no PEP, com tipografia `var(--pp-ink-muted)` e caixas de fundo translúcido `bg-[var(--pp-surface)]`.

---

## 3. Lista de Candidatos (`SimulacaoNovoPrestadorTab.tsx` -> `CandidatoLinha`)

O problema de leitura onde nomes curtos ficam "rques" ou "ASSIM Saúd" precisa ser sanado através da reestruturação da célula.

### O que faremos:
- **Layout Flex:** Ajustar o `flex` e os truncamentos (`truncate`) das linhas de pacientes na tabela expandida para garantir que o nome possua `flex-1` real.
- **Selo de Modalidade ("Adjacência", "Remanejamento"):** Adotar os `.pp-selo-motivo` para estas categorias, emulando os status do PEP. Cores: Adjacência (Azul Suave), Remanejamento (Âmbar Suave), Reserva (Vermelho Suave).
- **Tipografia:** Harmonizar as fontes, removendo estilos antigos do Tailwind (como `text-xs font-medium` nativo) e impondo variáveis de cor `--pp-ink` e `--c-tinta`.

---

## 4. Onde Encaixar esse Profissional (`SimulacaoNovoPrestadorTab.tsx` -> Seção 3)

O layout atual se tornou visualmente confuso, misturando informações de vagas, dias, turnos e a dicotomia de plano recomendado vs. fixação de unidade.

### O que faremos:
- **Cards de Unidade (Plano Recomendado vs. Fixe em Unidade Única):**
  - Cada unidade se tornará um cartão pastel claramente definido (`bg-[var(--pp-surface)] border-[var(--pp-border)]`).
  - Títulos ("Plano Recomendado") se aproveitarão do `.CabecalhoPastel` de forma reduzida.
  - O resumo de "X vagas que exigem contratação... Y pacientes disputando" deixará de ser um bloco de texto sem graça e virará uma barra de destaque visual.
- **Botões de Ação:** O clique nas unidades (para fixar a simulação) usará o modelo de card interativo do PEP, revelando bordas tingidas (ex: azul) quando ativo (`ring-2 ring-[var(--pp-ring)]`).

---

## 5. Projeção Financeira - Break Even (`SimulacaoNovoPrestadorTab.tsx` -> Seção 4)

A "pior" parte do layout segundo o diagnóstico: "Ficou muito mal trabalhado". A massa de informações sobre impostos, perdas, líquido, remuneração e margem está caótica.

### O que faremos (Sempre preservando cálculos e textos exatos!):
- **Estruturação em Painéis (Frente 1 vs Frente 2):**
  - Criar um grid de colunas robusto (ex: `grid-cols-2`). 
  - Usar os `.pp-cartao` com sombreamento suave. Cada frente ("Projeção específica" e "Projeção média mensal") terá uma caixa visualmente coesa e separada.
- **O Bloco do Break Even ("+R$ 1.896,00 Margem de Novembro..."):**
  - Transformar o número gigante em um cartão de valor de destaque idêntico ao "VisaoGeralPep" (`bg-[var(--c-suave)] text-[var(--c-tinta)]`).
- **Tabela em Cascata (Extrato de Impostos/Receita/Remuneração):**
  - Aquela "lista" onde se deduz valores ("− Perda (20%)", "− Imposto (20%)", "= Líquido") será formatada como um cupom/fatura contábil.
  - Fundo cinza (`bg-[var(--pp-muted)]`), espaçamento vertical delicado, e cores lógicas para subtrações (vermelho suave pastel) e resultados positivos (verde suave pastel).
- **Seletores de Cenário (Perda 20/25/30%):** Substituir as pílulas rústicas por abas ou botões alternadores do sistema `.pp-tom`.

---

## Próximos Passos (Workflow)

Quando o usuário autorizar a execução, o robô (eu) deverá:
1. Validar que estamos em `feat/redesign-simulacao-pastel-profundo`.
2. Começar pelo `FiltrosContratacao.tsx`.
3. Passar para o `SugestoesContratacaoPanel.tsx`.
4. Alterar as linhas de paciente do `SimulacaoNovoPrestadorTab.tsx`.
5. Redesenhar a seção "Onde Encaixar".
6. Refatorar cuidadosamente a "Projeção Financeira - Break Even".
7. Pausar e exibir o resultado de cada etapa, de forma extremamente lenta e metódica.
