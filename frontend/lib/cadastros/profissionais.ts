import { normTxt } from "@/lib/cronograma/constants"
import { COR_NEUTRA, corDaTerapia } from "@/lib/cadastros/terapias"
import type { CadastroTerapia } from "@/types/terapia"
import type { Profissional, TerapiaDoProfissional } from "@/types/profissional"

// Lógica pura do Cadastro de Profissionais (sem React, sem Supabase).

/**
 * Junta as terapias habilitadas (catálogo) com as que a grade TiTa mostra para o
 * profissional. Ordem: a focal primeiro, depois as de mais horários na grade,
 * depois alfabética.
 */
export function terapiasDoProfissional(
  prof: Pick<Profissional, "terapia_focal_id">,
  habilitadasIds: number[],
  daGrade: { terapia: string; horarios: number }[],
  catalogoPorId: Map<number, CadastroTerapia>,
  indicePorNome: Map<string, CadastroTerapia>
): TerapiaDoProfissional[] {
  const porChave = new Map<string, TerapiaDoProfissional>()

  for (const id of habilitadasIds) {
    const t = catalogoPorId.get(id)
    if (!t) continue
    porChave.set(normTxt(t.nome), { nome: t.nome, cor: t.cor_hex, terapiaId: t.id, habilitada: true, horariosGrade: 0 })
  }

  for (const g of daGrade) {
    const chave = normTxt(g.terapia)
    const existente = porChave.get(chave)
    if (existente) {
      existente.horariosGrade += g.horarios
      continue
    }
    const doCatalogo = indicePorNome.get(chave)
    porChave.set(chave, {
      nome: doCatalogo?.nome ?? g.terapia,
      cor: corDaTerapia(g.terapia, indicePorNome),
      terapiaId: doCatalogo?.id ?? null,
      habilitada: false,
      horariosGrade: g.horarios,
    })
  }

  const focal = prof.terapia_focal_id
  return [...porChave.values()].sort((a, b) => {
    if (focal !== null) {
      if (a.terapiaId === focal && b.terapiaId !== focal) return -1
      if (b.terapiaId === focal && a.terapiaId !== focal) return 1
    }
    if (b.horariosGrade !== a.horariosGrade) return b.horariosGrade - a.horariosGrade
    return a.nome.localeCompare(b.nome, "pt-BR")
  })
}

/**
 * Cor do card: a terapia escolhida como focal; sem escolha (ou escolha que não
 * está mais entre as terapias do profissional), a primeira da ordem acima — a
 * de mais horários na grade. Sem terapia nenhuma, cinza neutro.
 */
export function corFocal(
  prof: Pick<Profissional, "terapia_focal_id">,
  terapias: TerapiaDoProfissional[]
): { cor: string; terapia: TerapiaDoProfissional | null } {
  const escolhida = prof.terapia_focal_id !== null
    ? terapias.find(t => t.terapiaId === prof.terapia_focal_id)
    : undefined
  const t = escolhida ?? terapias[0] ?? null
  return { cor: t?.cor ?? COR_NEUTRA, terapia: t }
}

/** "CRP 05/12345 · RJ" — o que couber dos três campos. */
export function registroCompleto(
  p: Pick<Profissional, "tipo_registro" | "codigo_registro" | "uf_registro">
): string | null {
  const partes = [[p.tipo_registro, p.codigo_registro].filter(Boolean).join(" "), p.uf_registro].filter(Boolean)
  return partes.length ? partes.join(" · ") : null
}

/** 21999998888 → (21) 99999-8888; 2133334444 → (21) 3333-4444. */
export function formatarCelular(digitos: string | null): string | null {
  if (!digitos) return null
  const d = digitos.replace(/\D/g, "")
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return d
}

/** Iniciais para o avatar: primeira e última palavra que não sejam "de/da/do/dos/das/e". */
export function iniciaisNome(nome: string): string {
  const palavras = nome.trim().split(/\s+/).filter(p => !/^(de|da|do|dos|das|e)$/i.test(p))
  if (!palavras.length) return "?"
  const primeira = palavras[0][0] ?? ""
  const ultima = palavras.length > 1 ? palavras[palavras.length - 1][0] ?? "" : ""
  return (primeira + ultima).toUpperCase()
}
