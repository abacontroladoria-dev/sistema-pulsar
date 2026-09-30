import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { temPermissao } from '@/lib/permissions/resolver'
import { carregarPermissoesEfetivas } from '@/lib/permissions/carregar'

// Ponte entre o painel /admin/robo-sharepoint e o container do robô.
//
// O robô NÃO tem endereço público: ele fica na rede interna do Docker no
// Coolify, e só este servidor (o Next, no mesmo servidor) fala com ele. O
// navegador nunca vê ROBO_PEP_URL nem ROBO_TRIGGER_SECRET — são variáveis de
// servidor, sem NEXT_PUBLIC_.
//
//   GET  → saúde do robô (de pé? executando? próxima execução? certificado?)
//   POST → "Executar agora"
//
// A permissão é conferida AQUI: o proxy.ts protege página, não /api.

const PERMISSAO = 'robo_sharepoint'
export const dynamic = 'force-dynamic'

async function autorizar() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }

  const { data: perfil } = await supabase.from('usuarios').select('role, nome, ativo').eq('id', user.id).maybeSingle()
  if (!perfil?.ativo) return { erro: NextResponse.json({ error: 'Usuário inativo' }, { status: 401 }) }

  const codigos = await carregarPermissoesEfetivas(supabase)
  if (!temPermissao((perfil.role as string) ?? '', codigos, PERMISSAO)) {
    return { erro: NextResponse.json({ error: 'Sem permissão para o robô SharePoint' }, { status: 403 }) }
  }
  return { nome: (perfil.nome as string | null) ?? 'Usuário', supabase }
}

function destino() {
  const url = process.env.ROBO_PEP_URL
  const segredo = process.env.ROBO_TRIGGER_SECRET
  if (!url || !segredo) return null
  return { url: url.replace(/\/+$/, ''), segredo }
}

const NAO_CONFIGURADO = NextResponse.json(
  { error: 'O robô não está configurado neste ambiente (ROBO_PEP_URL / ROBO_TRIGGER_SECRET).', configurado: false },
  { status: 503 },
)

export async function GET() {
  const a = await autorizar()
  if (a.erro) return a.erro
  const d = destino()
  if (!d) return NAO_CONFIGURADO

  try {
    const r = await fetch(`${d.url}/health`, { cache: 'no-store', signal: AbortSignal.timeout(4000) })
    const corpo = await r.json().catch(() => ({}))
    return NextResponse.json({ configurado: true, online: true, ...corpo }, { status: 200 })
  } catch {
    return NextResponse.json({ configurado: true, online: false }, { status: 200 })
  }
}

// Intervalo mínimo entre dois "Executar agora". Perto do dia de pagamento o
// botão vai ser usado de verdade; a trava impede que cliques repetidos (ou
// várias pessoas ao mesmo tempo) empilhem execuções. Execução sem novidade
// custa quase nada, mas não há motivo para rodar de novo em menos que isso.
const INTERVALO_MANUAL_MIN = Number(process.env.ROBO_INTERVALO_MANUAL_MIN ?? 5)

export async function POST() {
  const a = await autorizar()
  if (a.erro) return a.erro
  const d = destino()
  if (!d) return NAO_CONFIGURADO

  const { data: recente } = await a.supabase
    .from('sp_pep_execucoes')
    .select('status, iniciado_em')
    .order('iniciado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (recente?.status === 'executando') {
    return NextResponse.json({ error: 'O robô já está executando.' }, { status: 409 })
  }
  if (recente) {
    const passadosMin = (Date.now() - new Date(recente.iniciado_em as string).getTime()) / 60000
    if (passadosMin < INTERVALO_MANUAL_MIN) {
      const falta = Math.ceil(INTERVALO_MANUAL_MIN - passadosMin)
      return NextResponse.json(
        { error: `A última execução foi há menos de ${INTERVALO_MANUAL_MIN} min. Tente de novo em ${falta} min.` },
        { status: 429 },
      )
    }
  }

  try {
    const r = await fetch(`${d.url}/executar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-robo-segredo': d.segredo },
      body: JSON.stringify({ solicitado_por_nome: a.nome }),
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    const corpo = await r.json().catch(() => ({}))
    if (r.status === 409) {
      const motivo = corpo?.motivo === 'erro_fatal'
        ? 'O robô está parado por erro de configuração. Veja o log no Coolify.'
        : 'O robô já está executando.'
      return NextResponse.json({ error: motivo, motivo: corpo?.motivo }, { status: 409 })
    }
    if (!r.ok) return NextResponse.json({ error: `O robô recusou o pedido (HTTP ${r.status}).` }, { status: 502 })
    return NextResponse.json({ aceito: true }, { status: 202 })
  } catch {
    return NextResponse.json({ error: 'Não foi possível falar com o robô. Ele está de pé no Coolify?' }, { status: 502 })
  }
}
