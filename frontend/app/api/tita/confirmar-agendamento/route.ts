import { createServerClient } from "@supabase/ssr"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import {
  prepararAgendamento,
  interpretarDisponibilidade,
  interpretarResultadoCriacao,
  mensagemAmigavel,
  mensagemResumoCriacao,
} from "@/services/tita/confirmar"
import { verificarDisponibilidade, criarAgendamento } from "@/services/tita/client"
import { registrarInclusaoTerapia } from "@/services/tita/inclusaoTerapia"
import { acaoDaCriacao, registrarAuditoriaImplantacao } from "@/services/tita/auditoriaImplantacao"
import type { AceiteSessao } from "@/types/acompanhamento"

const LOG_TAG = "[tita:confirmar-agendamento]"

interface RequestBody {
  pac?: string
  sessoes?: AceiteSessao[]
  /**
   * Qual tela originou a implantação: "aumentar" (Aumentar Cronograma) ou
   * "novo" (Criar Novo Cronograma). Vai para o card de inclusão no ClickUp.
   *
   * Explícita, e não inferida de `idFavorecidoFallback`: aquele campo só aparece
   * hoje na modalidade "novo" por consequência de outra regra (o paciente sem
   * linha Agendado), então inferir dali passaria a mentir calado se a regra
   * mudasse. Ausente = não informado, nunca um chute.
   */
  modalidade?: "aumentar" | "novo"
}

// Nunca inclui conteúdo bruto da TiTa (stack trace, caminhos internos) — apenas
// código de erro estável, mensagem amigável e o identificador da sessão. O corpo
// bruto de qualquer erro só é logado no servidor (ver client.ts/confirmar.ts).
interface ResultadoSessao {
  csvGradeId: string
  ok: boolean
  codigoErro?: string
  mensagem?: string
  // Preenchidos só na fase de criação (Fase 3) — reflete o achado de que
  // agendamento/create não é transacional: cria a série inteira e marca cada
  // ocorrência individualmente como "Planejado" ou "Conflito".
  status?: "success" | "partial_success" | "failed" | "erro_api"
  criadas?: number
  conflitos?: number
  rejeitadas?: number
  total?: number
  idAgendaFav?: number
}

async function getCurrentUser(request: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll() {},
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// Implanta na TiTa as sessões aceitas no fluxo de Ocupação de Paciente.
//
// Estratégia "tudo ou nada": as três fases rodam em sequência para o BUNDLE
// inteiro (nenhuma fase começa até a anterior confirmar todas as sessões).
// Isso evita criar 1 de 5 sessões e travar as outras 4 num estado incerto na
// maioria dos casos — mas não é atômico: se agendamento/create falhar para a
// sessão N depois de já ter sucesso nas sessões 1..N-1, essas já foram
// efetivamente criadas na TiTa e não há rollback automático aqui.
export async function POST(request: NextRequest) {
  const inicioTotal = Date.now()

  // DISABLE_AUTH cobre o desenvolvimento local, sem sessão (mesma convenção de
  // /api/acompanhamento-laudos, /api/pdi-controle-prazos e
  // /api/tita/situacao-favorecidos). Diferente delas, esta rota GRAVA autoria
  // (implantadoPor / inclusoes_terapia / log de auditoria) — sem usuário real,
  // userId fica null (as colunas que o guardam são FK anulável para
  // auth.users/usuarios) e o e-mail vira um marcador óbvio de teste local, pra
  // nunca ser confundido com uma implantação real na consulta de auditoria.
  const devBypass = process.env.DISABLE_AUTH === "true"
  const user = await getCurrentUser(request)
  if (!user && !devBypass) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 })
  const userId = user?.id ?? null
  const userEmail = user?.email ?? (devBypass ? "dev-local@localhost" : null)

  const body = await request.json().catch(() => null) as RequestBody | null
  if (!body?.pac || !Array.isArray(body.sessoes) || body.sessoes.length === 0) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 })
  }
  if (body.sessoes.some(s => !s.csvGradeId)) {
    return NextResponse.json({ ok: false, error: "sessao_sem_csv_grade_id" }, { status: 400 })
  }

  console.log(`${LOG_TAG} início pac=${body.pac} sessoes=${body.sessoes.length}`)

  // Fase 1: busca a grade e monta o payload de cada sessão (sem chamar a TiTa ainda).
  const inicioPreparacao = Date.now()
  const preparos = await Promise.all(
    body.sessoes.map(async sessao => ({
      sessao,
      preparo: await prepararAgendamento(sessao.csvGradeId, body.pac!, sessao.terapiaExibicaoOverride, sessao.idFavorecidoFallback),
    })),
  )
  const falhasPreparo = preparos.filter(p => !p.preparo.ok)
  console.log(
    `${LOG_TAG} etapa=preparacao ok=${preparos.length - falhasPreparo.length} falhas=${falhasPreparo.length} duracaoMs=${Date.now() - inicioPreparacao}`,
  )
  if (falhasPreparo.length > 0) {
    const resultados: ResultadoSessao[] = preparos.map(p => ({
      csvGradeId: p.sessao.csvGradeId,
      ok: p.preparo.ok,
      codigoErro: p.preparo.erro,
      mensagem: p.preparo.ok ? undefined : mensagemAmigavel(p.preparo.erro),
    }))
    // Códigos internos (ex.: "grade_nao_encontrada") são seguros de logar — nunca
    // carregam resposta bruta da TiTa (essa só passa por prepararAgendamento/
    // resolverGradeTerapeuta, que já logam o detalhe técnico separadamente).
    console.error(`${LOG_TAG} cancelado na fase de preparação`, JSON.stringify(resultados))
    await registrarAuditoriaImplantacao({
      pac: body.pac,
      userId,
      userEmail,
      modalidade: body.modalidade,
      linhas: preparos.map(p => ({
        sessao: p.sessao,
        grade: p.preparo.grade,
        acao: p.preparo.ok ? "cancelada" : "falha_preparacao",
        detalhe: p.preparo.ok ? "outra sessão do pacote falhou na preparação" : p.preparo.erro,
      })),
    })
    return NextResponse.json({
      ok: false, etapa: "preparacao", mensagem: mensagemAmigavel(falhasPreparo[0].preparo.erro), resultados,
    })
  }

  // Fase 2: confere disponibilidade de TODAS antes de criar QUALQUER uma.
  const inicioDisponibilidade = Date.now()
  const disponibilidades = await Promise.all(
    preparos.map(async p => ({
      sessao: p.sessao,
      resultado: await verificarDisponibilidade({
        data_inicial: p.preparo.payload!.data_inicial,
        data_final: p.preparo.payload!.data_final,
        id_grade_terapeuta: p.preparo.payload!.id_grade_terapeuta,
        ids_favorecidos: p.preparo.payload!.ids_favorecidos,
      }),
    })),
  )
  const statusDisponibilidade = disponibilidades.map(d => ({ ...d, status: interpretarDisponibilidade(d.resultado) }))
  const indisponiveis = statusDisponibilidade.filter(d => d.status !== "disponivel")
  console.log(
    `${LOG_TAG} etapa=disponibilidade ok=${statusDisponibilidade.length - indisponiveis.length} indisponiveis=${indisponiveis.length} duracaoMs=${Date.now() - inicioDisponibilidade}`,
  )
  if (indisponiveis.length > 0) {
    // "erro_verificacao" (falha na chamada em si) é um problema técnico diferente
    // de "indisponivel" (grade genuinamente cheia) — cada sessão carrega o código
    // que reflete o que de fato aconteceu com ela.
    const resultados: ResultadoSessao[] = statusDisponibilidade.map(d => {
      const disponivel = d.status === "disponivel"
      const codigoErro = disponivel ? undefined : d.status === "erro_verificacao" ? "erro_ao_verificar_disponibilidade" : "indisponivel_na_tita"
      return { csvGradeId: d.sessao.csvGradeId, ok: disponivel, codigoErro, mensagem: codigoErro ? mensagemAmigavel(codigoErro) : undefined }
    })
    console.error(`${LOG_TAG} cancelado na fase de disponibilidade`, JSON.stringify(resultados))
    await registrarAuditoriaImplantacao({
      pac: body.pac,
      userId,
      userEmail,
      modalidade: body.modalidade,
      linhas: statusDisponibilidade.map((d, i) => ({
        sessao: d.sessao,
        grade: preparos[i].preparo.grade,
        acao: d.status === "disponivel" ? "cancelada" : "falha_disponibilidade",
        detalhe: d.status === "disponivel"
          ? "outra sessão do pacote estava indisponível"
          : resultados[i].codigoErro,
      })),
    })
    const primeiraFalha = indisponiveis[0].status === "erro_verificacao" ? "erro_ao_verificar_disponibilidade" : "indisponivel_na_tita"
    return NextResponse.json({
      ok: false, etapa: "disponibilidade", mensagem: mensagemAmigavel(primeiraFalha), resultados,
    })
  }

  // Fase 3: cria o agendamento na TiTa para cada sessão.
  // Achado da homologação: agendamento/create NÃO é transacional — cria a série
  // semanal inteira e marca cada ocorrência como "Planejado" ou "Conflito" em vez
  // de aceitar/rejeitar tudo (ver interpretarResultadoCriacao). Por isso "ok" aqui
  // continua refletindo só o sucesso HTTP da chamada (igual à Sprint 2): mesmo com
  // conflitos parciais a reserva é persistida no Pulsar, consistente com o que a
  // TiTa de fato criou. Se a própria chamada falhar (erro_api), a reserva local do
  // Pulsar NÃO é persistida (ver confirmarImplantacao em OcupPacMode.tsx); sessões
  // já criadas com sucesso antes da falha permanecem criadas lá (sem rollback).
  //
  // Sequencial, não Promise.all: achado real em produção (2026-08-07) — duas
  // chamadas concorrentes deste mesmo bundle, cada uma inserindo em lote em
  // agenda_fav_items (uma linha por ocorrência semanal), causaram deadlock no
  // MySQL da TiTa ("SQLSTATE[40001]: Deadlock found when trying to get lock") e
  // uma das duas sessões foi rejeitada com 500 mesmo com dados corretos dos dois
  // lados. criarAgendamento já reexecuta sozinho se a TiTa sinalizar deadlock (ver
  // client.ts), mas evitar a concorrência entre sessões do mesmo bundle reduz a
  // chance de o deadlock ocorrer.
  const inicioCriacao = Date.now()
  const criacoes: Array<{ sessao: typeof preparos[number]["sessao"]; resultado: Awaited<ReturnType<typeof criarAgendamento>>; resumo: ReturnType<typeof interpretarResultadoCriacao> }> = []
  for (const p of preparos) {
    const inicioChamada = Date.now()
    const resultado = await criarAgendamento(p.preparo.payload!)
    const resumo = interpretarResultadoCriacao(resultado)
    // Diagnóstico completo da operação, sem token: permite reconstruir o que
    // aconteceu com cada sessão sem precisar reler os logs brutos da TiTa.
    console.log(
      `${LOG_TAG} criacao`,
      JSON.stringify({
        csvGradeId: p.sessao.csvGradeId,
        id_grade_terapeuta: p.preparo.payload!.id_grade_terapeuta,
        ids_favorecidos: p.preparo.payload!.ids_favorecidos,
        id_agenda_fav: resumo.idAgendaFav,
        status: resumo.status,
        criadas: resumo.criadas,
        conflitos: resumo.conflitos,
        rejeitadas: resumo.rejeitadas,
        duracaoMs: Date.now() - inicioChamada,
      }),
    )
    criacoes.push({ sessao: p.sessao, resultado, resumo })
  }
  const resultados: ResultadoSessao[] = criacoes.map(c => ({
    csvGradeId: c.sessao.csvGradeId,
    ok: c.resultado.ok,
    codigoErro: c.resultado.ok ? undefined : `tita_erro_http_${c.resultado.status}`,
    mensagem: mensagemResumoCriacao(c.resumo),
    status: c.resumo.status,
    criadas: c.resumo.criadas,
    conflitos: c.resumo.conflitos,
    rejeitadas: c.resumo.rejeitadas,
    total: c.resumo.total,
    idAgendaFav: c.resumo.idAgendaFav,
  }))
  const falhasCriacao = resultados.filter(r => !r.ok)
  const ok = falhasCriacao.length === 0
  const agregado = criacoes.reduce(
    (acc, c) => ({
      criadas: acc.criadas + c.resumo.criadas,
      conflitos: acc.conflitos + c.resumo.conflitos,
      rejeitadas: acc.rejeitadas + c.resumo.rejeitadas,
      total: acc.total + c.resumo.total,
    }),
    { criadas: 0, conflitos: 0, rejeitadas: 0, total: 0 },
  )
  console.log(
    `${LOG_TAG} etapa=criacao ok=${resultados.length - falhasCriacao.length} falhas=${falhasCriacao.length} ` +
      `criadas=${agregado.criadas} conflitos=${agregado.conflitos} rejeitadas=${agregado.rejeitadas} duracaoMs=${Date.now() - inicioCriacao}`,
  )
  if (!ok) console.error(`${LOG_TAG} falha na chamada de criação — auditar`, JSON.stringify(resultados.map(r => ({ csvGradeId: r.csvGradeId, codigoErro: r.codigoErro }))))

  // Toda sessão, aceita ou não, com o resultado real da TiTa — inclusive quando
  // `ok` é falso e a tela não grava bundle nenhum, mas séries anteriores do mesmo
  // pacote já foram criadas lá.
  await registrarAuditoriaImplantacao({
    pac: body.pac,
    userId,
    userEmail,
    modalidade: body.modalidade,
    linhas: criacoes.map((c, i) => ({
      sessao: c.sessao,
      grade: preparos[i].preparo.grade,
      acao: acaoDaCriacao(c.resultado.ok, c.resumo),
      detalhe: resultados[i].codigoErro ?? (c.resumo.rejeitadas > 0 ? `${c.resumo.rejeitadas} ocorrência(s) rejeitada(s)` : null),
      resumo: c.resumo,
    })),
  })

  // A inclusão se anuncia ao cronograma.
  //
  // Antes disto, implantar uma terapia nova não avisava ninguém: o terapêutico
  // tinha de lembrar de preencher um formulário no ClickUp que gera o card da
  // lista PACIENTES, e é esse card que manda o setor de cronograma fazer os
  // trâmites junto ao convênio. Em 09/2026 alguém esqueceu e a sessão glosou.
  //
  // Só entram as sessões que a TiTa ACEITOU (success/partial_success). Uma
  // sessão que falhou não é terapia nova — gerar card para ela faria o
  // cronograma trabalhar sobre algo que não existe.
  //
  // `await` e não fire-and-forget: em serverless a resposta pode encerrar o
  // processo e matar a promessa pendente, e o depósito é uma escrita local e
  // barata (nenhuma chamada ao ClickUp acontece aqui — quem faz rede é o cron).
  // registrarInclusaoTerapia nunca lança: avisar não pode derrubar implantar.
  //
  // A grade sai de `preparos`, que a Fase 1 já leu — nenhuma consulta nova. Se
  // por algum motivo ela não estiver lá, a sessão é PULADA em vez de derrubar a
  // resposta: chegar aqui só é possível depois de a Fase 1 ter aprovado todas,
  // mas depender disso com um `!` faria uma mudança futura naquela fase virar
  // um 500 numa implantação que deu certo.
  const gradePorId = new Map(
    preparos
      .filter(p => p.preparo.grade != null)
      .map(p => [p.sessao.csvGradeId, p.preparo.grade!] as const),
  )

  const aceitas = criacoes
    .filter(c => c.resumo.status === "success" || c.resumo.status === "partial_success")
    .flatMap(c => {
      const grade = gradePorId.get(c.sessao.csvGradeId)
      if (!grade) return []
      return [{ csvGradeId: c.sessao.csvGradeId, grade, resumo: c.resumo }]
    })

  if (aceitas.length > 0) {
    await registrarInclusaoTerapia({
      pacienteNome: body.pac,
      entradas: aceitas,
      // Conta SLOTS do bundle, não ocorrências da série. `agregado.conflitos`
      // soma as ocorrências semanais de cada série até 31/12 — usá-lo aqui faria
      // o card anunciar dezenas de "sessões não implantadas" onde o cronograma
      // enxerga dois horários. A unidade do card é a mesma da tela: o slot.
      naoCriadas: criacoes.length - aceitas.length,
      userId,
      userEmail,
      modalidade: body.modalidade,
    })
  }

  console.log(`${LOG_TAG} fim pac=${body.pac} ok=${ok} duracaoTotalMs=${Date.now() - inicioTotal}`)
  return NextResponse.json({
    ok,
    etapa: "criacao",
    // Auditoria: quem de fato gravou na TiTa, capturado do usuário autenticado no
    // servidor (fonte confiável). O cliente carimba isso no bundle de forma imutável
    // (ver confirmarImplantacao) — separado de atualizado_por, que é sobrescrito a
    // cada sincronização e não serve para autoria.
    implantadoPor: userId,
    implantadoPorEmail: userEmail,
    mensagem: ok
      ? mensagemResumoCriacao({
          status: agregado.total === 0 ? "erro_api" : agregado.criadas === agregado.total ? "success" : agregado.criadas === 0 ? "failed" : "partial_success",
          ...agregado,
        })
      : mensagemAmigavel(falhasCriacao[0]?.codigoErro),
    resultados,
  })
}
