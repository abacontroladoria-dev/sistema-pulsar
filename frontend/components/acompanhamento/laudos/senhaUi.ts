// Como uma senha ASSIM aparece na tela: o texto do status e as cores. Um lugar
// só para o cartão e o modal nunca descreverem a mesma senha de dois jeitos.

import type { SenhaDoRol, StatusSenha } from "@/types/laudosAcompanhamento"

/** "2027-03-30" → "30/03/27". Compacto: a caixa do cartão tem ~110px. */
export function isoParaBrCurto(iso: string | null): string {
  if (!iso) return "—"
  const [ano, mes, dia] = iso.slice(0, 10).split("-")
  return `${dia}/${mes}/${ano.slice(2)}`
}

/** "2026-09-03T08:42" → "03/09/2026 08:42". */
export function dataHoraParaBr(iso: string | null): string {
  if (!iso) return "—"
  const [data, hora] = iso.split("T")
  const [ano, mes, dia] = data.split("-")
  return hora ? `${dia}/${mes}/${ano} ${hora.slice(0, 5)}` : `${dia}/${mes}/${ano}`
}

/**
 * O status de UMA senha em palavras, com a data quando ela existe.
 * `lado` muda só o "não se aplica": fora do ROL ele não é "outro convênio".
 */
export function textoStatusSenha(s: SenhaDoRol, lado: "dentro" | "fora" = "dentro"): string {
  switch (s.status) {
    case "vigente":
      return `Vigente até ${isoParaBrCurto(s.validade)}`
    case "vence_em_breve":
      if (s.dias === 0) return "Vence hoje"
      if (s.dias === 1) return "Vence amanhã"
      return `Vence em ${s.dias} dias`
    case "vencida":
      return `Vencida em ${isoParaBrCurto(s.validade)}`
    case "em_analise":
      return "Em análise"
    case "sem_validade":
      return "Sem validade"
    case "pendente":
      return lado === "fora" ? "Pendente fora do ROL" : "Pendente"
    case "laudo_antigo":
      return "No laudo antigo"
    case "sem_senha":
      return "Sem senha"
    case "nao_se_aplica":
      return lado === "fora" ? "Não se aplica" : "Outro convênio"
  }
}

/**
 * O status em UMA linha curta, para a caixa compacta (ROL + FORA na mesma
 * caixa, que precisa caber na altura da caixa padrão). A cor já diz o estado
 * ("Até 27/02/27" em verde = vigente); o texto completo vai no `title`.
 */
export function textoStatusSenhaCurto(s: SenhaDoRol, lado: "dentro" | "fora" = "dentro"): string {
  switch (s.status) {
    case "vigente":
      return `Até ${isoParaBrCurto(s.validade)}`
    case "vence_em_breve":
      return s.dias === 0 ? "Vence hoje" : `Vence ${isoParaBrCurto(s.validade)}`
    case "vencida":
      return "Vencida"
    case "em_analise":
      return "Em análise"
    case "sem_validade":
      return "Sem validade"
    case "pendente":
      return "Pendente"
    case "laudo_antigo":
      return "Laudo antigo"
    case "sem_senha":
      return "Sem senha"
    case "nao_se_aplica":
      return lado === "fora" ? "Não se aplica" : "Outro convênio"
  }
}

/**
 * Tamanho de letra para o nome do convênio caber na caixa SEM partir palavra
 * ("SULAMERIC / A" era o defeito). A caixa é um container (`@container`), e
 * `100cqi` é a largura dela: a letra é a largura dividida pela palavra mais
 * longa (em "em" de caixa alta negrito, ~0,74 por letra), entre 8px e 13px.
 * Nome curto fica em 13px; "ADMINISTRATIVO" encolhe o necessário para caber.
 */
export function fonteQueCabe(nome: string): string {
  const maiorPalavra = Math.max(1, ...nome.split(/\s+/).map((p) => p.length))
  const emPorLetra = 0.74
  return `max(8px, min(13px, calc(100cqi / ${(maiorPalavra * emPorLetra).toFixed(2)})))`
}

/**
 * Verde para vigente e vermelho para vencida (a mesma paleta de Vigente/Vencido
 * do laudo). Âmbar para o que pede atenção sem já ter vencido. Azul para a
 * senha no laudo antigo: existe, mas precisa ser vinculada ao atual — nem
 * "valendo" nem "falta". Apagado para o que não se aplica.
 */
export const TOM_SENHA: Record<StatusSenha, { cor: string; contorno: string }> = {
  vigente: {
    cor: "text-emerald-600 dark:text-emerald-400",
    contorno: "border-emerald-500/40 bg-emerald-500/5",
  },
  vence_em_breve: {
    cor: "text-amber-700 dark:text-amber-400",
    contorno: "border-amber-500/40 bg-amber-500/5",
  },
  vencida: {
    cor: "text-rose-600 dark:text-rose-400",
    contorno: "border-rose-500/40 bg-rose-500/5",
  },
  em_analise: {
    cor: "text-amber-700 dark:text-amber-400",
    contorno: "border-amber-500/40 bg-amber-500/5",
  },
  sem_validade: {
    cor: "text-amber-700 dark:text-amber-400",
    contorno: "border-amber-500/40 bg-amber-500/5",
  },
  pendente: {
    cor: "text-amber-700 dark:text-amber-400",
    contorno: "border-amber-500/40 bg-amber-500/5",
  },
  laudo_antigo: {
    cor: "text-sky-700 dark:text-sky-400",
    contorno: "border-sky-500/40 bg-sky-500/5",
  },
  sem_senha: {
    cor: "text-amber-700 dark:text-amber-400",
    contorno: "border-amber-500/40 bg-amber-500/5",
  },
  nao_se_aplica: {
    cor: "text-muted-foreground",
    contorno: "border-border bg-muted/20",
  },
}
