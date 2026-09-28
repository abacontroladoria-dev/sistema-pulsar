import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// ─── Componentes padrão de UI (decisão do usuário, 30/09/2026) ──────────────
// Toda tela nova usa estes, e não uma implementação própria:
//   * data única ........ DatePicker       (@/components/ui/date-picker)
//   * intervalo de datas  DateRangePicker  (@/components/ui/date-range-picker)
//   * lista suspensa com várias seleções e busca por digitação
//                         MultiSearchCombobox (@/components/cronograma/ui/MultiSearchCombobox)
// Referências vivas: "Data da alta" em /cadastros/pacientes/[id] e "Exclusividade
// de salas com terapias" em /relacionamento-prestador/ocupacao-salas.
// Detalhes e armadilhas (ex.: MultiSearchCombobox dentro de Dialog) em AGENTS.md.
const MSG_DATA =
  "Campo de data nativo fora do padrão do sistema. Use DatePicker (data única) ou DateRangePicker (intervalo) de @/components/ui/date-picker e @/components/ui/date-range-picker — ver AGENTS.md, 'Componentes padrão'.";
const MSG_MULTI =
  "<select multiple> fora do padrão do sistema. Use MultiSearchCombobox de @/components/cronograma/ui/MultiSearchCombobox — ver AGENTS.md, 'Componentes padrão'.";
const MSG_CALENDARIO =
  "Calendário fora do padrão do sistema. Use DatePicker / DateRangePicker de @/components/ui/date-picker e @/components/ui/date-range-picker — ver AGENTS.md, 'Componentes padrão'.";

const TIPOS_DATA_NATIVOS = "/^(date|datetime-local|month|week)$/";

// Arquivos que JÁ tinham campo de data nativo quando a regra nasceu. Ficam fora
// dela para não quebrar o que existe — é dívida, não permissão: ao mexer num
// deles, prefira trocar pelo DatePicker e tirar o arquivo desta lista. Arquivo
// novo NUNCA entra aqui.
const LEGADO_DATA_NATIVA = [
  "app/(dashboard)/autorizacoes-avulsas/page.tsx",
  "app/(dashboard)/solicitar/page.tsx",
  "app/disponibilidade-terapeuta/page.tsx",
  "app/ficha-escolar/page.tsx",
  "components/acompanhamento/laudos/FiltrosLaudos.tsx",
  "components/acompanhamento/laudos/RegistrarAvisoModal.tsx",
  "components/auditoria-assim/FiltrosAuditoria.tsx",
  "components/auditoria-assim/ModalReclassificarSituacao.tsx",
  "components/auditoria-assim/ModalVisaoGerencial.tsx",
  "components/auditoria-assim/reconciliacao/ListaPendencias.tsx",
  "components/cadastros/FeriadosCadastro.tsx",
  "components/cadastros/pacientes/NovoPacienteModal.tsx",
  "components/cadastros/pacientes/ResponsavelFormModal.tsx",
  "components/cadastros/pacientes/secoes/DadosPessoais.tsx",
  "components/central-terapeutas/ControleFiltersBar.tsx",
  "components/central-terapeutas/RelatorioModal.tsx",
  "components/connect/agenda/ReservarVagaModal.tsx",
  "components/cronograma/remuneracao/RemuneracaoUploadBadges.tsx",
  "components/nina/detalhamento/ModalAgendarRetorno.tsx",
  "components/nina/detalhamento/ModalDesignarTarefa.tsx",
  "components/terapeutico/auditoria/AuditoriaEvolucoesShell.tsx",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  // Padrão de lista suspensa e de calendário — vale para todo arquivo.
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXOpeningElement[name.name='select'] > JSXAttribute[name.name='multiple']",
          message: MSG_MULTI,
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@/components/ui/calendar", message: MSG_CALENDARIO },
            { name: "react-day-picker", message: MSG_CALENDARIO },
          ],
        },
      ],
    },
  },

  // Campo de data nativo — vale para todo arquivo, menos o legado acima.
  // (Bloco separado porque um segundo "no-restricted-syntax" no mesmo arquivo
  // SUBSTITUI o primeiro; aqui as duas proibições são repetidas.)
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    ignores: LEGADO_DATA_NATIVA,
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXOpeningElement[name.name='select'] > JSXAttribute[name.name='multiple']",
          message: MSG_MULTI,
        },
        {
          selector: `JSXOpeningElement[name.name='input'] > JSXAttribute[name.name='type'][value.value=${TIPOS_DATA_NATIVOS}]`,
          message: MSG_DATA,
        },
        {
          selector: `JSXOpeningElement[name.name='input'] > JSXAttribute[name.name='type'] > JSXExpressionContainer > Literal[value=${TIPOS_DATA_NATIVOS}]`,
          message: MSG_DATA,
        },
      ],
    },
  },
]);

export default eslintConfig;
