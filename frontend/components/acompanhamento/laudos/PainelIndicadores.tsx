"use client"

import { useState, type ReactNode } from "react"
import {
  CalendarX,
  ClockAlert,
  FileCheck2,
  FileClock,
  FileX,
  Hourglass,
  KeyRound,
  Layers,
  Link2,
  MailCheck,
  MailWarning,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  ShieldX,
  X,
} from "lucide-react"
import { foco } from "@/components/cadastros/pacientes/ui/campos"
import { BarraEmpilhada, Legenda, num } from "@/components/cronograma/remuneracao/visaoGeral/pecas"
import {
  RECORTE_LABEL,
  RECORTE_SENHA_LABEL,
  type RecorteLaudo,
  type RecorteSenha,
} from "@/lib/laudos/filtros"
import type { ConveniosDaSenha } from "@/lib/laudos/convenio"

// Os indicadores da tela: DOIS painéis lado a lado, "Laudo" e "Senhas" —
// decisão do usuário (28/09/2026). Até ali só existia o do laudo, e a senha era
// uma lista suspensa sem número; 118 pacientes ASSIM sem senha não apareciam em
// lugar nenhum. O painel da senha cobre ASSIM e LEVE e o nome segue o filtro
// "Convênio" (29/09/2026): "Senhas ASSIM", "Senhas LEVE" ou "Senhas ASSIM e LEVE".
//
//   • Cada painel É o filtro da sua dimensão (mesma regra de antes: o número que
//     motiva o filtro é o próprio botão — clicar filtra, clicar de novo desfaz).
//   • Os dois se COMBINAM: a lista é a interseção, e cada painel conta pelo
//     recorte do OUTRO (`contarKpis`/`contarKpisSenha`). "Vencidos sem aviso" +
//     "Sem senha" responde, em dois cliques, "quem está com as duas pendências".
//   • A `FaixaRecortes` diz o que está combinado e quantos laudos sobraram — com
//     dois painéis se afetando, sem ela o número de um card mudar pareceria erro.
//   • No celular os painéis viram abas: empilhados, a lista começaria duas telas
//     abaixo, e a tela mobile é a das atendentes. A faixa fica sempre à vista.
//
// Dentro de cada painel, dois níveis, com desenho diferente de propósito:
// VISÃO GERAL (cartões pastel, grandes, "como estamos?") e FILA DE AÇÃO
// (compactos, neutros em repouso, na ordem de urgência, "o que fazer agora?").

/** Um card: a chave do recorte que ele escreve, e o desenho. */
type CardInfo<R extends string> = {
  recorte: R
  rotulo: string
  icone: typeof FileClock
  /** Texto/ícone. */
  tom: string
  /** Moldura em repouso e selecionada. */
  base: string
  ativo: string
}

// ─── Paleta ─────────────────────────────────────────────────────────────────
// Pastel na visão geral (a família -50/-950 de "estado, não alarme"); neutro com
// cor só ao selecionar na fila de ação. As mesmas cores do laudo servem à senha:
// verde = valendo, rosa = vencido, âmbar = pede ação.

const PASTEL = {
  neutro: {
    tom: "text-slate-600 dark:text-slate-300",
    base: "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40",
    ativo: "border-slate-400 bg-slate-100 ring-1 ring-slate-400/30 dark:border-slate-600 dark:bg-slate-800/60",
  },
  verde: {
    tom: "text-emerald-600 dark:text-emerald-400",
    base: "border-emerald-100 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30",
    ativo: "border-emerald-400 bg-emerald-100 ring-1 ring-emerald-400/30 dark:border-emerald-700 dark:bg-emerald-900/40",
  },
  rosa: {
    tom: "text-rose-600 dark:text-rose-400",
    base: "border-rose-100 bg-rose-50 dark:border-rose-900/60 dark:bg-rose-950/30",
    ativo: "border-rose-400 bg-rose-100 ring-1 ring-rose-400/30 dark:border-rose-700 dark:bg-rose-900/40",
  },
  // O mesmo assunto de `rosa`, um grau pior: texto e moldura mais fortes, fundo
  // um tom acima — "Vencidos há mais de 6 meses" ao lado de "Vencidos".
  rosaForte: {
    tom: "text-rose-800 dark:text-rose-300",
    base: "border-rose-200 bg-rose-100/70 dark:border-rose-800/70 dark:bg-rose-950/50",
    ativo: "border-rose-500 bg-rose-200/70 ring-1 ring-rose-500/30 dark:border-rose-600 dark:bg-rose-900/60",
  },
  ambar: {
    tom: "text-amber-600 dark:text-amber-400",
    base: "border-amber-100 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30",
    ativo: "border-amber-400 bg-amber-100 ring-1 ring-amber-400/30 dark:border-amber-700 dark:bg-amber-900/40",
  },
  azul: {
    tom: "text-sky-600 dark:text-sky-400",
    base: "border-sky-100 bg-sky-50 dark:border-sky-900/60 dark:bg-sky-950/30",
    ativo: "border-sky-400 bg-sky-100 ring-1 ring-sky-400/30 dark:border-sky-700 dark:bg-sky-900/40",
  },
}

const NEUTRO = "border-border bg-card"

const LAUDO_GERAL: CardInfo<RecorteLaudo>[] = [
  { recorte: "todos", rotulo: RECORTE_LABEL.todos, icone: Layers, ...PASTEL.neutro },
  { recorte: "vigentes", rotulo: RECORTE_LABEL.vigentes, icone: FileCheck2, ...PASTEL.verde },
  { recorte: "vencidos", rotulo: RECORTE_LABEL.vencidos, icone: FileClock, ...PASTEL.rosa },
  { recorte: "vencidos_ha_muito", rotulo: RECORTE_LABEL.vencidos_ha_muito, icone: FileX, ...PASTEL.rosaForte },
]

/** Na ordem de urgência: a fila do dia primeiro, o que já foi tratado por último. */
const LAUDO_ACAO: CardInfo<RecorteLaudo>[] = [
  {
    recorte: "vencidos_sem_aviso",
    rotulo: RECORTE_LABEL.vencidos_sem_aviso,
    icone: MailWarning,
    tom: "text-amber-600 dark:text-amber-400",
    base: NEUTRO,
    ativo: "border-amber-500 bg-amber-500/5",
  },
  {
    recorte: "proximo_vencimento",
    rotulo: RECORTE_LABEL.proximo_vencimento,
    icone: ClockAlert,
    tom: "text-amber-600 dark:text-amber-400",
    base: NEUTRO,
    ativo: "border-amber-500 bg-amber-500/5",
  },
  {
    recorte: "avisados_vigentes",
    rotulo: RECORTE_LABEL.avisados_vigentes,
    icone: MailCheck,
    tom: "text-sky-600 dark:text-sky-400",
    base: NEUTRO,
    ativo: "border-sky-500 bg-sky-500/5",
  },
  {
    recorte: "avisados_vencidos",
    rotulo: RECORTE_LABEL.avisados_vencidos,
    icone: MailCheck,
    tom: "text-rose-500 dark:text-rose-400",
    base: NEUTRO,
    ativo: "border-rose-400 bg-rose-500/5",
  },
]

const SENHA_GERAL: CardInfo<RecorteSenha>[] = [
  { recorte: "vigente", rotulo: RECORTE_SENHA_LABEL.vigente, icone: ShieldCheck, ...PASTEL.verde },
  { recorte: "vencida", rotulo: RECORTE_SENHA_LABEL.vencida, icone: ShieldX, ...PASTEL.rosa },
  // Azul: a senha existe, só está no laudo anterior — nem "valendo" nem "falta".
  { recorte: "laudo_antigo", rotulo: RECORTE_SENHA_LABEL.laudo_antigo, icone: Link2, ...PASTEL.azul },
  { recorte: "sem_senha", rotulo: RECORTE_SENHA_LABEL.sem_senha, icone: ShieldOff, ...PASTEL.ambar },
]

/** Na ordem de urgência: o que impede atendimento primeiro. */
const SENHA_ACAO: CardInfo<RecorteSenha>[] = [
  {
    recorte: "pendente",
    rotulo: RECORTE_SENHA_LABEL.pendente,
    icone: ShieldAlert,
    tom: "text-amber-600 dark:text-amber-400",
    base: NEUTRO,
    ativo: "border-amber-500 bg-amber-500/5",
  },
  {
    recorte: "vence_em_breve",
    rotulo: RECORTE_SENHA_LABEL.vence_em_breve,
    icone: ClockAlert,
    tom: "text-amber-600 dark:text-amber-400",
    base: NEUTRO,
    ativo: "border-amber-500 bg-amber-500/5",
  },
  {
    recorte: "sem_validade",
    rotulo: RECORTE_SENHA_LABEL.sem_validade,
    icone: CalendarX,
    tom: "text-slate-600 dark:text-slate-300",
    base: NEUTRO,
    ativo: "border-slate-400 bg-slate-500/5",
  },
  {
    recorte: "em_analise",
    rotulo: RECORTE_SENHA_LABEL.em_analise,
    icone: Hourglass,
    tom: "text-sky-600 dark:text-sky-400",
    base: NEUTRO,
    ativo: "border-sky-500 bg-sky-500/5",
  },
]

/** O que cada card de senha quer dizer — no `title`, para quem passa o mouse. */
function explicaSenha(r: RecorteSenha, convenios: ConveniosDaSenha): string {
  const EXPLICA: Record<RecorteSenha, string> = {
    todos: "",
    vigente: "Senha válida hoje, dentro e (quando se aplica) fora do ROL",
    vencida: "A validade da senha já passou",
    laudo_antigo:
      "O relatório tem senha do paciente, mas no laudo anterior — falta vincular ao laudo atual",
    sem_senha: `Laudo ${convenios} sem nenhuma autorização do paciente no relatório`,
    pendente: "Precisa de senha (ex.: especialidade fora do ROL) e o relatório não traz",
    vence_em_breve: "Ainda válida, mas vence em até 15 dias",
    sem_validade: "Autorizada, mas o relatório não traz a data de validade",
    em_analise: "O convênio ainda está analisando o pedido",
  }
  return EXPLICA[r]
}

// ─── Barra 100% ─────────────────────────────────────────────────────────────
// Uma barra só, acima da visão geral, dizendo como o total do painel se divide.
// Os pedaços são DISJUNTOS e somam o número do badge do painel — por isso o
// laudo separa "vencidos há mais de 6 meses" dos demais vencidos (nos cards um
// está contido no outro) e a senha junta numa fatia "Outras situações" o que só
// aparece na fila de ação. Cores: o -500 da família de cada card.

/** Valores da paleta do Tailwind, literais: `BarraEmpilhada` recebe cor CSS, e o
 *  Tailwind 4 só emite a variável `--color-*` que alguma classe usa. */
const COR = {
  emerald: "oklch(69.6% 0.17 162.48)", // emerald-500
  rosa: "oklch(71.2% 0.194 13.428)", // rose-400
  rosaVencida: "oklch(64.5% 0.246 16.439)", // rose-500
  rosaForte: "oklch(51.4% 0.222 16.935)", // rose-700
  sky: "oklch(68.5% 0.169 237.323)", // sky-500
  amber: "oklch(76.9% 0.188 70.08)", // amber-500
  slate: "oklch(86.9% 0.022 252.894)", // slate-300
}

type Parte = { valor: number; cor: string; rotulo: string; titulo?: string }

function partesLaudo(c: Record<RecorteLaudo, number>): Parte[] {
  const semValidade = Math.max(0, c.todos - c.vigentes - c.vencidos)
  return [
    { valor: c.vigentes, cor: COR.emerald, rotulo: RECORTE_LABEL.vigentes },
    {
      valor: Math.max(0, c.vencidos - c.vencidos_ha_muito),
      cor: COR.rosa,
      rotulo: "Vencidos até 6 meses",
    },
    { valor: c.vencidos_ha_muito, cor: COR.rosaForte, rotulo: RECORTE_LABEL.vencidos_ha_muito },
    ...(semValidade > 0
      ? [{ valor: semValidade, cor: COR.slate, rotulo: "Sem validade" }]
      : []),
  ]
}

function partesSenha(c: Record<RecorteSenha, number> & { aplicaveis: number }): Parte[] {
  const outras = c.pendente + c.em_analise + c.sem_validade
  return [
    { valor: c.vigente, cor: COR.emerald, rotulo: RECORTE_SENHA_LABEL.vigente },
    { valor: c.vencida, cor: COR.rosaVencida, rotulo: RECORTE_SENHA_LABEL.vencida },
    { valor: c.laudo_antigo, cor: COR.sky, rotulo: RECORTE_SENHA_LABEL.laudo_antigo },
    { valor: c.sem_senha, cor: COR.amber, rotulo: RECORTE_SENHA_LABEL.sem_senha },
    ...(outras > 0
      ? [
          {
            valor: outras,
            cor: COR.slate,
            rotulo: "Outras situações",
            titulo: `${RECORTE_SENHA_LABEL.pendente}: ${c.pendente} · ${RECORTE_SENHA_LABEL.em_analise}: ${c.em_analise} · ${RECORTE_SENHA_LABEL.sem_validade}: ${c.sem_validade}`,
          },
        ]
      : []),
  ]
}

function BarraProporcao({ partes, carregando }: { partes: Parte[]; carregando: boolean }) {
  const total = partes.reduce((s, p) => s + p.valor, 0)
  const formatar = (v: number) => (total > 0 ? `${num(v)} (${Math.round((v / total) * 100)}%)` : num(v))
  return (
    <div className="space-y-2">
      <BarraEmpilhada partes={carregando ? [] : partes} />
      {!carregando && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {partes.map((p) => (
            <span key={p.rotulo} title={p.titulo}>
              <Legenda cor={p.cor} rotulo={p.rotulo} valor={p.valor} formatar={formatar} />
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

type Aba = "laudo" | "senha"

export function PainelIndicadores({
  contagensLaudo,
  contagensSenha,
  recorte,
  recorteSenha,
  onRecorte,
  onRecorteSenha,
  carregando,
  comSenhas,
  conveniosSenha,
}: {
  contagensLaudo: Record<RecorteLaudo, number>
  contagensSenha: Record<RecorteSenha, number> & { aplicaveis: number }
  recorte: RecorteLaudo
  recorteSenha: RecorteSenha
  onRecorte: (r: RecorteLaudo) => void
  onRecorteSenha: (r: RecorteSenha) => void
  carregando: boolean
  /** Há relatório de senhas importado? Sem ele, o painel da senha explica o que falta. */
  comSenhas: boolean
  /** Segue o filtro "Convênio" — ver `conveniosDaSenha`. */
  conveniosSenha: ConveniosDaSenha
}) {
  const [aba, setAba] = useState<Aba>("laudo")

  // Clicar no card ativo volta para "todos" — sem isso, sair do recorte exigiria
  // caçar outro card, e o usuário ficaria preso nele.
  const clicarLaudo = (r: RecorteLaudo) => onRecorte(recorte === r && r !== "todos" ? "todos" : r)
  const clicarSenha = (r: RecorteSenha) => onRecorteSenha(recorteSenha === r ? "todos" : r)

  return (
    <div className="space-y-3">
      {/* Abas só no celular: no desktop os dois painéis ficam lado a lado. O
          ponto na aba avisa que o painel escondido tem um recorte ativo. */}
      <div
        role="tablist"
        aria-label="Indicadores"
        className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-muted/40 p-1 lg:hidden"
      >
        <BotaoAba
          ativo={aba === "laudo"}
          onClick={() => setAba("laudo")}
          icone={FileClock}
          rotulo="Laudo"
          comRecorte={recorte !== "todos"}
        />
        <BotaoAba
          ativo={aba === "senha"}
          onClick={() => setAba("senha")}
          icone={KeyRound}
          // Só "Senhas" na aba: "Senhas ASSIM e LEVE" não cabe em meia largura
          // de celular, e o nome inteiro está no título do painel logo abaixo.
          rotulo="Senhas"
          comRecorte={recorteSenha !== "todos"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Painel
          escondidoNoCelular={aba !== "laudo"}
          icone={FileClock}
          titulo="Laudo"
          subtitulo="Renovação e aviso ao responsável"
          contagem={carregando ? "—" : `${contagensLaudo.todos} laudos`}
        >
          <BarraProporcao partes={partesLaudo(contagensLaudo)} carregando={carregando} />
          <Grupo rotulo="Visão geral">
            {/* Mesma grade do painel de senhas: os dois com quatro cards. */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {LAUDO_GERAL.map((c) => (
                <CardGrande
                  key={c.recorte}
                  card={c}
                  valor={contagensLaudo[c.recorte]}
                  selecionado={recorte === c.recorte}
                  carregando={carregando}
                  onClick={() => clicarLaudo(c.recorte)}
                />
              ))}
            </div>
          </Grupo>
          <Grupo rotulo="Fila de ação">
            <div className="grid grid-cols-2 gap-2">
              {LAUDO_ACAO.map((c) => (
                <CardCompacto
                  key={c.recorte}
                  card={c}
                  valor={contagensLaudo[c.recorte]}
                  selecionado={recorte === c.recorte}
                  carregando={carregando}
                  onClick={() => clicarLaudo(c.recorte)}
                />
              ))}
            </div>
          </Grupo>
        </Painel>

        <Painel
          escondidoNoCelular={aba !== "senha"}
          icone={KeyRound}
          titulo={`Senhas ${conveniosSenha}`}
          subtitulo="Autorização do convênio"
          contagem={
            carregando
              ? "—"
              : comSenhas
                ? `${contagensSenha.aplicaveis} laudos ${conveniosSenha}`
                : undefined
          }
        >
          {comSenhas || carregando ? (
            <>
              <BarraProporcao partes={partesSenha(contagensSenha)} carregando={carregando} />
              <Grupo rotulo="Visão geral">
                {/* Quatro cards: 2×2 no celular (em quatro colunas o rótulo
                    "Senha vinculada ao laudo antigo" quebraria em cinco linhas). */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {SENHA_GERAL.map((c) => (
                    <CardGrande
                      key={c.recorte}
                      card={c}
                      valor={contagensSenha[c.recorte]}
                      selecionado={recorteSenha === c.recorte}
                      carregando={carregando}
                      titulo={explicaSenha(c.recorte, conveniosSenha)}
                      onClick={() => clicarSenha(c.recorte)}
                    />
                  ))}
                </div>
              </Grupo>
              <Grupo rotulo="Fila de ação">
                <div className="grid grid-cols-2 gap-2">
                  {SENHA_ACAO.map((c) => (
                    <CardCompacto
                      key={c.recorte}
                      card={c}
                      valor={contagensSenha[c.recorte]}
                      selecionado={recorteSenha === c.recorte}
                      carregando={carregando}
                      titulo={explicaSenha(c.recorte, conveniosSenha)}
                      onClick={() => clicarSenha(c.recorte)}
                    />
                  ))}
                </div>
              </Grupo>
            </>
          ) : (
            <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-6 text-center">
              <KeyRound className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-semibold text-foreground">Nenhum relatório de senhas</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Suba o <span className="font-semibold">relatorio_autorizacoes_assim</span> em
                “Atualizar senhas”, no topo da tela, para ver o andamento das senhas.
              </p>
            </div>
          )}
        </Painel>
      </div>
    </div>
  )
}

/**
 * O que está combinado agora e quantos laudos sobraram. Cada recorte vira uma
 * etiqueta removível — é a forma de desfazer um recorte do painel escondido no
 * celular sem trocar de aba.
 */
export function FaixaRecortes({
  recorte,
  recorteSenha,
  total,
  carregando,
  onRecorte,
  onRecorteSenha,
}: {
  recorte: RecorteLaudo
  recorteSenha: RecorteSenha
  /** Laudos na lista depois de TODOS os filtros e recortes. */
  total: number
  carregando: boolean
  onRecorte: (r: RecorteLaudo) => void
  onRecorteSenha: (r: RecorteSenha) => void
}) {
  const semRecorte = recorte === "todos" && recorteSenha === "todos"

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2"
      aria-live="polite"
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Mostrando
      </span>
      {semRecorte && <span className="text-sm text-foreground">todos os laudos</span>}
      {recorte !== "todos" && (
        <Etiqueta
          icone={FileClock}
          texto={`Laudo: ${RECORTE_LABEL[recorte]}`}
          onRemover={() => onRecorte("todos")}
        />
      )}
      {recorteSenha !== "todos" && (
        <Etiqueta
          icone={KeyRound}
          texto={`Senha: ${RECORTE_SENHA_LABEL[recorteSenha]}`}
          onRemover={() => onRecorteSenha("todos")}
        />
      )}
      <span className="ml-auto text-sm font-bold tabular-nums text-foreground">
        {carregando ? "—" : total} <span className="font-normal text-muted-foreground">{total === 1 ? "laudo" : "laudos"}</span>
      </span>
    </div>
  )
}

function Etiqueta({
  icone: Icone,
  texto,
  onRemover,
}: {
  icone: typeof FileClock
  texto: string
  onRemover: () => void
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-1 pl-2.5 pr-1 text-xs font-semibold text-foreground shadow-sm">
      <Icone className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      {texto}
      <button
        type="button"
        onClick={onRemover}
        aria-label={`Tirar o recorte ${texto}`}
        className={`flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground ${foco}`}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </span>
  )
}

function BotaoAba({
  ativo,
  onClick,
  icone: Icone,
  rotulo,
  comRecorte,
}: {
  ativo: boolean
  onClick: () => void
  icone: typeof FileClock
  rotulo: string
  comRecorte: boolean
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={ativo}
      onClick={onClick}
      className={`relative flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition ${foco} ${
        ativo ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icone className="h-4 w-4" aria-hidden="true" />
      {rotulo}
      {comRecorte && (
        <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label="com recorte ativo" />
      )}
    </button>
  )
}

function Painel({
  escondidoNoCelular,
  icone: Icone,
  titulo,
  subtitulo,
  contagem,
  children,
}: {
  escondidoNoCelular: boolean
  icone: typeof FileClock
  titulo: string
  subtitulo: string
  contagem?: string
  children: ReactNode
}) {
  return (
    <section
      aria-label={titulo}
      className={`flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm ${
        escondidoNoCelular ? "hidden lg:flex" : "flex"
      }`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
            <Icone className="h-4.5 w-4.5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-bold leading-tight text-foreground">{titulo}</h2>
            <p className="text-xs text-muted-foreground">{subtitulo}</p>
          </div>
        </div>
        {contagem && (
          <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold tabular-nums text-muted-foreground">
            {contagem}
          </span>
        )}
      </header>
      {children}
    </section>
  )
}

function Grupo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {rotulo}
      </p>
      {children}
    </div>
  )
}

/**
 * Cartão da VISÃO GERAL: centralizado, pastel, número grande. Quatro por
 * painel (laudo e senha), em 2×2 no celular e em uma faixa a partir de `sm`:
 * em quatro colunas de ~80px o rótulo mais longo quebraria em cinco linhas.
 */
function CardGrande<R extends string>({
  card,
  valor,
  selecionado,
  carregando,
  titulo,
  onClick,
}: {
  card: CardInfo<R>
  valor: number
  selecionado: boolean
  carregando: boolean
  titulo?: string
  onClick: () => void
}) {
  const Icone = card.icone
  return (
    <button
      type="button"
      aria-pressed={selecionado}
      title={titulo}
      onClick={onClick}
      className={`flex flex-col items-center gap-1 rounded-2xl border px-2 py-3 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md motion-reduce:transform-none sm:px-3 sm:py-4 ${foco} ${
        selecionado ? card.ativo : card.base
      }`}
    >
      <Icone className={`h-5 w-5 ${card.tom}`} aria-hidden="true" />
      <span className={`text-2xl font-bold leading-none tabular-nums sm:text-3xl ${card.tom}`}>
        {carregando ? "—" : valor}
      </span>
      <span className="text-xs font-semibold leading-tight text-muted-foreground sm:text-sm">
        {card.rotulo}
      </span>
    </button>
  )
}

/** Cartão da FILA DE AÇÃO: compacto, neutro em repouso, cor só ao selecionar. */
function CardCompacto<R extends string>({
  card,
  valor,
  selecionado,
  carregando,
  titulo,
  onClick,
}: {
  card: CardInfo<R>
  valor: number
  selecionado: boolean
  carregando: boolean
  titulo?: string
  onClick: () => void
}) {
  const Icone = card.icone
  return (
    <button
      type="button"
      aria-pressed={selecionado}
      title={titulo}
      onClick={onClick}
      className={`flex items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md motion-reduce:transform-none ${foco} ${
        selecionado ? card.ativo : card.base
      }`}
    >
      <Icone className={`h-5 w-5 shrink-0 ${card.tom}`} aria-hidden="true" />
      <span className="min-w-0">
        <span className={`block text-xl font-bold leading-none tabular-nums ${card.tom}`}>
          {carregando ? "—" : valor}
        </span>
        <span className="mt-1 block text-xs font-semibold leading-tight text-muted-foreground">
          {card.rotulo}
        </span>
      </span>
    </button>
  )
}
