import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  BarChart3,
  Bot,
  BriefcaseBusiness,
  Building2,
  Calendar,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  ClipboardPenLine,
  ClipboardPlus,
  Database,
  DoorOpen,
  FileClock,
  FileSearch,
  FileSignature,
  Gauge,
  Handshake,
  History,
  KeyRound,
  Landmark,
  LayoutDashboard,
  Link2,
  ListChecks,
  LogOut,
  Megaphone,
  Monitor,
  Package,
  Palette,
  Percent,
  Plug,
  PlusCircle,
  RotateCcw,
  ScrollText,
  ShieldCheck,
  Stethoscope,
  Tag,
  TrendingUp,
  UserCheck,
  UserPlus,
  UserRound,
  Users,
  UserSearch,
  Wallet,
  XCircle,
  Zap,
  type LucideIcon,
} from 'lucide-react'

// Fonte única do menu: rótulo, ícone, grupo e ordem de cada tela, exatamente
// como o Sidebar mostra. O Sidebar e /admin/permissoes leem daqui — é o que
// impede os dois de voltarem a divergir (em 28/09/2026 eram 15 nomes e 4 grupos
// diferentes, e a Reconciliação ASSIM não tinha código próprio).
//
// Regra: um item do menu = um código de permissão. O catálogo do banco
// (public.permissoes: nome, grupo, ordem) é espelho desta lista — a migration
// 20260929120000_catalogo_permissoes_espelha_sidebar.sql grava os mesmos valores,
// e menu.test.ts confere que nenhum código ficou de fora de CODIGO_PARA_ROTAS.
//
// Fica fora de routes.ts de propósito: aquele módulo é importado pelo proxy e
// não deve arrastar os ícones.

export type MenuGrupoDef = { nome: string; icon: LucideIcon }

export const MENU_GRUPOS = {
  geral: { nome: 'Geral', icon: LayoutDashboard },
  pacientes: { nome: 'Pacientes', icon: Users },
  terapeutico: { nome: 'Terapêutico', icon: Stethoscope },
  autorizacao: { nome: 'Autorização', icon: BriefcaseBusiness },
  suprimentos: { nome: 'Suprimentos', icon: Package },
  cronograma: { nome: 'Cronograma', icon: CalendarRange },
  indicadores: { nome: 'Indicadores', icon: TrendingUp },
  cadastros: { nome: 'Cadastros', icon: Database },
  relacionamentoPrestador: { nome: 'Relacionamento Prestador', icon: Handshake },
  marketing: { nome: 'Marketing', icon: Megaphone },
  administracao: { nome: 'Administração', icon: ShieldCheck },
} satisfies Record<string, MenuGrupoDef>

export type MenuItemDef = {
  codigo: string
  label: string
  grupo: string
  /** O href do item no Sidebar (pode trazer ?tab=). */
  path: string
  icon: LucideIcon
}

const G = MENU_GRUPOS

// Na ordem em que o Sidebar lista. Dashboard e Pulsar Connect ficam soltos no
// menu (topo e rodapé) e aparecem juntos em "Geral" na tela de Permissões.
export const MENU_ITENS: MenuItemDef[] = [
  { codigo: 'dashboard', label: 'Dashboard', grupo: G.geral.nome, path: '/', icon: LayoutDashboard },

  { codigo: 'atendimentos', label: 'Atendimentos', grupo: G.pacientes.nome, path: '/solicitar', icon: PlusCircle },
  { codigo: 'gestao', label: 'Gestão Recepção', grupo: G.pacientes.nome, path: '/central-pacientes', icon: Activity },
  { codigo: 'autorizacoes_avulsas', label: 'Autorizações Avulsas', grupo: G.pacientes.nome, path: '/autorizacoes-avulsas', icon: ClipboardPlus },
  { codigo: 'acompanhamento_laudos', label: 'Status Laudos e Senhas', grupo: G.pacientes.nome, path: '/acompanhamento/laudos', icon: FileClock },
  { codigo: 'status_contratos', label: 'Status Contratos', grupo: G.pacientes.nome, path: '/acompanhamento/contratos', icon: ScrollText },
  { codigo: 'outros_convenios', label: 'Outros Convênios', grupo: G.pacientes.nome, path: '/outros-convenios', icon: Landmark },

  { codigo: 'escala_terapeutica', label: 'Gestão', grupo: G.terapeutico.nome, path: '/central-terapeutas', icon: UserRound },
  { codigo: 'analise_tratativas', label: 'Análise de Evolução', grupo: G.terapeutico.nome, path: '/analise-tratativas', icon: ClipboardCheck },
  { codigo: 'terapeutico_auditoria_evolucoes', label: 'Auditoria de Evoluções', grupo: G.terapeutico.nome, path: '/terapeutico/auditoria-evolucoes', icon: FileSearch },
  { codigo: 'terapeutico_pdi', label: 'PDI - Controle', grupo: G.terapeutico.nome, path: '/terapeutico/prazos-pdi', icon: CalendarClock },
  { codigo: 'terapeutico_pdi_painel', label: 'PDI - Painel', grupo: G.terapeutico.nome, path: '/terapeutico/pdi-painel-analista', icon: Gauge },

  { codigo: 'auditoria_assim', label: 'Conferência ASSIM', grupo: G.autorizacao.nome, path: '/auditoria-assim?tab=auditoria', icon: ClipboardList },
  { codigo: 'reconciliacao_assim', label: 'Reconciliação ASSIM', grupo: G.autorizacao.nome, path: '/auditoria-assim?tab=reconciliacao', icon: Link2 },
  { codigo: 'conferencia_guias', label: 'Conferência de Guias', grupo: G.autorizacao.nome, path: '/conferencia-guias', icon: ClipboardPenLine },

  { codigo: 'insumos', label: 'Solicitações', grupo: G.suprimentos.nome, path: '/insumos', icon: Package },

  { codigo: 'cronograma_grade', label: 'Grade', grupo: G.cronograma.nome, path: '/cronograma/grade', icon: CalendarDays },
  { codigo: 'cronograma_saida_profissional', label: 'Saída Profissional', grupo: G.cronograma.nome, path: '/cronograma/saida-profissional', icon: LogOut },
  { codigo: 'cronograma_ocupacao_paciente', label: 'Ocupação Paciente', grupo: G.cronograma.nome, path: '/cronograma/ocupacao-paciente', icon: UserCheck },
  { codigo: 'reposicao_faltas', label: 'Reposição de Faltas', grupo: G.cronograma.nome, path: '/cronograma/reposicao', icon: RotateCcw },
  { codigo: 'ocupacao_clinica', label: 'Oportunidades recusadas', grupo: G.cronograma.nome, path: '/cronograma/ocupacao?tab=oportunidades-recusadas', icon: XCircle },
  { codigo: 'ocupacao_clinica_gaps', label: 'Diferença: Laudo e Oferta', grupo: G.cronograma.nome, path: '/cronograma/ocupacao?tab=gaps', icon: BarChart3 },
  { codigo: 'ocupacao_clinica_inconsistencias', label: 'Inconsistências e Exceções', grupo: G.cronograma.nome, path: '/cronograma/ocupacao?tab=inconsistencias', icon: AlertTriangle },

  { codigo: 'ocupacao_profissionais', label: 'Ocupação de Profissionais', grupo: G.indicadores.nome, path: '/cronograma/indicadores?tab=profissionais', icon: BarChart3 },
  { codigo: 'indicadores_ocupacao_unidades', label: 'Ocupação Clínica', grupo: G.indicadores.nome, path: '/cronograma/indicadores?tab=unidades', icon: Building2 },
  { codigo: 'indicadores_pacientes', label: 'Dashboard de Pacientes', grupo: G.indicadores.nome, path: '/cronograma/indicadores?tab=pacientes', icon: UserCheck },
  { codigo: 'indicadores_previsao_receitas', label: 'Previsão de Receitas', grupo: G.indicadores.nome, path: '/cronograma/indicadores?tab=previsao-receitas', icon: Wallet },
  { codigo: 'indicadores_alimentar_bd', label: 'Preencher Receitas Faturadas', grupo: G.indicadores.nome, path: '/cronograma/indicadores?tab=alimentar-bd', icon: Database },
  { codigo: 'indicadores_comparativo_sessoes', label: 'Comparativo de Sessões', grupo: G.indicadores.nome, path: '/cronograma/indicadores?tab=comparativo-sessoes', icon: ArrowRightLeft },

  { codigo: 'cadastros_pacientes', label: 'Pacientes', grupo: G.cadastros.nome, path: '/cadastros/pacientes', icon: UserRound },
  { codigo: 'cadastros_profissionais', label: 'Profissionais', grupo: G.cadastros.nome, path: '/cadastros/profissionais', icon: Stethoscope },
  { codigo: 'cadastros_terapias', label: 'Terapias', grupo: G.cadastros.nome, path: '/cadastros/terapias', icon: Palette },
  { codigo: 'cadastros_convenios', label: 'Convênios', grupo: G.cadastros.nome, path: '/cadastros/convenios', icon: Building2 },
  { codigo: 'cronograma_valores_convenio', label: 'Cadastro de Valores', grupo: G.cadastros.nome, path: '/cadastros/cadastro-valores', icon: Tag },
  { codigo: 'cadastros_feriados', label: 'Feriados', grupo: G.cadastros.nome, path: '/cadastros/feriados', icon: Calendar },
  { codigo: 'cadastros_taxas', label: 'Variáveis & Taxas', grupo: G.cadastros.nome, path: '/cadastros/taxas-e-parametros', icon: Percent },
  { codigo: 'cadastros_contratos', label: 'Contratos', grupo: G.cadastros.nome, path: '/cadastros/contratos', icon: FileSignature },

  { codigo: 'cronograma_ocupacao_salas', label: 'Ocupação de Salas', grupo: G.relacionamentoPrestador.nome, path: '/relacionamento-prestador/ocupacao-salas', icon: DoorOpen },
  { codigo: 'cronograma_solicitacoes', label: 'Simulação de Novo Prestador', grupo: G.relacionamentoPrestador.nome, path: '/relacionamento-prestador/solicitacoes?tab=simulacao', icon: UserPlus },
  { codigo: 'cronograma_disponibilidade_interna', label: 'Ocupar Profissionais Disponíveis', grupo: G.relacionamentoPrestador.nome, path: '/relacionamento-prestador/ocupar-profissionais-disponiveis', icon: UserSearch },
  { codigo: 'relacionamento_prestador_analise', label: 'Rem. Mês - Previsão', grupo: G.relacionamentoPrestador.nome, path: '/relacionamento-prestador/analise', icon: TrendingUp },
  { codigo: 'relacionamento_prestador_rp', label: 'Remuneração Total', grupo: G.relacionamentoPrestador.nome, path: '/relacionamento-prestador/rp', icon: Wallet },
  { codigo: 'relacionamento_prestador_individual', label: 'Remuneração Individual', grupo: G.relacionamentoPrestador.nome, path: '/relacionamento-prestador/individual', icon: UserRound },
  { codigo: 'relacionamento_prestador_pep', label: 'Entregas PEP', grupo: G.relacionamentoPrestador.nome, path: '/relacionamento-prestador/pep', icon: ListChecks },
  { codigo: 'relacionamento_prestador_pep_historico', label: 'PEP - Histórico', grupo: G.relacionamentoPrestador.nome, path: '/relacionamento-prestador/pep-historico', icon: History },

  { codigo: 'tv_avisos', label: 'TV da Recepção', grupo: G.marketing.nome, path: '/tv-avisos', icon: Monitor },

  { codigo: 'usuarios', label: 'Usuários', grupo: G.administracao.nome, path: '/admin', icon: Users },
  { codigo: 'permissoes', label: 'Permissões', grupo: G.administracao.nome, path: '/admin/permissoes', icon: KeyRound },
  { codigo: 'api_integracao', label: 'API', grupo: G.administracao.nome, path: '/admin/api', icon: Plug },
  { codigo: 'robo_sharepoint', label: 'Robô SharePoint', grupo: G.administracao.nome, path: '/admin/robo-sharepoint', icon: Bot },

  { codigo: 'connect', label: 'Pulsar Connect', grupo: G.geral.nome, path: '/connect', icon: Zap },
]

export const MENU_POR_CODIGO: Record<string, MenuItemDef> = Object.fromEntries(
  MENU_ITENS.map((item) => [item.codigo, item])
)

/** Nomes dos grupos na ordem do menu (Geral primeiro). */
export const MENU_ORDEM_GRUPOS: string[] = Object.values(MENU_GRUPOS).map((g) => g.nome)

export const MENU_ICONE_GRUPO: Record<string, LucideIcon> = Object.fromEntries(
  Object.values(MENU_GRUPOS).map((g) => [g.nome, g.icon])
)

/** Posição do item no menu — a coluna `ordem` do catálogo usa o mesmo número. */
export const MENU_ORDEM_ITEM: Record<string, number> = Object.fromEntries(
  MENU_ITENS.map((item, i) => [item.codigo, (i + 1) * 10])
)
