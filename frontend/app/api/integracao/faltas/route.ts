import type { NextRequest } from 'next/server'

import { checkRateLimit } from '@/lib/rate-limit'
import { supabaseService } from '@/lib/supabase/service'

// Leitura de faltas por sistema parceiro.
//
// Esta rota é deliberadamente fina: ela não decide nada sobre autorização nem
// sobre quais colunas saem. Quem faz as duas coisas é a RPC `integracao_faltas`
// (SECURITY DEFINER) sobre a view `vw_integracao_faltas`, pelo mesmo motivo do
// robô — a regra fica no banco, onde não há como um bug de rota vazar coluna a
// mais de `fila_autorizacoes`, que guarda CPF, carteirinha e guia.
//
// O token viaja no header `Authorization: Bearer` e nunca na URL, portanto nunca
// em log de acesso.
//
// É server-to-server: nenhuma rota deste projeto seta CORS, então o browser
// bloqueia a leitura. Isso é desejado — um Bearer estático que viajasse no
// browser estaria no bundle do parceiro, ou seja, público.

export const dynamic = 'force-dynamic'

// 60/min é folgado para o volume real (as faltas mudam ~67 vezes por dia) e
// ainda assim limita a drenagem se o token vazar.
const LIMITE_REQ = 60
const JANELA_MS = 60_000

type LinhaFalta = {
  tita_agendamento_id: number
  paciente_id: number | null
  profissional_id: number | null
  data_atendimento: string
  horario: string
  terapia_nome: string | null
  tipo_falta: string | null
  codigo_justificativa: number | null
  justificativa: string | null
  ativa: boolean
  status: string
  atualizado_em: string
}

// Máximo de ids por chamada. O mesmo teto existe na RPC, que é quem de fato
// recusa — aqui a checagem serve só para devolver 400 com mensagem útil em vez
// de deixar o Postgres levantar 22023, que a rota traduziria como 500.
const MAX_IDS = 200

// `?agendamento_id=1,2,3` (ou repetido: `?agendamento_id=1&agendamento_id=2`).
// Devolve `undefined` quando o parâmetro não veio — que é diferente de veio
// vazio: a RPC trata array vazio como "sem filtro", mas deixar um `?x=` virar
// filtro-de-nada e responder `[]` seria transformar um erro de digitação numa
// resposta que parece legítima.
function extrairIds(
  params: URLSearchParams,
  nome: string
): { ids?: number[]; erro?: string } {
  const brutos = params.getAll(nome)
  if (brutos.length === 0) return {}

  const partes = brutos
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter((v) => v !== '')

  if (partes.length === 0) {
    return { erro: `\`${nome}\` veio vazio; omita o parâmetro para não filtrar` }
  }

  if (partes.length > MAX_IDS) {
    return { erro: `\`${nome}\` aceita no máximo ${MAX_IDS} ids por chamada` }
  }

  const ids: number[] = []
  for (const parte of partes) {
    const n = Number(parte)
    // `Number('')` é 0 e `Number('1e3')` é 1000: validar com isSafeInteger
    // depois de filtrar vazios evita aceitar notação que o parceiro não quis.
    if (!Number.isSafeInteger(n) || n < 0) {
      return { erro: `\`${nome}\` contém um valor que não é inteiro: ${parte}` }
    }
    ids.push(n)
  }

  return { ids }
}

function extrairToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null

  const [esquema, valor] = header.split(' ')
  if (!valor || esquema.toLowerCase() !== 'bearer') return null

  return valor.trim() || null
}

export async function GET(request: NextRequest) {
  const token = extrairToken(request)
  if (!token) {
    return Response.json(
      { erro: 'informe o token em Authorization: Bearer <token>' },
      { status: 401 }
    )
  }

  const params = request.nextUrl.searchParams

  // Cursor composto. `desde` sozinho não basta: milhares de faltas compartilham
  // o mesmo `atualizado_em` (um backfill carimbou 3.858 no mesmo instante), e
  // paginar só pelo tempo perderia todas as que não coubessem na primeira
  // página daquele instante. `desde_id` continua a varredura dentro do empate.
  const desde = params.get('desde')
  if (desde && Number.isNaN(Date.parse(desde))) {
    return Response.json(
      { erro: '`desde` deve ser uma data ISO 8601 (ex.: 2026-09-14T00:00:00Z)' },
      { status: 400 }
    )
  }

  const desdeIdBruto = params.get('desde_id')
  const desdeId = desdeIdBruto ? Number(desdeIdBruto) : null
  if (desdeIdBruto && !Number.isSafeInteger(desdeId)) {
    return Response.json(
      { erro: '`desde_id` deve ser um inteiro (o `proximo_desde_id` da resposta anterior)' },
      { status: 400 }
    )
  }

  // Filtro por id — consulta pontual ("esse agendamento faltou?"). Quando vem,
  // a RPC ignora o cursor de propósito: ver o cabeçalho da migration
  // 20260915140000. Resumo: com filtro, `[]` significa sempre "não há falta", e
  // nunca "não mudou desde o seu cursor".
  const agendamento = extrairIds(params, 'agendamento_id')
  if (agendamento.erro) {
    return Response.json({ erro: agendamento.erro }, { status: 400 })
  }

  const paciente = extrairIds(params, 'paciente_id')
  if (paciente.erro) {
    return Response.json({ erro: paciente.erro }, { status: 400 })
  }

  const filtrandoPorId = agendamento.ids !== undefined || paciente.ids !== undefined

  const limiteBruto = params.get('limite')
  const limite = limiteBruto ? Number(limiteBruto) : 500
  if (!Number.isInteger(limite) || limite < 1 || limite > 1000) {
    return Response.json(
      { erro: '`limite` deve ser um inteiro entre 1 e 1000' },
      { status: 400 }
    )
  }

  // ── 1. Autenticar ANTES do rate limit ────────────────────────────────────
  //
  // O rate limit é chaveado pelo ID DO PARCEIRO, e é por isso que a
  // autenticação vem primeiro. A versão anterior chaveava pelo token do
  // request, antes de autenticar — e como `lib/rate-limit.ts` é um Map de
  // processo cujo `cleanupRateLimitStore()` nunca é chamado, um atacante SEM
  // TOKEN VÁLIDO variava o token a cada request e crescia o heap para sempre:
  // medido em 292 bytes por request, ~31 min de flood a 1k req/s para 512 MB.
  //
  // Chaveando pelo id, a cardinalidade do Map é o número de parceiros
  // cadastrados — não o que o atacante digita. O vetor fecha por construção.
  //
  // Autenticar numa chamada separada (e não reaproveitar a consulta) é o que
  // faz o limite valer também quando a consulta devolveria ZERO linhas: um
  // cursor no futuro retorna vazio sempre, e seria um caminho livre de limite.
  const auth = await supabaseService.rpc('integracao_identificar', { p_token: token })

  if (auth.error) {
    if (auth.error.code === '28000') {
      return Response.json({ erro: 'token invalido' }, { status: 401 })
    }
    console.error('[integracao/faltas] falha ao identificar', { code: auth.error.code })
    return Response.json({ erro: 'servico indisponivel' }, { status: 500 })
  }

  const parceiroId = (auth.data as { parceiro_id: number }[] | null)?.[0]?.parceiro_id
  if (parceiroId === undefined) {
    return Response.json({ erro: 'token invalido' }, { status: 401 })
  }

  // ── 2. Rate limit por parceiro ───────────────────────────────────────────
  if (checkRateLimit(`integracao:faltas:${parceiroId}`, LIMITE_REQ, JANELA_MS)) {
    return Response.json(
      { erro: 'limite de requisicoes excedido' },
      { status: 429, headers: { 'Retry-After': String(JANELA_MS / 1000) } }
    )
  }

  // ── 3. A consulta ────────────────────────────────────────────────────────
  const { data, error } = await supabaseService.rpc('integracao_faltas', {
    p_token: token,
    p_desde: desde,
    p_desde_id: desdeId,
    p_limite: limite,
    p_agendamento_ids: agendamento.ids ?? null,
    p_paciente_ids: paciente.ids ?? null,
  })

  if (error) {
    // '28000' é o código que `integracao_autenticar` levanta para token
    // inexistente, revogado ou de outro escopo — sempre a mesma mensagem, para
    // não entregar ao chamador a informação de "quase acertou".
    if (error.code === '28000') {
      return Response.json({ erro: 'token invalido' }, { status: 401 })
    }

    // '22023' é o teto de ids da RPC. A rota já barra antes, então chegar aqui
    // significa divergência entre os dois limites — devolver 400 mantém a culpa
    // no chamador em vez de acusar falha do serviço.
    if (error.code === '22023') {
      return Response.json(
        { erro: `no maximo ${MAX_IDS} ids por chamada` },
        { status: 400 }
      )
    }

    // Só o código do erro vai ao log. A mensagem/detalhe do PostgREST pode
    // carregar conteúdo influenciado pelo chamador (um token com byte inválido,
    // por exemplo, volta como erro de driver), e isso é poluição de log que o
    // atacante escolhe. O diagnóstico real fica no log do Postgres.
    console.error('[integracao/faltas] falha na consulta', { code: error.code })
    return Response.json({ erro: 'servico indisponivel' }, { status: 500 })
  }

  const faltas = (data ?? []) as LinhaFalta[]

  // Cursor pronto para a próxima chamada: o parceiro só devolve os dois valores,
  // sem precisar calcular nada. A RPC ordena por (atualizado_em, id), então é a
  // última linha da lista.
  const ultima = faltas.at(-1)

  // Sob filtro por id o cursor NÃO é emitido. Ele seria uma armadilha: a RPC
  // ignorou `desde` nesta resposta, então devolver um `proximo_desde` daria ao
  // chamador um cursor que nunca governou a consulta — e guardá-lo para a
  // sincronização seguinte faria pular tudo que mudou nesse intervalo.
  //
  // `tem_mais` continua valendo nos dois modos: significa "a página encheu".
  const cursor = filtrandoPorId
    ? {}
    : {
        proximo_desde: ultima?.atualizado_em ?? desde,
        proximo_desde_id: ultima?.tita_agendamento_id ?? desdeId,
      }

  return Response.json(
    {
      faltas,
      // `true` significa que a página encheu: chame de novo com o cursor abaixo
      // antes de considerar a sincronização em dia.
      tem_mais: faltas.length === limite,
      ...cursor,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
