import "server-only"

import { supabaseService } from "@/lib/supabase/service"
import { buscarLaudosDoRelatorio } from "@/services/laudos/relatorio"
import { buscarGrade } from "@/lib/grade/fonte"
import { hojeBrasiliaISO } from "@/lib/laudos/acompanhamento"
import { calcularElegibilidadePdi } from "@/lib/pdi/elegibilidade"
import { addDiasIso } from "@/lib/pdi/datas"
import { juntarPdi, type PacienteParaPdi, type RegistroPdiPrazosBruto } from "@/lib/pdi/juntar"
import { PACIENTES_PLACEHOLDER, TERAPIAS_ABA, type LinhaGradePdi } from "@/lib/pdi/agenda"
import type { ItemPdi } from "@/lib/pdi/filtros"
import type { MetaPdiPrazos } from "@/types/pdiPrazos"

// Montagem da lista do Controle de Prazos do PDI: relatório Órbita (via
// buscarLaudosDoRelatorio, que já resolve paginação/status/importação — ver o
// cabeçalho de services/laudos/relatorio.ts) + `public.pacientes` +
// `public.pdi_controle_prazos` + a janela relevante de
// `public.vw_grade_base`. O cruzamento em si é PURO e mora em
// lib/pdi/juntar.ts — este módulo só lê e entrega em memória, mesmo papel que
// services/laudos/acompanhamento.ts cumpre para Acompanhamento de Laudos.
//
// ─── Por que service_role para TUDO, inclusive `pdi_controle_prazos` ───────
//
// `orbita_laudos_relatorio` não tem GRANT para `authenticated` (só
// service_role lê — ver o cabeçalho de services/laudos/acompanhamento.ts), e
// como a elegibilidade PRECISA daquele relatório, a rota já roda inteira sob
// service_role. `pdi_controle_prazos`, ao contrário, TEM RLS por
// `usuario_tem_permissao('terapeutico_pdi')` (20260904120000) e um client de
// sessão a respeitaria — mas ler por ele aqui exigiria manter DOIS clientes
// nesta função só para uma tabela que, de qualquer forma, é sempre lida
// inteira (a lista de elegíveis já é o recorte; não há "menos pdi_controle_prazos"
// para um usuário sem a permissão ver). A autorização de QUEM VÊ A TELA
// continua sendo o Sidebar/canAccess — mesmo modelo, mesma dívida documentada,
// que /api/acompanhamento-laudos já assume para `laudos_acompanhamento` (ali
// nem é citado porque a tabela dali É de sessão; aqui optamos por não duplicar
// o cliente). Repetir a checagem fina aqui exigiria um segundo lugar para
// mantê-la em dia — mesma razão já registrada naquele arquivo.
//
// A ESCRITA de pdi_controle_prazos é sempre client-side, com o client de
// sessão, sob RLS de verdade — ver services/pdiPrazos.service.ts. Só a
// LEITURA que alimenta esta tela passa por aqui.

const PAGE = 1000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteSupabase = any

/** Lê uma tabela inteira, paginada — mesmo laço de services/laudos/acompanhamento.ts::lerTudo. */
async function lerTudo(
  sb: ClienteSupabase,
  tabela: string,
  colunas: string,
  ordem: string,
): Promise<Record<string, unknown>[]> {
  const todas: Record<string, unknown>[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from(tabela)
      .select(colunas)
      .order(ordem, { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`[pdi:prazos] falha ao ler ${tabela}: ${error.message}`)
    const pagina = (data ?? []) as Record<string, unknown>[]
    todas.push(...pagina)
    if (pagina.length < PAGE) break
  }
  return todas
}

/**
 * Linhas de `vw_grade_base`, status 'Agendado', SÓ dos `idsFavorecido`
 * (o `paciente_id` da grade — ver o cabeçalho de lib/pdi/juntar.ts sobre o
 * espaço de identidade compartilhado), de hoje até 45 dias à frente.
 *
 * `idsFavorecido` deve trazer a UNIÃO de elegíveis (relatório de hoje) e
 * tracked (já têm linha em `pdi_controle_prazos`) — ver `buscarControlePrazosPdi`
 * abaixo. Sem isso não dá pra calcular `ativoNaGrade` nem os badges de agenda
 * de um paciente tracked que caiu do relatório (correção de 04/09/2026).
 *
 * 45 dias é a janela mínima que garante cobrir a primeira semana do mês
 * SEGUINTE inteira (o que `coordenadorDoCaso` precisa — ver lib/pdi/agenda.ts):
 * mesmo no pior caso, hoje = dia 1 do mês, dia 7 do mês seguinte fica a no
 * máximo 37 dias de distância. `diasClinicos`/`turnoClinico`/
 * `temAgendamentoAmbienteNatural`/`quantidadeAplicadores` também usam essa
 * mesma janela — a agenda sincronizada é "hoje em diante", então não há
 * recorte mais recente para pegar o padrão semanal atual.
 *
 * Sem filtro de `unidade`: o Coordenador de Caso e o acompanhamento clínico do
 * PDI não são exclusivos da unidade 280 (ver buscarTurnosBloqueioAdministrativo
 * em services/salas.service.ts, mesmo padrão de não recortar unidade).
 */
async function buscarGradeDaJanela(
  sb: ClienteSupabase,
  idsFavorecido: number[],
  hoje: string,
): Promise<LinhaGradePdi[]> {
  if (idsFavorecido.length === 0) return []

  return buscarGrade<LinhaGradePdi>({
    campos:
      "paciente_id, profissional_id, profissional_nome, data, dia_semana, hora_inicial, hora_final, terapia_nome, paciente_nome",
    fonte: "base",
    status: "Agendado",
    de: hoje,
    ate: addDiasIso(hoje, 45),
    refinar: (q) => q.in("paciente_id", idsFavorecido),
    ordem: [{ coluna: "data" }, { coluna: "id" }],
    cliente: sb,
  })
}

/**
 * Os `paciente_id` com alguma terapia de ABA agendada na primeira semana do
 * mês SEGUINTE — a descoberta que quebra o ovo-e-galinha da correção de
 * 11/09/2026.
 *
 * `buscarGradeDaJanela` acima só lê a grade de IDs que já conhecemos
 * (elegíveis do relatório + tracked), então um paciente em atendimento de ABA
 * cujo laudo não diz "Psicologia ABA" jamais teria a grade lida — e sem a
 * grade não há como descobrir que ele é de ABA. Esta leitura vem ANTES, sem
 * filtro de paciente, e devolve os IDs que faltavam para a união em
 * `juntarPdi`.
 *
 * Recorte deliberadamente estreito: 7 dias e só as terapias de `TERAPIAS_ABA`
 * (~4.050 linhas na janela inteira, medido em 11/09/2026 — a filtragem por
 * terapia acontece aqui, em memória, porque `buscarGrade` não tem parâmetro
 * de terapia e `refinar` com `.in()` de 12 strings não paga o próprio custo).
 * A paginação é responsabilidade de `buscarGrade` (o `max_rows = 1000` do
 * PostgREST trunca em silêncio — ver lib/grade/fonte.ts).
 */
async function buscarIdsComAbaNaAgenda(sb: ClienteSupabase, hoje: string): Promise<number[]> {
  const [ano, mes] = hoje.slice(0, 10).split("-").map(Number)
  const mesSeguinte = mes === 12 ? 1 : mes + 1
  const anoDoMesSeguinte = mes === 12 ? ano + 1 : ano
  const prefixo = `${anoDoMesSeguinte}-${String(mesSeguinte).padStart(2, "0")}`

  const linhas = await buscarGrade<{ paciente_id: number | null; terapia_nome: string | null }>({
    campos: "paciente_id, terapia_nome",
    fonte: "base",
    status: "Agendado",
    de: `${prefixo}-01`,
    ate: `${prefixo}-07`,
    ordem: [{ coluna: "id" }],
    cliente: sb,
  })

  const ids = new Set<number>()
  for (const l of linhas) {
    if (l.paciente_id === null || !l.terapia_nome) continue
    if (!TERAPIAS_ABA.has(l.terapia_nome)) continue
    if (PACIENTES_PLACEHOLDER.has(l.paciente_id)) continue
    ids.add(l.paciente_id)
  }
  return [...ids]
}

export async function buscarControlePrazosPdi(
  cliente?: ClienteSupabase,
  agora?: Date,
): Promise<{ itens: ItemPdi[]; meta: MetaPdiPrazos }> {
  const sb: ClienteSupabase = cliente ?? supabaseService
  const hoje = hojeBrasiliaISO(agora)

  const { rows, meta: metaImportacao } = await buscarLaudosDoRelatorio(sb)

  // O relatório dá a lista de `idFavorecido` ELEGÍVEIS hoje; `pdi_controle_prazos`
  // dá a lista dos já TRACKED (podem ter caído do relatório — ver o cabeçalho
  // de lib/pdi/juntar.ts). A leitura da grade precisa da UNIÃO dos dois, senão
  // um paciente tracked-só fica sem `ativoNaGrade`/badges de agenda — por isso
  // `pdi_controle_prazos` e `pacientes` são lidos ANTES de montar o filtro da
  // grade (não em paralelo com ela, como antes da correção de 04/09/2026).
  const elegibilidade = calcularElegibilidadePdi(rows)
  const idsElegiveis = [...elegibilidade.entries()].filter(([, e]) => e.elegivel).map(([id]) => id)

  const [pacientesBrutos, registrosBrutos] = await Promise.all([
    lerTudo(sb, "pacientes", "id_paciente, tita_paciente_id, nome, ativo, foto_path", "id_paciente"),
    lerTudo(
      sb,
      "pdi_controle_prazos",
      "paciente_id, especialista_tita_id, data_avaliacao, data_validade, observacoes",
      "paciente_id",
    ),
  ])

  const idsTracked = (registrosBrutos as unknown as RegistroPdiPrazosBruto[]).map((r) => Number(r.paciente_id))
  // 3º conjunto: quem tem ABA na AGENDA mas pode não estar em nenhum dos dois
  // acima (ver `buscarIdsComAbaNaAgenda` e o bloco laudo × agenda em
  // lib/pdi/agenda.ts). Sem ele, o "PDI - Painel por Analista" perde paciente
  // em atendimento real e o coordenador aparece com menos gente do que tem.
  const idsComAba = await buscarIdsComAbaNaAgenda(sb, hoje)
  const idsUniao = [...new Set([...idsElegiveis, ...idsTracked, ...idsComAba])].filter(
    (id) => !PACIENTES_PLACEHOLDER.has(id),
  )

  const linhasGrade = await buscarGradeDaJanela(sb, idsUniao, hoje)

  const { itens, semCadastroPulsar } = juntarPdi(
    rows,
    registrosBrutos as unknown as RegistroPdiPrazosBruto[],
    pacientesBrutos as unknown as PacienteParaPdi[],
    linhasGrade,
    hoje,
  )

  // Só um AVISO agora — não uma contagem de descartados. Ver o cabeçalho de
  // lib/pdi/juntar.ts: desde 04/09/2026 o paciente sem cadastro em
  // public.pacientes continua na lista (fotoPath/ativo nulos, nome do
  // relatório Órbita).
  if (semCadastroPulsar > 0) {
    console.warn(
      `[pdi:prazos] ${semCadastroPulsar} paciente(s) elegível(is) para o PDI sem cadastro em public.pacientes — presentes na lista mesmo assim (ver ItemPdi.semCadastroPulsar).`,
    )
  }

  return {
    itens,
    meta: {
      importacaoId: metaImportacao.importacaoId,
      arquivoNome: metaImportacao.arquivoNome,
      concluidoEm: metaImportacao.concluidoEm,
      linhasLidas: metaImportacao.linhasLidas,
      itens: itens.length,
      hoje,
      semCadastroPulsar,
    },
  }
}
