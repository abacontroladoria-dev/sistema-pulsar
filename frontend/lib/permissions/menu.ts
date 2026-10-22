import {
  Activity,
  ArrowRightLeft,
  BarChart3,
  Bot,
  CloudDownload,
  BriefcaseBusiness,
  DollarSign,
  FileChartColumn,
  LayoutGrid,
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
  FileOutput,
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
  ScanText,
  Settings,
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
  relacionamentoPrestador: { nome: 'Relacionamento Prestador', icon: Handshake },
  marketing: { nome: 'Marketing', icon: Megaphone },
  cadastros: { nome: 'Cadastros', icon: Database },
  configuracoes: { nome: 'Configurações', icon: Settings },
} satisfies Record<string, MenuGrupoDef>

// Grupos que o Sidebar não lista como grupo: viram um botão só, dentro de outro
// grupo, que abre um modal no centro da tela com as telas deles (decisão do
// usuário em 22/10/2026: os 8 cadastros ocupavam o menu inteiro). A tela de
// Permissões e o catálogo do banco continuam vendo o grupo de sempre.
export const MENU_GRUPOS_EM_MODAL: Record<string, string> = {
  [MENU_GRUPOS.cadastros.nome]: MENU_GRUPOS.configuracoes.nome,
}

// Áreas do seletor acima do menu. Cada tela fica numa área só, e o Sidebar mostra
// apenas as telas da área escolhida. É agrupamento visual: o `grupo` (que a tela
// de Permissões e o catálogo do banco usam) não muda, e a área não tem migration.
export type AreaId = 'operacional' | 'financeiro' | 'relatorios' | 'connect'

export type MenuAreaDef = { id: AreaId; nome: string; icon: LucideIcon }

export const MENU_AREAS: MenuAreaDef[] = [
  { id: 'operacional', nome: 'Operacional', icon: LayoutGrid },
  { id: 'financeiro', nome: 'Financeiro', icon: DollarSign },
  { id: 'relatorios', nome: 'Relatórios', icon: FileChartColumn },
  { id: 'connect', nome: 'Pulsar Connect', icon: Zap },
]

export const MENU_AREA_POR_ID: Record<AreaId, MenuAreaDef> = Object.fromEntries(
  MENU_AREAS.map((a) => [a.id, a])
) as Record<AreaId, MenuAreaDef>

// Só as telas que NÃO são Operacional (decisão do usuário em 22/10/2026).
// Relatórios = telas de visualização e exportação, que não geram trabalho
// operacional. Na 2ª rodada do mesmo dia entraram também Status Contratos,
// Outros Convênios, Status Laudos e Senhas, Análise de Evolução, os dois PDI e
// "Diferença: Laudo e Oferta"; "Oportunidades recusadas" segue em Operacional
// (é fila de trabalho). `null`: aparece em todas as áreas.
const AREA_DO_ITEM: Record<string, AreaId | null> = {
  dashboard: null,
  insumos: 'financeiro',
  acompanhamento_laudos: 'relatorios',
  status_contratos: 'relatorios',
  outros_convenios: 'relatorios',
  analise_tratativas: 'relatorios',
  terapeutico_pdi: 'relatorios',
  terapeutico_pdi_painel: 'relatorios',
  ocupacao_clinica_gaps: 'relatorios',
  ocupacao_profissionais: 'relatorios',
  indicadores_ocupacao_unidades: 'relatorios',
  indicadores_pacientes: 'relatorios',
  indicadores_previsao_receitas: 'relatorios',
  indicadores_comparativo_sessoes: 'relatorios',
  indicadores_entrada_convenio: 'relatorios',
  relacionamento_prestador_analise: 'relatorios',
  relacionamento_prestador_rp: 'relatorios',
  relacionamento_prestador_individual: 'relatorios',
  relacionamento_prestador_pep_historico: 'relatorios',
  exportar_evolucoes: 'relatorios',
  connect: 'connect',
}

// Outros nomes por que as pessoas procuram a tela na busca mestre.
const PALAVRAS_CHAVE: Record<string, string> = {
  atendimentos: 'solicitar guia autorização',
  gestao: 'recepção',
  acompanhamento_laudos: 'laudo senha',
  status_contratos: 'assinatura',
  escala_terapeutica: 'escala terapeutas',
  analise_tratativas: 'tratativas',
  terapeutico_pdi: 'prazo',
  conferencia_guias: 'guia',
  insumos: 'insumos compra estoque',
  cronograma_grade: 'cronograma agenda horário',
  cronograma_saida_profissional: 'desligamento',
  cronograma_ocupacao_paciente: 'implantação horário',
  reposicao_faltas: 'falta faltas',
  ocupacao_clinica: 'recusa',
  ocupacao_clinica_gaps: 'gaps',
  indicadores_previsao_receitas: 'faturamento receita',
  cadastros_pacientes: 'ficha',
  cadastros_profissionais: 'prestador terapeuta',
  cadastros_convenios: 'plano de saúde',
  cronograma_valores_convenio: 'preço valor',
  cadastros_taxas: 'imposto',
  cronograma_ocupacao_salas: 'sala',
  relacionamento_prestador_analise: 'remuneração',
  tv_avisos: 'avisos',
  permissoes: 'acesso',
  api_integracao: 'integração',
  carregar_tita: 'importar',
  exportar_evolucoes: 'pdf exportação',
}

export type MenuItemDef = {
  codigo: string
  label: string
  grupo: string
  /** O href do item no Sidebar (pode trazer ?tab=). */
  path: string
  icon: LucideIcon
  /** Área do seletor; `null` = aparece em todas (Dashboard). */
  area: AreaId | null
  /** Outros nomes da tela, para a busca mestre. */
  palavrasChave?: string
}

type MenuItemBase = Omit<MenuItemDef, 'area' | 'palavrasChave'>

const G = MENU_GRUPOS

// Na ordem em que o Sidebar lista. O Dashboard fica solto no topo do menu e o
// Pulsar Connect é uma área do seletor; os dois aparecem juntos em "Geral" na
// tela de Permissões.
//
// Decisões de agrupamento que vinham comentadas no Sidebar:
// - Status Laudos e Senhas em Pacientes (e não em Autorização ou Cadastros): quem
//   trabalha nela é a recepção, e as outras telas dela estão em Pacientes (28/08/2026).
// - Status Contratos: só leitura; criar e assinar é na aba Contratos da ficha.
// - Outros Convênios existia sem item no menu; entrou em 29/09/2026.
// - Conferência e Reconciliação ASSIM: duas abas da mesma rota, cada uma com código
//   próprio desde 29/09/2026. Quem pode VINCULAR continua decidido pelas RPCs.
// - Suprimentos é grupo próprio, não Faturamento: é compra de insumo, não
//   faturamento de convênio. Vai crescer com Estoque.
// - Marketing é grupo próprio, não um item de Administração: quem opera a TV não
//   administra o sistema. O rótulo diz o LUGAR ("TV da Recepção"), não o meio.
// - Indicadores: uma permissão por aba, não uma para a rota inteira.
// - "Preencher Receitas Faturadas" saiu do menu e da página em 22/10/2026 (ninguém
//   usava). O código indicadores_alimentar_bd fica no banco: a RLS de
//   previsao_receitas_faturamento ainda o usa e os lançamentos já feitos ficam.
// - "Inconsistências e Exceções" (/cronograma/ocupacao?tab=inconsistencias) saiu
//   em 22/10/2026 (ninguém usava). O código ocupacao_clinica_inconsistencias fica
//   no banco.
// - Ocupação de Salas em Terapêutico desde 22/10/2026 (antes em Relacionamento
//   Prestador). A rota continua /relacionamento-prestador/ocupacao-salas.
// - Cadastros: no Sidebar é um botão dentro de Configurações (ver MENU_GRUPOS_EM_MODAL).
const MENU_ITENS_BASE: MenuItemBase[] = [
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
  { codigo: 'cronograma_ocupacao_salas', label: 'Ocupação de Salas', grupo: G.terapeutico.nome, path: '/relacionamento-prestador/ocupacao-salas', icon: DoorOpen },

  { codigo: 'auditoria_assim', label: 'Conferência ASSIM', grupo: G.autorizacao.nome, path: '/auditoria-assim?tab=auditoria', icon: ClipboardList },
  { codigo: 'reconciliacao_assim', label: 'Reconciliação ASSIM', grupo: G.autorizacao.nome, path: '/auditoria-assim?tab=reconciliacao', icon: Link2 },
  { codigo: 'conferencia_guias', label: 'Conferência de Guias', grupo: G.autorizacao.nome, path: '/conferencia-guias', icon: ClipboardPenLine },
  { codigo: 'exportar_evolucoes', label: 'Exportar Evoluções', grupo: G.autorizacao.nome, path: '/exportar-evolucoes', icon: FileOutput },

  { codigo: 'insumos', label: 'Solicitações', grupo: G.suprimentos.nome, path: '/insumos', icon: Package },

  { codigo: 'cronograma_grade', label: 'Grade', grupo: G.cronograma.nome, path: '/cronograma/grade', icon: CalendarDays },
  { codigo: 'cronograma_saida_profissional', label: 'Saída Profissional', grupo: G.cronograma.nome, path: '/cronograma/saida-profissional', icon: LogOut },
  { codigo: 'cronograma_ocupacao_paciente', label: 'Ocupação Paciente', grupo: G.cronograma.nome, path: '/cronograma/ocupacao-paciente', icon: UserCheck },
  { codigo: 'reposicao_faltas', label: 'Reposição de Faltas', grupo: G.cronograma.nome, path: '/cronograma/reposicao', icon: RotateCcw },
  { codigo: 'ocupacao_clinica', label: 'Oportunidades recusadas', grupo: G.cronograma.nome, path: '/cronograma/ocupacao?tab=oportunidades-recusadas', icon: XCircle },
  { codigo: 'ocupacao_clinica_gaps', label: 'Diferença: Laudo e Oferta', grupo: G.cronograma.nome, path: '/cronograma/ocupacao?tab=gaps', icon: BarChart3 },

  { codigo: 'ocupacao_profissionais', label: 'Ocupação de Profissionais', grupo: G.indicadores.nome, path: '/cronograma/indicadores?tab=profissionais', icon: BarChart3 },
  { codigo: 'indicadores_ocupacao_unidades', label: 'Ocupação Clínica', grupo: G.indicadores.nome, path: '/cronograma/indicadores?tab=unidades', icon: Building2 },
  { codigo: 'indicadores_pacientes', label: 'Dashboard de Pacientes', grupo: G.indicadores.nome, path: '/cronograma/indicadores?tab=pacientes', icon: UserCheck },
  { codigo: 'indicadores_previsao_receitas', label: 'Previsão de Receitas', grupo: G.indicadores.nome, path: '/cronograma/indicadores?tab=previsao-receitas', icon: Wallet },
  { codigo: 'indicadores_comparativo_sessoes', label: 'Comparativo de Sessões', grupo: G.indicadores.nome, path: '/cronograma/indicadores?tab=comparativo-sessoes', icon: ArrowRightLeft },
  { codigo: 'indicadores_entrada_convenio', label: 'Entrada de Pacientes (Convênio)', grupo: G.indicadores.nome, path: '/cronograma/indicadores?tab=entrada-convenio', icon: UserPlus },

  { codigo: 'cronograma_solicitacoes', label: 'Simulação de Novo Prestador', grupo: G.relacionamentoPrestador.nome, path: '/relacionamento-prestador/solicitacoes?tab=simulacao', icon: UserPlus },
  { codigo: 'cronograma_disponibilidade_interna', label: 'Ocupar Profissionais Disponíveis', grupo: G.relacionamentoPrestador.nome, path: '/relacionamento-prestador/ocupar-profissionais-disponiveis', icon: UserSearch },
  { codigo: 'relacionamento_prestador_analise', label: 'Rem. Mês - Previsão', grupo: G.relacionamentoPrestador.nome, path: '/relacionamento-prestador/analise', icon: TrendingUp },
  { codigo: 'relacionamento_prestador_rp', label: 'Remuneração Total', grupo: G.relacionamentoPrestador.nome, path: '/relacionamento-prestador/rp', icon: Wallet },
  { codigo: 'relacionamento_prestador_individual', label: 'Remuneração Individual', grupo: G.relacionamentoPrestador.nome, path: '/relacionamento-prestador/individual', icon: UserRound },
  { codigo: 'relacionamento_prestador_pep', label: 'Entregas PEP', grupo: G.relacionamentoPrestador.nome, path: '/relacionamento-prestador/pep', icon: ListChecks },
  { codigo: 'relacionamento_prestador_pep_historico', label: 'PEP - Histórico', grupo: G.relacionamentoPrestador.nome, path: '/relacionamento-prestador/pep-historico', icon: History },
  { codigo: 'relacionamento_prestador_auditoria_documentos', label: 'Auditoria de Documentos PEP', grupo: G.relacionamentoPrestador.nome, path: '/relacionamento-prestador/auditoria-documentos', icon: ScanText },

  { codigo: 'tv_avisos', label: 'TV da Recepção', grupo: G.marketing.nome, path: '/tv-avisos', icon: Monitor },

  { codigo: 'cadastros_pacientes', label: 'Pacientes', grupo: G.cadastros.nome, path: '/cadastros/pacientes', icon: UserRound },
  { codigo: 'cadastros_profissionais', label: 'Profissionais', grupo: G.cadastros.nome, path: '/cadastros/profissionais', icon: Stethoscope },
  { codigo: 'cadastros_terapias', label: 'Terapias', grupo: G.cadastros.nome, path: '/cadastros/terapias', icon: Palette },
  { codigo: 'cadastros_convenios', label: 'Convênios', grupo: G.cadastros.nome, path: '/cadastros/convenios', icon: Building2 },
  { codigo: 'cronograma_valores_convenio', label: 'Cadastro de Valores', grupo: G.cadastros.nome, path: '/cadastros/cadastro-valores', icon: Tag },
  { codigo: 'cadastros_feriados', label: 'Feriados', grupo: G.cadastros.nome, path: '/cadastros/feriados', icon: Calendar },
  { codigo: 'cadastros_taxas', label: 'Variáveis & Taxas', grupo: G.cadastros.nome, path: '/cadastros/taxas-e-parametros', icon: Percent },
  { codigo: 'cadastros_contratos', label: 'Contratos', grupo: G.cadastros.nome, path: '/cadastros/contratos', icon: FileSignature },

  { codigo: 'usuarios', label: 'Usuários', grupo: G.configuracoes.nome, path: '/admin', icon: Users },
  { codigo: 'permissoes', label: 'Permissões', grupo: G.configuracoes.nome, path: '/admin/permissoes', icon: KeyRound },
  { codigo: 'api_integracao', label: 'API', grupo: G.configuracoes.nome, path: '/admin/api', icon: Plug },
  { codigo: 'robo_sharepoint', label: 'Robô SharePoint', grupo: G.configuracoes.nome, path: '/admin/robo-sharepoint', icon: Bot },
  { codigo: 'carregar_tita', label: 'Carregar do TiTa', grupo: G.configuracoes.nome, path: '/admin/carregar-tita', icon: CloudDownload },

  { codigo: 'connect', label: 'Pulsar Connect', grupo: G.geral.nome, path: '/connect', icon: Zap },
]

export const MENU_ITENS: MenuItemDef[] = MENU_ITENS_BASE.map((item) => ({
  ...item,
  area: item.codigo in AREA_DO_ITEM ? AREA_DO_ITEM[item.codigo] : 'operacional',
  palavrasChave: PALAVRAS_CHAVE[item.codigo],
}))

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
