# Projeto GESTAO_CLINICA

## Stack

- Next.js App Router
- TypeScript
- Supabase
- TailwindCSS
- shadcn/ui

## Regras importantes

- Manter layout atual do sistema
- Manter identidade visual existente
- Mobile-first
- Não quebrar páginas existentes
- Reutilizar componentes existentes sempre que possível

## Backend

### agenda_tita
Agenda oficial

### controle_terapeutico
Controle operacional

### grade_profissionais_tita
Grade operacional do Tita

### vw_profissionais_disponiveis
View oficial para cobertura

## Regras operacionais

- Nunca usar agenda_id como chave principal
- Usar terapia_nome como referência operacional
- Filtrar unidade operacional:
  id_unidade = 280

## UI

- Seguir padrão visual das páginas existentes
- Usar side panels ao invés de páginas excessivas
- Desktop + Mobile compatíveis
- Tela mobile será usada pelas atendentes

## Componentes padrão (obrigatório)

Toda tela nova usa estes componentes. Não criar implementação própria, não usar
o campo nativo do navegador, não trazer outra biblioteca. O ESLint
(`frontend/eslint.config.mjs`) acusa erro nos casos que consegue detectar.

### Calendário

- **Data única:** `DatePicker` — `@/components/ui/date-picker`.
  Valor em `"AAAA-MM-DD"`; exibição `dd/mm/aaaa`; fim de semana em vermelho;
  rodapé "Limpar" / "Hoje". É o calendário padrão de TODO o sistema.
  Referências vivas: "Data de início *" / "Data de vencimento *" em
  `/cadastros/pacientes/[id]` → aba Contratos → Novo contrato; e "Data da alta *"
  na aba Altas → Nova Alta.
- **Intervalo:** `DateRangePicker` — `@/components/ui/date-range-picker`, mesma
  aparência do `DatePicker`.
- Para encaixar numa barra de filtros, use a prop `classeGatilho` (troca só a
  moldura do botão; o calendário é o mesmo).
- **Proibido:** `<input type="date">` (e `datetime-local`, `month`, `week`),
  `@/components/ui/calendar` (esqueleto vazio) e `react-day-picker` direto.

### Lista suspensa com várias seleções

- `MultiSearchCombobox` — `@/components/cronograma/ui/MultiSearchCombobox`:
  campo "Digite para buscar...", caixa de seleção por item, continua aberta
  entre marcações, fecha com clique fora ou Esc. Referência viva: "Exclusividade
  de salas com terapias" em `/relacionamento-prestador/ocupacao-salas`.
- **Dentro de um `Dialog` (`@/components/ui/dialog`):** passe `portal={false}`
  e não use `overflow-hidden` no `DialogContent`; no `DialogContent`, impeça que
  o Esc da busca feche o formulário (`onEscapeKeyDown` checando
  `[data-multisearch-aberto]`). Sem isso a lista abre mas não aceita clique nem
  digitação. Exemplo pronto: `components/admin/CreateUserModal.tsx`.
- **Proibido:** `<select multiple>` e lista de caixas de seleção feita à mão.

### Dívida

Campo de data nativo: zerado em 09/10/2026 (`LEGADO_DATA_NATIVA` vazia em
`frontend/eslint.config.mjs`); nenhum arquivo entra nela. Seleção de mês usa
`DatePicker` com `apenasMes`; limites com `min`/`max`. Seleção múltipla feita à mão que ainda existe: `UnidadeMultiSelect`
(Previsão de Receitas) e as listas de `ComparativoSessoesShell` e
`AnaliseFuturaTab`.

## Objetivo atual

Criar:
- página Controle Terapêutico
- modal de cobertura
- controle de presença/falta
- sincronização operacional