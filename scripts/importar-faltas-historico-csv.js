#!/usr/bin/env node
// Backfill de faltas de Jan-Jun/2026 na tabela faltas_historico_csv, a partir
// do relatório externo "relatorio_faltas_detalhado" do Órbita (um CSV por mês).
//
// Contexto: csv_grades_profissionais tem origem='backup_xls' para Jan-Jun/2026
// (seed do backup XLS), e essas linhas nunca têm tita_agendamento_id — por
// isso a dedução de receita (que casa fila_autorizacoes por esse id) sempre dá
// zero nesse período. Esta tabela nova guarda o CSV do Órbita (que tem
// Presença Sim/Não por sessão) e resolve paciente_id + a sessão correspondente
// em csv_grades_profissionais, para a Edge Function snapshot-previsao-receitas
// poder deduzir corretamente também para Jan-Jun.
//
// Presença=Não sempre deduz, sem exceção de motivo (verificado contra produção:
// 20260908100200_falta_da_unidade_fora_da_assiduidade.sql linha 34-36 — a
// dedução real hoje ignora tipo_falta/motivo). tipo_falta/codigo_justificativa
// são gravados só como rótulo de auditoria (mesmo vocabulário de
// fila_autorizacoes), nunca usados pela Edge Function para decidir dedução.
//
// Uso:
//   node scripts/importar-faltas-historico-csv.js <arquivo.csv> --mes=2026-01
//   node scripts/importar-faltas-historico-csv.js <arquivo.csv> --mes=2026-01 --apply
//   node scripts/importar-faltas-historico-csv.js <arquivo.csv> --mes=2026-01 --apply --force
//
// DRY-RUN É O PADRÃO. Sem --apply nada é gravado: o script lê o CSV inteiro,
// resolve paciente e sessão, e imprime um relatório completo (motivos não
// mapeados, pacientes não resolvidos, sessões não casadas). Rode assim
// primeiro, sempre, e leia o relatório antes de --apply.
//
// O QUE ELE NÃO FAZ, DE PROPÓSITO:
//   - Não cria paciente novo. Nome sem match em public.pacientes só é reportado.
//   - Não escreve em csv_grades_profissionais nem fila_autorizacoes — é
//     insert-only em faltas_historico_csv.
//   - Não decide dedução: só grava presenca_bool e o match com a sessão; quem
//     decide dedução é a Edge Function, lendo presenca_bool.
//
// LGPD: o CSV traz nome de paciente e não deve ser versionado (*.csv já está
// no .gitignore) — apague do disco depois de concluído o backfill dos 6 meses.

const path = require("path")
const {
  lerEnv, descreverDestino, parsearArquivo, TABELA, TABELA_GRADE,
  contar, selecionarTudo, normalizarNomesLote, classificarMotivo, inserirLote,
} = require("./lib/faltas-historico-csv")

const LOTE = 500

async function main() {
  const args = process.argv.slice(2)
  const arquivo = args.find(a => !a.startsWith("--"))
  const aplicar = args.includes("--apply")
  const forcar  = args.includes("--force")
  const mesArg  = args.find(a => a.startsWith("--mes="))
  const mes     = mesArg ? mesArg.split("=")[1] : null

  if (!arquivo || !mes || !/^\d{4}-\d{2}$/.test(mes)) {
    console.error("Uso: node scripts/importar-faltas-historico-csv.js <arquivo.csv> --mes=2026-01 [--apply] [--force]")
    process.exit(1)
  }

  const nomeArquivo = path.basename(arquivo)
  console.log(`Lendo ${nomeArquivo} (competência ${mes})…`)

  const { linhas, stats } = parsearArquivo(arquivo)
  console.log("\nParse:")
  console.log(`  linhas de dados ........... ${stats.total}`)
  console.log(`  sem 10 colunas ............. ${stats.semColunasEsperadas}`)
  console.log(`  data inválida .............. ${stats.dataInvalida}`)
  console.log(`  presença fora de Sim/Não ... ${stats.presencaInvalida}`)
  console.log(`  válidas .................... ${linhas.length}`)

  const foraDoMes = linhas.filter(l => !l.data_agendamento.startsWith(mes))
  if (foraDoMes.length > 0) {
    console.log(`\n⚠  ${foraDoMes.length} linhas com data fora de ${mes} — provavelmente o mês errado no --mes. Abortando.`)
    process.exit(1)
  }

  const presencaSim = linhas.filter(l => l.presenca_bool).length
  const presencaNao = linhas.filter(l => !l.presenca_bool).length
  console.log(`\n  Presença=Sim ............... ${presencaSim}`)
  console.log(`  Presença=Não ............... ${presencaNao}`)

  const cfg = lerEnv()
  console.log(`\nDestino: ${descreverDestino(cfg)}`)

  // ─── Guarda de idempotência (antes de qualquer trabalho pesado) ────────────
  const inicio = `${mes}-01`
  const fim = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).toISOString().slice(0, 10)
  const jaImportado = await contar(cfg, TABELA, `data_agendamento=gte.${inicio}&data_agendamento=lte.${fim}`)
  if (jaImportado > 0 && !forcar) {
    console.error(
      `\nAbortando: já existem ${jaImportado} linhas em ${TABELA} para ${mes}.\n` +
      `Rodar de novo duplicaria o backfill. Use --force se a intenção é reimportar\n` +
      `(idealmente apague as linhas do mês manualmente antes, para não deixar lixo\n` +
      `de uma tentativa anterior misturado com a nova).`,
    )
    process.exit(1)
  }

  // ─── Classificação de motivo (poucos valores distintos — 1 RPC por valor) ──
  console.log("\nClassificando motivos…")
  const motivosDistintos = [...new Set(linhas.map(l => l.motivo_raw || ""))]
  const classificacaoPorMotivo = new Map()
  for (const motivo of motivosDistintos) {
    // presenca não entra na chave: quando presenca=true a classificação é
    // sempre null/null/true, então calculamos as duas variantes por motivo.
    const [comFalta, semFalta] = await Promise.all([
      classificarMotivo(cfg, motivo || null, false),
      classificarMotivo(cfg, motivo || null, true),
    ])
    classificacaoPorMotivo.set(motivo, { comFalta, semFalta })
  }

  const naoClassificados = new Map()
  for (const l of linhas) {
    const { comFalta, semFalta } = classificacaoPorMotivo.get(l.motivo_raw || "")
    const c = l.presenca_bool ? semFalta : comFalta
    l.tipo_falta = c.tipo_falta
    l.codigo_justificativa = c.codigo_justificativa
    l.motivo_classificado = c.motivo_classificado
    if (!l.presenca_bool && !c.motivo_classificado) {
      naoClassificados.set(l.motivo_raw || "(vazio)", (naoClassificados.get(l.motivo_raw || "(vazio)") || 0) + 1)
    }
  }

  console.log("\nDistribuição de tipo_falta (Presença=Não):")
  const porTipo = {}
  for (const l of linhas) if (!l.presenca_bool) porTipo[l.tipo_falta] = (porTipo[l.tipo_falta] || 0) + 1
  for (const [tipo, n] of Object.entries(porTipo)) console.log(`  ${tipo} .......... ${n}`)

  if (naoClassificados.size > 0) {
    console.log(`\nMotivos SEM classificação conhecida (tratados como 'paciente', informativo — NÃO bloqueia):`)
    for (const [motivo, n] of naoClassificados) console.log(`  "${motivo}" .... ${n}`)
  }

  // ─── Resolução de paciente_id por nome normalizado ─────────────────────────
  console.log("\nResolvendo pacientes por nome…")
  const nomesDistintos = [...new Set(linhas.map(l => l.paciente_nome_raw).filter(Boolean))]
  const normalizados = await normalizarNomesLote(cfg, nomesDistintos)

  // NOTA: csv_grades_profissionais.paciente_id é o ID EXTERNO da TiTa (ex:
  // 11511) — não é o mesmo namespace de pacientes.id_paciente (a PK interna,
  // ex: 11). A ponte é pacientes.tita_paciente_id. Medido contra produção:
  // casar por id_paciente dava 0 matches; por tita_paciente_id funciona.
  const pacientes = await selecionarTudo(cfg, "pacientes", "id_paciente,tita_paciente_id,nome,nome_normalizado", "nome_normalizado=not.is.null")
  const porNomeNormalizado = new Map()
  const ambiguos = new Set()
  for (const p of pacientes) {
    if (porNomeNormalizado.has(p.nome_normalizado)) ambiguos.add(p.nome_normalizado)
    else porNomeNormalizado.set(p.nome_normalizado, p)
  }

  let semPaciente = 0, comAmbiguidade = 0, semTitaId = 0
  const nomesNaoResolvidos = new Map()
  for (const l of linhas) {
    const normalizado = normalizados.get(l.paciente_nome_raw)
    l.paciente_nome_normalizado = normalizado || null
    l.paciente_id = null
    l.tita_paciente_id = null
    if (normalizado && ambiguos.has(normalizado)) {
      comAmbiguidade++
    } else if (normalizado && porNomeNormalizado.has(normalizado)) {
      const p = porNomeNormalizado.get(normalizado)
      l.paciente_id = p.id_paciente
      if (p.tita_paciente_id) l.tita_paciente_id = p.tita_paciente_id
      else semTitaId++
    } else {
      semPaciente++
      nomesNaoResolvidos.set(l.paciente_nome_raw, (nomesNaoResolvidos.get(l.paciente_nome_raw) || 0) + 1)
    }
  }
  console.log(`  resolvidos ................. ${linhas.length - semPaciente - comAmbiguidade}`)
  console.log(`  sem match .................. ${semPaciente}`)
  console.log(`  ambíguos (2+ pacientes) .... ${comAmbiguidade}`)
  console.log(`  sem tita_paciente_id ....... ${semTitaId} (resolvido em pacientes, mas sem ponte pra grade)`)
  if (nomesNaoResolvidos.size > 0) {
    console.log(`\n  Nomes sem match (top 15):`)
    ;[...nomesNaoResolvidos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
      .forEach(([nome, n]) => console.log(`    "${nome}" .... ${n}`))
  }

  // ─── Casamento com a sessão em csv_grades_profissionais ────────────────────
  // Chave (paciente, data, hora) sozinha não é suficiente: é comum o mesmo
  // paciente ter 2+ terapias marcadas no mesmo horário (ex. "Coordenador de
  // Caso" e "Aplicador ABA (SF)" às 09:20 do mesmo dia). Especialidade do CSV
  // casa com terapia_nome da grade quase sempre literalmente (mesma origem
  // TiTa) — normalizado só para tolerar diferença de caixa/espaço.
  const normTerapia = s => String(s || "").trim().toLowerCase().replace(/\s+/g, " ")

  // Medido nos dados reais (Jan/2026): paciente+data+hora+terapia ainda deixa
  // ~2.400 linhas ambíguas — mesmo paciente com 2 profissionais diferentes na
  // mesma terapia/horário (ex. troca de terapeuta no mês). Acrescentar
  // profissional_nome como critério resolve 99,7% desses casos. O punhado que
  // sobra (mesmo profissional 2x, duplicata genuína da grade — já documentada
  // em chaveNatural() de backup-grade.js) fica sem match mesmo: mais seguro
  // não decidir do que casar com a linha errada.
  console.log("\nCasando com sessões de csv_grades_profissionais (origem=backup_xls)…")
  const grade = await selecionarTudo(
    cfg, TABELA_GRADE, "id,paciente_id,data,hora_inicial,terapia_nome,profissional_nome",
    `origem=eq.backup_xls&data=gte.${inicio}&data=lte.${fim}&paciente_id=not.is.null`,
  )
  const porChaveCompleta = new Map()
  const porChaveSemProfissional = new Map()
  const porChaveSemTerapia = new Map()
  for (const g of grade) {
    const chaveCompleta = `${g.paciente_id}|${g.data}|${g.hora_inicial}|${normTerapia(g.terapia_nome)}|${normTerapia(g.profissional_nome)}`
    if (!porChaveCompleta.has(chaveCompleta)) porChaveCompleta.set(chaveCompleta, [])
    porChaveCompleta.get(chaveCompleta).push(g.id)

    const chaveSp = `${g.paciente_id}|${g.data}|${g.hora_inicial}|${normTerapia(g.terapia_nome)}`
    if (!porChaveSemProfissional.has(chaveSp)) porChaveSemProfissional.set(chaveSp, [])
    porChaveSemProfissional.get(chaveSp).push(g.id)

    const chaveSt = `${g.paciente_id}|${g.data}|${g.hora_inicial}`
    if (!porChaveSemTerapia.has(chaveSt)) porChaveSemTerapia.set(chaveSt, [])
    porChaveSemTerapia.get(chaveSt).push(g.id)
  }

  let casadosCompleto = 0, casadosSemProfissional = 0, casadosSemTerapia = 0
  let casadosZero = 0, casadosAmbiguo = 0, semPacienteParaCasar = 0
  for (const l of linhas) {
    if (!l.tita_paciente_id) { l.csv_grade_id = null; semPacienteParaCasar++; continue }

    const base = `${l.tita_paciente_id}|${l.data_agendamento}|${l.hora_inicial}`
    const chaveCompleta = `${base}|${normTerapia(l.especialidade_raw)}|${normTerapia(l.profissional_nome_raw)}`
    let cand = porChaveCompleta.get(chaveCompleta) || []
    if (cand.length === 1) { l.csv_grade_id = cand[0]; casadosCompleto++; continue }
    if (cand.length > 1) { l.csv_grade_id = null; casadosAmbiguo++; continue }

    // Zero com profissional no critério: especialidade pode ter batido mas o
    // nome do profissional estar grafado diferente entre Órbita e TiTa.
    const chaveSp = `${base}|${normTerapia(l.especialidade_raw)}`
    cand = porChaveSemProfissional.get(chaveSp) || []
    if (cand.length === 1) { l.csv_grade_id = cand[0]; casadosSemProfissional++; continue }
    if (cand.length > 1) { l.csv_grade_id = null; casadosAmbiguo++; continue }

    // Zero mesmo sem profissional: tenta só paciente+data+hora, só se único.
    cand = porChaveSemTerapia.get(base) || []
    if (cand.length === 1) { l.csv_grade_id = cand[0]; casadosSemTerapia++; continue }
    if (cand.length === 0) { l.csv_grade_id = null; casadosZero++; continue }
    l.csv_grade_id = null; casadosAmbiguo++
  }
  console.log(`  casados (paciente+data+hora+terapia+profissional) . ${casadosCompleto}`)
  console.log(`  casados (sem bater profissional) ................... ${casadosSemProfissional}`)
  console.log(`  casados (sem bater terapia) ......................... ${casadosSemTerapia}`)
  console.log(`  zero sessão candidata ............................... ${casadosZero}`)
  console.log(`  ambíguo (2+ sessões, mesmo com todos os critérios) .. ${casadosAmbiguo}`)
  console.log(`  sem paciente_id (não tentou) ......................... ${semPacienteParaCasar}`)

  const faltasSemMatch = linhas.filter(l => !l.presenca_bool && !l.csv_grade_id).length
  const faltasComMatch = linhas.filter(l => !l.presenca_bool && l.csv_grade_id).length
  console.log(`\nCobertura da dedução (só Presença=Não importa aqui):`)
  console.log(`  faltas casadas com sessão (vão deduzir) ...... ${faltasComMatch}`)
  console.log(`  faltas SEM sessão casada (não vão deduzir) ... ${faltasSemMatch}`)

  if (!aplicar) {
    console.log("\nDry-run — nada foi gravado. Revise o relatório acima e use --apply para importar.")
    return
  }

  console.log(`\nGravando ${linhas.length} linhas em faltas_historico_csv…`)
  const registros = linhas.map(l => ({
    arquivo_origem: nomeArquivo,
    linha_origem: l.linha_origem,
    data_agendamento: l.data_agendamento,
    hora_inicial: l.hora_inicial,
    paciente_nome_raw: l.paciente_nome_raw,
    profissional_nome_raw: l.profissional_nome_raw,
    especialidade_raw: l.especialidade_raw,
    motivo_raw: l.motivo_raw,
    justificativa_raw: l.justificativa_raw,
    profissional_substituto_raw: l.profissional_substituto_raw,
    presenca_raw: l.presenca_raw,
    mensagem_protocolo_raw: l.mensagem_protocolo_raw,
    presenca_bool: l.presenca_bool,
    paciente_id: l.paciente_id,
    paciente_nome_normalizado: l.paciente_nome_normalizado,
    csv_grade_id: l.csv_grade_id,
    tipo_falta: l.tipo_falta,
    codigo_justificativa: l.codigo_justificativa,
    motivo_classificado: l.motivo_classificado,
    observacao_classificacao: l.motivo_classificado ? null : "motivo não mapeado, tratado como falta de paciente por padrão",
  }))

  const totalLotes = Math.ceil(registros.length / LOTE)
  for (let i = 0; i < totalLotes; i++) {
    const lote = registros.slice(i * LOTE, (i + 1) * LOTE)
    try {
      await inserirLote(cfg, lote)
    } catch (e) {
      console.error(`\nFalhou no lote ${i} (linhas ${i * LOTE}–${i * LOTE + lote.length - 1}): ${e.message}`)
      console.error(`Algumas linhas do mês já foram gravadas. Investigue antes de rodar de novo (a chave natural evita duplicar o que já entrou).`)
      process.exit(1)
    }
    if ((i + 1) % 10 === 0 || i === totalLotes - 1) console.log(`  ${i + 1}/${totalLotes} lotes`)
  }

  console.log(`\nPronto. Linhas gravadas para ${mes}: ${await contar(cfg, TABELA, `data_agendamento=gte.${inicio}&data_agendamento=lte.${fim}`)}`)
}

main().catch(e => { console.error(e); process.exit(1) })
