"use client"

import { useCallback, useEffect, useState } from "react"
import toast from "react-hot-toast"
import { Loader2, Save, AlertCircle } from "lucide-react"
import { B, TERAPIA_CORES } from "@/lib/cronograma/constants"
import { useParametrosGerais, refetchParametrosGerais } from "@/hooks/useParametrosGerais"
import { useTaxasEspecialidade, refetchTaxasEspecialidade } from "@/hooks/useTaxasEspecialidade"
import { updateParametrosGerais } from "@/services/parametrosGerais.service"
import { upsertTaxaEspecialidade } from "@/services/taxasEspecialidade.service"
import { useUnsavedChangesGuard } from "@/contexts/UnsavedChangesContext"
import { calcularBreakEvenPJ, CENARIOS_PERDA_PCT, ESPECIALIDADES_BREAK_EVEN_PJ } from "@/lib/remuneracao/pontoEquilibrio"
import { ESPECIALIDADES_AGENDA } from "@/lib/remuneracao/especialidades"
import { InfoTooltip } from "@/components/cronograma/ui/InfoTooltip"

type ConsumerTag = "Folha" | "Análise Futura" | "PEP Entregas" | "Simulação"

const CONSUMER_TAG_STYLE: Record<ConsumerTag, string> = {
  "Folha": "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  "Análise Futura": "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300",
  "PEP Entregas": "bg-fuchsia-100 text-fuchsia-600 dark:bg-fuchsia-900/30 dark:text-fuchsia-300",
  "Simulação": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
}

function ConsumerBadge({ tags }: { tags: ConsumerTag[] }) {
  return (
    <span className="inline-flex items-center gap-1 ml-2">
      {tags.map(tag => (
        <span key={tag} className={`text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${CONSUMER_TAG_STYLE[tag]}`}>
          {tag}
        </span>
      ))}
    </span>
  )
}

function especialidadeCor(esp: string): string {
  const hex = TERAPIA_CORES[esp]
  if (!hex || hex.toLowerCase() === "#ffffff" || hex.toLowerCase() === "#f0f0f0") return B.gray
  return hex
}

type Valor = {
  presenca: number
  ccPA: number
  ccPE: number
  ccLim: number
  etaBonus: number
  impostoFaturamento: number
  paCapacidadeManha: number
  paCapacidadeTarde: number
  taxas: Record<string, number>
  diarias: Record<string, number>
  beCustoMensalPJ: Record<string, number>
  beCapacidadeManha: Record<string, number>
  beCapacidadeTarde: Record<string, number>
}

export function TaxasEParametrosCadastro() {
  const { parametros, loading: loadingParametros, error: errorParametros } = useParametrosGerais()
  const {
    taxas_pa, diarias: diariasEspecialidade,
    be_custo_mensal_pj: beCustoMensalEspecialidade,
    be_capacidade_manha: beCapacidadeManhaEspecialidade, be_capacidade_tarde: beCapacidadeTardeEspecialidade,
    loading: loadingTaxas,
  } = useTaxasEspecialidade()
  const loading = loadingParametros || loadingTaxas
  const error = errorParametros

  const buildValor = useCallback((): Valor => ({
    presenca: parametros?.presenca_padrao ?? 80,
    ccPA: parametros?.cc_pa_default ?? 0,
    ccPE: parametros?.cc_pe_default ?? 0,
    ccLim: parametros?.cc_lim_default ?? 18,
    etaBonus: parametros?.eta_bonus_default ?? 0,
    impostoFaturamento: parametros?.imposto_faturamento_pct ?? 20,
    paCapacidadeManha: parametros?.pa_capacidade_manha_padrao ?? 6,
    paCapacidadeTarde: parametros?.pa_capacidade_tarde_padrao ?? 7,
    taxas: taxas_pa,
    diarias: diariasEspecialidade,
    beCustoMensalPJ: Object.fromEntries([...ESPECIALIDADES_BREAK_EVEN_PJ].map(esp => [esp, beCustoMensalEspecialidade[esp] ?? 0])),
    beCapacidadeManha: Object.fromEntries([...ESPECIALIDADES_BREAK_EVEN_PJ].map(esp => [esp, beCapacidadeManhaEspecialidade[esp] ?? 0])),
    beCapacidadeTarde: Object.fromEntries([...ESPECIALIDADES_BREAK_EVEN_PJ].map(esp => [esp, beCapacidadeTardeEspecialidade[esp] ?? 0])),
  }), [parametros, taxas_pa, diariasEspecialidade, beCustoMensalEspecialidade, beCapacidadeManhaEspecialidade, beCapacidadeTardeEspecialidade])

  const [valor, setValor] = useState<Valor>(buildValor)
  const [savedValor, setSavedValor] = useState<Valor>(buildValor)
  const [saving, setSaving] = useState(false)

  // Ressincroniza com os dados assíncronos quando chegam/mudam depois do
  // mount — padrão recomendado do React para ajustar estado a partir de
  // props sem efeito (evita cascading-render dentro de useEffect).
  const [prevParametros, setPrevParametros] = useState(parametros)
  const [prevTaxas, setPrevTaxas] = useState(taxas_pa)
  if ((parametros && parametros !== prevParametros) || taxas_pa !== prevTaxas) {
    setPrevParametros(parametros)
    setPrevTaxas(taxas_pa)
    const fresh = buildValor()
    setValor(fresh)
    setSavedValor(fresh)
  }

  const update = useCallback((patch: Partial<Valor>) => {
    setValor(prev => ({ ...prev, ...patch }))
  }, [])

  const isDirty = JSON.stringify(valor) !== JSON.stringify(savedValor)

  const handleSalvarTudo = useCallback(async () => {
    if (!parametros) return false
    setSaving(true)

    const ops: Promise<boolean>[] = []

    const parametrosMudaram = valor.presenca !== savedValor.presenca || valor.ccPA !== savedValor.ccPA
      || valor.ccPE !== savedValor.ccPE || valor.ccLim !== savedValor.ccLim || valor.etaBonus !== savedValor.etaBonus
      || valor.impostoFaturamento !== savedValor.impostoFaturamento
      || valor.paCapacidadeManha !== savedValor.paCapacidadeManha || valor.paCapacidadeTarde !== savedValor.paCapacidadeTarde
    if (parametrosMudaram) {
      ops.push(updateParametrosGerais(parametros.id, {
        presenca_padrao: valor.presenca,
        cc_pa_default: valor.ccPA,
        cc_pe_default: valor.ccPE,
        cc_lim_default: valor.ccLim,
        eta_bonus_default: valor.etaBonus,
        imposto_faturamento_pct: valor.impostoFaturamento,
        pa_capacidade_manha_padrao: valor.paCapacidadeManha,
        pa_capacidade_tarde_padrao: valor.paCapacidadeTarde,
      }))
    }

    const especialidades = new Set([...Object.keys(valor.taxas), ...Object.keys(valor.diarias), ...ESPECIALIDADES_BREAK_EVEN_PJ])
    for (const esp of especialidades) {
      const taxaPA = valor.taxas[esp] ?? 0
      const diaria = valor.diarias[esp] ?? 0
      const beCustoMensal = ESPECIALIDADES_BREAK_EVEN_PJ.has(esp) ? (valor.beCustoMensalPJ[esp] ?? 0) : undefined
      const beManha = ESPECIALIDADES_BREAK_EVEN_PJ.has(esp) ? (valor.beCapacidadeManha[esp] ?? 0) : undefined
      const beTarde = ESPECIALIDADES_BREAK_EVEN_PJ.has(esp) ? (valor.beCapacidadeTarde[esp] ?? 0) : undefined
      const beMudou = ESPECIALIDADES_BREAK_EVEN_PJ.has(esp)
        && (beCustoMensal !== (savedValor.beCustoMensalPJ[esp] ?? 0)
          || beManha !== (savedValor.beCapacidadeManha[esp] ?? 0)
          || beTarde !== (savedValor.beCapacidadeTarde[esp] ?? 0))
      if (taxaPA !== (savedValor.taxas[esp] ?? 0) || diaria !== (savedValor.diarias[esp] ?? 0) || beMudou) {
        ops.push(upsertTaxaEspecialidade({
          especialidade: esp, taxa_pa: taxaPA, diaria,
          be_custo_mensal_pj: beCustoMensal, be_capacidade_manha: beManha, be_capacidade_tarde: beTarde,
        }))
      }
    }

    const resultados = await Promise.all(ops)
    const ok = resultados.every(Boolean)
    setSaving(false)
    if (ok) {
      setSavedValor(valor)
      await Promise.all([refetchParametrosGerais(), refetchTaxasEspecialidade()])
      toast.success("Configurações salvas.")
    } else {
      toast.error("Erro ao salvar configurações.")
    }
    return ok
  }, [parametros, valor, savedValor])

  const { registerGuard } = useUnsavedChangesGuard()
  useEffect(() => {
    registerGuard({ isDirty, save: handleSalvarTudo })
    return () => registerGuard(null)
  })

  if (loading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    )
  }

  if (error || !parametros) {
    return (
      <div className="p-8">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex gap-3 text-red-800 dark:text-red-300">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <div className="flex-1">
            <div className="font-bold">Erro ao carregar configurações</div>
            <div className="text-sm mt-1">{error || "Configuração não encontrada"}</div>
          </div>
        </div>
      </div>
    )
  }

  const {
    presenca, ccPA, ccPE, ccLim, etaBonus, impostoFaturamento, paCapacidadeManha, paCapacidadeTarde,
    taxas, diarias, beCustoMensalPJ, beCapacidadeManha, beCapacidadeTarde,
  } = valor
  // Além das que já têm linha na tabela, entram as especialidades da agenda que
  // ainda não têm: antes a lista saía só do banco, e uma especialidade nova
  // (ex.: Avaliação Neuropsicopedagógica) não tinha onde receber valor — a
  // calculadora pagava R$ 0 sem ninguém conseguir corrigir por aqui. A linha só
  // é gravada quando alguém muda um valor dela (ver handleSalvarTudo).
  const allEspecialidades = Array.from(
    new Set([...Object.keys(taxas), ...Object.keys(diarias), ...ESPECIALIDADES_AGENDA]),
  ).sort((a, b) => a.localeCompare(b, "pt-BR"))

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 lg:p-8 space-y-6 animate-in fade-in duration-500">

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-foreground">
            Variáveis & Taxas
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            As alterações aqui refletem imediatamente em todas as novas análises da calculadora de remuneração.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {isDirty && (
            <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap">
              alterações não salvas
            </span>
          )}
          <button
            type="button"
            onClick={handleSalvarTudo}
            disabled={saving || !isDirty}
            className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg font-bold text-white shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: B.blue }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar
          </button>
        </div>
      </div>

      <div className="space-y-6">

        {/* Seção 1: Parâmetros Gerais — um card só, dois campos por linha em telas largas */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 md:p-6 shadow-sm">
          <h3 className="font-bold text-lg text-foreground mb-5">Parâmetros Gerais</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">

            <div>
              <label htmlFor="config-presenca" className="flex items-center text-sm font-bold mb-1.5" style={{ color: B.navy }}>
                Taxa de Presença Projetada (%)
                <ConsumerBadge tags={["Análise Futura"]} />
                <InfoTooltip ariaLabel="Como a Taxa de Presença é usada">
                  <p>Usado na Análise Futura para estimar o ganho real descontando faltas. Padrão 80%.</p>
                </InfoTooltip>
              </label>
              <input
                id="config-presenca"
                type="number" min="0" max="100"
                value={presenca}
                onChange={e => update({ presenca: Number(e.target.value) })}
                className="w-full sm:w-32 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
              />
            </div>

            <div>
              <label htmlFor="config-eta-bonus" className="flex items-center text-sm font-bold mb-1.5" style={{ color: B.orange }}>
                Especialista Técnico de Área — Bônus
                <ConsumerBadge tags={["Folha"]} />
                <InfoTooltip ariaLabel="Como o bônus do Especialista Técnico de Área é usado">
                  <p>Valor fixo por semana trabalhada.</p>
                </InfoTooltip>
              </label>
              <div className="relative w-full sm:w-40">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">R$</span>
                <input
                  id="config-eta-bonus"
                  type="number" min="0" step="0.01"
                  value={etaBonus}
                  onChange={e => update({ etaBonus: Number(e.target.value) })}
                  className="w-full rounded-lg border border-orange-200 dark:border-orange-900/50 bg-orange-50/50 dark:bg-orange-900/10 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-shadow"
                />
              </div>
            </div>

            <div>
              <label htmlFor="config-cc-pe" className="flex items-center text-sm font-bold mb-1.5" style={{ color: B.purple }}>
                Coordenador de Caso — PE base
                <ConsumerBadge tags={["Folha", "PEP Entregas"]} />
                <InfoTooltip ariaLabel="Como o PE base do Coordenador de Caso é usado">
                  <p>Valor por Paciente Único no mês, para a função de Coordenador.</p>
                </InfoTooltip>
              </label>
              <div className="relative w-full sm:w-40">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">R$</span>
                <input
                  id="config-cc-pe"
                  type="number" min="0" step="0.01"
                  value={ccPE}
                  onChange={e => update({ ccPE: Number(e.target.value) })}
                  className="w-full rounded-lg border border-purple-200 dark:border-purple-900 bg-purple-50/50 dark:bg-purple-900/10 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-shadow"
                />
              </div>
            </div>

            <div>
              <label htmlFor="config-cc-lim" className="flex items-center text-sm font-bold mb-1.5" style={{ color: B.purple }}>
                Coordenador de Caso — Limite de pacientes
                <ConsumerBadge tags={["Análise Futura"]} />
                <InfoTooltip ariaLabel="Como o limite de pacientes do Coordenador de Caso é usado">
                  <p>Limite geral de pacientes por Coordenador de Caso/Analista do Comportamento, usado no alerta de excesso em Rem. Mês - Previsão.</p>
                </InfoTooltip>
              </label>
              <input
                id="config-cc-lim"
                type="number" min="0"
                value={ccLim}
                onChange={e => update({ ccLim: Number(e.target.value) })}
                className="w-full sm:w-32 rounded-lg border border-purple-200 dark:border-purple-900 bg-purple-50/50 dark:bg-purple-900/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-shadow"
              />
            </div>

            <div>
              <label htmlFor="config-imposto-faturamento" className="flex items-center text-sm font-bold mb-1.5" style={{ color: B.green }}>
                Imposto sobre faturamento (%)
                <ConsumerBadge tags={["Simulação"]} />
                <InfoTooltip ariaLabel="Como o imposto sobre faturamento é usado">
                  <p>Alíquota que incide só sobre sessões efetivamente realizadas — usada no cálculo de Ponto de Equilíbrio de todas as especialidades.</p>
                </InfoTooltip>
              </label>
              <div className="relative w-full sm:w-32">
                <input
                  id="config-imposto-faturamento"
                  type="number" min="0" max="100" step="0.1"
                  value={impostoFaturamento}
                  onChange={e => update({ impostoFaturamento: Number(e.target.value) })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent pr-8 pl-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">%</span>
              </div>
            </div>

            <div>
              <label className="flex items-center text-sm font-bold mb-1.5" style={{ color: B.green }}>
                Capacidade padrão por atendimento
                <ConsumerBadge tags={["Simulação"]} />
                <InfoTooltip ariaLabel="Como a capacidade padrão por atendimento é usada">
                  <p>Sessões de manhã/tarde num dia completo, usadas como referência de capacidade no Ponto de Equilíbrio de todas as especialidades que pagam por atendimento (todas exceto Fono/TO/Musicoterapia, que têm capacidade própria).</p>
                </InfoTooltip>
              </label>
              <div className="grid grid-cols-2 gap-3 sm:w-64">
                <div>
                  <label className="block text-[11px] font-semibold mb-1 text-slate-500 dark:text-slate-400">Manhã</label>
                  <input
                    type="number" min="0" step="1"
                    value={paCapacidadeManha}
                    onChange={e => update({ paCapacidadeManha: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold mb-1 text-slate-500 dark:text-slate-400">Tarde</label>
                  <input
                    type="number" min="0" step="1"
                    value={paCapacidadeTarde}
                    onChange={e => update({ paCapacidadeTarde: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
                  />
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Seção 2: Taxas por Especialidade — tabela única; Fono/TO/Musicoterapia têm o
            Ponto de Equilíbrio (PJ) encaixado na própria linha, em vez de virar outra tabela */}
        <div className="space-y-4">
          <h3 className="font-bold text-lg text-foreground">Taxas por Especialidade</h3>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">

            <div className="grid grid-cols-12 gap-2 p-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              <div className="col-span-6">Especialidade</div>
              <div className="col-span-3 flex items-center justify-end gap-1 normal-case">
                <span className="uppercase">PA (R$)</span>
                <ConsumerBadge tags={["Folha", "Simulação"]} />
                <InfoTooltip ariaLabel="Onde o valor de PA é usado">
                  <p>Sempre usado na <strong className="text-foreground">Folha</strong> (Análise Futura, Rem. Mês).</p>
                  <p className="mt-2">Também usado na <strong className="text-foreground">Simulação</strong> (Break Even &ldquo;por atendimento&rdquo;) — <strong className="text-foreground">exceto</strong> Fonoaudiologia, Terapia Ocupacional e Musicoterapia, que usam o modelo de custo fixo mensal (PJ) logo abaixo do nome delas nesta tabela.</p>
                </InfoTooltip>
              </div>
              <div className="col-span-3 flex items-center justify-end gap-1 normal-case">
                <span className="uppercase">Diária (R$)</span>
                <ConsumerBadge tags={["Folha"]} />
                <InfoTooltip ariaLabel="Onde o valor de Diária é usado">
                  <p>Usado só na <strong className="text-foreground">Folha</strong> (linha &ldquo;PPD&rdquo; em Análise Futura/Rem. Mês). Não entra no Break Even da Simulação.</p>
                </InfoTooltip>
              </div>
            </div>

            <div className="p-2 space-y-1">
              {(() => {
                const ccHex = especialidadeCor("Coordenador de Caso")
                return (
                  <div className="rounded-lg" style={{ background: ccHex + "14" }}>
                    <div className="grid grid-cols-12 gap-2 items-center p-2">
                      <div className="col-span-6 flex items-center text-sm font-bold truncate pr-2" style={{ color: ccHex }} title="Coordenador de Caso">
                        Coordenador de Caso
                      </div>
                      <div className="col-span-3">
                        <input
                          id="config-cc-pa"
                          type="number" min="0" step="0.01"
                          value={ccPA}
                          onChange={e => update({ ccPA: Number(e.target.value) })}
                          className="w-full text-right rounded-md border bg-white dark:bg-transparent px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                          style={{ borderColor: ccHex + "55" }}
                        />
                      </div>
                      <div className="col-span-3">
                        <input
                          id="config-cc-diaria"
                          type="number" min="0" step="0.01"
                          value={diarias["Coordenador de Caso"] || 0}
                          onChange={e => update({ diarias: { ...diarias, "Coordenador de Caso": Number(e.target.value) } })}
                          className="w-full text-right rounded-md border bg-white dark:bg-transparent px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                          style={{ borderColor: ccHex + "55" }}
                        />
                      </div>
                    </div>
                  </div>
                )
              })()}
              {allEspecialidades.map(esp => {
                if (esp === "Coordenador de Caso") return null // Tem linha própria acima
                const hex = especialidadeCor(esp)
                return (
                  <div key={esp} className="grid grid-cols-12 gap-2 items-center p-2 rounded-lg transition-colors" style={{ background: hex + "0d" }}>
                    <div className="col-span-6 text-sm font-bold truncate pr-2" style={{ color: hex }} title={esp}>
                      {esp}
                      {!(esp in taxas_pa) && (
                        <span className="ml-2 text-[11px] font-medium text-slate-400 dark:text-slate-500">sem valor cadastrado</span>
                      )}
                    </div>
                    <div className="col-span-3">
                      <input
                        type="number" min="0" step="0.01"
                        value={taxas[esp] || 0}
                        onChange={e => update({ taxas: { ...taxas, [esp]: Number(e.target.value) } })}
                        className="w-full text-right rounded-md border bg-white dark:bg-transparent px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                        style={{ borderColor: hex + "55" }}
                      />
                    </div>
                    <div className="col-span-3">
                      <input
                        type="number" min="0" step="0.01"
                        value={diarias[esp] || 0}
                        onChange={e => update({ diarias: { ...diarias, [esp]: Number(e.target.value) } })}
                        className="w-full text-right rounded-md border bg-white dark:bg-transparent px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                        style={{ borderColor: hex + "55" }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>

          </div>
        </div>

        {/* Seção 3: Ponto de Equilíbrio (PJ) — seção própria, cards empilhados um abaixo do outro */}
        <div className="space-y-4">
          <div className="flex items-center gap-1">
            <h3 className="font-bold text-lg text-foreground">Ponto de Equilíbrio — custo fixo mensal (PJ)</h3>
            <ConsumerBadge tags={["Simulação"]} />
            <InfoTooltip ariaLabel="Como o Ponto de Equilíbrio (PJ) é calculado">
              <p>Média mensal para 4,33 sem/mês e 56,33 sess/mês. Alimenta o Break Even mostrado em &ldquo;Simulação de Novo Prestador&rdquo; (relacionamento-prestador/solicitacoes → aba Simulação).</p>
              <p className="mt-2">O valor de sessão usado ali vem direto da Projeção financeira daquela tela — aqui você cadastra o custo fixo mensal (pra 1 dia/semana completo) e a capacidade de manhã/tarde separadas, já que um dia pode não valer o mesmo nos dois turnos. Só se aplica a Fonoaudiologia, Terapia Ocupacional e Musicoterapia — as demais especialidades usam o &ldquo;PA (R$)&rdquo; da tabela acima.</p>
            </InfoTooltip>
          </div>

          <div className="space-y-3">
            {[...ESPECIALIDADES_BREAK_EVEN_PJ].map(esp => {
              const hex = especialidadeCor(esp)
              const custoMensal = beCustoMensalPJ[esp] ?? 0
              const capacidadeManha = beCapacidadeManha[esp] ?? 0
              const capacidadeTarde = beCapacidadeTarde[esp] ?? 0
              return (
                <div key={esp} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
                  <div className="text-sm font-bold mb-4" style={{ color: hex }}>{esp}</div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-bold mb-1.5 text-slate-500 dark:text-slate-400">Custo mensal — dia completo (R$)</label>
                      <input
                        type="number" min="0" step="0.01"
                        value={custoMensal}
                        onChange={e => update({ beCustoMensalPJ: { ...beCustoMensalPJ, [esp]: Number(e.target.value) } })}
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold mb-1.5 text-slate-500 dark:text-slate-400">Capacidade manhã (sessões)</label>
                      <input
                        type="number" min="0" step="1"
                        value={capacidadeManha}
                        onChange={e => update({ beCapacidadeManha: { ...beCapacidadeManha, [esp]: Number(e.target.value) } })}
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold mb-1.5 text-slate-500 dark:text-slate-400">Capacidade tarde (sessões)</label>
                      <input
                        type="number" min="0" step="1"
                        value={capacidadeTarde}
                        onChange={e => update({ beCapacidadeTarde: { ...beCapacidadeTarde, [esp]: Number(e.target.value) } })}
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
                      />
                    </div>
                  </div>

                  <div className="h-px bg-slate-100 dark:bg-slate-800 my-4" />

                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Dia completo: <strong className="text-foreground">{capacidadeManha + capacidadeTarde}</strong> sessões
                  </div>

                  <div className="mt-3">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
                      Mínimo de sessões/semana para bater o Break Even
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {CENARIOS_PERDA_PCT.map(perdaPct => {
                        const r = calcularBreakEvenPJ({
                          valorSessaoBruto: 120, impostoFaturamentoPct: impostoFaturamento,
                          custoMensalDiaCompleto: custoMensal, capacidadeManha, capacidadeTarde, perdaPct,
                          periodosManha: 1, periodosTarde: 1,
                        })
                        return (
                          <span key={perdaPct} className="rounded-md bg-slate-50 dark:bg-slate-800/50 px-2.5 py-1 text-[11px] text-slate-500 dark:text-slate-400">
                            Com {perdaPct}% de perdas: <strong className="text-foreground">{r.slotsSemanaMinimo}</strong> sessões/sem
                          </span>
                        )
                      })}
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-2">
                    Considera 1 dia completo/semana (manhã+tarde) e valor de sessão de referência R$120 (a simulação real usa o valor projetado em Projeção financeira).
                  </p>
                </div>
              )
            })}
          </div>
        </div>

      </div>
    </div>
  )
}
