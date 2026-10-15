"use client"

// Prazos das etapas 0 a 7 do Painel de Entrada (ícone "Prazos" do header).
// Para cada etapa: tempo mediano real, % no prazo e o prazo atual; Direção e
// Admin alteram (com motivo e prévia do impacto). Embaixo, o histórico completo
// de alterações. Tudo o que muda aqui muda na hora a régua do fluxo e quem está
// dentro ou fora do prazo — a rota do painel reaplica os prazos sobre a rodada.

import { useMemo, useState } from "react"
import toast from "react-hot-toast"
import { AlertTriangle, History, Lock, Minus, Pencil, Plus, RotateCcw } from "lucide-react"
import { Drawer } from "@/components/cronograma/ui/Drawer"
import { InlineNotice } from "@/components/cronograma/ui/InlineNotice"
import { SegmentedTabs } from "@/components/cronograma/ui/SegmentedTabs"
import { TONE_SOFT } from "@/components/cronograma/ui/tones"
import { useConfirmacao } from "@/components/ui/pastel/confirmacao"
import { usePrazosEntradaConvenio } from "@/hooks/usePrazosEntradaConvenio"
import {
  MOTIVO_MINIMO,
  PRAZOS_PADRAO,
  PRAZO_MAXIMO,
  ROTULO_ROLE,
  fmtDiaMes,
  impactoDaAlteracao,
  mapaDePrazos,
  textoDiasUteis,
  type AlteracaoPrazo,
  type DadosPainel,
  type EtapaResumo,
  type ImpactoPrazo,
  type MapaPrazos,
  type PrazoVigente,
} from "@/lib/indicadores/entradaConvenio"

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

// ─── Prévia / impacto ────────────────────────────────────────────────────────

function LinhasImpacto({ imp }: { imp: Partial<ImpactoPrazo> }) {
  const a = imp.agora_antes
  const d = imp.agora_depois
  return (
    <ul className="flex flex-col gap-0.5 text-xs text-foreground">
      {imp.meta_antes != null && imp.meta_depois != null && imp.meta_antes !== imp.meta_depois && (
        <li>Meta ponta a ponta: <b className="tabular-nums">{imp.meta_antes} → {imp.meta_depois}</b> dias úteis</li>
      )}
      {imp.pct_no_prazo_antes !== undefined && (
        <li>
          No histórico desta etapa:{" "}
          <b className="tabular-nums">
            {imp.pct_no_prazo_antes ?? "—"}{imp.pct_no_prazo_antes != null && "%"} → {imp.pct_no_prazo_depois ?? "—"}{imp.pct_no_prazo_depois != null && "%"}
          </b>{" "}
          no prazo{imp.n ? ` (${plural(imp.n, "paciente", "pacientes")})` : ""}
        </li>
      )}
      {a && d && (
        <li>
          Agora: <b className="tabular-nums">{a.atrasados} → {d.atrasados}</b> atrasados ·{" "}
          <span className="tabular-nums">{a.vence_hoje} → {d.vence_hoje}</span> vencem hoje ·{" "}
          <span className="tabular-nums">{a.no_prazo} → {d.no_prazo}</span> no prazo
        </li>
      )}
      {imp.mudancas && imp.mudancas.length > 0 && (
        <li>
          <details>
            <summary className="cursor-pointer text-muted-foreground">
              {plural(imp.mudancas.length, "mudança de situação", "mudanças de situação")} (pacientes)
            </summary>
            <ul className="mt-1 flex flex-col gap-0.5 pl-3">
              {imp.mudancas.map((m, i) => (
                <li key={i}>
                  <b>{m.paciente}</b> · {m.onde === "atual" ? "etapa atual" : `histórico ${m.etapa}`}: {m.de} → {m.para}
                </li>
              ))}
            </ul>
          </details>
        </li>
      )}
    </ul>
  )
}

// ─── Uma etapa ───────────────────────────────────────────────────────────────

function EditorPrazo({ etapa, atual, padrao, dados, prazos, bloqueio, salvando, onSalvar, onCancelar }: {
  etapa: EtapaResumo
  atual: number
  padrao: number
  dados: DadosPainel
  prazos: MapaPrazos
  bloqueio: string | null
  salvando: boolean
  onSalvar: (prazo: number, motivo: string) => void
  onCancelar: () => void
}) {
  const [novo, setNovo] = useState(atual)
  const [motivo, setMotivo] = useState("")
  const valido = Number.isInteger(novo) && novo >= 0 && novo <= PRAZO_MAXIMO
  const mudou = valido && novo !== atual
  const motivoOk = motivo.trim().length >= MOTIVO_MINIMO
  const impacto = useMemo(
    () => (mudou ? impactoDaAlteracao(dados, prazos, etapa.etapa, novo) : null),
    [mudou, dados, prazos, etapa.etapa, novo],
  )
  const idCampo = `prazo-${etapa.etapa}`
  const idMotivo = `motivo-${etapa.etapa}`
  const botao = "inline-flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-card text-foreground hover:bg-muted disabled:opacity-40 sm:h-9 sm:w-9"

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-xl border border-sky-200 bg-sky-50/50 p-3 dark:border-sky-900 dark:bg-sky-950/20">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={idCampo} className="text-xs font-semibold text-foreground">Novo prazo</label>
          <div className="flex items-center gap-1.5">
            <button type="button" aria-label="Diminuir 1 dia" className={botao} disabled={novo <= 0} onClick={() => setNovo(n => Math.max(0, n - 1))}>
              <Minus size={14} aria-hidden />
            </button>
            <input
              id={idCampo}
              type="number"
              inputMode="numeric"
              min={0}
              max={PRAZO_MAXIMO}
              step={1}
              value={Number.isNaN(novo) ? "" : novo}
              onChange={e => setNovo(e.target.value === "" ? NaN : Math.trunc(Number(e.target.value)))}
              className="h-11 w-20 rounded-lg border border-border bg-card px-2 text-center text-base font-bold tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9"
            />
            <button type="button" aria-label="Aumentar 1 dia" className={botao} disabled={novo >= PRAZO_MAXIMO} onClick={() => setNovo(n => Math.min(PRAZO_MAXIMO, (Number.isNaN(n) ? 0 : n) + 1))}>
              <Plus size={14} aria-hidden />
            </button>
            <span className="text-xs text-muted-foreground">dias úteis</span>
          </div>
        </div>
        {atual !== padrao && (
          <button
            type="button"
            onClick={() => setNovo(padrao)}
            className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-sky-700 hover:underline sm:min-h-9 dark:text-sky-400"
          >
            <RotateCcw size={12} aria-hidden /> Voltar ao padrão do fluxo ({textoDiasUteis(padrao)})
          </button>
        )}
      </div>
      {!valido && <p className={`text-xs font-semibold ${TONE_SOFT.red.text}`}>Use um número inteiro de 0 a {PRAZO_MAXIMO}.</p>}

      <div className="flex flex-col gap-1">
        <label htmlFor={idMotivo} className="text-xs font-semibold text-foreground">
          Motivo da alteração <span className="font-normal text-muted-foreground">(obrigatório, fica no histórico)</span>
        </label>
        <textarea
          id={idMotivo}
          value={motivo}
          onChange={e => setMotivo(e.target.value)}
          maxLength={1000}
          rows={2}
          placeholder="Ex.: reunião de 15/10 — a operadora leva 2 dias úteis para responder a elegibilidade"
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {!motivoOk && motivo.length > 0 && (
          <span className="text-[11px] text-muted-foreground">Mínimo de {MOTIVO_MINIMO} caracteres ({motivo.trim().length} até agora).</span>
        )}
      </div>

      {impacto && (
        <div className="rounded-lg border border-border bg-card p-2.5">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Se salvar ({textoDiasUteis(atual)} → {textoDiasUteis(novo)})
          </p>
          <LinhasImpacto imp={impacto} />
        </div>
      )}

      {bloqueio && (
        <p className={`flex items-start gap-1.5 text-xs font-semibold ${TONE_SOFT.amber.text}`}>
          <Lock size={13} className="mt-0.5 shrink-0" aria-hidden /> {bloqueio}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!mudou || !motivoOk || !!bloqueio || salvando}
          onClick={() => onSalvar(novo, motivo.trim())}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-sky-700 px-3 text-xs font-bold text-white shadow-sm transition-colors hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9 dark:bg-sky-600 dark:hover:bg-sky-700"
        >
          {salvando ? "Salvando..." : "Salvar alteração"}
        </button>
        <button
          type="button"
          onClick={onCancelar}
          className="inline-flex min-h-11 items-center rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-muted sm:min-h-9"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}

function LinhaEtapa({ etapa, indice, prazo, padrao, editando, podeAlterar, onEditar, children }: {
  etapa: EtapaResumo
  indice: number
  prazo: number
  padrao: number
  editando: boolean
  podeAlterar: boolean
  onEditar: () => void
  children?: React.ReactNode
}) {
  const acima = etapa.mediana != null && etapa.mediana > prazo
  return (
    <li className={`rounded-xl border p-3 ${editando ? "border-sky-300 dark:border-sky-800" : "border-border"} bg-card`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="block text-[11px] text-muted-foreground">Etapa {indice} · {etapa.setor}</span>
          <span className="block text-sm font-bold leading-tight text-foreground">{etapa.nome}</span>
        </div>
        {podeAlterar && !editando && (
          <button
            type="button"
            onClick={onEditar}
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg border border-border px-3 text-xs font-semibold text-foreground hover:bg-muted sm:min-h-8"
          >
            <Pencil size={12} aria-hidden /> Alterar
          </button>
        )}
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Tempo mediano real</dt>
          <dd className={`font-bold tabular-nums ${acima ? TONE_SOFT.red.text : "text-foreground"}`}>
            {etapa.mediana == null ? "sem histórico" : textoDiasUteis(etapa.mediana)}
          </dd>
          {etapa.n > 0 && <dd className="text-[11px] text-muted-foreground">{plural(etapa.n, "paciente", "pacientes")}{acima ? " · acima do prazo" : ""}</dd>}
        </div>
        <div>
          <dt className="text-muted-foreground">No prazo</dt>
          <dd className="font-bold tabular-nums text-foreground">{etapa.pct_no_prazo == null ? "—" : `${etapa.pct_no_prazo}%`}</dd>
          <dd className="text-[11px] text-muted-foreground"><span className="tabular-nums">{etapa.em_aberto}</span> nesta etapa agora</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Prazo atual</dt>
          <dd className="text-base font-black tabular-nums text-foreground">{textoDiasUteis(prazo)}</dd>
          {prazo !== padrao && <dd className="text-[11px] text-muted-foreground">padrão do fluxo: {textoDiasUteis(padrao)}</dd>}
        </div>
      </dl>
      {etapa.etapa === "E6" && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Na Leve com início previsto, a autorização vence 1 dia útil antes do início (regra fixa do convênio): esse caso não usa este prazo.
        </p>
      )}
      {etapa.etapa === "E3" && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Entrevista já marcada: conta a data marcada (dias úteis após agendar) contra este prazo.
        </p>
      )}
      {children}
    </li>
  )
}

// ─── Histórico ───────────────────────────────────────────────────────────────

function ItemHistorico({ h }: { h: AlteracaoPrazo }) {
  const papel = ROTULO_ROLE[h.usuario_role] ?? h.usuario_role
  const imp = h.impacto ?? {}
  const temImpacto = imp.agora_antes != null || imp.pct_no_prazo_antes !== undefined
  return (
    <li className="rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        <span className="tabular-nums">{h.alterado_em_brasilia}</span>
        <span>
          <b className="text-foreground">{h.usuario_nome ?? "Usuário sem nome"}</b> · {papel}
          {h.usuario_email ? ` · ${h.usuario_email}` : ""}
        </span>
      </div>
      <p className="mt-1 text-sm font-semibold text-foreground">{h.resumo}</p>
      <p className="mt-1 border-l-2 border-border pl-2 text-xs text-foreground">{h.motivo}</p>
      {temImpacto && (
        <div className="mt-2">
          <p className="mb-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Efeito na hora{imp.snapshot_gerado_em ? ` (rodada de ${fmtDiaMes(imp.snapshot_gerado_em)})` : ""}
            {imp.mediana != null ? ` · mediana real da etapa: ${textoDiasUteis(imp.mediana)}` : ""}
          </p>
          <LinhasImpacto imp={imp} />
        </div>
      )}
      <details className="mt-1.5 text-[11px] text-muted-foreground">
        <summary className="cursor-pointer">Prazos vigentes depois desta alteração</summary>
        <p className="mt-1 tabular-nums">
          {Object.entries(h.prazos_vigentes ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([e, p]) => `${e}: ${p}`).join(" · ")}
        </p>
      </details>
    </li>
  )
}

function Historico({ itens }: { itens: AlteracaoPrazo[] }) {
  const [filtro, setFiltro] = useState("todas")
  const etapas = [...new Set(itens.map(h => h.etapa))].sort()
  const lista = filtro === "todas" ? itens : itens.filter(h => h.etapa === filtro)
  return (
    <section aria-labelledby="prazos-historico" className="mt-6 flex flex-col gap-2">
      <h3 id="prazos-historico" className="flex items-center gap-1.5 text-sm font-bold text-foreground">
        <History size={14} aria-hidden /> Histórico de alterações <span className="tabular-nums text-muted-foreground">({itens.length})</span>
      </h3>
      {itens.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          Nenhuma alteração desde a implantação: valem os prazos do fluxo v4 (09/10/2026).
        </p>
      ) : (
        <>
          {etapas.length > 1 && (
            <SegmentedTabs
              ariaLabel="Filtrar o histórico por etapa"
              value={filtro}
              onChange={setFiltro}
              tabs={[
                { value: "todas", label: "Todas", count: itens.length },
                ...etapas.map(e => ({ value: e, label: `Etapa ${e.slice(1)}`, count: itens.filter(h => h.etapa === e).length })),
              ]}
            />
          )}
          <ol className="flex flex-col gap-2">
            {lista.map(h => <ItemHistorico key={h.id} h={h} />)}
          </ol>
        </>
      )}
    </section>
  )
}

// ─── Drawer ──────────────────────────────────────────────────────────────────

export function PrazosDrawer({ dados, onClose, onAlterado }: {
  /** Rodada atual, já com os prazos vigentes aplicados. */
  dados: DadosPainel
  onClose: () => void
  /** Depois de salvar: recarregar o painel para a tela toda refletir o prazo novo. */
  onAlterado: () => void
}) {
  const { dados: prazos, loading, erro, salvando, alterar } = usePrazosEntradaConvenio(true)
  const { confirmar, dialogo } = useConfirmacao()
  const [editando, setEditando] = useState<string | null>(null)

  const vigentePor = useMemo(
    () => new Map<string, PrazoVigente>((prazos?.vigentes ?? []).map(v => [v.etapa, v])),
    [prazos],
  )
  const mapaAtual: MapaPrazos = useMemo(
    () => (prazos?.instalado && prazos.vigentes.length
      ? mapaDePrazos(prazos.vigentes)
      : Object.fromEntries(dados.etapas.map(e => [e.etapa, e.prazo]))),
    [prazos, dados.etapas],
  )
  const meta = Object.values(mapaAtual).reduce((s, n) => s + n, 0)
  const podeAlterar = !!prazos?.podeAlterar
  // Localhost sem login: abre o editor (para ver a prévia), mas Salvar fica travado.
  const mostrarAlterar = podeAlterar || (!!prazos?.instalado && !!prazos.semLogin)

  async function salvar(etapa: EtapaResumo, prazoAtual: number, novo: number, motivo: string) {
    const ok = await confirmar({
      titulo: `Alterar o prazo de ${etapa.nome}?`,
      texto: (
        <span className="flex flex-col gap-1.5">
          <span><b>{textoDiasUteis(prazoAtual)} → {textoDiasUteis(novo)}</b>. Muda na hora quem está dentro ou fora do prazo e a régua do fluxo, para todos que veem o painel.</span>
          <span>Fica no histórico com o seu nome, a data e o motivo.</span>
        </span>
      ),
      confirmar: "Alterar prazo",
    })
    if (!ok) return
    const r = await alterar(etapa.etapa, novo, motivo)
    if (r.ok) {
      toast.success(r.mensagem)
      setEditando(null)
      onAlterado()
    } else {
      toast.error(r.mensagem)
    }
  }

  return (
    <Drawer
      title="Prazos das etapas"
      subtitle={`Etapas 0 a 7 · meta ponta a ponta: ${textoDiasUteis(meta)}`}
      width="min(720px, 100vw)"
      onClose={onClose}
    >
      <p className="mb-3 text-sm text-foreground">
        O prazo de cada etapa define <b>quem está dentro ou fora do prazo</b> e a <b>régua do fluxo</b>. A meta ponta a ponta é a soma dos prazos.
        Só <b>Direção</b> e <b>Admin</b> alteram, sempre com motivo; toda alteração fica no histórico abaixo.
      </p>

      {erro && <InlineNotice tone="red" icon={<AlertTriangle size={14} />}>{erro}</InlineNotice>}
      {prazos && !prazos.instalado && (
        <InlineNotice tone="amber" icon={<AlertTriangle size={14} />}>
          A tabela de prazos ainda não foi instalada (migration 20261015160000 pendente). Mostrando os prazos do cálculo.
        </InlineNotice>
      )}
      {prazos?.instalado && !podeAlterar && prazos.motivoBloqueio && !mostrarAlterar && (
        <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock size={12} aria-hidden /> {prazos.motivoBloqueio}
        </p>
      )}
      {loading && !prazos && <p className="text-sm text-muted-foreground">Carregando os prazos...</p>}

      <ol className="mt-3 flex flex-col gap-2">
        {dados.etapas.map((e, i) => {
          const prazo = mapaAtual[e.etapa] ?? e.prazo
          const padrao = vigentePor.get(e.etapa)?.prazo_padrao ?? PRAZOS_PADRAO[e.etapa] ?? e.prazo
          const aberto = editando === e.etapa
          return (
            <LinhaEtapa
              key={e.etapa}
              etapa={e}
              indice={i}
              prazo={prazo}
              padrao={padrao}
              editando={aberto}
              podeAlterar={mostrarAlterar}
              onEditar={() => setEditando(e.etapa)}
            >
              {aberto && (
                <EditorPrazo
                  etapa={e}
                  atual={prazo}
                  padrao={padrao}
                  dados={dados}
                  prazos={mapaAtual}
                  bloqueio={podeAlterar ? null : prazos?.motivoBloqueio ?? null}
                  salvando={salvando}
                  onSalvar={(novo, motivo) => void salvar(e, prazo, novo, motivo)}
                  onCancelar={() => setEditando(null)}
                />
              )}
            </LinhaEtapa>
          )
        })}
      </ol>

      {prazos && <Historico itens={prazos.historico} />}
      {dialogo}
    </Drawer>
  )
}
