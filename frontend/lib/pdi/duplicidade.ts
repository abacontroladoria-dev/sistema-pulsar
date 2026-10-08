// Detecção de "cadastro duplicado no TiTa" para o Controle de Prazos do PDI.
//
// ─── ORIGEM DO PROBLEMA (caso real, 2026-09-04) ──────────────────────────────
//
// Na migração de dado da planilha "Controle_Prazos_PDI pronto 2.0" (ver
// APLICAR_pdi_controle_prazos_2026-09-04.sql), "Luiz Felipe Mariano" casou
// como AMBÍGUO: dois "ID Favorecido" distintos no TiTa — 12517 e 20945 —
// ambos com o nome completo "Luiz Felipe Mariano Vasconcelos". Ou seja, a
// TiTa tem DOIS cadastros de paciente com o mesmo nome, e não há como saber
// automaticamente qual dos dois é o "certo" para ligar ao dado manual da
// planilha. Aquele caso específico ficou de fora do INSERT da migração (não
// resolvido às cegas) — mas o problema de qualidade de dado que ele revelou
// (nome duplicado com IDs diferentes) pode acontecer com QUALQUER paciente, a
// qualquer momento, sem aviso. Este módulo generaliza a detecção para
// sinalizar isso na interface, em vez de descobrir cada caso na mão.
//
// ─── POR QUE HEURÍSTICA POR NOME, NÃO POR CPF ────────────────────────────────
//
// A duplicidade "de verdade" seria detectável por CPF (duas linhas com o
// mesmo CPF e IDs diferentes = certeza de duplicidade). Mas o relatório que
// `calcularElegibilidadePdi`/`juntarPdi` já leem (`orbita_laudos_relatorio`,
// via `buscarLaudosDoRelatorio()` — ver o cabeçalho de elegibilidade.ts) NÃO
// tem coluna de CPF de paciente (conferido: nenhuma chave do `LaudoRow`
// remotamente parece CPF, só há "Paciente", "ID Favorecido" etc. — ver
// types/cronograma.ts). Buscar CPF exigiria uma fonte nova (chamada de rede
// extra cara, ou outra tabela) só para esta função — fora do orçamento desta
// etapa. Por isso a heurística abaixo usa o que a rota JÁ tem em mãos: o
// NOME do paciente, normalizado (mesmo `normTxt` de lib/cronograma/constants.ts,
// que ignora acento/caixa/espaço duplicado) e com entidades HTML decodificadas
// (`decodeEntidadesHtml`, mesmo tratamento que o caso "D'Ávila" já usa em
// outro lugar do módulo cronograma — nomes vindos do TiTa às vezes chegam
// escapados, ex. "D&#039;avila").
//
// Regra: se o MESMO nome normalizado aparecer no relatório associado a MAIS
// DE UM "ID Favorecido" distinto, TODOS os IDs daquele nome são marcados como
// `cadastroDuplicadoTita`.
//
// ─── LIMITAÇÃO CONHECIDA — falso positivo aceitável ──────────────────────────
//
// Isto é uma heurística por NOME EXATO NORMALIZADO, não uma verificação de
// identidade (não usa CPF, data de nascimento, ou qualquer outro dado que
// distinga duas pessoas de fato). Dois pacientes DIFERENTES que por
// coincidência têm o nome completo idêntico (homônimos reais) vão disparar um
// falso positivo aqui — o alerta na tela vai dizer "cadastro duplicado" para
// duas pessoas que são, na verdade, duas pessoas distintas. Decisão
// consciente: é preferível alertar demais (o usuário confere e descarta o
// aviso) do que esconder um problema real de duplicidade — mesmo raciocínio
// de "melhor detectar um coordenador irregular a mais do que deixar passar um
// caso real" já aplicado em `coordenadorDoCaso` (lib/pdi/agenda.ts).

import type { LaudoRow } from "@/types/cronograma"
import { decodeEntidadesHtml, normTxt } from "@/lib/cronograma/constants"

/** Lê uma coluna do relatório, tolerando ausência/tipo — mesma convenção de `ler()` em elegibilidade.ts/juntar.ts. */
function ler(row: LaudoRow, ...chaves: string[]): string {
  for (const k of chaves) {
    const v = row[k]
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim()
  }
  return ""
}

function idFavorecidoDe(row: LaudoRow): number | null {
  const bruto = ler(row, "ID Favorecido", "Id Favorecido", "ID Paciente", "Id Paciente")
  return /^\d+$/.test(bruto) ? Number(bruto) : null
}

/**
 * Calcula, a partir das linhas do relatório Órbita, o conjunto de
 * "ID Favorecido" cujo nome normalizado aparece associado a mais de um ID
 * distinto no relatório — ver o cabeçalho deste arquivo para a heurística e
 * sua limitação conhecida (falso positivo em homônimos reais).
 */
export function calcularCadastroDuplicadoTita(rows: LaudoRow[]): Set<number> {
  const idsPorNome = new Map<string, Set<number>>()

  for (const row of rows) {
    const idFavorecido = idFavorecidoDe(row)
    if (idFavorecido === null) continue

    const nome = ler(row, "Paciente")
    if (!nome) continue

    const chave = normTxt(decodeEntidadesHtml(nome))
    if (!chave) continue

    const atual = idsPorNome.get(chave)
    if (atual) atual.add(idFavorecido)
    else idsPorNome.set(chave, new Set([idFavorecido]))
  }

  const duplicados = new Set<number>()
  for (const ids of idsPorNome.values()) {
    if (ids.size > 1) {
      for (const id of ids) duplicados.add(id)
    }
  }

  return duplicados
}
