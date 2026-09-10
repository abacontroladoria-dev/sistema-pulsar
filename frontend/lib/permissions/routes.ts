// Fonte única de verdade para permissões → rotas.
// IMPORTANTE: este módulo é puro (sem import do supabase) para poder ser
// importado tanto no client (Sidebar) quanto no proxy server-side.

// Permissões padrão por setor (role). O role `cronograma` é um setor novo
// que ainda não tem módulos próprios — por ora recebe apenas o dashboard.
// `disponibilidade_terapeuta` não entra aqui: tem fluxo dedicado e rota pública.
export const roleDefaults: Record<string, string[]> = {
  admin: [
    'dashboard', 'atendimentos', 'autorizacoes_avulsas', 'gestao',
    'acompanhamento_laudos',
    'escala_terapeutica',
    'auditoria_assim', 'usuarios', 'permissoes', 'cco',
    'tv_avisos',
    'preauditoria', 'outros_convenios',
    'cronograma_solicitacoes', 'cronograma_saida_profissional', 'cronograma_ocupacao_paciente',
    'cronograma_disponibilidade_interna',
    'ocupacao_clinica', 'ocupacao_clinica_gaps', 'ocupacao_clinica_inconsistencias',
    'ocupacao_profissionais', 'indicadores_ocupacao_unidades',
    'indicadores_pacientes', 'indicadores_previsao_receitas', 'indicadores_historico_receitas',
    'indicadores_comparativo_sessoes',
    'reposicao_faltas', 'cronograma_ocupacao_salas',
    'cronograma_valores_convenio', 'cadastros_feriados', 'cadastros_contratos', 'cadastros_taxas',
    'cadastros_convenios',
    'analise_tratativas',
    'relacionamento_prestador_analise', 'relacionamento_prestador_rp',
    'relacionamento_prestador_individual',
    'connect',
    'cadastros_pacientes', 'cadastros_profissionais',
    'cronograma_por_paciente', 'cronograma_por_profissional',
    'insumos',
    'terapeutico_pdi', 'terapeutico_pdi_painel',
  ],
  diretoria: [
    'dashboard', 'atendimentos', 'gestao',
    'acompanhamento_laudos',
    'escala_terapeutica', 'auditoria_assim',
    'preauditoria', 'outros_convenios',
    'cronograma_solicitacoes', 'cronograma_saida_profissional', 'cronograma_ocupacao_paciente',
    'cronograma_disponibilidade_interna',
    'ocupacao_clinica', 'ocupacao_clinica_gaps', 'ocupacao_clinica_inconsistencias',
    'ocupacao_profissionais', 'indicadores_ocupacao_unidades',
    'indicadores_pacientes', 'indicadores_previsao_receitas', 'indicadores_historico_receitas',
    'indicadores_comparativo_sessoes',
    'reposicao_faltas', 'cronograma_ocupacao_salas',
    'cronograma_valores_convenio', 'cadastros_feriados', 'cadastros_contratos', 'cadastros_taxas',
    'cadastros_convenios',
    'analise_tratativas',
    'relacionamento_prestador_analise', 'relacionamento_prestador_rp',
    'relacionamento_prestador_individual',
    'cadastros_pacientes', 'cadastros_profissionais',
    'cronograma_por_paciente', 'cronograma_por_profissional',
    'insumos',
    'terapeutico_pdi', 'terapeutico_pdi_painel',
  ],
  recepcao: [
    'dashboard', 'atendimentos', 'autorizacoes_avulsas', 'gestao', 'auditoria_assim',
    'outros_convenios',
    // A recepção é quem cobra a renovação do laudo vencido — é a dona da tela,
    // não uma convidada. Os mesmos três papéis estão no ramo por papel da RLS
    // (20260828150000), senão quem tem a tela pelo papel não conseguiria gravar.
    'acompanhamento_laudos',
  ],
  autorizacao: [
    'dashboard', 'auditoria_assim',
    'preauditoria',
  ],
  terapeutico: ['dashboard', 'escala_terapeutica', 'analise_tratativas'],
  // O setor que opera o controle de insumos, junto com admin e diretoria
  // (definido pelo usuario em 2026-08-18). Ate entao tinha so o dashboard.
  faturamento: ['dashboard', 'insumos'],
  rp: [
    'dashboard', 'escala_terapeutica',
    'cadastros_feriados', 'cadastros_contratos', 'cadastros_taxas',
    'relacionamento_prestador_analise', 'relacionamento_prestador_rp',
    'relacionamento_prestador_individual',
  ],
  // O setor que publica os cartazes da TV da recepção, e NADA mais. É o primeiro
  // papel cujo trabalho não toca em dado de paciente — reaproveitar `recepcao`
  // para "resolver o acesso" daria a fila de autorizações inteira a quem só troca
  // uma imagem de parede. `dashboard` entra porque toda a base o tem e '/' é
  // forçada em codigosToRotas de qualquer forma: sem ele o login cairia numa home
  // vazia. Os mesmos papéis estão no ramo por papel da RLS de tv_avisos e das
  // policies do bucket (20260910120100), senão a tela abriria e o upload falharia
  // em silêncio.
  marketing: ['dashboard', 'tv_avisos'],
  // Ocupação de Salas, Cadastro de Valores de Convênio e Reposição de Faltas
  // foram retiradas deste papel em 2026-07-24 a pedido do usuário — ficam
  // restritas a admin/diretoria (a RLS das tabelas por trás também foi
  // restringida junto, ver 20260724200000_restringir_cronograma_role_admin_diretoria.sql).
  cronograma: [
    'dashboard', 'cronograma_solicitacoes',
    'cronograma_saida_profissional', 'cronograma_ocupacao_paciente',
    'cronograma_disponibilidade_interna',
    'ocupacao_clinica', 'ocupacao_clinica_gaps', 'ocupacao_clinica_inconsistencias',
    'cadastros_pacientes', 'cadastros_profissionais',
    'cronograma_por_paciente', 'cronograma_por_profissional',
  ],
}

export function getRoleDefaultPermissions(role: string): string[] {
  return roleDefaults[role] ?? []
}

// Mapeamento código de permissão → rota(s) da aplicação.
export const CODIGO_PARA_ROTAS: Record<string, string[]> = {
  dashboard: ['/'],
  atendimentos: ['/solicitar'],
  // Código próprio, e não uma segunda rota dentro de `atendimentos`: a avulsa é a
  // única tela que INSERE em fila_autorizacoes sem sessão por trás, e quem pode
  // fazer isso é decisão de setor. Concedido a admin e recepcao — exatamente os
  // papéis que têm INSERT na RLS da tabela (20260817120000).
  autorizacoes_avulsas: ['/autorizacoes-avulsas'],
  gestao: ['/central-pacientes'],
  // Código PRÓPRIO, e não uma segunda rota dentro de `cadastros_pacientes`: quem
  // opera a fila de laudos vencidos é a RECEPÇÃO, e a recepção não tem
  // `cadastros_pacientes`. Reaproveitar aquele código daria a tela a quem mantém
  // o cadastro e a negaria a quem faz a cobrança. A RLS de
  // public.laudos_acompanhamento exige este mesmo código (20260828150000).
  acompanhamento_laudos: ['/acompanhamento/laudos'],
  escala_terapeutica: ['/central-terapeutas'],
  auditoria_assim: ['/auditoria-assim'],
  usuarios: ['/admin'],
  permissoes: ['/admin/permissoes'],
  // Carrossel de avisos da TV da recepção. Código PRÓPRIO porque quem opera é o
  // MARKETING — um setor sem nenhuma outra permissão aqui, e que não pode ganhar
  // acesso a dado de paciente só para trocar um cartaz de parede. A RLS de
  // public.tv_avisos e as policies do bucket exigem este mesmo código
  // (20260831150000). A rota /tv da TV em si continua PÚBLICA em proxy.ts: isto
  // é a tela de gestão, não a de exibição.
  tv_avisos: ['/tv-avisos'],
  cco: ['/cco'],
  // `autorizacoes` (a rota /autorizacoes) saiu em 2026-08-26: a tela foi
  // descontinuada e quem chama o responsável agora é a /solicitar. O código
  // pode continuar existindo em permissões já gravadas de usuários — sem
  // entrada aqui, `codigosToRotas` simplesmente o ignora (`?? []`).
  preauditoria: ['/preauditoria'],
  outros_convenios: ['/outros-convenios'],
  cronograma_solicitacoes: ['/relacionamento-prestador/solicitacoes'],
  cronograma_saida_profissional: ['/cronograma/saida-profissional'],
  cronograma_ocupacao_paciente: ['/cronograma/ocupacao-paciente'],
  cronograma_disponibilidade_interna: ['/relacionamento-prestador/ocupar-profissionais-disponiveis'],
  // Mesmo padrão de Indicadores: /cronograma/ocupacao tem 3 abas
  // (Oportunidades Recusadas, Diferença: Laudo e Oferta, Inconsistências e
  // Exceções), cada uma com seu próprio código de permissão.
  ocupacao_clinica: ['/cronograma/ocupacao?tab=oportunidades-recusadas'],
  ocupacao_clinica_gaps: ['/cronograma/ocupacao?tab=gaps'],
  ocupacao_clinica_inconsistencias: ['/cronograma/ocupacao?tab=inconsistencias'],
  // Indicadores: uma rota só (/cronograma/indicadores), abas diferenciadas por
  // ?tab=. Cada aba tem seu próprio código de permissão — ver routeMatches()
  // abaixo, que sabe comparar rota+querystring (não só pathname) pra isso
  // funcionar tanto no Sidebar quanto no proxy.ts (gate real, server-side).
  ocupacao_profissionais: ['/cronograma/indicadores?tab=profissionais'],
  indicadores_ocupacao_unidades: ['/cronograma/indicadores?tab=unidades'],
  indicadores_pacientes: ['/cronograma/indicadores?tab=pacientes'],
  indicadores_previsao_receitas: ['/cronograma/indicadores?tab=previsao-receitas'],
  indicadores_historico_receitas: ['/cronograma/indicadores?tab=historico-receitas'],
  indicadores_comparativo_sessoes: ['/cronograma/indicadores?tab=comparativo-sessoes'],
  reposicao_faltas: ['/cronograma/reposicao'],
  cronograma_ocupacao_salas: ['/relacionamento-prestador/ocupacao-salas'],
  cronograma_valores_convenio: ['/cadastros/cadastro-valores'],
  cadastros_feriados: ['/cadastros/feriados'],
  cadastros_contratos: ['/cadastros/contratos'],
  cadastros_taxas: ['/cadastros/taxas-e-parametros'],
  // Cadastro nativo de Convênios + Planos de Saúde, fonte do select "Plano de
  // saúde" na Ficha Médica do Cadastro de Pacientes — ver
  // supabase/migrations/20260826110000_create_convenios_planos_saude.sql.
  cadastros_convenios: ['/cadastros/convenios'],
  analise_tratativas: ['/analise-tratativas'],
  relacionamento_prestador_analise: ['/relacionamento-prestador/analise'],
  relacionamento_prestador_rp: ['/relacionamento-prestador/rp'],
  relacionamento_prestador_individual: ['/relacionamento-prestador/individual'],
  relacionamento_prestador_pep: ['/relacionamento-prestador/pep'],
  relacionamento_prestador_pep_historico: ['/relacionamento-prestador/pep-historico'],
  // O Pulsar Connect não tinha código de permissão: o proxy derivava as rotas
  // permitidas deste mapa, '/connect' nunca aparecia, e todo não-admin que
  // clicasse no item do menu caía em /sem-permissao. O item era visível para
  // todos e levava a lugar nenhum. Com o código, sidebar e proxy voltam a
  // decidir pela mesma fonte — e conceder Connect a alguém que não é admin
  // passa a ser um clique em /admin/permissoes, não uma mudança de código.
  connect: ['/connect'],
  // Sistema próprio de agendamentos/grade (nativo, substituindo gradualmente
  // o TiTa Therapy) — ver supabase/migrations/20260812140000_create_reboot_pacientes.sql.
  // Responsável não tem rota própria: é controlado dentro do cadastro do
  // paciente ("Filiação e responsáveis"), e a RLS de public.responsaveis já é
  // gated por esta mesma permissão (20260826100200).
  cadastros_pacientes: ['/cadastros/pacientes'],
  cadastros_profissionais: ['/cadastros/profissionais'],
  cronograma_por_paciente: ['/cronograma/por-paciente'],
  cronograma_por_profissional: ['/cronograma/por-profissional'],
  // Controle de insumos (porte do AXIUM). Um código só, não os 8 granulares do
  // AXIUM (compras.ver/aprovar/comprar/…): o acesso definido pelo usuário é por
  // setor — faturamento, admin e diretoria. Granularizar depois, se aparecer o
  // caso de quem cota mas não aprova.
  insumos: ['/insumos'],
  // Controle de Prazos do PDI (tela /terapeutico/prazos-pdi) — Amanda/Gracielle
  // recebem por concessão individual em /admin (fora deste código), não pelo
  // roleDefaults de um setor genérico; admin/diretoria têm o código aqui.
  terapeutico_pdi: ['/terapeutico/prazos-pdi'],
  // "PDI - Painel por Analista" (/terapeutico/pdi-painel-analista) — CÓDIGO
  // PRÓPRIO, separado do Controle de Prazos acima (pedido do usuário,
  // 05/09/2026: dá pra conceder as duas telas independentemente uma da
  // outra, em vez de uma única linha em /admin/permissoes cobrindo as duas).
  // A RLS de escrita em `pdi_controle_prazos` continua exigindo só
  // `terapeutico_pdi` (20260904120000/120100) — o Painel é somente leitura
  // por natureza; quem só tem este código consegue ABRIR o modal de edição
  // pelo drill-down (PainelAnalistaShell.tsx), mas o SALVAR falha por RLS se
  // a pessoa não tiver `terapeutico_pdi` também.
  terapeutico_pdi_painel: ['/terapeutico/pdi-painel-analista'],
}

// Converte um conjunto de códigos de permissão em rotas permitidas,
// garantindo que '/' esteja sempre presente.
export function codigosToRotas(codigos: Iterable<string>): string[] {
  const rotas = [...codigos].flatMap((c) => CODIGO_PARA_ROTAS[c] ?? [])
  if (!rotas.includes('/')) rotas.unshift('/')
  return rotas
}

// Compara um pathname+querystring contra uma rota de CODIGO_PARA_ROTAS, que
// pode vir só com pathname ("/x/y") ou com querystring embutida
// ("/x/y?tab=z") — nesse segundo caso, todo par chave=valor da rota precisa
// bater com o search recebido, não só o pathname. Rotas sem "?" continuam
// se comportando exatamente como antes (só pathname importa).
export function routeMatches(pathname: string, search: string, route: string): boolean {
  const [routePath, routeQuery] = route.split('?')
  const pathOk = pathname === routePath || pathname.startsWith(routePath + '/')
  if (!pathOk) return false
  if (!routeQuery) return true

  const params = new URLSearchParams(search)
  const routeParams = new URLSearchParams(routeQuery)
  for (const [key, value] of routeParams) {
    if (params.get(key) !== value) return false
  }
  return true
}

// Mesma checagem, mas contra uma lista de rotas permitidas (basta uma bater).
export function hasRouteAccess(pathname: string, search: string, allowedRoutes: string[]): boolean {
  return allowedRoutes.some((route) => routeMatches(pathname, search, route))
}
