"use client"

// Aba principal da Análise de Tratativas (escopo Terapêutico). Espelha a
// RemunRPTab, MAS sem nada monetário: sem export XLSX, sem painel de PE, sem
// dashboard de valores. Só contagens de tratativas por profissional.

import { useCallback, useEffect, useMemo, useState } from "react"
import { HelpCircle, Loader2 } from "lucide-react"

import { useHeader } from "@/contexts/HeaderContext"
import { useTratativasContext } from "@/contexts/TratativasContext"
import { TratativasUploadBadge, labelMes } from "./TratativasUploadBadge"
import { TratativasDashboard } from "./TratativasDashboard"
import { TratativasSkeleton } from "./TratativasSkeleton"
import CardTratativas from "./CardTratativas"
import { ModalAnaliseTerapeuta } from "./ModalAnaliseTerapeuta"
import type { ProfTratativas } from "@/lib/remuneracao/tratativas"

const normKey = (v: unknown): string =>
  String(v ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim()

// Profissionais com pelo menos uma sessão COM tratativa na especialidade alvo
// (mesmo critério do dashboard — ver EVOLUIDA_PROPRIA em TratativasDashboard.tsx:
// "Evolução duplicada" também conta, a autoria é certa, só a captura registrou
// o salvamento duas vezes).
function profTemEspecialidade(p: ProfTratativas, esp: string): boolean {
  return p.sessoes.some(s => {
    const comTratativa =
      s.papel === "Substituição realizada" ||
      (s.papel === "Agenda" && (s.classificacao === "Evolução normal" || s.classificacao === "Evolução duplicada"))
    return comTratativa && (s.especialidade || "Sem especialidade") === esp
  })
}

export function TratativasTab() {
  const {
    resultado, controlesGrade, loading, error,
  } = useTratativasContext()

  // Profissional em análise no modal. Guardado por nome (a chave da lista) e não
  // pelo objeto: assim uma recarga da grade reaproveita o dado novo em vez de
  // manter o modal preso na versão antiga do profissional.
  const [profAberto, setProfAberto] = useState<string | null>(null)
  const [remBusca, setRemBusca] = useState("")
  const [apenasInconsistencia, setApenasInconsistencia] = useState(false)
  const [especialidadeFiltro, setEspecialidadeFiltro] = useState<string | null>(null)
  const { setHeader, setRightContent } = useHeader()

  const profissionaisComInconsistencia = useMemo(
    () => resultado?.filter(p => p.inconsistencias > 0) ?? [],
    [resultado]
  )

  const buscaQ = useMemo(() => normKey(remBusca), [remBusca])
  const profTemBusca = useCallback((p: ProfTratativas) => {
    if (!buscaQ) return true
    return p.sessoes.some(s =>
      normKey(`${s.paciente} ${s.especialidade} ${s.data} ${s.hora} ${s.profAgenda} ${s.profCsv}`).includes(buscaQ)
    )
  }, [buscaQ])

  const resultadoExibido = useMemo(() => {
    let r = apenasInconsistencia ? profissionaisComInconsistencia : resultado
    if (especialidadeFiltro) r = r ? r.filter(p => profTemEspecialidade(p, especialidadeFiltro)) : r
    if (buscaQ) r = r ? r.filter(profTemBusca) : r
    return r
  }, [apenasInconsistencia, profissionaisComInconsistencia, resultado, especialidadeFiltro, buscaQ, profTemBusca])

  // Lido de `resultado` (não de `resultadoExibido`): trocar um filtro com o modal
  // aberto não deve fechá-lo por baixo de quem está analisando. Vira null quando
  // o profissional some da grade recarregada — aí o modal se fecha sozinho.
  const profEmAnalise = useMemo(
    () => (profAberto ? resultado?.find(p => p.prof === profAberto) ?? null : null),
    [profAberto, resultado]
  )

  useEffect(() => {
    setHeader("Análise de Evolução", "Terapêutico")
    setRightContent(<TratativasUploadBadge c={controlesGrade} />)
    return () => {
      setHeader("", "")
      setRightContent(null)
    }
  }, [setHeader, setRightContent, controlesGrade])

  // A carga da grade é a demorada (mês inteiro paginado + cruzamento de
  // presença) e é automática ao abrir a aba: sem isto o corpo mostrava o vazio
  // "Sem sessões nesta grade" enquanto o dado vinha, parecendo tela quebrada.
  const carregando = controlesGrade.gradeLoading || loading
  const temDados = !!resultado && resultado.length > 0
  const periodoLabel = labelMes(controlesGrade.periodoCarregado ?? controlesGrade.periodo)

  if (carregando && !temDados) {
    return (
      <div className="space-y-4">
        {error && <p role="alert" aria-live="assertive" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <TratativasSkeleton periodo={periodoLabel} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Recarga com dado na tela: a lista fica onde está (esconder o que a
          pessoa está lendo é pior que esperar), só avisa que vem coisa nova. */}
      {carregando && temDados && (
        <p role="status" aria-live="polite" className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Loader2 size={13} className="motion-safe:animate-spin" aria-hidden />
          Atualizando a grade de {periodoLabel}…
        </p>
      )}

      {resultado && resultado.length > 0 && (
        <TratativasDashboard
          resultado={resultado}
          especialidadeFiltro={especialidadeFiltro}
          onFiltroEspecialidade={setEspecialidadeFiltro}
        />
      )}

      {error && <p role="alert" aria-live="assertive" className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {resultado && resultado.length > 0 && (
        <div className="flex items-center gap-3">
          <input
            type="search"
            placeholder="Buscar paciente, especialidade, data…"
            value={remBusca}
            onChange={e => setRemBusca(e.target.value)}
            className="flex-1 rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Buscar paciente, especialidade ou data"
          />
          <button
            type="button"
            onClick={() => setApenasInconsistencia(v => !v)}
            aria-pressed={apenasInconsistencia}
            title="Mostrar apenas profissionais com ao menos uma inconsistência"
            className={`shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold border transition-colors ${
              apenasInconsistencia
                ? "bg-red-600 border-red-600 text-white"
                : "border-border text-foreground bg-background hover:bg-muted/50"
            }`}
          >
            <HelpCircle size={13} />
            Contém Inconsistência
            <span className={`rounded-full px-1.5 text-[10px] font-bold ${apenasInconsistencia ? "bg-white/20" : "bg-muted text-muted-foreground"}`}>
              {profissionaisComInconsistencia.length}
            </span>
          </button>
        </div>
      )}

      {resultado && resultado.length > 0 && (buscaQ || apenasInconsistencia || especialidadeFiltro) && (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="font-bold uppercase tracking-wide text-muted-foreground">Filtros ativos:</span>
          {buscaQ && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-semibold text-foreground">
              Busca: {remBusca}
              <button type="button" onClick={() => setRemBusca("")} className="opacity-70 hover:opacity-100">×</button>
            </span>
          )}
          {apenasInconsistencia && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-semibold text-foreground">
              Contém inconsistência
              <button type="button" onClick={() => setApenasInconsistencia(false)} className="opacity-70 hover:opacity-100">×</button>
            </span>
          )}
          {especialidadeFiltro && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-semibold text-foreground">
              Especialidade: {especialidadeFiltro}
              <button type="button" onClick={() => setEspecialidadeFiltro(null)} className="opacity-70 hover:opacity-100">×</button>
            </span>
          )}
          <button
            type="button"
            onClick={() => { setRemBusca(""); setApenasInconsistencia(false); setEspecialidadeFiltro(null) }}
            className="font-semibold text-foreground hover:opacity-70 transition-opacity"
          >
            limpar tudo
          </button>
        </div>
      )}

      {!resultado && !carregando && (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Sem sessões nesta grade — troque o mês no cabeçalho ou, se ele não tiver dado no banco,
          carregue o CSV exportado do TiTa.
        </div>
      )}

      {resultado && resultado.length > 0 && resultadoExibido && resultadoExibido.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          {especialidadeFiltro
            ? `Nenhum profissional com evolução em "${especialidadeFiltro}" nesta grade.`
            : buscaQ
              ? `Nenhuma sessão encontrada para "${remBusca}".`
              : "Nenhum profissional com inconsistência nesta grade."}
        </div>
      )}

      {resultadoExibido && resultadoExibido.length > 0 && (
        <div>
          {resultadoExibido.map(p => (
            <CardTratativas key={p.prof} p={p} onAbrir={setProfAberto} />
          ))}
        </div>
      )}

      {/* Sem passar a busca da página: ela decide QUEM aparece na lista, não o
          que aparece dentro do modal — o modal tem busca própria. */}
      <ModalAnaliseTerapeuta
        key={profAberto ?? "fechado"}
        p={profEmAnalise}
        periodo={controlesGrade.periodoCarregado ?? controlesGrade.periodo}
        onClose={() => setProfAberto(null)}
      />
    </div>
  )
}
