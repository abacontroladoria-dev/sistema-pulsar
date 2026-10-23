"use client"

import { History, Loader2, Users } from "lucide-react"
import { rotulo } from "@/components/cadastros/pacientes/ui/campos"
import { btnSecundario } from "@/components/cronograma/grade/estilo"
import { SearchCombobox } from "@/components/cronograma/ui/SearchCombobox"
import { Cartao, EstadoVazio, cartaoPadrao } from "@/components/ui/padrao"
import type { PepApuracaoMensal, PepCatalogoItem, PepPlanejamentoSemestral } from "@/types/pep"
import { CelulaRecorrente, CelulaSemestral, money, type RegistroResumo } from "./Celulas"
import { ExplicacaoPepTooltip } from "./ExplicacaoPepTooltip"

export function SeletorPrestador({ analistas, prestador, onChange, onHistoricoGeral, onHistoricoPrestador, carregando }: {
  analistas: string[]
  prestador: string
  onChange: (v: string) => void
  onHistoricoGeral: () => void
  onHistoricoPrestador?: () => void
  carregando?: boolean
}) {
  return (
    <Cartao>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <label className={`${rotulo} mb-0 flex items-center gap-1.5`}>
          Analista do Comportamento
          {carregando && <Loader2 size={11} className="animate-spin motion-reduce:animate-none" />}
        </label>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {onHistoricoPrestador && (
            <button
              type="button"
              onClick={onHistoricoPrestador}
              className={`${btnSecundario} min-h-11 sm:min-h-0`}
            >
              <History size={14} /> Histórico
            </button>
          )}
          <button
            type="button"
            onClick={onHistoricoGeral}
            className={`${btnSecundario} min-h-11 sm:min-h-0`}
          >
            <History size={14} /> Histórico geral
          </button>
        </div>
      </div>
      <SearchCombobox
        value={prestador}
        onChange={onChange}
        opcoes={analistas}
        ariaLabel="Analista do Comportamento"
        placeholder={carregando && analistas.length === 0 ? "Carregando…" : "Digite para buscar..."}
        disabled={carregando && analistas.length === 0}
      />
    </Cartao>
  )
}

export function TabelaGeralAnalista({
  itensGerais,
  semanasCalendario,
  registroDe,
  onAbrirPainel,
  liberado,
  impactoGeral,
  totalPacientes,
}: {
  itensGerais: PepCatalogoItem[]
  semanasCalendario: number
  registroDe: (pacienteNome: string | null, itemId: string) => RegistroResumo
  onAbrirPainel: (item: PepCatalogoItem) => void
  liberado: boolean
  impactoGeral: number
  totalPacientes: number
}) {
  if (itensGerais.length === 0) return null
  return (
    <div className={`${cartaoPadrao} overflow-x-auto`}>
      <table className="w-full min-w-[640px] table-fixed text-sm">
        {/* Percentuais idênticos aos da tabela de pacientes logo abaixo —
            mantém ETC/STC alinhados com TAP/TOP mesmo em blocos separados. */}
        <colgroup>
          <col style={{ width: "28%" }} />
          {itensGerais.map(item => <col key={item.id} style={{ width: "16%" }} />)}
          <col style={{ width: "40%" }} />
        </colgroup>
        <tbody>
          <tr>
            <td className="px-4 py-3 font-medium text-foreground">
              Geral <span className="font-normal text-muted-foreground">(sem paciente)</span>
            </td>
            {itensGerais.map((item, i) => (
              <td key={item.id} className={`px-3 py-3 text-center ${i === 0 ? "border-l border-border" : ""}`}>
                <CelulaRecorrente
                  item={item}
                  pacienteNome={null}
                  semanasCalendario={semanasCalendario}
                  registro={registroDe(null, item.id)}
                  onClick={() => onAbrirPainel(item)}
                  disabled={liberado}
                />
              </td>
            ))}
            <td />
          </tr>
        </tbody>
      </table>
      {impactoGeral > 0 && totalPacientes > 0 && (
        <p className="border-t border-border px-4 py-2 text-xs font-medium text-amber-800 dark:text-amber-300">
          Se ficar assim, reduz cada um dos {totalPacientes} paciente{totalPacientes > 1 ? "s" : ""} em até {money(impactoGeral)}
        </p>
      )}
    </div>
  )
}

export function TabelaMensalPacientes({
  loading,
  pacientes,
  itensPorPaciente,
  semanasCalendario,
  registroDe,
  resultadoDe,
  catalogoCompleto,
  apuracaoLoading,
  liberado,
  onAbrirPainel,
}: {
  loading: boolean
  pacientes: string[]
  itensPorPaciente: PepCatalogoItem[]
  semanasCalendario: number
  registroDe: (pacienteNome: string | null, itemId: string) => RegistroResumo
  resultadoDe: (pacienteNome: string) => PepApuracaoMensal | null | undefined
  catalogoCompleto: PepCatalogoItem[]
  apuracaoLoading: boolean
  liberado: boolean
  onAbrirPainel: (pacienteNome: string, item: PepCatalogoItem) => void
}) {
  if (loading) {
    return (
      <Cartao className="space-y-2">
        <div className="h-8 w-full animate-pulse rounded-md bg-muted" />
        <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
        <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
      </Cartao>
    )
  }

  if (pacientes.length === 0) {
    return (
      <EstadoVazio
        Icone={Users}
        titulo="Nenhum paciente na grade"
        texto="Nenhum paciente encontrado para este Analista na Grade carregada."
      />
    )
  }

  return (
    <div className={`${cartaoPadrao} overflow-x-auto`}>
      <table className="w-full min-w-[640px] table-fixed text-sm">
        <colgroup>
          <col style={{ width: "28%" }} />
          {itensPorPaciente.map(item => <col key={item.id} style={{ width: "16%" }} />)}
          <col style={{ width: "40%" }} />
        </colgroup>
        <thead>
          <tr className="border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground">
            <th className="px-4 py-2.5 text-left">Paciente</th>
            {itensPorPaciente.map((item, i) => (
              <th key={item.id} className={`px-3 py-2.5 text-center ${i === 0 ? "border-l border-border" : ""}`} title={item.nome}>
                {item.sigla}
              </th>
            ))}
            <th className="border-l border-border px-3 py-2.5 text-right">
              <span className="inline-flex items-center gap-1.5">
                PEP apurada
                {apuracaoLoading && <Loader2 size={11} className="animate-spin" />}
              </span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {pacientes.map(paciente => (
            <tr key={paciente}>
              <td className="break-words px-4 py-2.5 font-medium text-foreground">{paciente}</td>
              {itensPorPaciente.map((item, i) => (
                <td key={item.id} className={`px-3 py-2.5 text-center ${i === 0 ? "border-l border-border" : ""}`}>
                  <CelulaRecorrente
                    item={item}
                    pacienteNome={paciente}
                    semanasCalendario={semanasCalendario}
                    registro={registroDe(paciente, item.id)}
                    onClick={() => onAbrirPainel(paciente, item)}
                    disabled={liberado}
                  />
                </td>
              ))}
              <td className={`whitespace-nowrap border-l border-border px-3 py-2.5 text-right transition-opacity ${apuracaoLoading ? "opacity-40" : ""}`}>
                {resultadoDe(paciente)
                  ? <ExplicacaoPepTooltip apuracao={resultadoDe(paciente)!} catalogo={catalogoCompleto} semanasCalendario={semanasCalendario} />
                  : <span className="text-muted-foreground">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// PRD §7.2 — as entregas semestrais (OE/RT/PIC) valem para o ano inteiro,
// independente do mês selecionado na aba mensal. Uma matriz única: paciente na
// linha, documento na coluna.
export function MatrizSemestral({ pacientes, itensSemestrais, planejamentoDe, registroSemestralDe, onAbrirPainel, disabled }: {
  pacientes: string[]
  itensSemestrais: PepCatalogoItem[]
  planejamentoDe: (pacienteNome: string, itemId: string) => PepPlanejamentoSemestral | null
  registroSemestralDe: (pacienteNome: string, itemId: string) => RegistroResumo
  onAbrirPainel: (pacienteNome: string, item: PepCatalogoItem) => void
  disabled?: boolean
}) {
  if (pacientes.length === 0) {
    return (
      <EstadoVazio
        Icone={Users}
        titulo="Nenhum paciente na grade"
        texto="Nenhum paciente encontrado para este Analista na Grade carregada."
      />
    )
  }

  const hoje = new Date().toISOString().slice(0, 10)
  const larguraItem = 72 / Math.max(1, itensSemestrais.length)

  return (
    <div className={`${cartaoPadrao} overflow-x-auto`}>
      <table className="w-full min-w-[520px] table-fixed text-sm">
        <colgroup>
          <col style={{ width: "28%" }} />
          {itensSemestrais.map(item => (
            <col key={item.id} style={{ width: `${larguraItem}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground">
            <th className="px-4 py-2.5 text-left">Paciente</th>
            {itensSemestrais.map(item => (
              <th key={item.id} className="px-3 py-2.5 text-center" title={item.nome}>
                {item.sigla}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {pacientes.map(paciente => (
            <tr key={paciente}>
              <td className="break-words px-4 py-2.5 font-medium text-foreground">{paciente}</td>
              {itensSemestrais.map(item => (
                <td key={item.id} className="px-3 py-2.5 text-center">
                  <CelulaSemestral
                    paciente={paciente}
                    item={item}
                    plano={planejamentoDe(paciente, item.id)}
                    registro={registroSemestralDe(paciente, item.id)}
                    hoje={hoje}
                    onClick={() => onAbrirPainel(paciente, item)}
                    disabled={disabled}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
