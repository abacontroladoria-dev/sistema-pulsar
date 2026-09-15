"use client"

// SalaCadastroCard — o que a sala É, separado do que está acontecendo nela.
// Misturar as duas coisas é o problema central da tela antiga: capacidade e
// núcleo são estáveis por meses, a ocupação muda toda semana, e no layout
// tabular os dois competiam pelo mesmo espaço com o mesmo peso.
//
// Um <dl> porque é literalmente uma lista de definições; leitor de tela lê
// "Capacidade, 6 terapeutas" em vez de duas células soltas.

import { CAPACIDADE_LABEL_CURTO } from "@/lib/cronograma/salasTypes"
import { capacidadeProjetadaSala } from "@/lib/cronograma/salasTypes"
import type { Sala, SalaTerapiaExclusiva } from "@/lib/cronograma/salasTypes"

interface SalaCadastroCardProps {
  sala: Sala
  /** Só as regras DESTA sala — a filtragem é do chamador. */
  exclusividades: SalaTerapiaExclusiva[]
  /** Terapias efetivamente alocadas na sala (de `resumoCardSala`). */
  terapias: string[]
}

export function SalaCadastroCard({ sala, exclusividades, terapias }: SalaCadastroCardProps) {
  const capacidade = capacidadeProjetadaSala(sala.capacidade, sala.status)
  const obrigatorias = exclusividades.filter(e => e.modo === "obrigatoria")
  const preferenciais = exclusividades.filter(e => e.modo === "preferencial")

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-bold text-foreground">Configuração da sala</h3>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        <Campo rotulo="Capacidade">
          {CAPACIDADE_LABEL_CURTO[sala.capacidade]}
          {capacidade > 0 && (
            <span className="text-muted-foreground"> · {capacidade} simultâneos</span>
          )}
        </Campo>

        <Campo rotulo="Unidade">{sala.unidade_nome}</Campo>
        {/* Mesmo sufixo do card e do cabeçalho do detalhe — "1" sozinho lia-se
            como parte de outra coisa. */}
        <Campo rotulo="Andar">{sala.andar ? `${sala.andar}º andar` : "—"}</Campo>
        <Campo rotulo="Núcleo">{sala.nucleo || "—"}</Campo>
        <Campo rotulo="Número">{sala.numero_sala}</Campo>

        <Campo rotulo="Exclusividade">
          {exclusividades.length === 0 ? (
            <span className="text-muted-foreground">Sem restrição</span>
          ) : (
            <span className="flex flex-col gap-0.5">
              {obrigatorias.length > 0 && (
                <span>Só comporta: {obrigatorias.map(e => e.terapia_nome).join(", ")}</span>
              )}
              {preferenciais.length > 0 && (
                <span className="text-muted-foreground">
                  Prioriza: {preferenciais.map(e => e.terapia_nome).join(", ")}
                </span>
              )}
            </span>
          )}
        </Campo>
      </dl>

      <div className="mt-4 border-t border-border pt-4">
        <dl className="grid grid-cols-1 gap-4">
          <Campo rotulo="Especialidades em uso">
            {terapias.length ? terapias.join(", ") : <span className="text-muted-foreground">Nenhuma alocação nesta semana</span>}
          </Campo>
          {sala.observacoes && <Campo rotulo="Observações">{sala.observacoes}</Campo>}
        </dl>
      </div>
    </div>
  )
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium text-muted-foreground">{rotulo}</dt>
      <dd className="mt-0.5 text-sm text-foreground">{children}</dd>
    </div>
  )
}
