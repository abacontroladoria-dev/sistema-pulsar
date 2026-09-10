import { NextResponse } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'

// Carimbo de versão do carrossel. Existe para a TV descobrir de 30 em 30s se algo
// mudou sem pagar o preço da rota irmã (/api/tv/avisos), que monta URL pública de
// cada imagem. Aqui são duas leituras triviais; lá é a lista inteira.
//
// A TV chama ISTO a cada ciclo e só chama a rota pesada quando o carimbo muda —
// ou seja, quando alguém realmente publicou. Foi o que trocou a espera de 5 min
// por ~30s sem multiplicar carga no banco.
//
// service_role pela mesma razão da irmã: /tv é rota pública (proxy.ts) e a RLS de
// `tv_avisos` só responde a `authenticated`.

export async function GET() {
  try {
    return await carimbo()
  } catch {
    // Ex.: SUPABASE_SERVICE_ROLE_KEY ausente. A TV trata como "não sei" e mantém
    // na tela o que já está lá — nunca troca o cartaz por causa de um erro aqui.
    return NextResponse.json(
      { error: 'Serviço indisponível' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}

async function carimbo() {
  // Duas perguntas, porque uma sozinha mente:
  //
  // - `max(atualizado_em)` pega publicação e edição, mas NÃO pega remoção:
  //   despublicar o aviso mais recente faz o máximo BAIXAR (ou nem mudar, se o
  //   removido não era o mais recente). Sozinho, deixaria um cartaz despublicado
  //   na parede da recepção até a próxima publicação.
  // - a contagem pega remoção, mas não pega troca de imagem.
  //
  // Juntas cobrem tudo o que a TV precisa enxergar.
  const [maisRecente, total] = await Promise.all([
    supabaseService
      .from('tv_avisos')
      .select('atualizado_em')
      .eq('ativo', true)
      .order('atualizado_em', { ascending: false })
      .limit(1),
    supabaseService
      .from('tv_avisos')
      .select('id', { count: 'exact', head: true })
      .eq('ativo', true),
  ])

  if (maisRecente.error || total.error) {
    return NextResponse.json(
      { error: 'Falha ao ler a versão dos avisos' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  // Nenhum aviso ativo é estado LEGÍTIMO (todos despublicados), e precisa de um
  // carimbo próprio e estável — distinto de erro, que não devolve carimbo nenhum.
  const atualizadoEm = maisRecente.data?.[0]?.atualizado_em ?? 'vazio'
  const versao = `${atualizadoEm}:${total.count ?? 0}`

  return NextResponse.json(
    { versao },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
