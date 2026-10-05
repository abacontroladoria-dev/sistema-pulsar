import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { abaPadraoLiberada, isSuperRole, podeAcessarRota } from '@/lib/permissions/resolver'
import { carregarPermissoesEfetivas } from '@/lib/permissions/carregar'

export async function proxy(request: NextRequest) {
  let response = NextResponse.next()

  const clientIp = getClientIp(request)
  const pathname = request.nextUrl.pathname

  // Rate limit: 5 login attempts per 15 minutes per IP
  if (pathname === '/login' && request.method === 'POST') {
    const rateLimitKey = `login:${clientIp}`
    if (checkRateLimit(rateLimitKey, 5, 15 * 60 * 1000)) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again in 15 minutes.' },
        { status: 429 }
      )
    }
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Rotas públicas
  // `/ficha-escolar` é o formulário que o responsável preenche pelo link do
  // WhatsApp — sem conta e sem token por paciente. Ele não lê nem escreve pelo
  // client Supabase: fala com /api/ficha-escolar/*, que valida do lado do
  // servidor (busca com piso de 3 letras e teto de 5 resultados, envio conferido
  // pela data de nascimento). Ver os comentários naqueles handlers.
  // `/disponibilidade-paciente` segue o mesmo desenho (busca pelo CPF da criança,
  // nome mascarado, envio reconferido pela RPC). Ver /api/disponibilidade-paciente/*.
  const publicRoutes = ['/login', '/definir-senha', '/auth/callback', '/disponibilidade-terapeuta/login', '/disponibilidade-terapeuta', '/sem-permissao', '/tv', '/ficha-escolar', '/disponibilidade-paciente']

  const isPublicRoute = publicRoutes.some(
    (route) => pathname === route || pathname.startsWith(route + '/')
  )

  if (!user && !isPublicRoute) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user && pathname === '/login') {
    // Verifica se ainda precisa configurar antes de enviar ao dashboard
    const { data: p } = await supabase
      .from('usuarios')
      .select('primeiro_acesso, username, ativo')
      .eq('id', user.id)
      .maybeSingle()

    if (!p || !p.ativo) {
      await supabase.auth.signOut()
      return NextResponse.redirect(new URL('/login', request.url))
    }
    if (p.primeiro_acesso === true || !p.username) {
      return NextResponse.redirect(new URL('/definir-senha', request.url))
    }
    return NextResponse.redirect(new URL('/', request.url))
  }

  // Para rotas públicas ou usuários não logados, não verificar perfil
  if (!user || isPublicRoute) {
    return response
  }

  let { data: perfil, error: perfilError } = await supabase
    .from('usuarios')
    .select('role, ativo, primeiro_acesso, username')
    .eq('id', user.id)
    .maybeSingle()

  if (!perfil && user.email) {
    const { data: fallback } = await supabase
      .from('usuarios')
      .select('role, ativo, primeiro_acesso, username')
      .eq('email', user.email)
      .maybeSingle()
    perfil = fallback
  }

  if (!perfil?.ativo) {
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const precisaConfigurar = perfil?.primeiro_acesso === true || !perfil?.username
  if (precisaConfigurar && pathname !== '/definir-senha') {
    return NextResponse.redirect(new URL('/definir-senha', request.url))
  }

  const role = perfil?.role ?? ''

  // Admin acessa tudo — decidido dentro de `podeAcessarRota`, não aqui. Este
  // retorno antecipado existia solto e o Sidebar não o tinha: era a divergência
  // que escondia do admin o item cuja rota este mesmo gate liberava.
  if (isSuperRole(role)) {
    return response
  }

  // Telas efetivas calculadas pelo banco (grupos ao vivo + ajustes individuais) —
  // o mesmo carregador do Sidebar e das rotas de API. O matcher deste proxy exclui
  // /api, então route handler checa por conta própria, pela mesma função.
  const codigos = await carregarPermissoesEfetivas(supabase)

  // /auditoria-assim sem ?tab= não bate com código nenhum (cada aba tem o seu).
  // Leva à primeira aba liberada em vez de negar o endereço inteiro.
  const abaPadrao = abaPadraoLiberada(role, codigos, pathname, request.nextUrl.search)
  if (abaPadrao) {
    return NextResponse.redirect(new URL(abaPadrao, request.url))
  }

  // `podeAcessarRota` é a mesma função que o Sidebar usa para decidir se mostra o
  // item — inclusive a comparação de rota+querystring, necessária para as
  // permissões por aba (ex: /cronograma/indicadores?tab=previsao-receitas).
  const hasAccess = podeAcessarRota(role, codigos, pathname, request.nextUrl.search)

  if (!hasAccess) {
    return NextResponse.redirect(new URL('/sem-permissao', request.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!api|_next|favicon|logo|icon|manifest|.+\\..+$).*)'],
}
