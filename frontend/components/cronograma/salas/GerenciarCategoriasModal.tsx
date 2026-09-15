"use client"

// GerenciarCategoriasModal — CRUD de Núcleo e Status (ambos livres: criar,
// renomear rótulo/cor, excluir). Editar aqui é restrito a Administrador/
// Diretoria (ver podeEditar) — outros papéis com acesso à página só veem a
// listagem, sem os controles de criar/editar/excluir. "operacional" é o único
// status protegido (não pode ser excluído — ver excluirStatusLabel em
// salas.service.ts). Andar e Unidade ficam de fora de propósito: são fixos no
// código (ver SalaEditModal.tsx), não fazem parte deste gerenciamento.

import { useEffect, useState } from "react"
import { Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react"
import { ScheduleModal } from "@/components/cronograma/ui/ScheduleModal"
import { ConfirmDialog } from "@/components/cronograma/ui/ConfirmDialog"
import { SegmentedTabs } from "@/components/cronograma/ui/SegmentedTabs"
import { getUsuarioAtual } from "@/lib/supabase/usuarioAtual"
import {
  listarNucleos, criarNucleo, renomearNucleo, excluirNucleo, moverSalasParaNucleo,
  listarStatusLabels, atualizarStatusLabel, criarStatusLabel, excluirStatusLabel, moverSalasParaStatus,
  type NucleoCadastrado, type StatusLabel, type StatusTone,
} from "@/services/salas.service"
import { TONE_ACCENT, type Tone } from "@/components/cronograma/ui/tones"
import type { SalaStatus } from "@/lib/cronograma/salasTypes"

const TONE_OPCOES: Tone[] = ["green", "amber", "blue", "purple", "red", "slate"]
const TONE_NOME: Record<Tone, string> = { green: "Verde", amber: "Âmbar", blue: "Azul", purple: "Roxo", red: "Vermelho", slate: "Cinza" }

const PAPEIS_EDITAM = ["admin", "diretoria"]

interface Props {
  onClose: () => void
  /** Chamado sempre que algo muda (núcleo criado/renomeado/excluído, ou status criado/editado/excluído) — quem abriu o modal deve recarregar suas próprias listas dependentes. */
  onChanged: () => void
}

const INPUT_CLS = "w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm text-foreground"

export function GerenciarCategoriasModal({ onClose, onChanged }: Props) {
  const [tab, setTab] = useState<"nucleos" | "status">("nucleos")
  const [podeEditar, setPodeEditar] = useState<boolean | null>(null)

  useEffect(() => {
    getUsuarioAtual().then(({ role }) => setPodeEditar(!!role && PAPEIS_EDITAM.includes(role)))
  }, [])

  return (
    <ScheduleModal title="Gerenciar categorias" subtitle="Núcleo e Status das salas. Andar e Unidade não são editáveis aqui." maxWidth={480} onClose={onClose}>
      <SegmentedTabs
        value={tab}
        onChange={setTab}
        ariaLabel="Categoria a gerenciar"
        tabs={[
          { value: "nucleos", label: "Núcleos" },
          { value: "status", label: "Status" },
        ]}
      />
      {podeEditar === false && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          Editar tipos de Status e Núcleos só pode ser feito por usuários Administradores do Pulsar, por favor, contate-os.
        </div>
      )}
      <div className="mt-4">
        {tab === "nucleos"
          ? <NucleosTab onChanged={onChanged} podeEditar={podeEditar === true} />
          : <StatusTab onChanged={onChanged} podeEditar={podeEditar === true} />}
      </div>
    </ScheduleModal>
  )
}

/** Diálogo genérico "mover salas antes de excluir" — usado tanto por Núcleo quanto por Status quando a exclusão é bloqueada por haver sala(s) em uso. */
function MoverEExcluirDialog({
  itemRotulo, nomeItem, opcoes, onConfirmar, onCancelar,
}: {
  itemRotulo: string
  nomeItem: string
  opcoes: { value: string; label: string }[]
  onConfirmar: (destino: string) => void
  onCancelar: () => void
}) {
  const [destino, setDestino] = useState(opcoes[0]?.value ?? "")

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40"
      onClick={e => { if (e.target === e.currentTarget) onCancelar() }}
    >
      <div style={{
        background: "var(--card)", borderRadius: "16px",
        boxShadow: "0 16px 48px rgba(0,0,0,.22)",
        padding: "24px", width: "min(440px, 94vw)",
        display: "flex", flexDirection: "column", gap: "16px",
      }}>
        <div style={{ fontWeight: 800, fontSize: "16px" }}>Mover salas antes de excluir</div>
        <div style={{ fontSize: "13px", color: "var(--muted-foreground)" }}>
          Ainda há sala(s) cadastrada(s) com {itemRotulo} &quot;{nomeItem}&quot;. Escolha para qual {itemRotulo} mover essas salas — depois disso, &quot;{nomeItem}&quot; será excluído.
        </div>
        {opcoes.length === 0 ? (
          <div className="text-xs font-semibold text-rose-600 dark:text-rose-400">
            Não há outra opção cadastrada para mover as salas. Crie uma nova antes de excluir esta.
          </div>
        ) : (
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold text-muted-foreground">Mover salas para</span>
            <select className={INPUT_CLS} value={destino} onChange={e => setDestino(e.target.value)}>
              {opcoes.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        )}
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button
            onClick={onCancelar}
            style={{ padding: "8px 16px", borderRadius: "10px", background: "var(--muted)", color: "var(--card-foreground)", border: "1px solid var(--border)", cursor: "pointer", fontWeight: 600, fontSize: "13px" }}
          >
            Cancelar
          </button>
          <button
            onClick={() => destino && onConfirmar(destino)}
            disabled={!destino}
            style={{ padding: "8px 18px", borderRadius: "10px", background: destino ? "#dc2626" : "#d1d5db", color: "white", border: "none", cursor: destino ? "pointer" : "not-allowed", fontWeight: 700, fontSize: "13px" }}
          >
            Mover e excluir
          </button>
        </div>
      </div>
    </div>
  )
}

function NucleosTab({ onChanged, podeEditar }: { onChanged: () => void; podeEditar: boolean }) {
  const [nucleos, setNucleos] = useState<NucleoCadastrado[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [novoNome, setNovoNome] = useState("")
  const [salvando, setSalvando] = useState(false)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [nomeEdicao, setNomeEdicao] = useState("")
  const [excluindo, setExcluindo] = useState<NucleoCadastrado | null>(null)
  const [emUso, setEmUso] = useState<NucleoCadastrado | null>(null)

  function carregar() {
    setLoading(true)
    listarNucleos().then(setNucleos).catch(e => setError(e.message)).finally(() => setLoading(false))
  }

  useEffect(carregar, [])

  async function handleAdicionar() {
    const nome = novoNome.trim()
    if (!nome) return
    setSalvando(true)
    setError(null)
    try {
      await criarNucleo(nome)
      setNovoNome("")
      carregar()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao criar núcleo.")
    } finally {
      setSalvando(false)
    }
  }

  async function handleRenomear(id: string) {
    const nome = nomeEdicao.trim()
    if (!nome) return
    setSalvando(true)
    setError(null)
    try {
      await renomearNucleo(id, nome)
      setEditandoId(null)
      carregar()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao renomear núcleo.")
    } finally {
      setSalvando(false)
    }
  }

  async function handleExcluir() {
    if (!excluindo) return
    setSalvando(true)
    setError(null)
    const alvo = excluindo
    setExcluindo(null)
    try {
      await excluirNucleo(alvo.id)
      carregar()
      onChanged()
    } catch (e) {
      if (e instanceof Error && e.message === "EM_USO") {
        setEmUso(alvo)
      } else {
        setError(e instanceof Error ? e.message : "Erro ao excluir núcleo.")
      }
    } finally {
      setSalvando(false)
    }
  }

  async function handleMoverEExcluir(destino: string) {
    if (!emUso) return
    setSalvando(true)
    setError(null)
    try {
      await moverSalasParaNucleo(emUso.id, emUso.nome, destino)
      await excluirNucleo(emUso.id)
      setEmUso(null)
      carregar()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao mover salas e excluir núcleo.")
      setEmUso(null)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {podeEditar && (
        <div className="flex items-center gap-2">
          <input
            className={INPUT_CLS}
            value={novoNome}
            onChange={e => setNovoNome(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleAdicionar() }}
            placeholder="Nome do novo núcleo"
          />
          <button
            type="button"
            onClick={handleAdicionar}
            disabled={salvando || !novoNome.trim()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#2B5E86] px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[#24506F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:bg-white dark:text-slate-900"
          >
            <Plus size={14} /> Adicionar
          </button>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Carregando...
        </div>
      )}

      {!loading && nucleos.length === 0 && (
        <div className="text-sm text-muted-foreground">Nenhum núcleo cadastrado ainda.</div>
      )}

      <div className="flex flex-col gap-1.5">
        {nucleos.map(n => (
          <div key={n.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
            {editandoId === n.id ? (
              <>
                <input
                  className={INPUT_CLS}
                  value={nomeEdicao}
                  onChange={e => setNomeEdicao(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleRenomear(n.id) }}
                  autoFocus
                />
                <button type="button" onClick={() => handleRenomear(n.id)} disabled={salvando} className="shrink-0 rounded-md p-1.5 text-emerald-600 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-400">
                  <Save size={14} />
                </button>
                <button type="button" onClick={() => setEditandoId(null)} className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted/60">
                  <X size={14} />
                </button>
              </>
            ) : (
              <>
                <span className="flex-1 truncate text-sm text-foreground">{n.nome}</span>
                {podeEditar && (
                  <>
                    <button type="button" onClick={() => { setEditandoId(n.id); setNomeEdicao(n.nome) }} className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted/60">
                      <Pencil size={14} />
                    </button>
                    <button type="button" onClick={() => setExcluindo(n)} className="shrink-0 rounded-md p-1.5 text-rose-600 hover:bg-rose-50 dark:text-rose-400">
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {error && <div className="text-xs font-semibold text-rose-600 dark:text-rose-400">{error}</div>}

      {excluindo && (
        <ConfirmDialog
          title="Excluir núcleo?"
          description={`Excluir "${excluindo.nome}"? Se houver sala(s) usando esse núcleo, você vai poder movê-las antes.`}
          confirmLabel="Excluir"
          confirmColor="#dc2626"
          onConfirm={handleExcluir}
          onCancel={() => setExcluindo(null)}
        />
      )}

      {emUso && (
        <MoverEExcluirDialog
          itemRotulo="o núcleo"
          nomeItem={emUso.nome}
          opcoes={nucleos.filter(n => n.id !== emUso.id).map(n => ({ value: n.nome, label: n.nome }))}
          onConfirmar={handleMoverEExcluir}
          onCancelar={() => setEmUso(null)}
        />
      )}
    </div>
  )
}

function StatusTab({ onChanged, podeEditar }: { onChanged: () => void; podeEditar: boolean }) {
  const [labels, setLabels] = useState<StatusLabel[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editandoCodigo, setEditandoCodigo] = useState<SalaStatus | null>(null)
  const [criando, setCriando] = useState(false)
  const [form, setForm] = useState<{ label: string; label_curto: string; tone: StatusTone }>({ label: "", label_curto: "", tone: "slate" })
  const [salvando, setSalvando] = useState(false)
  const [excluindo, setExcluindo] = useState<StatusLabel | null>(null)
  const [emUso, setEmUso] = useState<StatusLabel | null>(null)

  function carregar() {
    listarStatusLabels().then(setLabels).catch(e => setError(e.message))
  }

  useEffect(carregar, [])

  function formVazio(): { label: string; label_curto: string; tone: StatusTone } {
    return { label: "", label_curto: "", tone: "slate" }
  }

  async function handleSalvar(codigo: SalaStatus) {
    if (!form.label.trim() || !form.label_curto.trim()) return
    setSalvando(true)
    setError(null)
    try {
      await atualizarStatusLabel(codigo, form)
      setEditandoCodigo(null)
      carregar()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar rótulo.")
    } finally {
      setSalvando(false)
    }
  }

  async function handleCriar() {
    if (!form.label.trim() || !form.label_curto.trim()) return
    setSalvando(true)
    setError(null)
    try {
      await criarStatusLabel(form)
      setCriando(false)
      setForm(formVazio())
      carregar()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao criar status.")
    } finally {
      setSalvando(false)
    }
  }

  async function handleExcluir() {
    if (!excluindo) return
    setSalvando(true)
    setError(null)
    const alvo = excluindo
    setExcluindo(null)
    try {
      await excluirStatusLabel(alvo.codigo)
      carregar()
      onChanged()
    } catch (e) {
      if (e instanceof Error && e.message === "EM_USO") {
        setEmUso(alvo)
      } else {
        setError(e instanceof Error ? e.message : "Erro ao excluir status.")
      }
    } finally {
      setSalvando(false)
    }
  }

  async function handleMoverEExcluir(destino: string) {
    if (!emUso) return
    setSalvando(true)
    setError(null)
    try {
      await moverSalasParaStatus(emUso.codigo, destino)
      await excluirStatusLabel(emUso.codigo)
      setEmUso(null)
      carregar()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao mover salas e excluir status.")
      setEmUso(null)
    } finally {
      setSalvando(false)
    }
  }

  if (!labels) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={14} className="animate-spin" /> Carregando...
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-muted-foreground">
        Rótulo, rótulo curto e cor são editáveis. &quot;Operacional&quot; não pode ser excluído — o cálculo de ocupação depende dele.
      </div>

      {podeEditar && !criando && (
        <button
          type="button"
          onClick={() => { setCriando(true); setForm(formVazio()) }}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-muted/50"
        >
          <Plus size={14} /> Novo status
        </button>
      )}

      {criando && (
        <StatusForm
          form={form}
          setForm={setForm}
          salvando={salvando}
          onCancelar={() => setCriando(false)}
          onSalvar={handleCriar}
        />
      )}

      <div className="flex flex-col gap-1.5">
        {labels.map(l => {
          const codigo = l.codigo
          const editando = editandoCodigo === codigo
          const protegido = codigo === "operacional"
          return (
            <div key={codigo} className="flex flex-col gap-2 rounded-lg border border-border px-2.5 py-2">
              {editando ? (
                <StatusForm
                  form={form}
                  setForm={setForm}
                  salvando={salvando}
                  onCancelar={() => setEditandoCodigo(null)}
                  onSalvar={() => handleSalvar(codigo)}
                />
              ) : (
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: TONE_ACCENT[l.tone] }} />
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-foreground">{l.label}</div>
                    <div className="text-[11px] text-muted-foreground">código: {codigo} · rótulo curto: {l.label_curto}</div>
                  </div>
                  {podeEditar && (
                    <>
                      <button
                        type="button"
                        onClick={() => { setEditandoCodigo(codigo); setForm({ label: l.label, label_curto: l.label_curto, tone: l.tone }) }}
                        className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted/60"
                      >
                        <Pencil size={14} />
                      </button>
                      {!protegido && (
                        <button type="button" onClick={() => setExcluindo(l)} className="shrink-0 rounded-md p-1.5 text-rose-600 hover:bg-rose-50 dark:text-rose-400">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {error && <div className="text-xs font-semibold text-rose-600 dark:text-rose-400">{error}</div>}

      {excluindo && (
        <ConfirmDialog
          title="Excluir status?"
          description={`Excluir "${excluindo.label}"? Se houver sala(s) com esse status, você vai poder movê-las antes.`}
          confirmLabel="Excluir"
          confirmColor="#dc2626"
          onConfirm={handleExcluir}
          onCancel={() => setExcluindo(null)}
        />
      )}

      {emUso && (
        <MoverEExcluirDialog
          itemRotulo="o status"
          nomeItem={emUso.label}
          opcoes={labels.filter(l => l.codigo !== emUso.codigo).map(l => ({ value: l.codigo, label: l.label }))}
          onConfirmar={handleMoverEExcluir}
          onCancelar={() => setEmUso(null)}
        />
      )}
    </div>
  )
}

/** Formulário de label/label_curto/tone, reaproveitado por criar e editar status. */
function StatusForm({
  form, setForm, salvando, onCancelar, onSalvar,
}: {
  form: { label: string; label_curto: string; tone: StatusTone }
  setForm: (fn: (f: { label: string; label_curto: string; tone: StatusTone }) => { label: string; label_curto: string; tone: StatusTone }) => void
  salvando: boolean
  onCancelar: () => void
  onSalvar: () => void
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border px-2.5 py-2">
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-semibold text-muted-foreground">Rótulo (formulário)</span>
        <input className={INPUT_CLS} value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} autoFocus />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-semibold text-muted-foreground">Rótulo curto (filtros/badges)</span>
        <input className={INPUT_CLS} value={form.label_curto} onChange={e => setForm(f => ({ ...f, label_curto: e.target.value }))} />
      </label>
      <div className="flex flex-col gap-1 text-xs">
        <span className="font-semibold text-muted-foreground">Cor</span>
        <div className="flex flex-wrap gap-1.5">
          {TONE_OPCOES.map(tone => (
            <button
              key={tone}
              type="button"
              title={TONE_NOME[tone]}
              onClick={() => setForm(f => ({ ...f, tone }))}
              className={`h-7 w-7 rounded-full border-2 transition-transform ${form.tone === tone ? "scale-110 border-foreground" : "border-transparent"}`}
              style={{ background: TONE_ACCENT[tone] }}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <button type="button" onClick={onCancelar} className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted/50">Cancelar</button>
        <button
          type="button"
          onClick={onSalvar}
          disabled={salvando || !form.label.trim() || !form.label_curto.trim()}
          className="inline-flex items-center gap-1 rounded-lg bg-[#2B5E86] px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-[#24506F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:bg-white dark:text-slate-900"
        >
          <Save size={12} /> Salvar
        </button>
      </div>
    </div>
  )
}
