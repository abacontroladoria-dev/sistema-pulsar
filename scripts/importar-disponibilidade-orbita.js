#!/usr/bin/env node
// Carga inicial da disponibilidade dos pacientes a partir do CSV da Órbita
// ("disponibilidades_AAAAMMDD_HHMMSS.csv"), para as tabelas da migration
// 20261005160000_pacientes_disponibilidade.sql.
//
// Uso:
//   node scripts/importar-disponibilidade-orbita.js <arquivo.csv>
//   node scripts/importar-disponibilidade-orbita.js <arquivo.csv> --apply
//
// DRY-RUN É O PADRÃO. Sem --apply nada é gravado: o script lê o CSV, resolve os
// pacientes e imprime o relatório (IDs sem paciente, janelas descartadas,
// parentescos remapeados, quantos têm CPF para usar o formulário). Leia o
// relatório antes de --apply.
//
// Cada linha do CSV vira a VERSÃO 1 do paciente, origem 'importacao_orbita',
// com criado_em = "Última Atualização" e o prazo do responsável = "Prazo Limite
// Edição" (no CSV de 05/10/2026 todos já vencidos — os pacientes chegam
// travados, como estavam na Órbita).
//
// IDEMPOTENTE: paciente que já tem qualquer versão é pulado, inclusive no prazo.
// Rodar de novo nunca sobrescreve um envio ou edição feitos depois da carga.
//
// O QUE ELE NÃO FAZ, DE PROPÓSITO:
//   - Não cria paciente. `ID Paciente` sem match em pacientes.tita_paciente_id
//     só é reportado.
//   - Não "arruma" horário: janela com fim <= início, ou 00:00–00:00, vira dia
//     vazio e entra no relatório. Horário fora da grade de sessões (inclusive
//     depois das 17:40) é gravado como veio.
//   - Não importa SÁBADO: a clínica deixou de oferecer o dia (05/10/2026). O
//     sábado do CSV é ignorado e só contado no relatório.
//
// LGPD: o CSV traz nome de responsável e não deve ser versionado (*.csv já está
// no .gitignore). Apague do disco depois da carga.

const fs = require("fs")
const path = require("path")
const { lerEnv, descreverDestino } = require("./lib/faltas-historico-csv")

const PARENTESCOS = [
  "Mãe", "Pai", "Madrasta", "Padrasto", "Avó", "Avô", "Irmã", "Irmão",
  "Tia", "Tio", "Tutor(a) legal", "Responsável legal", "Próprio paciente", "Outro",
]

const DIAS = [
  ["seg", "Seg"], ["ter", "Ter"], ["qua", "Qua"], ["qui", "Qui"], ["sex", "Sex"],
]

// Último horário que a clínica aceita (decisão do usuário, 05/10/2026). Janela
// que passa disso é gravada como veio e só entra no relatório.
const FIM_CLINICA = 17 * 60 + 40

// ─── Parsing ─────────────────────────────────────────────────────────────────

function lerCsv(arquivo) {
  const texto = fs.readFileSync(arquivo, "utf8").replace(/^﻿/, "")
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim() !== "")
  const cabecalho = linhas[0].split(";").map((c) => c.trim())
  return linhas.slice(1).map((l) => {
    const valores = l.split(";")
    return Object.fromEntries(cabecalho.map((c, i) => [c, (valores[i] ?? "").trim()]))
  })
}

const HORA = /^(\d{2}):(\d{2})$/
const minutos = (h) => {
  const m = HORA.exec(h || "")
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** Janela do CSV → {inicio, fim} | null, com o motivo do descarte. */
function janela(inicio, fim) {
  const vazio = (v) => !v || v === "—" || v === "-"
  if (vazio(inicio) && vazio(fim)) return { valor: null }
  if (inicio === "00:00" && fim === "00:00") return { valor: null, descarte: "00:00–00:00" }
  const a = minutos(inicio)
  const b = minutos(fim)
  if (a === null || b === null) return { valor: null, descarte: `formato inválido (${inicio}–${fim})` }
  if (b <= a) return { valor: null, descarte: `fim não é depois do início (${inicio}–${fim})` }
  return { valor: { inicio, fim } }
}

/** "28/11/2025 11:39" (horário de Brasília) → ISO com -03:00. */
function dataBr(texto) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(texto || "")
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00-03:00`
}

const semAcento = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "")

/**
 * Parentesco livre do CSV → lista fechada do banco.
 *
 * Primeiro tenta igualdade ignorando caixa ("mãe" → "Mãe"); depois ignorando
 * acento e o que não é letra ("Ma~e" → "Mãe"), mas só quando isso aponta para
 * UM item — "avo" sem acento pode ser Avó ou Avô, e chutar seria errar o
 * parentesco de alguém. O resto vira "Outro", com o texto original guardado em
 * `observacao` para não se perder.
 */
function normalizarParentesco(bruto) {
  const texto = (bruto || "").trim()
  if (!texto) return { valor: null }
  const exato = PARENTESCOS.find((p) => p.toLowerCase() === texto.toLowerCase())
  if (exato) return { valor: exato, remapeado: exato !== texto }
  const chave = (t) => semAcento(t).toLowerCase().replace(/[^a-z]/g, "")
  const candidatos = PARENTESCOS.filter((p) => chave(p) === chave(texto))
  if (candidatos.length === 1) return { valor: candidatos[0], remapeado: true }
  return { valor: "Outro", remapeado: true, observacao: `Parentesco no CSV da Órbita: "${texto}"` }
}

function converterLinha(l) {
  const descartes = []
  const versao = {
    frequenta_escola: null,
    escola_inicio: null,
    escola_fim: null,
  }

  const escola = janela(l["Escola Início"], l["Escola Fim"])
  if (escola.descarte) descartes.push(`Escola: ${escola.descarte}`)
  if (escola.valor) {
    versao.frequenta_escola = true
    versao.escola_inicio = escola.valor.inicio
    versao.escola_fim = escola.valor.fim
  }

  for (const [chave, rotulo] of DIAS) {
    const j = janela(l[`${rotulo} Início`], l[`${rotulo} Fim`])
    if (j.descarte) descartes.push(`${rotulo}: ${j.descarte}`)
    versao[`${chave}_inicio`] = j.valor ? j.valor.inicio : null
    versao[`${chave}_fim`] = j.valor ? j.valor.fim : null
  }

  const sabado = janela(l["Sab Início"], l["Sab Fim"]).valor
  const depoisDoFecho = DIAS.filter(([chave]) => versao[`${chave}_fim`] && minutos(versao[`${chave}_fim`]) > FIM_CLINICA).length

  const nome = (l["Responsável pelo Preenchimento das Informações"] || "").trim() || null
  const parentesco = normalizarParentesco(l["Parentesco"])

  return {
    titaId: Number(l["ID Paciente"]),
    tinhaSabado: !!sabado,
    diasDepoisDoFecho: depoisDoFecho,
    parentescoOriginal: (l["Parentesco"] || "").trim(),
    parentesco,
    descartes,
    criadoEm: dataBr(l["Última Atualização"]),
    prazo: dataBr(l["Prazo Limite Edição"]),
    versao: {
      ...versao,
      origem: "importacao_orbita",
      preenchido_por_nome: nome ? nome.slice(0, 120) : null,
      preenchido_por_parentesco: parentesco.valor,
      observacao: parentesco.observacao ?? null,
    },
  }
}

// ─── Supabase (REST, service_role) ───────────────────────────────────────────

async function rest(cfg, metodo, caminho, corpo, prefer) {
  const resposta = await fetch(`${cfg.url}/rest/v1/${caminho}`, {
    method: metodo,
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  const texto = await resposta.text()
  if (!resposta.ok) throw new Error(`${metodo} ${caminho.split("?")[0]} → HTTP ${resposta.status}: ${texto.slice(0, 400)}`)
  return texto ? JSON.parse(texto) : null
}

async function emLotes(lista, tamanho, fn) {
  const saida = []
  for (let i = 0; i < lista.length; i += tamanho) saida.push(...(await fn(lista.slice(i, i + tamanho))))
  return saida
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const arquivo = args.find((a) => !a.startsWith("--"))
  const aplicar = args.includes("--apply")

  if (!arquivo) {
    console.error("Uso: node scripts/importar-disponibilidade-orbita.js <arquivo.csv> [--apply]")
    process.exit(1)
  }

  console.log(`Lendo ${path.basename(arquivo)}…`)
  const linhas = lerCsv(arquivo).map(converterLinha)
  const invalidas = linhas.filter((l) => !Number.isInteger(l.titaId) || l.titaId <= 0 || !l.criadoEm)
  if (invalidas.length > 0) {
    console.error(`Abortando: ${invalidas.length} linha(s) sem ID Paciente ou sem "Última Atualização" válida.`)
    process.exit(1)
  }
  const ids = linhas.map((l) => l.titaId)
  if (new Set(ids).size !== ids.length) {
    console.error("Abortando: o CSV tem ID Paciente repetido. Cada paciente deve aparecer uma vez.")
    process.exit(1)
  }

  const cfg = lerEnv()
  console.log(`Destino: ${descreverDestino(cfg)}`)

  // Pacientes por tita_paciente_id
  const pacientes = await emLotes(ids, 100, (lote) =>
    rest(cfg, "GET", `pacientes?select=id_paciente,tita_paciente_id,cpf,ativo,ficticio&tita_paciente_id=in.(${lote.join(",")})`)
  )
  const porTita = new Map(pacientes.map((p) => [Number(p.tita_paciente_id), p]))

  const casadas = linhas.filter((l) => porTita.has(l.titaId))
  const semPaciente = linhas.filter((l) => !porTita.has(l.titaId))

  // Já importados / já com versão
  const idsPulsar = casadas.map((l) => porTita.get(l.titaId).id_paciente)
  let comVersao = new Set()
  try {
    const existentes = await emLotes(idsPulsar, 100, (lote) =>
      rest(cfg, "GET", `pacientes_disponibilidade_versoes?select=paciente_id&paciente_id=in.(${lote.join(",")})`)
    )
    comVersao = new Set(existentes.map((e) => Number(e.paciente_id)))
  } catch (e) {
    console.error(`\nNão consegui ler pacientes_disponibilidade_versoes: ${e.message}`)
    console.error("A migration 20261005160000_pacientes_disponibilidade.sql já foi aplicada?")
    // No dry-run, a migration ainda não aplicada não impede o relatório — só
    // impede saber quem já foi importado (ninguém, se a tabela não existe).
    if (aplicar) process.exit(1)
    console.error("Seguindo o DRY-RUN como se nenhum paciente tivesse disponibilidade ainda.")
  }

  const aImportar = casadas.filter((l) => !comVersao.has(porTita.get(l.titaId).id_paciente))

  // ─── Relatório ─────────────────────────────────────────────────────────────
  const cpfValido = (c) => (c || "").replace(/\D/g, "").length === 11
  const descartadas = linhas.filter((l) => l.descartes.length > 0)
  const remapeados = linhas.filter((l) => l.parentesco.remapeado)
  const semResponsavel = linhas.filter((l) => !l.versao.preenchido_por_nome)
  const inativos = casadas.filter((l) => !porTita.get(l.titaId).ativo || porTita.get(l.titaId).ficticio)
  const ativosComCpf = casadas.filter((l) => {
    const p = porTita.get(l.titaId)
    return p.ativo && !p.ficticio && cpfValido(p.cpf)
  })
  const ativosSemCpf = casadas.filter((l) => {
    const p = porTita.get(l.titaId)
    return p.ativo && !p.ficticio && !cpfValido(p.cpf)
  })
  const prazoAberto = aImportar.filter((l) => l.prazo && new Date(l.prazo).getTime() > Date.now())

  console.log("\n═══ Relatório ═══")
  console.log(`  linhas no CSV ........................ ${linhas.length}`)
  console.log(`  casadas com paciente (tita_id) ....... ${casadas.length}`)
  console.log(`  SEM paciente no Pulsar ............... ${semPaciente.length}${semPaciente.length ? `  → IDs: ${semPaciente.map((l) => l.titaId).join(", ")}` : ""}`)
  console.log(`  já têm disponibilidade (pulados) ..... ${comVersao.size}`)
  console.log(`  A IMPORTAR ........................... ${aImportar.length}`)
  console.log(`  pacientes inativos/fictícios casados . ${inativos.length} (importados mesmo assim — é histórico)`)
  console.log(`  ativos COM CPF válido (usam o link) .. ${ativosComCpf.length}`)
  console.log(`  ativos SEM CPF válido ................ ${ativosSemCpf.length} (o formulário não os encontra; completar CPF no cadastro)`)
  console.log(`  sem responsável identificado ......... ${semResponsavel.length}`)
  console.log(`  prazo do responsável ainda aberto .... ${prazoAberto.length}`)
  console.log(`  tinham SÁBADO (ignorado) ............. ${linhas.filter((l) => l.tinhaSabado).length}`)
  console.log(`  com dia passando das 17:40 ........... ${linhas.filter((l) => l.diasDepoisDoFecho > 0).length} (gravado como veio, aparece "fora da grade")`)

  if (descartadas.length) {
    console.log(`\n  Janelas descartadas (${descartadas.length} linha(s)):`)
    for (const l of descartadas) console.log(`    ID ${l.titaId}: ${l.descartes.join("; ")}`)
  }
  if (remapeados.length) {
    console.log(`\n  Parentescos remapeados (${remapeados.length}):`)
    const contagem = new Map()
    for (const l of remapeados) {
      const k = `"${l.parentescoOriginal}" → ${l.parentesco.valor}`
      contagem.set(k, (contagem.get(k) || 0) + 1)
    }
    for (const [k, n] of contagem) console.log(`    ${k}  (${n})`)
  }

  if (!aplicar) {
    console.log("\nDRY-RUN: nada foi gravado. Rode de novo com --apply para importar.")
    return
  }

  if (aImportar.length === 0) {
    console.log("\nNada a importar.")
    return
  }

  // ─── Gravação ──────────────────────────────────────────────────────────────
  // Prazo primeiro, com ignore-duplicates: se a gravação das versões falhar no
  // meio, rodar de novo encontra o prazo já lá (e não o sobrescreve), e nenhum
  // paciente importado fica com o formulário aberto por falta de prazo.
  console.log("\nGravando prazos…")
  await emLotes(aImportar, 200, async (lote) => {
    await rest(
      cfg,
      "POST",
      "pacientes_disponibilidade_prazo?on_conflict=paciente_id",
      lote.map((l) => ({ paciente_id: porTita.get(l.titaId).id_paciente, prazo_edicao_ate: l.prazo })),
      "resolution=ignore-duplicates,return=minimal"
    )
    return []
  })

  console.log("Gravando versões…")
  await emLotes(aImportar, 200, async (lote) => {
    await rest(
      cfg,
      "POST",
      "pacientes_disponibilidade_versoes",
      lote.map((l) => ({
        paciente_id: porTita.get(l.titaId).id_paciente,
        numero_versao: 0, // recalculado pelo trigger
        criado_em: l.criadoEm,
        ...l.versao,
      })),
      "return=minimal"
    )
    return []
  })

  const conferencia = await emLotes(aImportar.map((l) => porTita.get(l.titaId).id_paciente), 100, (lote) =>
    rest(cfg, "GET", `pacientes_disponibilidade_versoes?select=paciente_id&origem=eq.importacao_orbita&paciente_id=in.(${lote.join(",")})`)
  )
  console.log(`\nConferência: ${conferencia.length} de ${aImportar.length} versões importadas encontradas no banco.`)
  if (conferencia.length !== aImportar.length) process.exit(1)
}

module.exports = { lerCsv, converterLinha, normalizarParentesco }

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message || e)
    process.exit(1)
  })
}
