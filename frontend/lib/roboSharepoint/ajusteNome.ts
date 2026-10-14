// Selo "Ajustar nomenclatura" (decisão de 14/10/2026): uma pessoa pode marcar
// como entrega um arquivo cujo nome fere o padrão — a entrega vale —, mas a
// unidade carrega o aviso até o arquivo ser renomeado no SharePoint.
//
// De onde vem a decisão:
//   • evidência ligada a um arquivo lido pelo robô (sp_id): o que o banco
//     gravou em sp_pep_itens.padrao — enxerga também os repetidos e o
//     arquivo renomeado depois da entrega;
//   • evidência digitada à mão (sem sp_id): a mesma regra em TS sobre o nome
//     do arquivo no caminho (padraoNome.ts).

import { conferirNome, nomeDoArquivo } from './padraoNome'
import { MOTIVOS_PADRAO, nomeEsperado } from './rotulos'

export type AjusteNome = {
  /** Código do motivo (sp_pep_itens.padrao_motivo / lerNomePadrao().erro). */
  motivo: string
  /** O motivo em uma frase, para a tela. */
  texto: string
  /** O nome que o arquivo deveria ter. */
  nomeEsperado: string | null
}

export type ItemPadrao = { padrao?: string | null; padrao_motivo?: string | null; removido_em?: string | null }

export type ContextoAjuste = {
  sigla: string | null | undefined
  tipoRegistro: 'GERAL' | 'POR_PACIENTE' | null | undefined
  pacienteNome: string | null | undefined
  competencia: string | null | undefined
  /** Arquivos lidos pelo robô, por sp_id. */
  spPorId?: Map<string, ItemPadrao>
}

function montar(motivo: string, ctx: ContextoAjuste, sequencial: number): AjusteNome {
  return {
    motivo,
    texto: MOTIVOS_PADRAO[motivo] ?? 'Nome fora do padrão',
    nomeEsperado: nomeEsperado(ctx.sigla, ctx.tipoRegistro === 'GERAL' ? null : ctx.pacienteNome, ctx.competencia, sequencial),
  }
}

/**
 * O aviso de uma evidência, ou null quando o nome está certo (ou não há o que
 * conferir: caminho vazio, reprogramação, arquivo do robô ainda sem padrão).
 * `indice` é a posição da unidade (0 = 1ª): dá o número do nome esperado.
 */
export function ajusteDaEvidencia(
  ev: { caminho?: string | null; nome?: string | null; sp_id?: string | null },
  ctx: ContextoAjuste,
  indice = 0,
): AjusteNome | null {
  const sequencial = indice + 1
  if (ev.sp_id && ctx.spPorId?.has(ev.sp_id)) {
    const sp = ctx.spPorId.get(ev.sp_id)!
    if (sp.padrao === 'fora') return montar(sp.padrao_motivo ?? 'formato_desconhecido', ctx, sequencial)
    if (sp.padrao === 'duplicado') return montar('repetido', ctx, sequencial)
    return null
  }
  const nome = (ev.nome ?? '').trim() || nomeDoArquivo(ev.caminho)
  if (!nome) return null
  const r = conferirNome(nome, ctx.sigla, ctx.tipoRegistro, ctx.pacienteNome)
  return r.situacao === 'fora' ? montar(r.motivo, ctx, sequencial) : null
}

/** Quantas unidades de um registro carregam o aviso. */
export function contarAjustes(
  evidencias: { caminho?: string | null; nome?: string | null; sp_id?: string | null }[] | null | undefined,
  ctx: ContextoAjuste,
): number {
  return (evidencias ?? []).filter((ev, i) => (ev.caminho ?? '').trim() && ajusteDaEvidencia(ev, ctx, i)).length
}
