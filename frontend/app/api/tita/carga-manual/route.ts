import { after, NextResponse } from "next/server"
import { exigirPermissao, respostaDeAcessoRecusado } from "@/lib/permissions/exigirPermissao"
import { janelaImportacaoTita, janelaReleituraTita } from "@/lib/grade/janelaTita"
import { supabaseService } from "@/lib/supabase/service"
import { encerrarCargasAbandonadas, executarCargaTita } from "@/services/tita/cargaTita.server"

// Botão "Carregar o Pulsar segundo o TiTa" (Administração → Carregar do TiTa).
// Roda NO SERVIDOR, como a rotina das 04:00 (/api/tita/carga-diaria): responde
// na hora com o id da carga e roda as etapas depois, com after(). A página só
// acompanha a linha de tita_cargas — pode ser fechada sem interromper.
//
// Só LÊ o TiTa. Exige a permissão da página (carregar_tita).

export const dynamic = "force-dynamic"

const ETAPAS = ["pacientes", "profissionais", "disponibilidade", "agenda"] as const
type Etapa = (typeof ETAPAS)[number]

function negar(status: number, mensagem: string) {
  return NextResponse.json({ ok: false, mensagem }, { status })
}

export async function POST(req: Request) {
  let quem: { id: string | null; nome: string }
  try {
    const ctx = await exigirPermissao("carregar_tita")
    quem = { id: ctx.usuarioId, nome: ctx.usuarioNome }
  } catch (e) {
    const r = respostaDeAcessoRecusado(e)
    if (r) return r
    throw e
  }

  const corpo = (await req.json().catch(() => ({}))) as { inicio?: string; copiaCompleta?: boolean }
  const inicio: Etapa = ETAPAS.includes(corpo.inicio as Etapa) ? (corpo.inicio as Etapa) : "pacientes"

  const { data: corte } = await supabaseService.rpc("tita_cortado_em")
  if (corte) return negar(409, "O TiTa já foi desligado: não há mais o que carregar dele.")

  // Uma carga por vez (a das 04:00 ou a de outra pessoa). A que morreu no meio
  // é encerrada antes; a garantia final é o índice uq_tita_cargas_uma_rodando.
  await encerrarCargasAbandonadas(supabaseService)
  const jaRodando = async () => {
    const { data } = await supabaseService.from("tita_cargas").select("id").eq("situacao", "rodando").limit(1)
    return data?.[0]?.id as string | undefined
  }
  const emCurso = await jaRodando()
  if (emCurso) return NextResponse.json({ ok: false, id: emCurso, mensagem: "Já há uma carga rodando. Acompanhe por esta página." }, { status: 409 })

  const { data: carga, error } = await supabaseService
    .from("tita_cargas")
    .insert({ origem: "manual", pedida_por: quem.id, pedida_por_nome: quem.nome, passo: "Começando…", atualizado_em: new Date().toISOString() })
    .select("id")
    .single()
  if (error?.code === "23505") {
    // Outro clique ganhou a corrida entre a conferência acima e o insert.
    return NextResponse.json({ ok: false, id: await jaRodando(), mensagem: "Já há uma carga rodando. Acompanhe por esta página." }, { status: 409 })
  }
  if (error) {
    if (/column|schema cache/i.test(error.message)) {
      return negar(503, "Falta aplicar a configuração do banco desta tela (migration 20261023180000). Avise o time técnico.")
    }
    console.error("[carga-manual]", error.message)
    return negar(500, "Não foi possível registrar a carga.")
  }
  const id = (carga as { id: string }).id

  // Releitura ao vivo: de hoje até a primeira semana completa do mês seguinte;
  // com `copiaCompleta` (a cópia das 02:00 está velha), a janela inteira da agenda.
  const releitura = corpo.copiaCompleta ? janelaImportacaoTita() : janelaReleituraTita()
  const etapas = ETAPAS.slice(ETAPAS.indexOf(inicio))

  after(async () => {
    try {
      await executarCargaTita(supabaseService, "manual", { id, inicio, releitura: etapas.includes("agenda") ? releitura : undefined })
    } catch (e) {
      console.error("[carga-manual] falha inesperada:", e)
    }
  })
  return NextResponse.json({ ok: true, id }, { status: 202 })
}
