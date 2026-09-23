'use client'

import React, { useState } from 'react'
import { 
  X, 
  Sparkles, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Copy, 
  Check, 
  RefreshCw,
  User,
  Calendar,
  Tag,
  ShieldCheck,
  Clock,
  History
} from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { BOTAO_SECUNDARIO } from './vocabulario'
import type {
  EvolucaoPendenteAuditoria,
  StatusCobrancaEvolucao
} from '@/types/auditoriaEvolucoes'
// Rótulos dos 4 pilares. Usa o fallback (v1) porque as chaves são congeladas e
// os rótulos da v1 são os que a tela sempre mostrou; quando a Etapa 2 permitir
// renomeá-los, o painel de critérios já exibe a versão vigente.
import { CRITERIOS_FALLBACK } from '@/lib/auditoria/criterios'

const ROTULOS_STATUS_COBRANCA: Record<StatusCobrancaEvolucao, string> = {
  pendente: 'Pendente de Cobrança',
  cobrado: 'Cobrado do Profissional',
  aguardando_correcao: 'Aguardando Correção',
  corrigido_tita: 'Corrigido no TiTa',
  ignorado: 'Dispensado / Ignorado'
}

/**
 * Cores de risco alinhadas ao Status Lock Rule do DESIGN.md: rose é sempre o
 * estado negativo do sistema (não red-*, que é uma família Tailwind à parte).
 */
const RISCO_TONE = {
  sem_risco: {
    bg: 'bg-emerald-100 dark:bg-emerald-950/60',
    text: 'text-emerald-700 dark:text-emerald-300',
    border: 'border-emerald-200 dark:border-emerald-800'
  },
  risco_especifico: {
    bg: 'bg-amber-100 dark:bg-amber-950/60',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-200 dark:border-amber-800'
  },
  risco_relevante: {
    bg: 'bg-rose-100 dark:bg-rose-950/60',
    text: 'text-rose-700 dark:text-rose-300',
    border: 'border-rose-200 dark:border-rose-800'
  }
} as const

const GRAVIDADE_TONE: Record<string, string> = {
  alta: 'bg-rose-200 text-rose-800 dark:bg-rose-900 dark:text-rose-200',
  media: 'bg-amber-200 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
}

interface Props {
  item: EvolucaoPendenteAuditoria | null
  isOpen: boolean
  onClose: () => void
  onReauditar: (gradeId: string) => Promise<void>
  onAtualizarStatusCobranca: (auditoriaId: string, novoStatus: StatusCobrancaEvolucao, observacao?: string) => Promise<void>
}

export function ModalDetalheEvolucao({
  item,
  isOpen,
  onClose,
  onReauditar,
  onAtualizarStatusCobranca
}: Props) {
  const [copiado, setCopiado] = useState(false)
  const [reauditando, setReauditando] = useState(false)
  const [salvandoStatus, setSalvandoStatus] = useState(false)
  const [novoStatus, setNovoStatus] = useState<StatusCobrancaEvolucao>(
    item?.auditoria?.status_cobranca ?? 'pendente'
  )
  const [observacaoStatus, setObservacaoStatus] = useState('')

  if (!isOpen || !item) return null

  const aud = item.auditoria

  const fecharComConfirmacao = () => {
    if (observacaoStatus.trim() !== '') {
      const confirmar = window.confirm(
        'A observação digitada ainda não foi salva e será perdida. Fechar mesmo assim?'
      )
      if (!confirmar) return
    }
    onClose()
  }

  const handleCopiarTextoRevisado = async () => {
    if (!aud?.texto_revisado) return
    try {
      await navigator.clipboard.writeText(aud.texto_revisado)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2500)
    } catch (e) {
      console.error(e)
    }
  }

  const handleReauditarClick = async () => {
    setReauditando(true)
    try {
      await onReauditar(item.grade_id)
    } finally {
      setReauditando(false)
    }
  }

  const handleSalvarStatus = async () => {
    if (!aud?.id) return
    setSalvandoStatus(true)
    try {
      await onAtualizarStatusCobranca(aud.id, novoStatus, observacaoStatus)
      setObservacaoStatus('')
    } finally {
      setSalvandoStatus(false)
    }
  }

  const getRiscoBadge = () => {
    if (!aud) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
          <Clock className="w-3.5 h-3.5" /> Não Auditado
        </span>
      )
    }
    if (aud.status_risco === 'sem_risco') {
      const tone = RISCO_TONE.sem_risco
      return (
        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${tone.bg} ${tone.text} border ${tone.border}`}>
          <CheckCircle2 className="w-3.5 h-3.5" /> Sem Risco de Glosa
        </span>
      )
    }
    if (aud.status_risco === 'risco_especifico') {
      const tone = RISCO_TONE.risco_especifico
      return (
        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${tone.bg} ${tone.text} border ${tone.border}`}>
          <AlertTriangle className="w-3.5 h-3.5" /> Risco em Ponto Específico
        </span>
      )
    }
    const tone = RISCO_TONE.risco_relevante
    return (
      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${tone.bg} ${tone.text} border ${tone.border}`}>
        <XCircle className="w-3.5 h-3.5" /> Risco Relevante de Glosa
      </span>
    )
  }

  return (
    <Dialog open onOpenChange={aberto => { if (!aberto) fecharComConfirmacao() }}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        // Casca do padrão do sistema (docs/padrao-detalhamento-modal.md §4):
        // header fixo + corpo com scroll próprio. Sem o minmax(0,…) o corpo não
        // encolhe e o modal cresce além da viewport.
        // max-w-5xl, não os 350 da referência: aqui não há tabela de 7 colunas,
        // e sim texto de evolução para ler — linha larga demais atrapalha.
        className="h-[90vh] w-[90vw] max-w-5xl gap-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl bg-card p-0 sm:max-w-5xl"
      >
        {/* ── Cabeçalho ──────────────────────────────────────────────────────
            Empilha no mobile: numa linha só o nome do paciente disputa largura
            com o badge de risco e quebra letra a letra. */}
        <header className="relative flex flex-col gap-3 border-b border-border px-5 py-4 md:px-6 lg:flex-row lg:items-center lg:gap-x-6">
          <div className="min-w-0 space-y-1 lg:flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-fg">
                Auditoria Clínica &amp; Anti-Glosa
              </span>
              {getRiscoBadge()}
            </div>
            <DialogTitle className="truncate text-base font-bold text-foreground">
              {item.paciente_nome}
            </DialogTitle>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <User className="h-3 w-3" /> {item.profissional_nome}
              </span>
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {new Date(item.data_sessao + 'T12:00:00Z').toLocaleDateString('pt-BR')}
              </span>
              <span className="inline-flex items-center gap-1">
                <Tag className="h-3 w-3" /> {item.terapia_nome || 'Terapia'}
              </span>
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2 pr-11">
            <button
              onClick={handleReauditarClick}
              disabled={reauditando}
              title="Reauditar com IA"
              className={BOTAO_SECUNDARIO}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${reauditando ? 'motion-safe:animate-spin' : ''}`} />
              {reauditando ? 'Auditando…' : 'Reauditar'}
            </button>
          </div>

          {/* Absoluto para não empurrar o nome no mobile. */}
          <button
            type="button"
            onClick={fecharComConfirmacao}
            aria-label="Fechar detalhe da evolução"
            className="absolute top-3 right-3 flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <X size={18} />
          </button>
        </header>

        {/* ── Corpo ──────────────────────────────────────────────────────── */}
        <div className="overflow-y-auto px-5 py-5 md:px-6 space-y-6">

          {/*
            A última tentativa falhou. O veredito abaixo é da tentativa anterior
            — dizer isso é o ponto: antes, uma falha virava veredito plausível e
            ninguém distinguia "a IA analisou" de "a IA não respondeu".
          */}
          {aud?.erro_auditoria && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/30">
              <p className="flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                A última tentativa de auditoria falhou
              </p>
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                O resultado abaixo é da análise anterior. Use “Reauditar” para tentar de novo.
              </p>
              <p className="mt-1 text-xs text-amber-600/80 dark:text-amber-500/80">
                {aud.erro_auditoria}
              </p>
            </div>
          )}

          {/* Checklist dos 4 Pilares Fundamentais */}
          {aud && (
            <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-brand-fg" />
                Estrutura Mínima Obrigatória (4 Perguntas)
              </h3>
              
              {/*
                Rótulos vêm dos critérios, não do JSX: quando o terapêutico
                renomear um pilar, o checklist acompanha. O casamento é pela
                `chave`, que é congelada — a posição no array não importa.
              */}
              <div className="grid grid-cols-2 gap-2.5 text-xs">
                {CRITERIOS_FALLBACK.pilares.map((pilar, i) => {
                  const atendido = Boolean(aud.checklist_perguntas?.[pilar.chave])
                  return (
                    <div
                      key={pilar.chave}
                      className="flex items-center gap-2 p-2 rounded-lg bg-background border border-border"
                    >
                      {atendido ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 text-rose-500 shrink-0" />
                      )}
                      <span className={atendido ? 'text-foreground' : 'text-rose-600 dark:text-rose-400 font-medium'}>
                        {i + 1}. {pilar.rotulo}
                      </span>
                    </div>
                  )
                })}
              </div>

              {aud.resumo_justificativa && (
                <div className="pt-1 text-xs text-muted-foreground italic bg-brand/5 p-2.5 rounded-lg border border-brand/10">
                  💡 {aud.resumo_justificativa}
                </div>
              )}
            </div>
          )}

          {/* Apontamentos de Risco de Glosa */}
          {aud && aud.apontamentos && aud.apontamentos.length > 0 && (
            <div className="space-y-2.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Pontos de Atenção & Risco de Glosa ({aud.apontamentos.length})
              </h3>
              <div className="space-y-2">
                {aud.apontamentos.map((ap, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-xl bg-rose-50/60 dark:bg-rose-950/30 border border-rose-200/70 dark:border-rose-900/50 space-y-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-rose-900 dark:text-rose-200 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                        {ap.titulo}
                      </span>
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                        GRAVIDADE_TONE[ap.gravidade] ?? 'bg-muted text-muted-foreground'
                      }`}>
                        Gravidade {ap.gravidade}
                      </span>
                    </div>
                    <p className="text-foreground leading-relaxed">
                      {ap.descricao}
                    </p>
                    {ap.trecho && (
                      <div className="p-1.5 bg-background rounded font-mono text-[11px] text-rose-700 dark:text-rose-400 border border-rose-100 dark:border-rose-900/30">
                        &quot;{ap.trecho}&quot;
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Comparativo: Original vs Revisado */}
          <div className="space-y-4">
            
            {/* Texto Original */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground flex items-center justify-between">
                <span>Texto Original (Escrito pelo Profissional)</span>
                <span className="text-[11px] text-muted-foreground font-normal">
                  {item.texto_original?.length || 0} caracteres
                </span>
              </label>
              <div className="p-3.5 rounded-xl bg-muted/60 text-xs text-foreground border border-border leading-relaxed font-sans whitespace-pre-wrap">
                {item.texto_original || '(Sem texto de evolução)'}
              </div>
            </div>

            {/* Texto Revisado Sugerido */}
            {aud?.texto_revisado && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    Texto Revisado & Padronizado (Pronto para Prontuário)
                  </label>
                  <button
                    onClick={handleCopiarTextoRevisado}
                    className="flex items-center gap-1 text-[11px] text-brand-fg hover:underline font-medium"
                  >
                    {copiado ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                    {copiado ? 'Copiado!' : 'Copiar Texto'}
                  </button>
                </div>
                <div className="relative group">
                  <div className="p-4 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 text-xs text-foreground border border-emerald-200 dark:border-emerald-800/60 leading-relaxed font-sans whitespace-pre-wrap selection:bg-emerald-500/30">
                    {aud.texto_revisado}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Gestão de Cobrança / Tratativa */}
          {aud && (
            <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
                <History className="w-4 h-4 text-brand-fg" />
                Status de Cobrança & Histórico
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground flex items-center justify-between">
                    <span>Alterar Status:</span>
                    <span className="text-[11px] text-muted-foreground/80">
                      Status atual: {ROTULOS_STATUS_COBRANCA[aud.status_cobranca]}
                    </span>
                  </label>
                  <select
                    value={novoStatus}
                    onChange={e => setNovoStatus(e.target.value as StatusCobrancaEvolucao)}
                    className="w-full text-xs p-2 rounded-lg border border-border bg-background text-foreground focus:ring-2 focus:ring-ring"
                  >
                    <option value="pendente">Pendente de Cobrança</option>
                    <option value="cobrado">Cobrado do Profissional</option>
                    <option value="aguardando_correcao">Aguardando Correção</option>
                    <option value="corrigido_tita">Corrigido no TiTa</option>
                    <option value="ignorado">Dispensado / Ignorado</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Observação:</label>
                  <input
                    type="text"
                    placeholder="Ex: Cobrado via WhatsApp em 21/09..."
                    value={observacaoStatus}
                    onChange={e => setObservacaoStatus(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg border border-border bg-background text-foreground focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  onClick={handleSalvarStatus}
                  disabled={salvandoStatus}
                  className="px-4 py-1.5 rounded-lg bg-brand-fg hover:bg-brand-dark text-white text-xs font-medium shadow-sm transition disabled:opacity-50"
                >
                  {salvandoStatus ? 'Salvando...' : 'Salvar Alteração'}
                </button>
              </div>

              {/* Log de Histórico */}
              {aud.historico_cobranca && aud.historico_cobranca.length > 0 && (
                <div className="pt-2 border-t border-border space-y-1.5">
                  <span className="text-[11px] font-semibold text-muted-foreground block">Trilha de Tratativas:</span>
                  <div className="space-y-1 max-h-28 overflow-y-auto">
                    {aud.historico_cobranca.map((h, i) => (
                      <div key={i} className="text-[11px] text-muted-foreground flex items-start gap-2">
                        <span className="font-mono text-muted-foreground text-[10px]">
                          {new Date(h.data).toLocaleString('pt-BR')}
                        </span>
                        <span className="font-medium text-foreground">{h.usuario}:</span>
                        <span>{h.acao} {h.observacao ? `(${h.observacao})` : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Procedência da análise: ruído técnico vive no rodapé do detalhe,
              nunca competindo com o veredito (§3.8 do padrão). */}
          <p className="border-t border-border pt-3 text-xs text-muted-foreground">
            {aud?.auditado_em
              ? `Auditado em ${new Date(aud.auditado_em).toLocaleString('pt-BR')}`
              : 'Não auditado'}
            {aud?.criterios_versao_numero != null && ` · critérios v${aud.criterios_versao_numero}`}
            {aud?.modelo_ia && ` · ${aud.modelo_ia}`}
          </p>

        </div>
      </DialogContent>
    </Dialog>
  )
}
