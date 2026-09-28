// Gera a migration que alinha o catálogo de permissões do banco (public.permissoes)
// ao menu (lib/permissions/menu.ts). Criado em 29/09/2026, depois que o catálogo e
// o menu passaram meses divergindo sem ninguém perceber.
//
//   npm run permissoes:gerar-catalogo            → confere e, se houver diferença,
//                                                   escreve a migration em supabase/migrations
//   npm run permissoes:gerar-catalogo -- --check → só confere, não escreve nada
//
// Quando rodar: sempre que mexer em menu.ts (item novo, item removido, nome, grupo
// ou ordem). A tela /admin/permissoes mostra um aviso âmbar enquanto o banco estiver
// diferente do menu, então esquecer não passa despercebido.
//
// Por que não é automático no deploy: o banco exige a linha do código existir antes
// de alguém poder recebê-lo (FK de usuarios_permissoes), e migration neste projeto é
// aplicada à mão no SQL Editor.
//
// O banco é só LIDO (service_role do .env.local). Sem .env.local, gera a migration
// completa do mesmo jeito — ela é idempotente —, só não sabe o que remover.

import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const raiz = join(__dirname, '..')
const pastaMigrations = join(raiz, '..', 'supabase', 'migrations')
const soConferir = process.argv.includes('--check')

const { MENU_ITENS, MENU_ORDEM_ITEM } = await import(pathToFileURL(join(raiz, 'lib', 'permissions', 'menu.ts')).href)
const { CODIGO_PARA_ROTAS } = await import(pathToFileURL(join(raiz, 'lib', 'permissions', 'routes.ts')).href)

// Tudo dentro de main(): terminar com process.exit() enquanto a conexão do fetch
// ainda fecha derruba o Node no Windows ("Assertion failed ... UV_HANDLE_CLOSING").
async function main() {
const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)

// ─── o que o menu diz ───────────────────────────────────────────────────────
const alvo = MENU_ITENS.map((i) => ({
  codigo: i.codigo,
  nome: i.label,
  grupo: i.grupo,
  rota: (CODIGO_PARA_ROTAS[i.codigo] ?? [null])[0],
  ordem: MENU_ORDEM_ITEM[i.codigo],
}))
const semRota = alvo.filter((a) => !a.rota).map((a) => a.codigo)
if (semRota.length) {
  console.error(`✖ Item do menu sem rota em CODIGO_PARA_ROTAS (routes.ts): ${semRota.join(', ')}`)
  return 1
}

// ─── o que o banco tem (só leitura) ─────────────────────────────────────────
async function lerCatalogoDoBanco() {
  const arquivoEnv = join(raiz, '.env.local')
  if (!existsSync(arquivoEnv)) return null
  const env = Object.fromEntries(
    readFileSync(arquivoEnv, 'utf8')
      .split(/\r?\n/)
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => {
        const i = l.indexOf('=')
        return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
      })
  )
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL
  const chave = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !chave) return null
  const r = await fetch(`${url}/rest/v1/permissoes?select=codigo,nome,grupo,rota,ordem`, {
    headers: { apikey: chave, Authorization: `Bearer ${chave}` },
  })
  if (!r.ok) throw new Error(`Leitura do catálogo falhou: ${r.status} ${await r.text()}`)
  return r.json()
}

const banco = await lerCatalogoDoBanco()
let paraRemover = []

if (banco) {
  const porCodigo = Object.fromEntries(banco.map((p) => [p.codigo, p]))
  const codigosMenu = new Set(alvo.map((a) => a.codigo))
  const novos = alvo.filter((a) => !porCodigo[a.codigo])
  const removidos = banco.filter((p) => !codigosMenu.has(p.codigo))
  const alterados = alvo.filter((a) => {
    const b = porCodigo[a.codigo]
    return b && (b.nome !== a.nome || b.grupo !== a.grupo || b.rota !== a.rota || b.ordem !== a.ordem)
  })

  console.log(`Catálogo do banco: ${banco.length} · menu: ${alvo.length}`)
  for (const a of novos) console.log(`  + novo:      ${a.codigo} — "${a.nome}" (${a.grupo})`)
  for (const p of removidos) console.log(`  − sem menu:  ${p.codigo} — "${p.nome}"`)
  for (const a of alterados) {
    const b = porCodigo[a.codigo]
    const dif = ['nome', 'grupo', 'rota', 'ordem'].filter((k) => b[k] !== a[k]).map((k) => `${k}: "${b[k]}" → "${a[k]}"`)
    console.log(`  ~ alterado:  ${a.codigo} — ${dif.join('; ')}`)
  }

  if (!novos.length && !removidos.length && !alterados.length) {
    console.log('✔ Banco e menu estão iguais. Nada a gerar.')
    return 0
  }
  if (soConferir) return 1
  paraRemover = removidos.map((p) => p.codigo)
} else {
  console.log('(sem .env.local: não deu para ler o banco — gerando a migration completa, sem remoções)')
  if (soConferir) return 0
}

// ─── escreve a migration ────────────────────────────────────────────────────
const agora = new Date()
const pad = (n) => String(n).padStart(2, '0')
let carimbo = `${agora.getFullYear()}${pad(agora.getMonth() + 1)}${pad(agora.getDate())}${pad(agora.getHours())}${pad(agora.getMinutes())}00`
const existentes = new Set(readdirSync(pastaMigrations).map((f) => f.split('_')[0]))
while (existentes.has(carimbo)) carimbo = String(Number(carimbo) + 100) // nunca repete o prefixo

const valores = alvo
  .map((a) => `  (${q(a.codigo)}, ${q(a.nome)}, ${q(a.grupo)}, ${q(a.rota)}, ${a.ordem})`)
  .join(',\n')

const blocoRemocao = paraRemover.length
  ? `
-- 3. Códigos no banco que não têm mais item no menu. COMENTADO de propósito:
--    apagar um código apaga junto as concessões dele (FK ON DELETE CASCADE em
--    usuarios_permissoes). Confira que a tela saiu de verdade antes de descomentar.
-- UPDATE public.grupos_permissoes
-- SET modelo_permissoes = modelo_permissoes - ARRAY[${paraRemover.map(q).join(', ')}]::text[],
--     updated_at = now()
-- WHERE modelo_permissoes ?| ARRAY[${paraRemover.map(q).join(', ')}]::text[];
-- DELETE FROM public.permissoes WHERE codigo IN (${paraRemover.map(q).join(', ')});
`
  : ''

const sql = `-- Catálogo de permissões alinhado ao menu — GERADO por
-- frontend/scripts/gerar-catalogo-permissoes.mjs a partir de lib/permissions/menu.ts.
-- Não edite à mão: mude o menu e gere de novo.
--
-- Idempotente. Não muda o acesso de ninguém: só cadastra códigos novos e acerta
-- nome, grupo, rota e ordem. Um código NOVO nasce sem estar em grupo nenhum —
-- depois de aplicar, marque-o no modelo dos grupos que devem ter a tela
-- (/admin/permissoes → Por grupo).

-- 1. Códigos novos (os que já existem ficam como estão).
INSERT INTO public.permissoes (codigo, nome, grupo, rota, ordem)
SELECT v.codigo, v.nome, v.grupo, v.rota, v.ordem
FROM (VALUES
${valores}
) AS v(codigo, nome, grupo, rota, ordem)
ON CONFLICT (codigo) DO NOTHING;

-- 2. Nome, grupo, rota e ordem iguais ao menu.
UPDATE public.permissoes p
SET nome = v.nome, grupo = v.grupo, rota = v.rota, ordem = v.ordem
FROM (VALUES
${valores}
) AS v(codigo, nome, grupo, rota, ordem)
WHERE p.codigo = v.codigo;
${blocoRemocao}`

const arquivo = join(pastaMigrations, `${carimbo}_catalogo_permissoes_espelha_sidebar.sql`)
writeFileSync(arquivo, sql)
console.log(`✔ Migration gerada: supabase/migrations/${carimbo}_catalogo_permissoes_espelha_sidebar.sql`)
console.log('  Aplique no SQL Editor e recarregue /admin/permissoes — o aviso âmbar some.')
return 0
}

process.exitCode = await main()
