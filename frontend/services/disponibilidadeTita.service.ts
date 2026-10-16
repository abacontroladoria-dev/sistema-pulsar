import { classificarDisponibilidade, janelaGradeTita } from "@/lib/disponibilidadeDaGradeTita"
import { hojeBrasilia } from "@/lib/disponibilidadeProfissional"
import {
  lerGradeTitaDeTodos, listarHabilitadasDeTodos, listarLocais, listarProfissionaisComTita, listarVersoesAtivasDeTodos,
} from "@/services/profissionalDisponibilidade.service"
import {
  aplicarLoteDisponibilidade, concluirImportacaoDisponibilidade, gravarPreviaDisponibilidade, lerImportacao, listarItensImportacao,
} from "@/services/titaImportacoes.service"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { CadastroTerapia } from "@/types/terapia"
import type { ImportacaoTita, ItemImportacaoTita } from "@/types/titaImportacao"

// "Gravar no Pulsar a disponibilidade do TiTa" para todos — usado pelo botão da
// lista de profissionais e pela página "Carregar do TiTa". Lê a cópia da grade
// do TiTa já sincronizada; nada vai para o TiTa.

const LOTE = 15

export type PreviaDisponibilidadeTita = {
  id: string
  /** Profissionais com algo a gravar (novos e alterados). */
  aGravar: number[]
  /** Alterados cuja versão vigente foi editada no Pulsar (o TiTa vai prevalecer). */
  editadasNoPulsar: number
  /** Nomes da grade do TiTa que ainda não estão no cadastro do Pulsar. */
  foraDoCadastro: string[]
}

/** Monta a prévia de todos e grava no banco (nada muda na disponibilidade). */
export async function prepararPreviaDisponibilidade(args: {
  vigenteDe?: string
  catalogo: Pick<CadastroTerapia, "id" | "nome" | "ativo">[]
  onPasso?: (texto: string) => void
  /** A rotina das 04:00 passa o cliente da service_role. */
  cliente?: SupabaseClient
}): Promise<PreviaDisponibilidadeTita> {
  const { cliente } = args
  const hoje = hojeBrasilia()
  const vigenteDe = args.vigenteDe ?? hoje
  const janela = janelaGradeTita(hoje)
  args.onPasso?.("Lendo a grade do TiTa das duas semanas…")
  const [grade, profissionais, versoes, habilitadas, locais] = await Promise.all([
    lerGradeTitaDeTodos(janela.de, janela.ate, cliente),
    listarProfissionaisComTita(cliente),
    listarVersoesAtivasDeTodos(cliente),
    listarHabilitadasDeTodos(cliente),
    listarLocais(cliente),
  ])
  args.onPasso?.("Comparando com a disponibilidade de cada profissional…")
  const porTita = new Map(profissionais.map(p => [p.tita_profissional_id, p]))
  const foraDoCadastro = [...grade.entries()]
    .filter(([titaId]) => !porTita.has(titaId))
    .map(([, g]) => g.nome)
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
  const itens = profissionais
    .filter(p => p.ativo)
    .map(p => classificarDisponibilidade({
      profissionalId: p.id,
      nome: p.nome,
      linhas: grade.get(p.tita_profissional_id)?.linhas ?? [],
      versoes: versoes.get(p.id) ?? [],
      vigenteDe,
      janela,
      habilitadas: habilitadas.get(p.id) ?? new Set(),
      catalogo: args.catalogo,
      locais,
    }))

  args.onPasso?.("Gravando a prévia…")
  const id = await gravarPreviaDisponibilidade({ vigenteDe, janela, vistos: grade.size, itens }, cliente)
  return {
    id,
    aGravar: itens.filter(i => i.tipo === "novo" || i.tipo === "alterado").map(i => i.profissional_id),
    editadasNoPulsar: itens.filter(i => i.tipo === "alterado" && i.etiquetas?.some(e => e.startsWith("Substitui a versão editada"))).length,
    foraDoCadastro,
  }
}

/** Grava a prévia em lotes e fecha a importação. */
export async function gravarDisponibilidadeTita(
  previa: PreviaDisponibilidadeTita,
  onProgresso?: (feitos: number, total: number) => void,
  cliente?: SupabaseClient,
): Promise<{ situacao: string; aplicados: number; erros: number }> {
  const lotes: number[][] = []
  for (let i = 0; i < previa.aGravar.length; i += LOTE) lotes.push(previa.aGravar.slice(i, i + LOTE))
  onProgresso?.(0, lotes.length)
  for (let i = 0; i < lotes.length; i++) {
    await aplicarLoteDisponibilidade(previa.id, lotes[i], cliente)
    onProgresso?.(i + 1, lotes.length)
  }
  return concluirImportacaoDisponibilidade(previa.id, cliente)
}

/** A importação e seus itens, relidos do banco (o que a tela mostra é o que ficou gravado). */
export async function lerImportacaoCompleta(id: string, cliente?: SupabaseClient): Promise<{ imp: ImportacaoTita; itens: ItemImportacaoTita[] }> {
  const [imp, itens] = await Promise.all([lerImportacao(id, cliente), listarItensImportacao(id, cliente)])
  return { imp, itens }
}
