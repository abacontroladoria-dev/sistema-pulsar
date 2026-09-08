import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== 'production';

// ── connect-src do CSP, derivado do ambiente em vez de fixo ────────────────
//
// Antes esta lista era hardcoded com o host do Supabase de produção. O efeito
// colateral era que apontar o app para QUALQUER outro Supabase — em especial a
// stack local em 127.0.0.1:54321 — fazia o browser bloquear a chamada antes de
// ela sair da página. O sintoma é traiçoeiro: "Failed to fetch" no login sem
// nenhuma requisição aparecendo no devtools, porque o CSP corta antes da rede.
//
// Derivar do env garante que em produção o valor resolve para o mesmo host de
// sempre, e que testar contra o banco local passa a funcionar sem editar config.
function origensSupabase(): string[] {
  const urls = [
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ].filter((u): u is string => !!u && u.startsWith('http'));

  const origens = new Set<string>();
  for (const url of urls) {
    try {
      const { origin, protocol, host } = new URL(url);
      origens.add(origin);
      // Realtime usa websocket no mesmo host
      origens.add(`${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}`);
    } catch {
      // URL malformada no env: ignorar em vez de derrubar o build
    }
  }
  return [...origens];
}

const nextConfig: NextConfig = {
  output: 'standalone',
  trailingSlash: true,
  // 127.0.0.1 é tratado como origem distinta de localhost pelo Next 16: sem isso
  // os recursos de dev são bloqueados e a página nunca hidrata (o form cai para
  // submit nativo e o handler React nunca roda).
  allowedDevOrigins: ['192.168.0.241', '127.0.0.1'],
  typescript: {
    tsconfigPath: './tsconfig.json',

    // O type check NÃO roda dentro do build de produção — ele roda antes, no
    // `npm run typecheck` (ver package.json), e é lá que ele é obrigatório.
    //
    // Por que: o servidor do Coolify tem ~3,8 GB. O `next build` compila com
    // sucesso e SÓ ENTÃO roda o "Running TypeScript", que neste projeto usa
    // ~1,26 GB sozinho (2210 arquivos, 1,2 milhão de instanciações, 33s só de
    // checagem — medido com `tsc --extendedDiagnostics`). Somado ao que o
    // compilador ainda segura, isso estoura a RAM e o kernel mata o processo.
    //
    // O sintoma é traiçoeiro e foi o que derrubou o deploy de 08/09/2026: o
    // build imprime "✓ Compiled successfully", depois "Running TypeScript ...",
    // e morre em SILÊNCIO com exit 255 — sem nome de arquivo, sem linha, sem
    // mensagem. Parece erro de tipo e não é: erro de tipo real é impresso. O
    // que não imprime nada é OOM.
    //
    // ⚠️  A checagem não foi abandonada, foi movida. `npm run typecheck` roda o
    // mesmo tsconfig com os mesmos rigores; com "incremental": true ele leva ~5s
    // localmente. Rode-o antes de commitar — sem isso, um erro de tipo passa
    // direto para produção, porque aqui ninguém mais o pega.
    ignoreBuildErrors: true,
  },

  experimental: {
    // Reduz o pico de memória do webpack em troca de um build um pouco mais
    // lento. Documentado como baixo risco em docs/01-app/02-guides/memory-usage.
    // Não resolve sozinho o estouro acima (o webpack já passava; quem morria era
    // o type check), mas devolve folga no mesmo build de 3,8 GB.
    webpackMemoryOptimizations: true,
  },
  turbopack: { root: __dirname },

  // O hook webpack() que existia aqui foi removido: ele servia a um esquema de
  // importar arquivos de nina-api-oficial/ (projeto Vite irmão, do CRM Nina) que
  // nunca chegou a existir. Definia nove globais — __NINA_SUPABASE_URL__ e
  // companhia, mais import.meta.env.* — e nenhuma delas tinha uma única
  // referência no código; e tsconfig.json exclui `../nina-api-oficial` do
  // programa, então nada de lá é compilado. Sob Turbopack o hook não roda em dev
  // de todo modo.

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self'",
              [
                "connect-src 'self'",
                // Hosts do Supabase em uso, derivados do ambiente
                ...origensSupabase(),
                // Robô de autorização, servido NA MÁQUINA DA ATENDENTE.
                //
                // Precisa valer em produção, não só em dev: /solicitar consulta
                // http://127.0.0.1:3010/machine-id para saber se o robô está de
                // pé (lib/machine.ts) e desabilita o botão Autorizar quando a
                // chamada falha. Sem esta entrada o CSP corta a requisição antes
                // da rede, e a recepção inteira vê "Sistema Offline" com o robô
                // vivo e autorizando — foi o que aconteceu em 01/09/2026.
                //
                // O sintoma tem um atraso cruel: o CSP viaja no cabeçalho do
                // documento, então quem já estava com a página aberta continua
                // funcionando e só quebra ao recarregar. A quebra parece
                // espontânea e não coincide com o deploy que a causou.
                //
                // Liberar isto não expõe nada: connect-src autoriza o browser a
                // falar com um serviço no computador de quem acessa. Não abre
                // porta no servidor nem torna o robô alcançável de fora — cada
                // máquina só enxerga o próprio.
                'http://127.0.0.1:3010', 'http://localhost:3010',
                // Stack local do Supabase CLI — apenas em desenvolvimento
                ...(isDev
                  ? [
                      'http://127.0.0.1:54321', 'ws://127.0.0.1:54321',
                      'http://localhost:54321', 'ws://localhost:54321',
                    ]
                  : []),
              ].join(' '),
              "frame-ancestors 'none'",
            ].join('; '),
          },
          {
            key: 'Permissions-Policy',
            value: 'geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
          },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
        ],
      },
    ];
  },
};

export default nextConfig;
