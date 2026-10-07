// O vocabulário do TiTa para "o que aconteceu com a sessão", em um só lugar.
//
// São as colunas "Status" (status_execucao) e "Justificativa" de
// csv_grade_profissionais. `Status` é o que decide se a sessão gera diária
// (PPD), bônus ETA e PA — ver `cancelado` em calculo.ts. `Justificativa` só
// alimenta a coluna de exibição "Presença TiTa" (ver relatorio.ts) — não move
// dinheiro, mas mostrar "presente" quem faltou é um erro de exibição sério.
//
// ─── A mudança de 24/08/2026, e a correção da correção ───────────────────────
//
// Confirmado pelo usuário em 25/08/2026, contra uma captura de tela da própria
// TiTa: `Status` PERMANECE "Cancelado" para sempre — não existe e nunca vai
// existir 'Não realizado' na coluna Status. O que muda é só `Justificativa`,
// que passa a ter, além das três antigas, estas três novas:
//
//   Justificativa (antiga, continua válida)     Justificativa (nova)
//   Falta do Paciente                           Não realizado — paciente
//   Falta do Profissional                       Não realizado — prestador
//   Falta de Ambos                              Não realizado — clínica
//
// NÃO é garantido que sejam a mesma coisa renomeada linha a linha — em
// particular 'Falta de Ambos' (paciente E profissional faltaram) e 'Não
// realizado — clínica' (a clínica é quem não realizou) descrevem situações
// diferentes, e as três novas podem conviver com as três antigas em vez de
// substituí-las 1 para 1. Por isso as REGRAS abaixo tratam "prestador",
// "clínica" e "ambos" como motivos DISTINTOS (compatível com o que
// `isFaltaDoPaciente` já fazia) em vez de forçar uma correspondência que
// ninguém confirmou.
//
// A primeira versão desta correção (mesmo dia, mais cedo) supôs o contrário —
// que 'Não realizado' pudesse aparecer em `Status` — e construiu a rede de
// segurança contra rótulo desconhecido observando ESSA coluna
// (rotulosDeExecucaoDesconhecidos/veredictoRotuloDesconhecido, abaixo). Como
// `Status` nunca varia, aquela rede nunca dispara: ela vigiava a coluna errada
// e ficou como reforço morto, não como proteção. A proteção que interessa —
// `justificativaDesconhecida`/`avisoJustificativaDesconhecida`, mais abaixo —
// vigia `Justificativa`, que é onde o vocabulário de fato mudou.
//
// A base histórica NÃO foi reescrita, então as duas gerações de Justificativa
// convivem para sempre e as duas continuam válidas. Medido em 2026-08-24 sobre
// as 187.079 linhas da tabela, todo o vocabulário já existente:
//
//   126.313  Status (null)              — execução ainda não capturada
//    22.824  Status Planejado/Pendente
//    16.984  Status Em Conflito
//    15.365  Status Realizado
//     5.000  Status Cancelado + Justificativa Falta do Paciente
//       355  Status Cancelado + Justificativa Falta do Profissional
//       238  Status Cancelado + Justificativa Falta de Ambos
//
// Duas consequências desse levantamento, das quais o resto do arquivo depende:
// o conjunto de rótulos de `Status` é fechado e pequeno, e 'Cancelado' nunca
// aparece sem justificativa (não existe linha em que o motivo seja mudo) — até
// 24/08/2026 nenhuma variação de Justificativa nova havia chegado à produção.
//
// ─── Por que um módulo próprio ────────────────────────────────────────────────
//
// Isto morava em formatacao.ts como um `includes("cancel")` de uma linha. Não é
// formatação: é a tradução entre o vocabulário de um sistema externo e as
// decisões de pagamento deste. Externo quer dizer que muda sem avisar — mudou
// em 24/08/2026 —, e o que muda sem avisar precisa de um lugar único, com o
// histórico à vista e testes próprios (ver rotulosExecucao.test.ts).

/** Rótulo comparável: sem acento, minúsculo, espaços colapsados, traço unificado.
 *
 * O traço não é detalhe: os rótulos novos usam travessão ("Não realizado —
 * paciente"), e quem digitar hífen simples quer dizer a mesma coisa. Os pontos
 * de código cobertos são de U+2010 a U+2015 (hífen tipográfico até barra
 * horizontal), o menos matemático (U+2212) e o hífen-menos comum.
 */
const normRotulo = (v: unknown): string =>
  String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‐-―−-]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()

/**
 * O que a coluna `Status` afirma sobre a sessão.
 *
 * "ausente" é vazio/NULL — a captura de execução ainda não alcançou a linha, o
 * que é normal em período recente (ver DIAS_EVOLUCAO_EM_TRANSITO em
 * gradeRemuneracao.ts). "desconhecido" cobre texto presente que este código
 * não sabe ler — mantido como reforço, mas hoje sem uso prático confirmado:
 * o levantamento de 2026-08-24/25 não achou (e o usuário confirmou que não
 * existe) nenhuma variação de `Status` além das cinco listadas acima. A
 * mudança real de vocabulário está em `Justificativa` — ver
 * `justificativaDesconhecida` mais abaixo, que é quem de fato vigia isso.
 */
export type ResultadoExecucao =
  | "realizado"
  | "nao_realizado"
  | "pendente"
  | "conflito"
  | "ausente"
  | "desconhecido"

export function classificarStatusExecucao(status: unknown): ResultadoExecucao {
  const s = normRotulo(status)
  if (!s) return "ausente"
  // "nao realizad*" antes de "realizado": o segundo é substring do primeiro, e a
  // ordem inversa classificaria toda sessão não realizada como realizada — o
  // erro mais caro que este arquivo pode cometer.
  if (s.includes("nao realizad")) return "nao_realizado"
  if (s.includes("cancel")) return "nao_realizado"
  if (s.includes("realizad")) return "realizado"
  if (s.includes("conflito")) return "conflito"
  if (s.includes("planejado") || s.includes("pendente")) return "pendente"
  return "desconhecido"
}

/**
 * A sessão não aconteceu, a julgar pelo texto que se dá a ela.
 *
 * Em uso real recebe sempre o `Status` (nunca a Justificativa — ver o
 * cabeçalho do arquivo), e ali o único texto que isto precisa reconhecer é
 * 'Cancelado'. Reconhece também 'Não realizado' por tolerância — não porque
 * essa variação tenha sido confirmada em `Status` (foi descartada), mas porque
 * não custa nada aceitar as duas caso o TiTa um dia prove o contrário.
 *
 * Mantém o nome histórico (`isCancelado`) de propósito: é o vocabulário do
 * resto do código e da própria tela, onde a classificação exibida é
 * "Cancelado". Trocar o nome renomearia o que aparece para o usuário, que é uma
 * decisão de produto e não desta correção.
 */
export const isCancelado = (v: unknown): boolean =>
  classificarStatusExecucao(v) === "nao_realizado"

/** De quem foi a ausência. "outro" = não aconteceu, motivo ilegível. */
export type MotivoNaoRealizado = "paciente" | "prestador" | "clinica" | "ambos" | "outro"

const NAO_REALIZADO = "nao realizad\\w*"
// Travessão já virou "-" em normRotulo; ":" e "(" entram por tolerância a
// variações de digitação que não mudam o sentido.
const LIGACAO = " ?[-:(] ?"

const motivoNovo = (alternativas: string) =>
  new RegExp(`${NAO_REALIZADO}${LIGACAO}(?:${alternativas})`)

// Uma linha por motivo: à esquerda o rótulo antigo (justificativa), à direita o
// novo. 'profissional'/'terapeuta' entram junto de 'prestador' porque as três
// palavras já apareceram para a mesma pessoa em telas diferentes deste sistema.
const REGRAS: Array<[MotivoNaoRealizado, RegExp[]]> = [
  ["paciente",  [/falta do paciente/,                        motivoNovo("paciente")]],
  ["prestador", [/falta do (profissional|prestador|terapeuta)/, motivoNovo("prestador|profissional|terapeuta")]],
  ["clinica",   [/falta da clinica/,                         motivoNovo("clinica")]],
  ["ambos",     [/falta de ambos/,                           motivoNovo("ambos")]],
]

/**
 * Quem faltou, lido de todos os textos que podem carregar o motivo.
 *
 * Recebe os pedaços (justificativa, status) e olha o conjunto. Na prática o
 * motivo mora sempre na `Justificativa` — `Status` é só 'Cancelado' — mas a
 * função não presume isso: aceita o texto em qualquer um dos pedaços, então
 * continua certa mesmo se um dia o TiTa inverter onde põe o quê.
 *
 * `null` significa "não é uma sessão não realizada". "outro" significa "não
 * aconteceu (`Status` = Cancelado), mas o motivo em `Justificativa` não bate
 * com nenhum dos 6 conhecidos" — o sinal de que o TiTa mudou o vocabulário de
 * novo. Ver `justificativaDesconhecida`, que transforma esse "outro" num
 * aviso visível em vez de um silêncio.
 */
export function motivoNaoRealizado(...partes: unknown[]): MotivoNaoRealizado | null {
  const s = normRotulo(partes.filter(p => p !== null && p !== undefined && p !== "").join(" "))
  if (!s) return null
  for (const [motivo, padroes] of REGRAS) {
    if (padroes.some(p => p.test(s))) return motivo
  }
  return partes.some(p => isCancelado(p)) ? "outro" : null
}

/**
 * Foi o PACIENTE quem não veio — o que define "Presença TiTa" na conferência
 * (ver presencaTita em relatorio.ts).
 *
 * Falta de prestador, da clínica ou de ambos não entra aqui, exatamente como
 * antes: o antecessor desta função comparava a justificativa com "falta do
 * paciente" e só com ela. 'Falta de Ambos' é o caso limítrofe — o paciente
 * também não veio —, e continua fora de propósito: mudar isso mexeria no que
 * 238 linhas históricas exibem, o que é decisão de produto, não desta correção.
 */
export const isFaltaDoPaciente = (...partes: unknown[]): boolean =>
  motivoNaoRealizado(...partes) === "paciente"

/**
 * Rótulos de `Status` que a grade trouxe e este código não sabe ler — únicos, na
 * ordem em que apareceram, no texto original (é o que a pessoa vai procurar na
 * TiTa e o que o time técnico precisa para ensinar o rótulo novo).
 *
 * Reforço, não a proteção principal: o vocabulário de `Status` está confirmado
 * fechado (`Cancelado`/`Realizado`/`Em Conflito`/`Planejado-Pendente`/vazio) e
 * não é onde o TiTa mudou nada em 24/08/2026 — quem mudou foi `Justificativa`
 * (ver `justificativaDesconhecida`, abaixo, que é a proteção que de fato
 * importa hoje). Isto fica como rede para o dia em que `Status` variar de
 * verdade — o que ainda não tem precedente. Ver avaliarCoberturaGrade em
 * gradeRemuneracao.ts e parseGradeCsv em uploadParsers.ts.
 */
export function rotulosDeExecucaoDesconhecidos(valores: Iterable<unknown>): string[] {
  const vistos = new Set<string>()
  const amostra: string[] = []
  for (const v of valores) {
    if (classificarStatusExecucao(v) !== "desconhecido") continue
    const texto = String(v ?? "").trim()
    const chave = normRotulo(texto)
    if (vistos.has(chave)) continue
    vistos.add(chave)
    amostra.push(texto)
  }
  return amostra
}

/**
 * O veredicto de reprovação por rótulo ilegível — estruturalmente compatível
 * com `VeredictoGrade` de gradeRemuneracao.ts (mesmo formato `{ ok, resumo,
 * erro, dica, quantidade }`), mas definido AQUI e não lá.
 *
 * O motivo de morar neste módulo, e não em gradeRemuneracao.ts, que é quem o
 * consome: esta é a única peça da guarda que faz JUÍZO DE VOCABULÁRIO — decidir
 * se o texto que veio é dos que este sistema entende. Isso é o assunto deste
 * arquivo. gradeRemuneracao.ts entra depois, só para decidir ONDE no pipeline de
 * reprovações esse juízo se encaixa (antes de tudo — ver o comentário de
 * avaliarCoberturaGrade). Separar assim também é o que torna a regra testável
 * sem arrastar para o teste as consultas ao Supabase que gradeRemuneracao.ts
 * carrega (@/lib/grade/fonte) — este arquivo não importa nada fora do próprio
 * domínio, de propósito.
 *
 * Só o texto muda por `contexto` ("pagamento" vs. "tratativas"), como no resto
 * das guardas de gradeRemuneracao.ts — a decisão de reprovar é a mesma.
 */
export type VeredictoRotuloGrade =
  | null
  | { ok: false; resumo: string; erro: string; dica: string; quantidade: number }

export function veredictoRotuloDesconhecido(
  grade: { rotulosDesconhecidos: string[]; linhasRotuloDesconhecido: number },
  contexto: "pagamento" | "tratativas" = "pagamento",
): VeredictoRotuloGrade {
  if (grade.linhasRotuloDesconhecido <= 0) return null

  const n = grade.linhasRotuloDesconhecido
  const lista = grade.rotulosDesconhecidos.map(r => `"${r}"`).join(", ")
  const dePagamento = contexto === "pagamento"

  return {
    ok: false,
    resumo: "Rótulo de execução desconhecido",
    quantidade: n,
    erro: `${n === 1 ? "Uma linha" : `${n} linhas`} do período ${n === 1 ? "traz" : "trazem"} na coluna `
      + `"Status" um rótulo que este sistema não sabe ler: ${lista}. `
      + "Sem entender o rótulo não se sabe se a sessão aconteceu, e "
      + (dePagamento
        ? "sessão não realizada tratada como realizada gera diária, bônus ETA e PA indevidos."
        : "a contagem de adesão sairia sobre sessões que talvez não tenham acontecido."),
    // Diz também o que NÃO resolve. As outras reprovações oferecem o CSV como
    // saída; aqui ele traz exatamente o mesmo rótulo, e mandar tentar por lá
    // seria empurrar a pessoa para o mesmo erro por um caminho mais longo.
    dica: "O TiTa mudou o vocabulário da coluna \"Status\", que até aqui só usava "
      + "Cancelado/Realizado/Em Conflito/Planejado-Pendente. Avise o time técnico: o rótulo novo precisa "
      + "ser ensinado em lib/remuneracao/rotulosExecucao.ts. Recarregar não resolve, e o CSV exportado da "
      + "TiTa traz o mesmo rótulo.",
  }
}

/**
 * A justificativa de uma sessão `Cancelado` que não bate com nenhum dos 6
 * motivos conhecidos (os 3 antigos e os 3 de 24/08/2026) — o texto original, ou
 * `null` quando a linha não se qualifica (não é `Cancelado`, ou a justificativa
 * está vazia, ou o motivo já é reconhecido).
 *
 * É AQUI que o TiTa de fato mudou o vocabulário em 24/08/2026 — não em
 * `Status` (ver o cabeçalho do arquivo). Diferente de rótulo desconhecido em
 * `Status`, isto não decide pagamento: `cancelado`/`isCancelado` já depende só
 * de `Status`, então uma justificativa ilegível não risca diária, ETA nem PA.
 * O que ela compromete é a coluna de exibição "Presença TiTa" — sem saber quem
 * faltou, `motivoNaoRealizado` devolve "outro" e presencaTita fica em branco
 * (correto, não afirma "Sim" para quem talvez tenha faltado) mas sem avisar
 * ninguém. Ver avisoJustificativaDesconhecida, que dá esse aviso.
 *
 * `justificativa` sem `status` não basta: uma linha `Realizado` pode ter
 * qualquer texto solto em `Justificativa` sem que isso seja sintoma de nada.
 */
export function justificativaDesconhecida(justificativa: unknown, status: unknown): string | null {
  if (!isCancelado(status)) return null
  const texto = String(justificativa ?? "").trim()
  if (!texto) return null
  return motivoNaoRealizado(justificativa, status) === "outro" ? texto : null
}

/**
 * Aviso (NÃO bloqueio) para quando `justificativaDesconhecida` encontrou algo.
 *
 * Estruturalmente é o texto de um `aviso` de VeredictoGrade — mas ao contrário
 * de `veredictoRotuloDesconhecido`, esta função nunca reprova a leitura da
 * grade. A diferença de severidade é proposital: rótulo desconhecido em
 * `Status` arrisca dinheiro (sessão não realizada paga como se tivesse
 * ocorrido) e por isso bloqueia; justificativa desconhecida não arrisca
 * dinheiro (ver o comentário de `justificativaDesconhecida`), só deixa uma
 * célula de exibição em branco — proporcional é avisar, não travar o
 * fechamento do mês por causa de uma coluna que ninguém vai pagar por ela.
 */
export function avisoJustificativaDesconhecida(quantidade: number, amostra: string[]): string | null {
  if (quantidade <= 0) return null
  const n = quantidade
  const lista = amostra.map(a => `"${a}"`).join(", ")
  return `${n === 1 ? "Uma sessão cancelada" : `${n} sessões canceladas`} do período ${n === 1 ? "tem" : "têm"} `
    + `uma Justificativa que o sistema não reconhece: ${lista}. "Presença TiTa" fica em branco para `
    + "essas linhas — não afeta o pagamento, que já depende só do Status \"Cancelado\". Avise o time "
    + "técnico: o motivo novo precisa ser ensinado em lib/remuneracao/rotulosExecucao.ts."
}
