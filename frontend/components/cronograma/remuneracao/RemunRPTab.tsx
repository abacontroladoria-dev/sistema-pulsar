"use client"

// Rem. Mês - Total: lista compacta de profissionais + modal-workspace por
// pessoa, no padrão de docs/padrao-detalhamento-modal.md.
//
// O que mudou em relação ao desenho anterior:
//  • a linha não expande mais para baixo (nem abria quatro accordions dentro de
//    si) — o detalhamento vive em ModalRemuneracaoRP;
//  • a busca desta página escolhe QUEM aparece e para por aí. Antes ela era
//    repassada ao card e ainda forçava todos a abrirem (§3.11);
//  • enquanto a grade carrega e não há nada na tela, aparece um esqueleto no
//    formato do layout real, não a mensagem de "não existe dado" (§3.9).

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { HelpCircle, Download, Loader2 } from "lucide-react"

import { useHeader } from "@/contexts/HeaderContext"
import { useRemuneracaoRPContext } from "@/contexts/RemuneracaoRPContext"
import { useProfissionaisReboot } from "@/hooks/useProfissionaisReboot"
import { RemuneracaoGradeBadge, labelMes } from "./RemuneracaoGradeBadge"
import { RemuneracaoRPDashboard } from "./RemuneracaoRPDashboard"
import { EstadoGradeVazia } from "./EstadoGradeVazia"
import { RemuneracaoRPSkeleton } from "./RemuneracaoRPSkeleton"
import { usePepApuracaoResumo } from "@/hooks/usePepApuracaoResumo"
import { calcularTotalPorEspecialidade } from "@/lib/remuneracao/dashboardRP"
import { exportarRemuneracaoRPXlsx } from "@/lib/remuneracao/exportRemuneracaoRP"
import { competenciaDeLinhas } from "@/lib/remuneracao/datas"
import { B } from "@/lib/cronograma/constants"
import { MultiSearchCombobox } from "@/components/cronograma/ui/MultiSearchCombobox"
import CardRemunRP from "./CardRemunRP"
import { ModalRemuneracaoRP } from "./ModalRemuneracaoRP"
import type { ProfRemunReal } from "@/lib/remuneracao/calculo"

const normKey = (v: unknown): string =>
  String(v ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim()

export function RemunRPTab() {
  const {
    resultado, evoRows, csvName, controlesGrade,
    peName,
    loading, error,
    cadastroPrestadores,
  } = useRemuneracaoRPContext()

  const competenciaPep = useMemo(() => competenciaDeLinhas(evoRows), [evoRows])
  const { resumo: pepResumo } = usePepApuracaoResumo(competenciaPep)

  // Especialidade geral cadastrada do profissional (reboot_profissionais) —
  // fallback de contrato de banco de horas salvo sem `funcao` (ver dashboardRP.ts).
  const { profissionais: profissionaisReboot } = useProfissionaisReboot()
  const especialidadeGeralPorProf = useMemo(() => {
    const mapa = new Map<string, string>()
    profissionaisReboot.forEach(p => {
      if (p.especialidade?.trim()) mapa.set(normKey(p.nome), p.especialidade.trim())
    })
    return mapa
  }, [profissionaisReboot])

  // Uma pessoa aberta por vez, identificada pelo nome. O modal remonta por
  // `key`, então aba/página/detalhe nascem limpos a cada troca — nada de
  // useEffect com setState para resetar (§3.12).
  const [aberto, setAberto] = useState<string | null>(null)

  // Link direto de outra tela (ex.: causa de diferença na Visão Geral
  // Individual): ?prestador=Nome&sessao=ID abre este profissional já com
  // aquela sessão localizada. Só na entrada — depois disso o usuário manda.
  const searchParams = useSearchParams()
  const prestadorLink = searchParams.get("prestador")
  const sessaoLink = searchParams.get("sessao")
  const [linkAplicado, setLinkAplicado] = useState(false)
  useEffect(() => {
    if (linkAplicado || !prestadorLink || !resultado) return
    const alvo = resultado.find(p => normKey(p.prof) === normKey(prestadorLink))
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reage a um parâmetro de URL externo + à grade chegando de forma assíncrona; não há valor derivável no primeiro render
    if (alvo) setAberto(alvo.prof)
    // Marca como aplicado mesmo sem achar: a grade pode não ter mais essa
    // pessoa (mês trocado), e não adianta tentar de novo a cada re-render.
    setLinkAplicado(true)
  }, [linkAplicado, prestadorLink, resultado])
  const [remBusca, setRemBusca] = useState("")
  const [apenasInconsistencia, setApenasInconsistencia] = useState(false)
  // Múltiplas especialidades ativas ao mesmo tempo (OR) — mesmo padrão do
  // dropdown "Especialidades: Todas as especialidades" de
  // ocupar-profissionais-disponiveis (MultiSearchCombobox: digita pra buscar
  // + checkbox, fica aberto entre marcações).
  const [especialidadesFiltro, setEspecialidadesFiltro] = useState<Set<string>>(new Set())
  const toggleEspecialidade = useCallback((esp: string) => {
    setEspecialidadesFiltro(prev => {
      const next = new Set(prev)
      if (next.has(esp)) next.delete(esp)
      else next.add(esp)
      return next
    })
  }, [])
  const limparEspecialidades = useCallback(() => setEspecialidadesFiltro(new Set()), [])
  const { setHeader, setRightContent } = useHeader()

  const profissionaisComInconsistencia = useMemo(
    () => resultado?.filter(p => p.inconsistencias > 0) ?? [],
    [resultado]
  )

  // Mesmo cálculo do dashboard (barras) — reaproveitado aqui tanto para achar
  // QUEM tem a especialidade escolhida quanto para listar as opções do
  // dropdown de filtro, sem duplicar a regra de "quem conta em cada balde".
  const { porEspecialidade } = useMemo(
    () => calcularTotalPorEspecialidade(resultado ?? [], pepResumo, cadastroPrestadores, especialidadeGeralPorProf),
    [resultado, pepResumo, cadastroPrestadores, especialidadeGeralPorProf]
  )

  const especialidadesDisponiveis = useMemo(
    () => [...porEspecialidade]
      .map(e => e.especialidade)
      .sort((a, b) => a.localeCompare(b, "pt-BR"))
      .map(nome => ({ id: nome, nome })),
    [porEspecialidade]
  )

  // OR entre as especialidades marcadas: aparece quem tem qualquer uma delas.
  const profissionaisPorEspecialidade = useMemo(() => {
    if (especialidadesFiltro.size === 0) return null
    const nomes = new Set<string>()
    porEspecialidade.forEach(e => {
      if (especialidadesFiltro.has(e.especialidade)) e.profissionais.forEach(p => nomes.add(p))
    })
    return nomes
  }, [porEspecialidade, especialidadesFiltro])

  // A busca escolhe QUEM aparece na lista: um profissional entra se alguma
  // sessão dele casa com o termo. Dentro do modal ela não vale — lá a mesma
  // string esconderia o resto do período da pessoa, que é outra pergunta.
  const buscaQ = useMemo(() => normKey(remBusca), [remBusca])
  const profTemBusca = useCallback((p: ProfRemunReal) => {
    if (!buscaQ) return true
    return p.sessoes.some(s =>
      normKey(`${s.paciente} ${s.especialidade} ${s.data} ${s.hora} ${s.profAgenda} ${s.profCsv}`).includes(buscaQ)
    )
  }, [buscaQ])

  const resultadoExibido = useMemo(() => {
    let r = apenasInconsistencia ? profissionaisComInconsistencia : resultado
    if (profissionaisPorEspecialidade) r = r ? r.filter(p => profissionaisPorEspecialidade.has(p.prof)) : r
    if (buscaQ) r = r ? r.filter(profTemBusca) : r
    return r
  }, [apenasInconsistencia, profissionaisComInconsistencia, resultado, profissionaisPorEspecialidade, buscaQ, profTemBusca])

  const profAberto = useMemo(
    () => (aberto ? resultado?.find(p => p.prof === aberto) ?? null : null),
    [aberto, resultado]
  )

  useEffect(() => {
    setHeader("Remuneração Mensal", "Relacionamento Prestador")
    setRightContent(<RemuneracaoGradeBadge c={controlesGrade} />)
    return () => {
      setHeader("", "")
      setRightContent(null)
    }
  }, [setHeader, setRightContent, controlesGrade])

  const temDado = !!resultado && resultado.length > 0
  const carregando = loading || controlesGrade.gradeLoading
  // O mesmo rótulo do seletor no cabeçalho ("Agosto de 2026"): quem está
  // esperando lê no corpo exatamente o que escolheu lá em cima.
  const periodoTexto = labelMes(controlesGrade.periodoCarregado ?? controlesGrade.periodo)

  // Sem nada na tela e a grade a caminho → esqueleto no formato do layout real.
  // A mensagem de vazio (EstadoGradeVazia) só entra depois que a carga termina.
  if (!temDado && carregando) {
    return <RemuneracaoRPSkeleton periodo={periodoTexto} />
  }

  return (
    <div className="space-y-4">
      {temDado && (
        <RemuneracaoRPDashboard
          resultado={resultado}
          especialidadesFiltro={especialidadesFiltro}
          onToggleEspecialidade={toggleEspecialidade}
          onLimparEspecialidades={limparEspecialidades}
          pepResumo={pepResumo}
          cadastroPrestadores={cadastroPrestadores}
          especialidadeGeralPorProf={especialidadeGeralPorProf}
        />
      )}

      {/* Recarga com dado na tela: a lista fica onde está e o aviso é discreto.
          Esconder o que a pessoa está lendo é pior que fazê-la esperar. */}
      {temDado && carregando && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite">
          <Loader2 size={13} className="motion-safe:animate-spin" aria-hidden />
          Atualizando com a grade de {periodoTexto}…
        </p>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {temDado && (
        <div className="flex items-center gap-3">
          <input
            type="search"
            placeholder="Buscar paciente, especialidade, data…"
            value={remBusca}
            onChange={e => setRemBusca(e.target.value)}
            className="flex-1 rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Filtrar profissionais por sessão"
          />
          <div className="w-56 shrink-0">
            <MultiSearchCombobox
              opcoes={especialidadesDisponiveis}
              selecionados={especialidadesFiltro}
              onToggle={toggleEspecialidade}
              placeholder="Todas as especialidades"
              nomePlural="especialidades"
              ariaLabel="Especialidades"
            />
          </div>
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
          {csvName && (
            <p className="text-xs text-muted-foreground shrink-0">
              {csvName}{peName ? ` · ${peName}` : ""}
            </p>
          )}
          <button
            type="button"
            onClick={() => resultado && exportarRemuneracaoRPXlsx({ resultado, evoRows, csvName, pepResumo })}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white shadow-sm hover:opacity-90 active:scale-95 transition-all"
            style={{ background: B.green }}
          >
            <Download size={13} />
            Exportar XLSX
          </button>
        </div>
      )}

      {temDado && (buscaQ || apenasInconsistencia || especialidadesFiltro.size > 0) && (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="font-bold uppercase tracking-wide text-muted-foreground">
            Filtros ativos ({resultadoExibido?.length ?? 0} {resultadoExibido?.length === 1 ? "profissional" : "profissionais"}):
          </span>
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
          {[...especialidadesFiltro].map(esp => (
            <span key={esp} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-semibold text-foreground">
              Especialidade: {esp}
              <button type="button" onClick={() => toggleEspecialidade(esp)} className="opacity-70 hover:opacity-100">×</button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => { setRemBusca(""); setApenasInconsistencia(false); limparEspecialidades() }}
            className="font-semibold text-foreground hover:opacity-70 transition-opacity"
          >
            limpar tudo
          </button>
        </div>
      )}

      {!temDado && !carregando && (
        <EstadoGradeVazia
          carregando={false}
          periodo={controlesGrade.periodo}
          erroResumo={controlesGrade.gradeErroResumo}
        />
      )}

      {temDado && resultadoExibido && resultadoExibido.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          {especialidadesFiltro.size > 0
            ? `Nenhum profissional com remuneração em "${[...especialidadesFiltro].join(", ")}" nesta grade.`
            : buscaQ
              ? `Nenhuma sessão encontrada para "${remBusca}".`
              : "Nenhum profissional com inconsistência nesta grade."}
        </div>
      )}

      {resultadoExibido && resultadoExibido.length > 0 && (
        <div>
          {resultadoExibido.map(p => (
            <CardRemunRP key={p.prof} p={p} onAbrir={setAberto} pepInfo={pepResumo.get(p.prof)} />
          ))}
        </div>
      )}

      {/* `key` remonta o modal a cada pessoa: aba, página, detalhe e busca local
          nascem limpos sem nenhum efeito de reset. */}
      <ModalRemuneracaoRP
        key={aberto ?? "fechado"}
        p={profAberto}
        periodo={controlesGrade.periodo}
        pepResumo={aberto ? pepResumo.get(aberto) ?? null : null}
        focoSessaoId={aberto && prestadorLink && normKey(aberto) === normKey(prestadorLink) ? sessaoLink : null}
        onClose={() => setAberto(null)}
      />
    </div>
  )
}
