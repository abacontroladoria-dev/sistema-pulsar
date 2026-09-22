// Parsing do CSV "relatorio_faltas_detalhado" (Órbita) + acesso ao Supabase,
// usado por scripts/importar-faltas-historico-csv.js.
//
// Node puro, sem dependências — mesmo padrão de scripts/lib/backup-grade.js.

const fs   = require("fs")
const path = require("path")

const RAIZ      = path.join(__dirname, "..", "..")
const ENV_LOCAL = path.join(RAIZ, "frontend", ".env.local")

const TABELA = "faltas_historico_csv"
const TABELA_GRADE = "csv_grades_profissionais"

// ─── Env (idêntico a backup-grade.js: env var > frontend/.env.local) ───────────

function lerEnv() {
  let url = process.env.SUPABASE_URL || ""
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  let fonte = "variáveis de ambiente"

  if (!url || !key) {
    if (!fs.existsSync(ENV_LOCAL)) throw new Error(`Não encontrei ${ENV_LOCAL}`)
    const env = {}
    for (const linha of fs.readFileSync(ENV_LOCAL, "utf8").split(/\r?\n/)) {
      const m = linha.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
      if (!m) continue
      let valor = m[2].trim()
      if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
        valor = valor.slice(1, -1)
      }
      env[m[1]] = valor
    }
    url = url || env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || ""
    key = key || env.SUPABASE_SERVICE_ROLE_KEY || ""
    fonte = "frontend/.env.local"
  }

  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL ausente (env ou frontend/.env.local)")
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY ausente (env ou frontend/.env.local)")
  return { url: url.replace(/\/+$/, ""), key, fonte }
}

function descreverDestino(cfg) {
  const local = /127\.0\.0\.1|localhost/.test(cfg.url)
  const host  = cfg.url.replace(/^https?:\/\//, "").replace(/\/.*$/, "")
  return `${local ? "LOCAL" : "PRODUÇÃO"}  ${host}  (via ${cfg.fonte})`
}

// ─── Parsing do CSV ───────────────────────────────────────────────────────────
// Delimitador ';', sem aspas nos exemplos observados (mas o parser trata aspas
// por segurança, caso apareça texto livre com ';' dentro, ex. Justificativa).

const COLUNAS = [
  "data_agendamento", "hora_inicial", "paciente_nome", "profissional_nome",
  "especialidade", "motivo", "justificativa", "profissional_substituto",
  "presenca", "mensagem_protocolo",
]

function parsearLinhaCsv(linha) {
  const campos = []
  let atual = ""
  let dentroAspas = false
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i]
    if (c === '"') {
      if (dentroAspas && linha[i + 1] === '"') { atual += '"'; i++; }
      else dentroAspas = !dentroAspas
    } else if (c === ";" && !dentroAspas) {
      campos.push(atual); atual = ""
    } else {
      atual += c
    }
  }
  campos.push(atual)
  return campos
}

/** "05/01/2026" → "2026-01-05". Devolve null se não casar o formato. */
function dataParaIso(br) {
  const m = String(br).match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

/** "08:00" ou "08:00:00" → "08:00:00". */
function paraHora(s) {
  const m = String(s || "").match(/^(\d{1,2}):(\d{2})/)
  return m ? `${m[1].padStart(2, "0")}:${m[2]}:00` : null
}

/**
 * Lê o CSV e devolve as linhas parseadas (sem nenhuma resolução contra o
 * banco ainda — isso é feito à parte, em lote, por quem chama).
 */
function parsearArquivo(caminho) {
  const bruto = fs.readFileSync(caminho, "utf8").replace(/^﻿/, "")
  const linhasBrutas = bruto.split(/\r?\n/).filter(l => l.trim() !== "")
  const [cabecalho, ...resto] = linhasBrutas

  const linhas = []
  const stats = { total: 0, semColunasEsperadas: 0, dataInvalida: 0, presencaInvalida: 0 }

  resto.forEach((linhaTexto, idx) => {
    stats.total++
    const campos = parsearLinhaCsv(linhaTexto)
    if (campos.length !== COLUNAS.length) { stats.semColunasEsperadas++; return }

    const raw = {}
    COLUNAS.forEach((nome, i) => { raw[nome] = campos[i].trim() })

    const data = dataParaIso(raw.data_agendamento)
    if (!data) { stats.dataInvalida++; return }

    const hora = paraHora(raw.hora_inicial)

    let presencaBool
    if (raw.presenca === "Sim") presencaBool = true
    else if (raw.presenca === "Não" || raw.presenca === "Nao") presencaBool = false
    else { stats.presencaInvalida++; return }

    linhas.push({
      linha_origem: idx + 2, // +2: 1-based e pula o cabeçalho
      data_agendamento: data,
      hora_inicial: hora,
      paciente_nome_raw: raw.paciente_nome || null,
      profissional_nome_raw: raw.profissional_nome || null,
      especialidade_raw: raw.especialidade || null,
      motivo_raw: raw.motivo || null,
      justificativa_raw: raw.justificativa || null,
      profissional_substituto_raw: raw.profissional_substituto || null,
      presenca_raw: raw.presenca,
      mensagem_protocolo_raw: raw.mensagem_protocolo || null,
      presenca_bool: presencaBool,
    })
  })

  return { linhas, stats, cabecalho }
}

// ─── PostgREST ────────────────────────────────────────────────────────────────

function cabecalhos({ key }, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra }
}

async function comRetentativa(rotulo, fn, tentativas = 4) {
  let ultimoErro
  for (let i = 1; i <= tentativas; i++) {
    try {
      return await fn()
    } catch (e) {
      ultimoErro = e
      if (e.naoRetentar || i === tentativas) throw e
      const espera = 500 * 2 ** (i - 1)
      console.log(`  ${rotulo}: ${e.message.slice(0, 60)} — tentativa ${i + 1}/${tentativas} em ${espera}ms`)
      await new Promise(r => setTimeout(r, espera))
    }
  }
  throw ultimoErro
}

async function contar(cfg, tabela, filtro) {
  const r = await fetch(`${cfg.url}/rest/v1/${tabela}?select=id&${filtro}`, {
    method: "HEAD",
    headers: cabecalhos(cfg, { Prefer: "count=exact", Range: "0-0" }),
  })
  if (!r.ok && r.status !== 206 && r.status !== 200) {
    throw new Error(`HTTP ${r.status} ao contar ${tabela}: ${(await r.text()).slice(0, 300)}`)
  }
  return Number((r.headers.get("content-range") || "").split("/")[1] || 0)
}

/** Pagina o SELECT inteiro (PostgREST devolve no máximo 1000 linhas por chamada). */
async function selecionarTudo(cfg, tabela, campos, filtro, pagina = 1000) {
  const out = []
  for (let de = 0; ; de += pagina) {
    const qs = filtro ? `&${filtro}` : ""
    const r = await fetch(`${cfg.url}/rest/v1/${tabela}?select=${campos}${qs}`, {
      headers: cabecalhos(cfg, { Range: `${de}-${de + pagina - 1}`, "Range-Unit": "items" }),
    })
    if (!r.ok && r.status !== 206) {
      throw new Error(`HTTP ${r.status} ao selecionar ${tabela}: ${(await r.text()).slice(0, 300)}`)
    }
    const lote = await r.json()
    out.push(...lote)
    if (lote.length < pagina) return out
  }
}

/**
 * Normaliza uma lista de nomes em lote via RPC (público.normalizar_nomes_paciente_lote),
 * nunca reimplementando a lógica de normalização em JS.
 */
async function normalizarNomesLote(cfg, nomes, bloco = 300) {
  const mapa = new Map()
  for (let i = 0; i < nomes.length; i += bloco) {
    const fatia = nomes.slice(i, i + bloco)
    const r = await comRetentativa("rpc normalizar", () => fetch(
      `${cfg.url}/rest/v1/rpc/normalizar_nomes_paciente_lote`,
      {
        method: "POST",
        headers: cabecalhos(cfg, { "Content-Type": "application/json" }),
        body: JSON.stringify({ p_nomes: fatia }),
      },
    ).then(async res => {
      if (!res.ok) {
        const e = new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
        if (res.status < 500) e.naoRetentar = true
        throw e
      }
      return res.json()
    }))
    for (const { nome_raw, nome_normalizado } of r) mapa.set(nome_raw, nome_normalizado)
  }
  return mapa
}

/** Classifica um único motivo via RPC (poucos valores distintos — sem custo de lote). */
async function classificarMotivo(cfg, motivo, presenca) {
  const r = await fetch(`${cfg.url}/rest/v1/rpc/classificar_falta_historico_csv`, {
    method: "POST",
    headers: cabecalhos(cfg, { "Content-Type": "application/json" }),
    body: JSON.stringify({ p_motivo: motivo, p_presenca: presenca }),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status} ao classificar motivo: ${(await r.text()).slice(0, 300)}`)
  const [linha] = await r.json()
  return linha
}

// on_conflict = colunas da chave natural (uq_faltas_historico_csv_natural).
// resolution=ignore-duplicates: o CSV de origem tem duplicata byte-idêntica
// legítima (medido: mesmo padrão de scripts/lib/backup-grade.js, "13 grupos
// duplicados, 12 pares byte-idênticos" no backup da grade) — sem isto, uma
// linha repetida na fonte derruba o lote inteiro em vez de só ser ignorada.
const ON_CONFLICT = "paciente_nome_normalizado,data_agendamento,hora_inicial,especialidade_raw"

async function inserirLote(cfg, lote) {
  return comRetentativa("insert", async () => {
    const r = await fetch(`${cfg.url}/rest/v1/${TABELA}?on_conflict=${ON_CONFLICT}`, {
      method: "POST",
      headers: cabecalhos(cfg, { "Content-Type": "application/json", Prefer: "return=minimal,resolution=ignore-duplicates" }),
      body: JSON.stringify(lote),
    })
    if (!r.ok) {
      const e = new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 400)}`)
      if (r.status < 500 && r.status !== 429) e.naoRetentar = true
      throw e
    }
  })
}

module.exports = {
  RAIZ, TABELA, TABELA_GRADE,
  lerEnv, descreverDestino, parsearArquivo,
  contar, selecionarTudo, normalizarNomesLote, classificarMotivo, inserirLote,
  comRetentativa, cabecalhos,
}
