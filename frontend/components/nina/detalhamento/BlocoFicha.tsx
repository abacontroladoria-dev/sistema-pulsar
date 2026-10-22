'use client'

import React, { useState } from 'react'
import { IdCard, Check, X, Loader2 } from 'lucide-react'
import type { FichaPaciente, CampoFicha, OrigemCampo } from '@/modules/atendimento/types/central.types'
import { DatePicker } from '@/components/ui/date-picker'
import { Bloco, Vazio } from './Bloco'

// ----------------------------------------------------------------------------
// Quem é o paciente.
//
// Fica no TOPO do painel, antes da leitura da IA: quem é a criança se lê antes
// de como o responsável está.
//
// A HIERARQUIA (redesenho de 21/10/2026)
//
// O nome da criança e a idade são o cabeçalho — é por eles que a atendente
// reconhece de quem se trata. O responsável vem logo abaixo. Nascimento, turno,
// plano e serviços são a parte operacional, numa lista curta embaixo.
//
// A PROCEDÊNCIA É VISÍVEL, SEM SELO
//
// O que a Maia ouviu no WhatsApp não tem o peso do que alguém digitou com o
// documento na mão — o plano é usado para pedir autorização ao convênio, e um
// plano errado volta como glosa. Por isso cada valor diz de onde veio: o que a
// Maia anotou leva SUBLINHADO PONTILHADO ciano (anotação a lápis); o cadastro e
// a atendente ficam limpos. Antes era um selo "IA" por linha — com a ficha
// cheia eram seis selos competindo com os dados. O rodapé explica o pontilhado
// uma vez, e o leitor de tela recebe o texto por extenso.
//
// CAMPO VAZIO É LACUNA, NÃO FRASE
//
// Vazio vira uma lacuna tracejada "Informar", como a linha em branco de um
// formulário: tocar abre a edição. No celular (onde as atendentes usam o
// painel) não há hover, então a ação não pode depender dele. O rodapé diz, numa
// frase, o que falta.
// ----------------------------------------------------------------------------

const ROTULO: Record<CampoFicha, string> = {
  patient_name:  'Paciente',
  guardian_name: 'Responsável',
  birth_date:    'Nascimento',
  age_years:     'Idade',
  shift:         'Turno',
  health_plan:   'Plano',
}

// Como o campo aparece no rodapé ("Falta: nascimento e turno.").
const NO_RODAPE: Record<CampoFicha, string> = {
  patient_name:  'nome do paciente',
  guardian_name: 'responsável',
  birth_date:    'nascimento',
  age_years:     'idade',
  shift:         'turno',
  health_plan:   'plano',
}

const TURNOS: { valor: string; rotulo: string }[] = [
  { valor: 'manha',       rotulo: 'Manhã' },
  { valor: 'tarde',       rotulo: 'Tarde' },
  { valor: 'integral',    rotulo: 'Integral' },
  { valor: 'indiferente', rotulo: 'Tanto faz' },
]

type Salvar = (campo: CampoFicha, valor: string | null) => Promise<void>

export const BlocoFicha: React.FC<{
  ficha:      FichaPaciente | null
  // Rótulos das tags de "serviço de interesse" — as terapias que a família
  // procura. Vêm da classificação da conversa (e do que a equipe marcou no
  // contato); a ficha só as mostra, quem edita é o bloco de tags.
  servicos:   string[]
  carregando: boolean
  // Ausente quando não há contato selecionado: sem alguém, não há o que editar.
  aoSalvar?:  Salvar
  erro?:      string | null
}> = ({ ficha, servicos, carregando, aoSalvar, erro }) => {
  const [editando, setEditando] = useState<CampoFicha | null>(null)
  const [salvando, setSalvando] = useState(false)

  if (carregando && !ficha) {
    return (
      <Bloco titulo="Ficha do paciente" icone={<IdCard className="w-3.5 h-3.5" />}>
        <div className="h-24 rounded-xl bg-muted/50 animate-pulse" />
      </Bloco>
    )
  }

  if (!ficha) {
    return (
      <Bloco titulo="Ficha do paciente" icone={<IdCard className="w-3.5 h-3.5" />}>
        <Vazio>{erro ?? 'Sem dados do paciente para este contato.'}</Vazio>
      </Bloco>
    )
  }

  const salvar = async (campo: CampoFicha, valor: string | null) => {
    if (!aoSalvar) return
    setSalvando(true)
    try {
      await aoSalvar(campo, valor)
      setEditando(null)
    } finally {
      setSalvando(false)
    }
  }

  // Tudo o que um campo precisa para se desenhar e se editar.
  const campo = (c: CampoFicha) => ({
    campo:     c,
    valor:     ficha.campos[c].valor,
    origem:    ficha.campos[c].origem,
    editando:  editando === c,
    salvando,
    // Com nascimento, a idade é calculada dele: editar a idade não mudaria
    // nada na tela. Quem corrige, corrige a data.
    aoEditar:  aoSalvar && !(c === 'age_years' && ficha.campos.birth_date.valor !== null)
      ? () => setEditando(c)
      : undefined,
    aoCancelar: () => setEditando(null),
    aoSalvar:  (v: string | null) => salvar(c, v),
  })

  const temMaia = (Object.keys(ROTULO) as CampoFicha[]).some((c) => ficha.campos[c].origem === 'ia')

  return (
    <Bloco titulo="Ficha do paciente" icone={<IdCard className="w-3.5 h-3.5" />}>
      <dl>
        {/* Cabeçalho: quem é a criança. */}
        <dt className="sr-only">{ROTULO.patient_name}</dt>
        <dd className="flex items-baseline gap-x-2.5 flex-wrap">
          <Valor {...campo('patient_name')} destaque />
          <Valor {...campo('age_years')} />
        </dd>
        <Linha rotulo={ROTULO.guardian_name}>
          <Valor {...campo('guardian_name')} />
        </Linha>

        <div className="mt-2 pt-2 border-t border-border/60">
          <Linha rotulo={ROTULO.birth_date}><Valor {...campo('birth_date')} /></Linha>
          <Linha rotulo={ROTULO.shift}><Valor {...campo('shift')} /></Linha>
          <Linha rotulo={ROTULO.health_plan}><Valor {...campo('health_plan')} /></Linha>
          <Linha rotulo="Serviços">
            {servicos.length === 0 ? (
              <span className="text-xs leading-7 text-muted-foreground/80">Nenhum ainda</span>
            ) : (
              <div className="flex flex-wrap gap-1 py-1" title="Vem das tags de serviço da conversa">
                {servicos.map((s) => (
                  <span key={s} className="text-[11px] leading-5 px-1.5 rounded-md bg-muted text-foreground">
                    {s}
                  </span>
                ))}
              </div>
            )}
          </Linha>
        </div>
      </dl>

      <Rodape ficha={ficha} temMaia={temMaia} erro={erro} />
    </Bloco>
  )
}

// Rótulo à esquerda, valor à direita: uma lista de definições, que o leitor de
// tela anuncia como par.
const Linha: React.FC<{ rotulo: string; children: React.ReactNode }> = ({ rotulo, children }) => (
  <div className="flex items-start gap-2">
    <dt className="w-[76px] shrink-0 text-[11px] leading-7 text-muted-foreground">{rotulo}</dt>
    <dd className="flex-1 min-w-0">{children}</dd>
  </div>
)

// ----------------------------------------------------------------------------
// Um valor da ficha: texto (com a marca de procedência), lacuna ou edição.
// ----------------------------------------------------------------------------
const Valor: React.FC<{
  campo:      CampoFicha
  valor:      string | null
  origem:     OrigemCampo | null
  editando:   boolean
  salvando:   boolean
  destaque?:  boolean
  aoEditar?:  () => void
  aoCancelar: () => void
  aoSalvar:   (valor: string | null) => void
}> = ({ campo, valor, origem, editando, salvando, destaque, aoEditar, aoCancelar, aoSalvar }) => {
  if (editando) {
    return (
      <div className="w-full">
        <Edicao campo={campo} valor={valor} salvando={salvando} aoCancelar={aoCancelar} aoSalvar={aoSalvar} />
      </div>
    )
  }

  if (valor === null) {
    // A idade vazia não ganha lacuna no cabeçalho: a lacuna do nascimento já
    // pede o dado que resolve as duas.
    if (campo === 'age_years') return null
    return aoEditar ? (
      <button
        type="button"
        onClick={aoEditar}
        className={`my-0.5 inline-flex items-center rounded-md border border-dashed border-border px-2
                    text-muted-foreground hover:text-cyan-700 dark:hover:text-cyan-300 hover:border-cyan-600/60
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 transition-colors
                    ${destaque ? 'h-7 text-[13px]' : 'h-6 text-xs'}`}
      >
        {destaque ? 'Informar nome do paciente' : 'Informar'}
      </button>
    ) : (
      <span className="text-xs leading-7 text-muted-foreground/80">Não informado</span>
    )
  }

  const daMaia = origem === 'ia'
  const tamanho = destaque
    ? 'text-[15px] font-semibold leading-7'
    : campo === 'age_years' ? 'text-[13px] text-muted-foreground leading-7' : 'text-xs leading-7'
  const texto = (
    <span className={tamanho}>
      <span
        className={`break-words ${daMaia
          ? 'underline decoration-dotted decoration-cyan-500 decoration-[1.5px] underline-offset-[3px]'
          : ''}`}
      >
        {exibir(campo, valor)}
      </span>
      {daMaia && <span className="sr-only"> (anotado pela Maia na conversa)</span>}
    </span>
  )

  if (!aoEditar) return <span className="text-foreground">{texto}</span>

  return (
    <button
      type="button"
      onClick={aoEditar}
      title={daMaia
        ? 'Anotado pela Maia na conversa, sem conferir com documento. Clique para corrigir.'
        : `Editar ${ROTULO[campo].toLowerCase()}`}
      className="-mx-1 px-1 rounded-md text-left text-foreground cursor-text
                 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 transition-colors"
    >
      {texto}
    </button>
  )
}

// ----------------------------------------------------------------------------
// A edição de um campo. Cada dado com o controle que lhe cabe: o turno são
// quatro respostas possíveis (botões, não texto livre), a data usa o
// calendário padrão do sistema, o resto é texto.
// ----------------------------------------------------------------------------
const Edicao: React.FC<{
  campo:      CampoFicha
  valor:      string | null
  salvando:   boolean
  aoCancelar: () => void
  aoSalvar:   (valor: string | null) => void
}> = ({ campo, valor, salvando, aoCancelar, aoSalvar }) => {
  const [rascunho, setRascunho] = useState(valor ?? '')

  const cancelarOuGirar = salvando ? (
    <Loader2 className="w-3.5 h-3.5 mx-1.5 animate-spin text-muted-foreground" />
  ) : (
    <button
      type="button"
      onClick={aoCancelar}
      title="Cancelar"
      aria-label="Cancelar"
      className="w-7 h-7 shrink-0 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted"
    >
      <X className="w-3.5 h-3.5" />
    </button>
  )

  if (campo === 'shift') {
    return (
      <div className="flex items-center gap-1 flex-wrap py-0.5" role="group" aria-label="Turno">
        {TURNOS.map((t) => (
          <button
            key={t.valor}
            type="button"
            disabled={salvando}
            onClick={() => aoSalvar(t.valor)}
            aria-pressed={valor === t.valor}
            className={`h-7 px-2 rounded-md text-xs border transition-colors disabled:opacity-50
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50
                        ${valor === t.valor
                          ? 'border-cyan-600 bg-cyan-500/10 text-cyan-800 dark:text-cyan-200'
                          : 'border-border text-foreground hover:bg-muted'}`}
          >
            {t.rotulo}
          </button>
        ))}
        {cancelarOuGirar}
      </div>
    )
  }

  if (campo === 'birth_date') {
    return (
      <div className="flex items-center gap-1 py-0.5">
        <div className="flex-1 min-w-0">
          <DatePicker
            value={valor ?? ''}
            onChange={(v) => aoSalvar(v || null)}
            max={hojeISO()}
            disabled={salvando}
            classeGatilho="w-full h-7 px-2 rounded-md border border-border bg-background text-xs text-left flex items-center justify-between gap-2"
          />
        </div>
        {cancelarOuGirar}
      </div>
    )
  }

  const enviar = () => aoSalvar(rascunho.trim() || null)
  return (
    <div className="flex items-center gap-1 py-0.5">
      <input
        autoFocus
        value={rascunho}
        onChange={(e) => setRascunho(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter')  enviar()
          if (e.key === 'Escape') aoCancelar()
        }}
        inputMode={campo === 'age_years' ? 'numeric' : undefined}
        placeholder={campo === 'age_years' ? 'Anos, ex.: 5' : campo === 'patient_name' ? 'Nome do paciente' : ROTULO[campo]}
        aria-label={ROTULO[campo]}
        className="flex-1 min-w-0 h-7 text-xs bg-background border border-border rounded-md px-2
                   focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
      />
      {!salvando && (
        <button
          type="button"
          onClick={enviar}
          title="Salvar"
          aria-label="Salvar"
          className="w-7 h-7 shrink-0 rounded-md flex items-center justify-center text-cyan-700 dark:text-cyan-300 hover:bg-muted"
        >
          <Check className="w-3.5 h-3.5" />
        </button>
      )}
      {cancelarOuGirar}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Rodapé: de onde vêm os dados e o que ainda falta, uma frase cada.
// ----------------------------------------------------------------------------
const Rodape: React.FC<{ ficha: FichaPaciente; temMaia: boolean; erro?: string | null }> = ({ ficha, temMaia, erro }) => {
  const faltam = ficha.faltantes.map((c) => NO_RODAPE[c])

  return (
    <div className="mt-3 space-y-1 text-[11px] leading-4 text-muted-foreground">
      {ficha.vinculado ? (
        <p>
          Paciente do cadastro do TiTa
          {ficha.sincronizado_em && (
            // O plano vem de um cache derivado da agenda do TiTa, não de um
            // campo digitado. A data é o que permite ao atendente decidir se
            // confia nele para uma autorização.
            <>, atualizado em {new Date(ficha.sincronizado_em).toLocaleDateString('pt-BR')}</>
          )}
          .
        </p>
      ) : faltam.length >= 4 ? (
        <p>Nenhum dado ainda. A Maia anota quando a família contar.</p>
      ) : faltam.length > 0 ? (
        <p>Falta {juntar(faltam)}. A Maia anota quando a família contar.</p>
      ) : (
        <p>Ficha completa. Ainda não é paciente do cadastro.</p>
      )}

      {temMaia && (
        <p>
          <span aria-hidden className="inline-block w-4 mr-1.5 align-middle border-b-[1.5px] border-dotted border-cyan-500" />
          Ouvido pela Maia. Confira antes de pedir autorização.
        </p>
      )}

      {erro && <p className="text-rose-600 dark:text-rose-400">{erro}</p>}
    </div>
  )
}

// "nascimento e turno", "nome do paciente, nascimento e plano".
function juntar(itens: string[]): string {
  if (itens.length <= 1) return itens.join('')
  return `${itens.slice(0, -1).join(', ')} e ${itens.at(-1)}`
}

function hojeISO(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// A data vem do banco como YYYY-MM-DD e é lida por gente que escreve
// DD/MM/AAAA. Sem `T00:00:00` o JavaScript interpreta a string como UTC e a
// data recua um dia em São Paulo — o paciente nasceria na véspera.
function exibir(campo: CampoFicha, valor: string): string {
  if (campo === 'shift') return TURNOS.find((t) => t.valor === valor)?.rotulo ?? valor
  if (campo === 'age_years') {
    const n = Number(valor)
    return n === 0 ? 'menos de 1 ano' : n === 1 ? '1 ano' : `${valor} anos`
  }
  if (campo === 'birth_date') {
    const d = new Date(`${valor}T00:00:00`)
    return Number.isNaN(d.getTime()) ? valor : d.toLocaleDateString('pt-BR')
  }
  return valor
}
