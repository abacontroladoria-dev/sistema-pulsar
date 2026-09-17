import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'

// A TV do saguão roda sem conta logada (/tv é rota pública em proxy.ts), e a RLS
// de chamada_paciente só responde a `authenticated` — o anon lê `[]`. Por isso a
// leitura acontece aqui, no servidor, com service_role: a tela recebe apenas as
// últimas chamadas, não a tabela inteira, e nenhuma policy precisa ser afrouxada.

// A TV é painel de sala de espera, não histórico: passada a janela, some.
const JANELA_HORAS = 6

// 1 no card grande + 5 na lista lateral.
const LIMITE = 6

// Piso de permanência: uma chamada nunca sai da tela antes disso, nem com a
// autorização já resolvida.
//
// Eram 60s, e 57 das 60 chamadas de 17/09 sumiam da TV mesmo assim. O motivo é
// que a premissa de baixo — autorização resolvida DEPOIS da chamada prova que o
// responsável passou no balcão — não descreve o que acontece: quem resolve a
// autorização é o ROBÔ, sozinho, e ele leva de 40s a 3 min. Nesse intervalo o
// responsável em geral nem levantou da cadeira. O nome nascia, durava um ou dois
// polls de 3s e sumia; da recepção o sintoma era "aperto e não acontece nada".
//
// 5 min é o tempo que a sala de espera precisa: cobre a resolução do robô com
// folga larga e ainda tira o nome bem antes do fim da janela de 6h. Quem some
// cedo agora é só quem foi chamado e resolvido com o responsável já no balcão —
// e mesmo esse fica os 5 min, o que não atrapalha ninguém.
const PISO_VISIVEL_MS = 300_000

// `completed_at`/`updated_at` são `timestamp without time zone` guardando UTC,
// enquanto `chamado_em` é `timestamptz` — os dois fusos que essa tabela mistura
// (reference_fila_autorizacoes_dois_fusos). O PostgREST devolve os primeiros sem
// sufixo de zona, e `new Date('2026-08-26T17:58:19')` é interpretado como hora
// LOCAL do processo: num container fora do UTC isso desloca a comparação em
// horas, sem erro nenhum. O `Z` explícito é o que torna a conta correta.
function instanteUtc(valor: unknown): number {
  if (typeof valor !== 'string' || valor === '') return NaN

  const temZona = /(z|[+-]\d{2}:?\d{2})$/i.test(valor)

  return Date.parse(temZona ? valor : `${valor.replace(' ', 'T')}Z`)
}

export async function GET(request: NextRequest) {
  try {
    return await listar(request)
  } catch {
    // Ex.: SUPABASE_SERVICE_ROLE_KEY ausente no ambiente — a TV mostra
    // "Sem conexão" em vez de quebrar a tela.
    return NextResponse.json(
      { error: 'Serviço indisponível' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}

async function listar(request: NextRequest) {
  const unidade = request.nextUrl.searchParams.get('unidade')
  const desde = new Date(Date.now() - JANELA_HORAS * 60 * 60 * 1000).toISOString()

  // `sala` fica fora: a clínica tem uma recepção só, a TV não exibe qual, e o
  // endpoint é público — não faz sentido publicar campo que ninguém usa.
  let query = supabaseService
    .from('chamada_paciente')
    .select(
      'id, nome, agenda_id, unidade, chamado_em, paciente_id, data_atendimento, horario'
    )
    .eq('status', 'ativo')
    .gte('chamado_em', desde)
    .order('chamado_em', { ascending: false })
    .limit(30)

  // Hoje nenhum insert preenche `unidade` (fica no default 'principal'), então o
  // filtro é opt-in: /tv?unidade=x quando existir uma segunda recepção.
  if (unidade) {
    query = query.eq('unidade', unidade)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json(
      { error: 'Falha ao ler as chamadas' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  const chamadas = data ?? []

  // A chamada guarda QUAL SESSÃO foi chamada — (paciente_id, data_atendimento,
  // horario) —, não um id de linha da fila. É o único vínculo possível: quem
  // chama é a /solicitar, e no instante do "Chamar" a linha da fila em geral
  // ainda não existe (o responsável está sendo chamado para que ela exista).
  // `unique_fila_agendamento` garante que essa tupla casa com no máximo uma
  // linha, então não há ambiguidade a resolver aqui.
  //
  // `agenda_id` é o vínculo legado da /autorizacoes (removida): as chamadas
  // antigas que ainda estejam na janela ficam sem sessão e expiram pelo tempo.
  const chave = (p: unknown, d: unknown, h: unknown) =>
    `${p}|${d}|${String(h).slice(0, 5)}`

  const comSessao = chamadas.filter(
    (c) => c.paciente_id && c.data_atendimento && c.horario
  )

  // chave da sessão → instante em que a autorização foi resolvida (ms UTC).
  // Guardar o INSTANTE, e não só "está resolvida", é o coração da correção:
  // ver o comentário sobre causalidade logo abaixo.
  const resolvidas = new Map<string, number>()

  if (comSessao.length > 0) {
    // Produto cartesiano de propósito: são no máximo 30 chamadas na janela, os
    // `in` batem em `unique_fila_agendamento` e o casamento exato acontece
    // abaixo, por chave. Montar um `or(and(...))` por sessão seria mais preciso
    // no wire e mais frágil na formatação de `time`.
    //
    // O filtro de status é por EXCLUSÃO, não por lista de terminais: `chk_status`
    // aceita 9 valores, e casar só `concluido` deixava na tela quem terminou em
    // `glosa` ou `concluido_sem_guia` — processo encerrado, responsável já foi
    // embora, nome parado na lateral. Assim um status terminal novo some
    // sozinho, sem ninguém precisar lembrar desta rota.
    //
    // `erro` fica do lado de cá junto dos em andamento, de propósito: a
    // automação falhou e alguém ainda vai tratar aquilo, então o nome continua.
    //
    // O filtro de status continua sendo indispensável agora que `updated_at`
    // serve de reserva para `completed_at`: sem ele, uma linha `pendente` tocada
    // depois da chamada esconderia o nome de quem ainda não foi atendido.
    const { data: fila } = await supabaseService
      .from('fila_autorizacoes')
      .select('paciente_id, data_atendimento, horario, completed_at, updated_at')
      .in('paciente_id', [...new Set(comSessao.map((c) => c.paciente_id))])
      .in('data_atendimento', [
        ...new Set(comSessao.map((c) => c.data_atendimento)),
      ])
      .not('status', 'in', '(pendente,processando,executando,erro)')

    for (const f of fila ?? []) {
      // `completed_at` é o instante da resolução e é o carimbo certo.
      // `updated_at` entra como reserva porque não há garantia de que todo
      // status terminal preencha `completed_at` — `falta`, por exemplo. A
      // reserva é imprecisa (uma edição alheia move `updated_at`), mas só
      // alcança linhas JÁ terminais, o que fecha bastante a janela.
      const resolvidoEm = instanteUtc(f.completed_at ?? f.updated_at)

      // Sem carimbo utilizável não há como provar que a resolução veio DEPOIS
      // da chamada — e na dúvida o nome fica. Esconder o nome de quem foi
      // chamado é o erro que custa: o responsável nunca descobre que o
      // chamaram. Deixar um nome a mais na lateral não custa nada.
      if (Number.isNaN(resolvidoEm)) continue

      const k = chave(f.paciente_id, f.data_atendimento, f.horario)
      const anterior = resolvidas.get(k)

      if (anterior === undefined || resolvidoEm > anterior) {
        resolvidas.set(k, resolvidoEm)
      }
    }
  }

  // idade_segundos vem daqui e não do navegador: a TV pode estar num PC com o
  // relógio errado, e aí "chamada agora" viraria mentira na tela. Como o poll é
  // de 3s, a idade se atualiza sozinha sem timer nenhum no cliente.
  const agora = Date.now()

  // A regra não é "a autorização está concluída", é "a autorização foi
  // concluída DEPOIS da chamada".
  //
  // A primeira versão escondia toda sessão em status terminal, seguindo a ideia
  // de que autorização encerrada significa que o responsável já passou pela
  // recepção. Os dados de produção derrubaram isso: em 10 de 11 chamadas com
  // sessão a fila JÁ estava `concluido` ou `falta` no instante do "Chamar" —
  // autorizações tiradas mais cedo, ou de véspera, pelo robô. O nome nascia
  // filtrado e ninguém nunca o via; da recepção o sintoma era "aperto e não
  // acontece nada".
  //
  // Resolução anterior à chamada não é evidência de nada: se ela veio antes, o
  // responsável está sendo chamado por outro motivo (biometria, filipeta) e o
  // nome tem de aparecer. Só a resolução POSTERIOR sustenta a inferência
  // original — e é ela que tira o nome da tela.
  const oculta = (c: (typeof chamadas)[number]) => {
    const resolvidoEm = resolvidas.get(
      chave(c.paciente_id, c.data_atendimento, c.horario)
    )
    if (resolvidoEm === undefined) return false

    const chamadoEm = new Date(c.chamado_em as string).getTime()
    if (Number.isNaN(chamadoEm)) return false

    if (resolvidoEm <= chamadoEm) return false

    return agora - chamadoEm > PISO_VISIVEL_MS
  }

  // Um paciente ocupa UMA linha na tela, por mais vezes que tenha sido chamado.
  //
  // Em 31/08 um paciente apareceu 9 vezes na lateral: a recepção clicava de novo
  // porque a TV estava sem som e nada confirmava que a chamada tinha saído. A
  // causa foi tratada na origem (som + o botão virando "Chamado" na /solicitar),
  // mas a tela precisa aguentar repetição de qualquer jeito — as linhas antigas
  // seguem no banco, e rechamar continua legítimo quando o responsável não vem.
  //
  // Nove linhas do mesmo nome não informam mais que uma; só empurram os outros
  // pacientes para fora do LIMITE, que é o dado que a sala de espera precisa ver.
  //
  // Fica a MAIS RECENTE (a lista já vem ordenada por `chamado_em` desc, então é
  // a primeira que aparece): é ela que carrega a idade certa para o rótulo
  // "agora" e para o teto de anúncio. A dedupe é por `paciente_id` quando
  // existe; as chamadas legadas sem ele caem no nome, que é o que a tela mostra
  // de qualquer forma.
  //
  // Isto NÃO afeta o anúncio de uma rechamada: a marca d'água do cliente compara
  // `chamado_em`, e o da rechamada é maior que o da anterior — id novo, instante
  // maior, a TV fala de novo. O que a dedupe evita é só a repetição visual.
  const vistos = new Set<string>()

  const visiveis = chamadas
    .filter((c) => !oculta(c))
    .filter((c) => {
      const k = c.paciente_id ? `id:${c.paciente_id}` : `nome:${c.nome}`
      if (vistos.has(k)) return false
      vistos.add(k)
      return true
    })
    .slice(0, LIMITE)
    // Campo a campo, sem espalhar a linha: `paciente_id`, `data_atendimento` e
    // `horario` são lidos só para decidir o que sai da tela e NÃO podem ir na
    // resposta — este endpoint é público (a TV roda sem conta), e um `...c`
    // publicaria a agenda do paciente para quem chamasse a URL.
    .map((c) => ({
      id: c.id,
      nome: c.nome,
      agenda_id: c.agenda_id,
      chamado_em: c.chamado_em,
      idade_segundos: Math.max(
        0,
        Math.round((agora - new Date(c.chamado_em as string).getTime()) / 1000)
      ),
    }))

  return NextResponse.json(
    { chamadas: visiveis },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
