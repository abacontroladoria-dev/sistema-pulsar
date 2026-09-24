'use client'

import React, { useEffect, useRef, useState } from 'react'
import {
  X, ShieldCheck, Ban, BookOpen, Scale, History, Info, ListChecks,
  Download, Upload, Save, AlertTriangle, ScrollText, FileText, CheckCircle2, Loader2
} from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ModalConfirmacao } from './ModalConfirmacao'
import { buscarCriteriosVigentes, listarVersoes, type CriteriosVigentesUI } from '@/services/auditoriaCriterios.service'
import {
  criteriosParaMarkdown,
  markdownParaCriterios,
  lerVersaoOrigem
} from '@/lib/auditoria/criteriosMarkdown'
import {
  criteriosParaDocx,
  docxParaMarkdown,
  lerVersaoOrigemDocx
} from '@/lib/auditoria/criteriosDocx'
import { CriteriosInvalidosError } from '@/lib/auditoria/criterios'
import type { CriteriosAuditoria, VersaoCriteriosAuditoria } from '@/types/auditoriaCriterios'
import { ROTULO_RISCO, BOTAO_PRIMARIO, BOTAO_SECUNDARIO, CAMPO } from './vocabulario'
import type { StatusRiscoEvolucao } from '@/types/auditoriaEvolucoes'

interface Props {
  isOpen: boolean
  onClose: () => void
  /** Avisa a tela que saiu versão nova, para ela reavaliar o que ficou para trás. */
  onPublicou?: () => void | Promise<void>
  /** Evoluções já auditadas por uma versão anterior à vigente. */
  totalDesatualizadas: number
  onReauditarDesatualizadas: () => void
  auditandoLote: boolean
}

/** O que voltou de um arquivo subido e ainda não foi publicado. */
interface Pendente {
  criterios: CriteriosAuditoria
  nomeArquivo: string
  /** De qual versão o arquivo saiu — `null` quando o carimbo foi apagado. */
  versaoOrigem: number | null
}

/**
 * Os critérios que a IA aplica: ver, baixar, editar fora e subir de volta.
 *
 * POR QUE NÃO SE EDITA AQUI DENTRO. O usuário escolheu o fluxo de arquivo em vez
 * do formulário. Faz sentido para o que isto é: a régua muda raramente, a
 * mudança é revisada por mais de uma pessoa antes de valer, e o .md circula por
 * e-mail/WhatsApp para essa revisão — coisa que um formulário em modal não
 * permite. Edição parcial no meio de uma tela também convida a publicar sem ler
 * o conjunto; o arquivo obriga a passar o olho no todo.
 *
 * O CAMINHO INTEIRO: Baixar .md → editar no Word/Bloco de Notas → Subir → a tela
 * mostra o que mudou → nota do que mudou → publicar. Nada é sobrescrito: publicar
 * cria uma versão nova e imutável.
 *
 * As chaves congeladas (as 4 perguntas, os 3 riscos) viajam entre parênteses nos
 * títulos do .md e são conferidas na volta — ver lib/auditoria/criteriosMarkdown.
 *
 * Casca do padrão do sistema (docs/padrao-detalhamento-modal.md §4): Dialog do
 * Radix, header fixo, corpo com scroll próprio, 3ª linha para o rodapé de ações.
 */
export function ModalCriterios({
  isOpen,
  onClose,
  onPublicou,
  totalDesatualizadas,
  onReauditarDesatualizadas,
  auditandoLote
}: Props) {
  const [vigente, setVigente] = useState<CriteriosVigentesUI | null>(null)
  const [versoes, setVersoes] = useState<VersaoCriteriosAuditoria[]>([])
  const [carregando, setCarregando] = useState(true)
  const [historicoAberto, setHistoricoAberto] = useState(false)

  const [pendente, setPendente] = useState<Pendente | null>(null)
  /** Nome do arquivo em leitura; o .docx grande leva segundos no mammoth. */
  const [lendoArquivo, setLendoArquivo] = useState<string | null>(null)
  const [nota, setNota] = useState('')
  const [publicando, setPublicando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  // 'fechar': descartar veio do X/Esc/fora, então limpa e fecha o modal.
  // 'limpar': descartar veio do botão do rodapé, então só limpa o pendente.
  const [confirmarDescarte, setConfirmarDescarte] = useState<'fechar' | 'limpar' | null>(null)
  const inputArquivo = useRef<HTMLInputElement>(null)

  const recarregar = async () => {
    const [v, hist] = await Promise.all([buscarCriteriosVigentes(), listarVersoes()])
    setVigente(v)
    setVersoes(hist)
    setCarregando(false)
  }

  useEffect(() => {
    if (!isOpen) return
    let cancelado = false

    // setState síncrono no corpo do efeito dispara render em cascata; por isso
    // o estado só é tocado depois do await.
    void (async () => {
      const [v, hist] = await Promise.all([buscarCriteriosVigentes(), listarVersoes()])
      if (cancelado) return
      setVigente(v)
      setVersoes(hist)
      setCarregando(false)
    })()

    return () => {
      cancelado = true
      // Reabrir recarrega e descarta o pendente: entre uma abertura e outra pode
      // ter saído versão nova, e publicar por cima dela seria sobrescrever alheio.
      setCarregando(true)
      setPendente(null)
      setLendoArquivo(null)
      setNota('')
      setErro(null)
      setConfirmando(false)
      setConfirmarDescarte(null)
    }
  }, [isOpen])

  if (!isOpen) return null

  // O que está em tela: o arquivo subido, se houver, senão o vigente.
  const criterios = pendente?.criterios ?? vigente?.criterios

  const baixarMd = () => {
    if (!vigente?.criterios) return
    const md = criteriosParaMarkdown(vigente.criterios, { versaoOrigem: vigente.versao })
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `criterios-auditoria-v${vigente.versao ?? 'padrao'}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const baixarDocx = async () => {
    if (!vigente?.criterios) return
    const blob = await criteriosParaDocx(vigente.criterios, { versaoOrigem: vigente.versao })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `criterios-auditoria-v${vigente.versao ?? 'padrao'}.docx`
    a.click()
    URL.revokeObjectURL(url)
  }

  const subir = async (arquivo: File) => {
    setErro(null)
    setConfirmando(false)
    setLendoArquivo(arquivo.name)
    try {
      const ehDocx = arquivo.name.toLowerCase().endsWith('.docx')
      const texto = ehDocx ? await docxParaMarkdown(arquivo) : await arquivo.text()
      const lidos = markdownParaCriterios(texto)
      setPendente({
        criterios: lidos,
        nomeArquivo: arquivo.name,
        versaoOrigem: ehDocx ? lerVersaoOrigemDocx(texto) : lerVersaoOrigem(texto)
      })
    } catch (e) {
      setPendente(null)
      setErro(
        e instanceof CriteriosInvalidosError
          ? e.message.replace(/^Critérios de auditoria inválidos:\s*/, '')
          : 'Não consegui ler o arquivo. Ele precisa ser o .md ou .docx baixado desta tela.'
      )
    } finally {
      setLendoArquivo(null)
    }
  }

  const publicar = async () => {
    if (!pendente) return
    setPublicando(true)
    setErro(null)
    try {
      const res = await fetch('/api/terapeutico/auditoria-evolucoes/criterios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conteudo: pendente.criterios, nota_publicacao: nota })
      })
      const json = await res.json()
      if (!json.success) {
        setErro(json.error || 'Não foi possível publicar.')
        setConfirmando(false)
        return
      }
      setPendente(null)
      setNota('')
      setConfirmando(false)
      await recarregar()
      await onPublicou?.()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha de rede ao publicar.')
      setConfirmando(false)
    } finally {
      setPublicando(false)
    }
  }

  const tentarFechar = () => {
    if (pendente) {
      setConfirmarDescarte('fechar')
      return
    }
    onClose()
  }

  const confirmarEDescartar = () => {
    setPendente(null)
    setNota('')
    setErro(null)
    if (confirmarDescarte === 'fechar') onClose()
    setConfirmarDescarte(null)
  }

  // O arquivo saiu de uma versão que já não é a mais nova: publicar por cima
  // apagaria a alteração de quem publicou no meio do caminho.
  const desatualizado =
    pendente !== null &&
    vigente?.versao != null &&
    pendente.versaoOrigem !== null &&
    pendente.versaoOrigem < vigente.versao

  return (
    <>
    <Dialog open onOpenChange={aberto => { if (!aberto) tentarFechar() }}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        // Casca do padrão (docs/padrao-detalhamento-modal.md §4): header fixo +
        // corpo que rola, via grid-rows-[auto_minmax(0,1fr)]. Aqui há uma 3ª
        // linha `auto` para o rodapé de ações — sem o minmax(0,…) o corpo não
        // encolhe e o modal passa da viewport. Mais estreito que os 350 da
        // referência: isto é texto para ler, e linha longa atrapalha a leitura.
        className="h-[90vh] w-[90vw] max-w-4xl gap-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl bg-card p-0 sm:max-w-4xl"
        // Com arquivo subido e não publicado, clique fora e Esc não fecham
        // direto — abrem a confirmação de descarte, não silenciam a tentativa.
        onInteractOutside={e => { if (pendente) { e.preventDefault(); tentarFechar() } }}
        onEscapeKeyDown={e => { if (pendente) { e.preventDefault(); tentarFechar() } }}
      >
        {/* ── Cabeçalho ──────────────────────────────────────────────────── */}
        <header className="relative flex items-start justify-between gap-3 border-b border-border px-5 py-4 md:px-6">
          <div className="min-w-0 space-y-1">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-brand-fg">
              <ScrollText className="h-3.5 w-3.5" />
              Critérios da auditoria
            </span>
            <DialogTitle className="text-base font-bold text-foreground">
              {pendente ? 'Conferindo o arquivo subido' : 'O que a IA verifica em cada evolução'}
            </DialogTitle>
            {!carregando && vigente && !pendente && (
              <p className="text-xs text-muted-foreground">
                {vigente.versao !== null ? (
                  <>
                    Versão {vigente.versao} · publicada por {vigente.publicadoPorNome}
                    {vigente.publicadoEm &&
                      ` em ${new Date(vigente.publicadoEm).toLocaleDateString('pt-BR')}`}
                  </>
                ) : (
                  'Critérios padrão do sistema'
                )}
              </p>
            )}
            {pendente && (
              <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <FileText className="h-3 w-3 shrink-0" />
                {pendente.nomeArquivo} — ainda não publicado.
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {!carregando && !pendente && (
              <>
                <button
                  onClick={() => void baixarDocx()}
                  disabled={Boolean(lendoArquivo)}
                  className={BOTAO_SECUNDARIO}
                >
                  <Download className="h-3.5 w-3.5" />
                  Baixar Critérios
                </button>
                <button
                  onClick={() => inputArquivo.current?.click()}
                  disabled={Boolean(lendoArquivo)}
                  aria-busy={Boolean(lendoArquivo)}
                  className={BOTAO_SECUNDARIO}
                >
                  {lendoArquivo ? (
                    <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  {lendoArquivo ? 'Lendo arquivo…' : 'Subir arquivo'}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={tentarFechar}
              aria-label="Fechar critérios"
              className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <X size={18} />
            </button>
          </div>

          {/*
            O input fica sempre montado e escondido: um <input type=file> só abre
            o seletor a partir de clique do usuário, então não dá para criá-lo
            sob demanda. `value=''` a cada escolha permite subir o MESMO arquivo
            duas vezes seguidas (depois de corrigi-lo) — sem isso o onChange não
            dispara na segunda.
          */}
          <input
            ref={inputArquivo}
            type="file"
            accept=".md,.docx,text/markdown,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={e => {
              const arquivo = e.target.files?.[0]
              e.target.value = ''
              if (arquivo) void subir(arquivo)
            }}
          />
        </header>

        {/* ── Corpo ──────────────────────────────────────────────────────── */}
        <div className="overflow-y-auto px-5 py-5 md:px-6 space-y-6">
          {carregando || !criterios ? (
            <div className="space-y-3">
              {[0, 1, 2].map(i => (
                <div key={i} className="h-24 rounded-xl bg-muted/50 motion-safe:animate-pulse" />
              ))}
            </div>
          ) : (
            <>
              {lendoArquivo && (
                <div
                  role="status"
                  className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/50 p-3 text-xs text-foreground"
                >
                  <Loader2 className="h-4 w-4 shrink-0 text-brand-fg motion-safe:animate-spin" />
                  <span>
                    Lendo <strong className="font-semibold">{lendoArquivo}</strong>… pode levar alguns
                    segundos. Os critérios abaixo ainda são os vigentes.
                  </span>
                </div>
              )}

              {erro && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-900/60 dark:bg-rose-950/30">
                  <p className="flex items-start gap-2 text-xs text-rose-700 dark:text-rose-300">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      <strong className="block">O arquivo não pôde ser lido.</strong>
                      {erro}
                    </span>
                  </p>
                </div>
              )}

              {desatualizado && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/30">
                  <p className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Este arquivo saiu da versão {pendente?.versaoOrigem}, mas a vigente já é
                      a {vigente?.versao}. Publicando, o que mudou nesse intervalo se perde.
                      Baixe de novo e refaça a alteração, se puder.
                    </span>
                  </p>
                </div>
              )}

              {pendente && !erro && (
                <div className="rounded-xl border border-border bg-muted/40 p-3">
                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    <span>
                      Arquivo lido. <strong className="text-foreground">Confira abaixo</strong> como
                      os critérios ficaram e, se estiver certo, publique no rodapé.
                    </span>
                  </p>
                </div>
              )}

              {!pendente && (
                <div className="rounded-xl border border-dashed border-border p-3">
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Para mudar a régua: <strong className="text-foreground">Baixar .docx</strong>,
                    editar o texto no Word e <strong className="text-foreground">Subir arquivo</strong> de
                    volta (aceita .docx ou .md). Não apague as linhas de título nem mude o estilo
                    delas (Título 2/3), e não mexa no que está entre parênteses — é o que liga cada
                    item ao sistema.
                  </p>
                </div>
              )}

              <Secao icone={<Info className="w-4 h-4 text-brand-fg" />} titulo="Instrução geral">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {criterios.abertura}
                </p>
              </Secao>

              <Secao
                icone={<ListChecks className="w-4 h-4 text-brand-fg" />}
                titulo="Conferência estrutural"
              >
                <ul className="space-y-1.5">
                  {criterios.conferencia_estrutural.map((item, i) => (
                    <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                      <span>•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </Secao>

              <Secao
                icone={<ShieldCheck className="w-4 h-4 text-brand-fg" />}
                titulo="As 4 perguntas obrigatórias"
              >
                <div className="space-y-2">
                  {criterios.pilares.map((p, i) => (
                    <div key={p.chave} className="rounded-lg border border-border bg-background p-2.5">
                      <p className="text-xs font-semibold text-foreground">
                        {i + 1}. {p.rotulo}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{p.descricao}</p>
                    </div>
                  ))}
                </div>
              </Secao>

              <Secao
                icone={<BookOpen className="w-4 h-4 text-brand-fg" />}
                titulo="Regras para situações específicas"
              >
                <div className="space-y-2">
                  {criterios.regras_especificas.map((r, i) => (
                    <div key={i}>
                      <p className="text-xs font-semibold text-foreground">{r.titulo}</p>
                      <p className="text-xs text-muted-foreground">{r.texto}</p>
                    </div>
                  ))}
                </div>
              </Secao>

              <Secao
                icone={<Ban className="w-4 h-4 text-rose-500" />}
                titulo="Palavras e frases que geram glosa"
              >
                <div className="space-y-3">
                  {criterios.termos_proibidos.map((g, i) => (
                    <div key={i}>
                      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        {g.categoria}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {g.termos.map((t, j) => (
                          <span
                            key={j}
                            className="inline-flex items-center rounded-md bg-rose-500/10 px-1.5 py-0.5 text-xs text-rose-700 dark:text-rose-300"
                          >
                            {t}
                          </span>
                        ))}
                        {g.termos.length === 0 && (
                          <p className="text-xs italic text-muted-foreground">
                            Sem lista fechada — avaliado caso a caso.
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Secao>

              <Secao
                icone={<Scale className="w-4 h-4 text-brand-fg" />}
                titulo="Como o risco é classificado"
              >
                <div className="space-y-2">
                  {criterios.status_risco.map(s => (
                    <div key={s.chave}>
                      <p className="text-xs font-semibold text-foreground">
                        {ROTULO_RISCO[s.chave as StatusRiscoEvolucao] ?? s.chave}
                      </p>
                      <p className="text-xs text-muted-foreground">{s.descricao}</p>
                    </div>
                  ))}
                </div>
              </Secao>

              {!pendente && versoes.length > 0 && (
                <div className="rounded-xl border border-border bg-muted/40">
                  <button
                    onClick={() => setHistoricoAberto(v => !v)}
                    className="flex w-full items-center gap-2 p-4 text-xs font-bold uppercase tracking-wider text-foreground"
                  >
                    <History className="w-4 h-4" />
                    Histórico de versões ({versoes.length})
                  </button>
                  {historicoAberto && (
                    <ul className="space-y-2 px-4 pb-4">
                      {versoes.map(v => (
                        <li key={v.id} className="flex items-start justify-between gap-2 text-xs text-muted-foreground">
                          <div>
                            <span className="font-semibold">v{v.versao}</span> ·{' '}
                            {new Date(v.publicado_em).toLocaleDateString('pt-BR')} ·{' '}
                            {v.publicado_por_nome}
                            {v.nota_publicacao && (
                              <span className="block text-muted-foreground">{v.nota_publicacao}</span>
                            )}
                          </div>
                          {/*
                            Baixar uma versão antiga é o caminho para voltar atrás:
                            edita-se (ou nem isso) e sobe de novo, criando uma
                            versão NOVA com o conteúdo antigo. Nada é apagado.
                          */}
                          <button
                            onClick={() => {
                              const md = criteriosParaMarkdown(v.conteudo, { versaoOrigem: v.versao })
                              const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
                              const url = URL.createObjectURL(blob)
                              const a = document.createElement('a')
                              a.href = url
                              a.download = `criterios-auditoria-v${v.versao}.md`
                              a.click()
                              URL.revokeObjectURL(url)
                            }}
                            className="shrink-0 text-brand-fg hover:underline"
                          >
                            Baixar
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Rodapé de ações ────────────────────────────────────────────── */}
        <div className="border-t border-border px-5 py-3 md:px-6">
          {pendente ? (
            <div className="space-y-2">
              {confirmando ? (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 dark:border-amber-900/60 dark:bg-amber-950/30">
                  <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                    Publicar os novos critérios?
                  </p>
                  <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
                    Valem para as próximas auditorias. <strong>As auditorias já feitas não
                    mudam</strong> — para reaplicar, use “Reauditar” na evolução.
                  </p>
                </div>
              ) : (
                // Rótulo visível: com só o placeholder e o `title` do botão (que não
                // aparece no toque nem em botão desativado), ninguém descobria por
                // que o Publicar não liberava.
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-foreground">
                    O que mudou nesta versão? <span className="font-normal text-muted-foreground">(obrigatório, fica no histórico)</span>
                  </span>
                  <input
                    value={nota}
                    onChange={e => setNota(e.target.value)}
                    placeholder="Ex.: dispensa de chegada e saída quando a evolução for bem descritiva"
                    className={`${CAMPO} w-full`}
                  />
                </label>
              )}

              <div className="flex items-center justify-end gap-2">
                {!confirmando && !nota.trim() && (
                  <span className="mr-auto text-xs text-muted-foreground">
                    Escreva o que mudou para liberar o Publicar.
                  </span>
                )}
                <button
                  onClick={() => {
                    if (confirmando) { setConfirmando(false); return }
                    setConfirmarDescarte('limpar')
                  }}
                  disabled={publicando}
                  className={BOTAO_SECUNDARIO}
                >
                  {confirmando ? 'Voltar' : 'Descartar'}
                </button>
                <button
                  onClick={() => (confirmando ? publicar() : setConfirmando(true))}
                  disabled={publicando || !nota.trim()}
                  title={!nota.trim() ? 'Descreva o que mudou antes de publicar' : undefined}
                  className={BOTAO_PRIMARIO}
                >
                  <Save className={`h-3.5 w-3.5 ${publicando ? 'motion-safe:animate-pulse' : ''}`} />
                  {publicando ? 'Publicando…' : confirmando ? 'Confirmar e publicar' : 'Publicar'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Estes critérios valem para as próximas auditorias. Auditorias já feitas mantêm a
                versão sob a qual foram julgadas.
              </p>
              {totalDesatualizadas > 0 && (
                <button
                  onClick={onReauditarDesatualizadas}
                  disabled={auditandoLote}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded font-semibold text-brand-fg underline underline-offset-2 transition hover:text-brand-dark disabled:opacity-40"
                >
                  <History className="h-3.5 w-3.5" />
                  <span className="tabular-nums">{totalDesatualizadas}</span>{' '}
                  {totalDesatualizadas === 1 ? 'auditada com versão anterior — reaplicar' : 'auditadas com versão anterior — reaplicar'}
                </button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>

    <ModalConfirmacao
      isOpen={confirmarDescarte !== null}
      titulo="Descartar o arquivo subido?"
      descricao="O arquivo ainda não foi publicado. Descartando, a leitura se perde e os critérios vigentes continuam valendo."
      rotuloConfirmar="Descartar"
      onConfirmar={confirmarEDescartar}
      onCancelar={() => setConfirmarDescarte(null)}
    />
    </>
  )
}

function Secao({
  icone,
  titulo,
  children
}: {
  icone: React.ReactNode
  titulo: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-foreground">
        {icone}
        {titulo}
      </h3>
      {children}
    </div>
  )
}
