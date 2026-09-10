import { NextResponse } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'

// Avisos do carrossel da TV da recepção. Mesma razão de /api/tv/chamadas existir:
// /tv é rota pública (proxy.ts) e roda sem conta, mas a RLS de `tv_avisos` só
// responde a `authenticated` — o anon leria `[]`. A leitura acontece aqui, no
// servidor, com service_role.
//
// O BUCKET, ao contrário da tabela, é público em leitura: a URL da imagem
// precisa abrir direto no <img> da TV, sem sessão e sem expirar (ver
// 20260831150000). Por isso `getPublicUrl` e não `createSignedUrl` — assinada
// vence em 15 min e o quiosque fica dias sem recarregar.

const BUCKET = 'tv-avisos'

// Teto de sanidade. O carrossel é para alguns cartazes, não para uma galeria: a
// TV pré-carrega tudo o que vier, e 200 imagens de 10 MB derrubariam a tela que
// realmente importa (a chamada). Se um dia faltar, é decisão de produto, não
// número a subir no susto.
const LIMITE = 30

export async function GET() {
  try {
    return await listar()
  } catch {
    // Ex.: SUPABASE_SERVICE_ROLE_KEY ausente no ambiente. A TV cai no fallback
    // ("Atendimento em andamento") em vez de quebrar a tela.
    return NextResponse.json(
      { error: 'Serviço indisponível' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}

async function listar() {
  const { data, error } = await supabaseService
    .from('tv_avisos')
    .select('id, caminho')
    .eq('ativo', true)
    // Ordenação TOTAL: `ordem` empata com frequência (a UI reescreve o bloco em
    // setas, e dois avisos podem ficar com o mesmo valor por um instante). Sem
    // o desempate a TV trocaria a sequência sozinha entre dois polls, sem
    // ninguém ter mexido em nada.
    .order('ordem', { ascending: true })
    .order('criado_em', { ascending: true })
    .limit(LIMITE)

  if (error) {
    return NextResponse.json(
      { error: 'Falha ao ler os avisos' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  // Campo a campo, nunca `...a`: este endpoint é público, e `titulo` é rótulo
  // interno do marketing — não tem por que ser publicado. `caminho` também
  // fica de fora; o que a TV precisa é da URL pronta.
  const avisos = (data ?? []).map((a) => ({
    id: a.id as string,
    url: supabaseService.storage.from(BUCKET).getPublicUrl(a.caminho as string)
      .data.publicUrl,
  }))

  // `no-store` como em /api/tv/chamadas. O poll do carrossel já é lento (5 min);
  // cachear por cima disso só atrasaria a entrada de um aviso novo sem economizar
  // nada relevante — é uma consulta indexada, respondendo a UMA tela.
  return NextResponse.json(
    { avisos },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
