// Fonte única de verdade para permissões → rotas.
// IMPORTANTE: este módulo é puro (sem import do supabase) para poder ser
// importado tanto no client (Sidebar) quanto no proxy server-side.

// Sem "permissões padrão por setor" desde 29/09/2026: quem dá as telas são os
// grupos de permissão (ao vivo) mais os ajustes individuais — ver resolver.ts e a
// função do banco permissoes_efetivas() (20260929140000). O `roleDefaults` que
// morava aqui foi gravado explicitamente para cada pessoa antes de sair
// (snippet 20260929_materializar_permissoes_APLICAR.sql).

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
  // As duas abas de /auditoria-assim têm código próprio (29/09/2026: "cada item
  // do sidebar precisa de uma permissão própria"). A URL pura, sem ?tab=, não
  // bate com nenhuma das duas — rotaPadraoDeAbas() abaixo a manda para a
  // primeira aba liberada, no proxy, antes da checagem.
  // As RPCs da Reconciliação (vincular/reclassificar…) continuam decidindo quem
  // ESCREVE pelo papel; este código só decide quem ABRE a aba.
  auditoria_assim: ['/auditoria-assim?tab=auditoria'],
  reconciliacao_assim: ['/auditoria-assim?tab=reconciliacao'],
  // Código PRÓPRIO, e não uma rota dentro de `auditoria_assim`: quem confere a
  // folha de assinaturas é o faturamento, que não tem (nem precisa ter) a
  // Conferência ASSIM. A RLS de conferencia_guias_assinadas e a RPC
  // get_conferencia_guias_dia exigem este mesmo código (20260924200000).
  conferencia_guias: ['/conferencia-guias'],
  usuarios: ['/admin'],
  permissoes: ['/admin/permissoes'],
  // Documentação da API de integração de faltas (parceiros externos). Código
  // PRÓPRIO, e não uma segunda rota dentro de `usuarios`: quem consulta o
  // contrato da API para passar a um dev externo não é necessariamente quem
  // administra contas, e o inverso também vale. A tela é somente leitura — não
  // mostra token, não chama o endpoint, não escreve nada.
  api_integracao: ['/admin/api'],
  // Painel do robô SharePoint → PEP: execuções ao vivo, custo de cada uma e a
  // fila do que ele não reconheceu. Código próprio: é tela de admin/diretoria,
  // enquanto as SUGESTÕES que o robô gera aparecem na tela PEP para o RP
  // (RLS de sp_pep_itens aceita os dois códigos — 20261001120000).
  robo_sharepoint: ['/admin/robo-sharepoint'],
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
  // entrada aqui, `codigosToRotas` simplesmente o ignora (`?? []`). Saiu também
  // do catálogo em 29/09/2026, junto com `indicadores_historico_receitas` (aba
  // que não existe mais).
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
  indicadores_alimentar_bd: ['/cronograma/indicadores?tab=alimentar-bd'],
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
  // Catálogo de terapias/procedimentos com a cor (hex) usada no Cadastro de
  // Profissionais. Ver 20261006120000_cadastro_terapias.sql.
  cadastros_terapias: ['/cadastros/terapias'],
  // `cadastros_profissionais`, `cronograma_por_paciente` e
  // `cronograma_por_profissional` saíram em 29/09/2026: as rotas nunca ganharam
  // página e o catálogo passou a espelhar o Sidebar. Voltam junto com a tela.
  // Controle de insumos (porte do AXIUM). Um código só, não os 8 granulares do
  // AXIUM (compras.ver/aprovar/comprar/…): o acesso definido pelo usuário é por
  // setor — faturamento, admin e diretoria. Granularizar depois, se aparecer o
  // caso de quem cota mas não aprova.
  insumos: ['/insumos'],
  // Controle de Prazos do PDI (tela /terapeutico/prazos-pdi) — Amanda/Gracielle
  // recebem pelo grupo Especialista Téc. ABA; diretoria, pelo grupo Diretoria.
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
  terapeutico_auditoria_evolucoes: ['/terapeutico/auditoria-evolucoes'],
}

// Rotas cujas abas têm, TODAS, código próprio por ?tab= — a URL pura não bate
// com código nenhum. Em vez de mandar para /sem-permissao quem abre o endereço
// sem a aba (link antigo, favorito, digitado), o proxy redireciona para a
// primeira aba desta lista que a pessoa tem. A ordem é a do Sidebar.
export const ABAS_POR_ROTA: Record<string, string[]> = {
  '/auditoria-assim': ['auditoria', 'reconciliacao'],
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

const CAMINHOS_DO_CATALOGO = [
  ...new Set(Object.values(CODIGO_PARA_ROTAS).flat().map((r) => r.split('?')[0])),
]

// O caminho mais específico do catálogo que cobre `pathname`. Sem isso, o prefixo
// de '/admin' (código `usuarios`) abria também /admin/permissoes e /admin/api,
// que têm código próprio — desmarcar "Permissões" de alguém não valia nada se
// "Usuários" estivesse marcado.
function caminhoMaisEspecifico(pathname: string): string | undefined {
  let melhor: string | undefined
  for (const p of CAMINHOS_DO_CATALOGO) {
    const cobre = pathname === p || pathname.startsWith(p + '/')
    if (cobre && (!melhor || p.length > melhor.length)) melhor = p
  }
  return melhor
}

// Mesma checagem, mas contra uma lista de rotas permitidas (basta uma bater).
// Só conta a rota do caminho mais específico do catálogo — quem decide uma
// subpágina com código próprio é o código dela, não o da página-mãe.
export function hasRouteAccess(pathname: string, search: string, allowedRoutes: string[]): boolean {
  const alvo = caminhoMaisEspecifico(pathname)
  return allowedRoutes.some(
    (route) => routeMatches(pathname, search, route) && (!alvo || route.split('?')[0] === alvo)
  )
}
