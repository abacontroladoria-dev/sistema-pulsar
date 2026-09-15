"use client"

// SalaGradeSemanal — a ocupação de UMA sala: 2 linhas (Manhã/Tarde) × os dias
// que ela atende. O número de colunas vem de `dias_disponiveis`, nunca fixo em
// 5: existem salas de sábado (ver semanaCorrenteRange em useOcupacaoSalas).
//
// Diferença para SalasGridView: lá cada linha é uma SALA e a densidade é o
// ponto; aqui há uma sala só, então a célula pode respirar e mostrar situação
// por extenso em vez de codificar tudo em cor.

import { Plus } from "lucide-react"
import { tCor } from "@/lib/cronograma/constants"
import { StatusPill } from "@/components/cronograma/ui/StatusPill"
import { SITUACAO_LABEL, TURNOS_GRADE, type AlocacaoNaCelula, type CelulaGradeSala } from "@/lib/cronograma/salasView"
import {
  SITUACAO_DOT, SITUACAO_MARCA_CLS, SITUACAO_NOME_CLS, SITUACOES_LEGENDA, TERAPIA_MARCA_CLS,
} from "./salasVocabulario"

interface SalaGradeSemanalProps {
  celulas: CelulaGradeSala[]
  onAbrirAlocacao: (celula: CelulaGradeSala, alocacao: AlocacaoNaCelula) => void
  onNovaAlocacao: (celula: CelulaGradeSala) => void
}

export function SalaGradeSemanal({ celulas, onAbrirAlocacao, onNovaAlocacao }: SalaGradeSemanalProps) {
  const dias = [...new Map(celulas.map(c => [c.dow, { dow: c.dow, label: c.diaLabel }])).values()]
    .sort((a, b) => a.dow - b.dow)

  // As terapias presentes nesta grade — a legenda de `tCor` existe porque é a
  // codificação mais específica do produto e era a única sem legenda em tela
  // nenhuma: na célula o quadradinho colorido era o ÚNICO indicador de terapia.
  const terapias = [...new Set(
    celulas.flatMap(c => c.alocacoes.map(a => a.terapiaNome).filter((t): t is string => !!t)),
  )].sort()

  const semAlocacao = celulas.every(c => c.alocacoes.length === 0)

  return (
    <div className="flex flex-col gap-3">
      {/* Scroll horizontal só aqui dentro — o corpo da página nunca rola de lado. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-150 border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="w-20 border-b border-border px-2 py-2 text-left text-[11px] font-semibold text-muted-foreground">
                Turno
              </th>
              {dias.map(d => (
                <th
                  key={d.dow}
                  scope="col"
                  className="border-b border-l border-border px-2 py-2 text-center text-[11px] font-semibold text-foreground"
                >
                  {d.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TURNOS_GRADE.map(turno => (
              <tr key={turno}>
                <th
                  scope="row"
                  className="border-b border-border px-2 py-2 text-left align-top text-[11px] font-semibold text-muted-foreground"
                >
                  {turno}
                </th>
                {dias.map(d => {
                  const celula = celulas.find(c => c.dow === d.dow && c.turno === turno)
                  return (
                    <Celula
                      key={`${d.dow}-${turno}`}
                      celula={celula}
                      onAbrirAlocacao={onAbrirAlocacao}
                      onNovaAlocacao={onNovaAlocacao}
                    />
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {semAlocacao && (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          Nenhum profissional alocado nesta sala esta semana. Clique em um turno
          livre para alocar alguém.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {/* Situação: círculos. */}
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {SITUACOES_LEGENDA.map(s => (
            <li key={s} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={`${SITUACAO_MARCA_CLS} ${SITUACAO_DOT[s]}`} aria-hidden />
              {SITUACAO_LABEL[s]}
            </li>
          ))}
        </ul>

        {/* Terapia: quadrados. Eixo semântico diferente, forma diferente — duas
            bolinhas redondas vizinhas com significados distintos eram
            indistinguíveis. */}
        {terapias.length > 0 && (
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border pt-2">
            {terapias.map(t => (
              <li key={t} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className={TERAPIA_MARCA_CLS} style={{ background: tCor(t, true) }} aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function Celula({
  celula, onAbrirAlocacao, onNovaAlocacao,
}: {
  celula: CelulaGradeSala | undefined
  onAbrirAlocacao: (celula: CelulaGradeSala, alocacao: AlocacaoNaCelula) => void
  onNovaAlocacao: (celula: CelulaGradeSala) => void
}) {
  // Sem slot: a sala não atende esse dia/turno. NÃO oferece "Livre +" —
  // alocar aqui criaria uma reserva num turno inexistente.
  //
  // Diz "Não atende" por extenso em vez de um traço: o glifo "—" já significa
  // outras quatro coisas nesta tela (sem denominador, sem terapia, campo
  // vazio, sem dado na razão), e o rótulo já existe em SITUACAO_LABEL.
  if (!celula || celula.situacao === "indisponivel") {
    return (
      <td className="border-b border-l border-border bg-muted/20 px-2 py-3 text-center align-top text-[11px] text-muted-foreground">
        {SITUACAO_LABEL.indisponivel}
      </td>
    )
  }

  if (celula.situacao === "bloqueado") {
    return (
      <td className="border-b border-l border-border bg-muted/30 px-2 py-3 text-center align-top">
        <StatusPill tone="slate" dense>{SITUACAO_LABEL.bloqueado}</StatusPill>
      </td>
    )
  }

  return (
    <td
      className={`border-b border-l border-border px-1.5 py-1.5 align-top ${
        celula.situacao === "conflito" ? "bg-rose-50 dark:bg-rose-950/30" : ""
      }`}
    >
      {/* gap maior no toque: alvos empilhados a 4px de distância são um gerador
          de toque errado justamente no controle de alocação. */}
      <div className="flex flex-col gap-2 sm:gap-1">
        {celula.alocacoes.map(a => (
          <button
            key={a.alocacaoId}
            type="button"
            onClick={() => onAbrirAlocacao(celula, a)}
            title={`${a.profissionalNome}${a.terapiaNome ? " · " + a.terapiaNome : ""} · ${SITUACAO_LABEL[a.situacao]}`}
            className="flex min-h-11 w-full flex-col justify-center gap-0.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
          >
            <span className="flex items-center gap-1.5">
              {/* Quadrado = terapia (ver TERAPIA_MARCA_CLS). Círculo é sempre
                  situação. A forma diz QUAL eixo; a cor diz o valor. */}
              <span
                className={TERAPIA_MARCA_CLS}
                style={{ background: tCor(a.terapiaNome ?? "", true) }}
                aria-hidden
              />
              {/* A situação mora na cor do NOME, não num segundo marcador:
                  assim a célula em conflito mostra QUAL das três alocações é a
                  problemática — o fundo rosa sozinho só dizia "algo aqui está
                  errado". */}
              <span className={`min-w-0 flex-1 truncate text-[11px] font-medium leading-tight ${SITUACAO_NOME_CLS[a.situacao]}`}>
                {a.profissionalNome}
              </span>
            </span>
            <span className="flex items-center justify-between gap-1 pl-3.5">
              <span className="truncate text-[10px] leading-tight text-muted-foreground">
                {a.terapiaNome || "—"}
              </span>
              {/* A razão diz QUANTO do turno tem paciente; a situação da célula
                  já é dita pelo fundo da célula e pela cor do nome. Tonalizar a
                  razão também fazia "4/6 em conflito" ficar igual a "4/6
                  saudável" — a mesma cor com dois significados. Neutra aqui,
                  o estado mora num lugar só.

                  "s/d", não "—": nesta posição um traço fica ao lado de razões
                  como "0/6" e lê-se como zero, invertendo o sentido ("não temos
                  dado" vira "temos dado e está vazio"). O drawer já escrevia
                  "Sem cruzamento na agenda" por extenso; aqui não cabe, então
                  vai abreviado com o title dizendo o resto. */}
              {a.semCruzamentoCsv ? (
                <span
                  className="shrink-0 cursor-help text-[10px] font-semibold text-muted-foreground underline decoration-dotted underline-offset-2"
                  title="Sem cruzamento na agenda: não há dado de sessão para este turno"
                >
                  s/d
                </span>
              ) : (
                <span className="shrink-0 text-[10px] font-semibold tabular-nums text-muted-foreground">
                  {a.sessoesReais}/{a.sessoesCapacidadeTurno}
                </span>
              )}
            </span>
          </button>
        ))}

        {/* Antes: texto cinza a 70% de opacidade, sem borda, com um "+" de
            texto — lia-se como rótulo desabilitado, e a única pista de que
            clicava era o title no hover. Borda tracejada + ícone dizem "isto
            é um lugar vazio onde cabe alguém". min-h-11 no toque porque estes
            botões empilham com 4px entre eles e são o controle de ALOCAR. */}
        {Array.from({ length: celula.vagasLivres }).map((_, i) => (
          <button
            key={`livre-${i}`}
            type="button"
            onClick={() => onNovaAlocacao(celula)}
            title="Alocar profissional neste bloco"
            className="flex min-h-11 w-full items-center justify-center gap-1 rounded-md border border-dashed border-border px-1.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-solid hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
          >
            <Plus size={11} aria-hidden /> Livre
          </button>
        ))}
      </div>
    </td>
  )
}
