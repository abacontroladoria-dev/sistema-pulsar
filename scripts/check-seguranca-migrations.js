#!/usr/bin/env node
// Segunda tranca de CI, ao lado de check-rls.js (que só pega tabela sem RLS).
// Varre as migrations A PARTIR de BASE e falha nos padrões que já vazaram dado
// neste projeto ou abrem porta sem ninguém perceber:
//
//   1. GRANT para anon (a chave pública está no JavaScript do site).
//   2. Função SECURITY DEFINER sem `set search_path` (sequestro de função).
//   3. VIEW sem `security_invoker` (a view passa por cima da RLS de quem lê).
//   4. Policy `using (true)` / `with check (true)` (RLS que não restringe nada;
//      foi o caso das 5 tabelas de 2026-07-23).
//   5. Função criada sem `revoke ... from public` no mesmo arquivo (função
//      nasce com EXECUTE para PUBLIC, e anon é PUBLIC).
//
// Exceção consciente: escreva `-- seguranca: <motivo>` na MESMA linha (ou na
// linha de cima) do trecho. O motivo fica no código para quem revisar.
//
// Migrations anteriores a BASE não são cobradas: o legado está mapeado em
// docs/SEGURANCA_DADOS_AGENDA.md e se corrige por migration nova.
//
//   node scripts/check-seguranca-migrations.js

const fs = require("fs")
const path = require("path")

const MIGRATIONS_DIR = path.join(__dirname, "..", "supabase", "migrations")
const BASE = "20261016000000"

const EXCECAO = /--\s*seguranca:/i

/** Linha (1-based) de um índice no texto. */
const linhaDe = (texto, i) => texto.slice(0, i).split("\n").length

function temExcecao(linhas, n) {
  return EXCECAO.test(linhas[n - 1] ?? "") || EXCECAO.test(linhas[n - 2] ?? "")
}

function semComentarios(sql) {
  // Troca comentários de linha por espaços do mesmo tamanho (as posições continuam valendo).
  return sql.replace(/--[^\n]*/g, m => " ".repeat(m.length))
}

function verificar(arquivo, sql) {
  const achados = []
  const linhas = sql.split("\n")
  const limpo = semComentarios(sql)
  const add = (i, regra) => {
    const n = linhaDe(limpo, i)
    if (!temExcecao(linhas, n)) achados.push({ arquivo, linha: n, regra })
  }

  for (const m of limpo.matchAll(/\bgrant\b[^;]*\bto\b[^;]*\banon\b[^;]*;/gi)) {
    add(m.index, "GRANT para anon")
  }

  for (const m of limpo.matchAll(/create\s+(?:or\s+replace\s+)?function\s+[^(]+\([^]*?\bas\s+\$[a-z_]*\$/gi)) {
    const cabecalho = m[0]
    if (/\bsecurity\s+definer\b/i.test(cabecalho) && !/\bset\s+search_path\b/i.test(cabecalho)) {
      add(m.index, "SECURITY DEFINER sem set search_path")
    }
  }

  for (const m of limpo.matchAll(/create\s+(?:or\s+replace\s+)?view\s+[\w."]+([^;]*?)\bas\b/gi)) {
    if (!/security_invoker/i.test(m[1])) add(m.index, "VIEW sem security_invoker")
  }

  for (const m of limpo.matchAll(/\b(using|with\s+check)\s*\(\s*\(?\s*true\s*\)?\s*\)/gi)) {
    add(m.index, `policy ${m[1].toLowerCase()} (true)`)
  }

  const funcoes = [...limpo.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:"?public"?\.)?"?(\w+)"?/gi)]
  for (const f of funcoes) {
    const nome = f[1]
    const revogada = new RegExp(`revoke\\s+all\\s+on\\s+function\\s+(?:public\\.)?${nome}\\b[^;]*from[^;]*\\bpublic\\b`, "i").test(limpo)
    if (!revogada) add(f.index, `função ${nome} sem "revoke all ... from public"`)
  }

  return achados
}

const arquivos = fs.readdirSync(MIGRATIONS_DIR)
  .filter(f => f.endsWith(".sql") && f.slice(0, 14) >= BASE)
  .sort()

const achados = arquivos.flatMap(f => verificar(f, fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8")))

if (achados.length) {
  console.error(`\n❌ ${achados.length} problema(s) de segurança em migrations a partir de ${BASE}:\n`)
  for (const a of achados) console.error(`  ${a.arquivo}:${a.linha}  ${a.regra}`)
  console.error('\nCorrija, ou marque a exceção consciente com "-- seguranca: <motivo>" na linha.\n')
  process.exit(1)
}
console.log(`✔ ${arquivos.length} migration(s) a partir de ${BASE} sem os padrões de risco.`)
