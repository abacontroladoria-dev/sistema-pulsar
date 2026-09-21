'use client'

import React, { useState } from 'react'
import { IdCard, Check, X, Pencil, Sparkles, Loader2 } from 'lucide-react'
import type { FichaPaciente, CampoFicha, OrigemCampo } from '@/modules/atendimento/types/central.types'
import { Bloco, Vazio } from './Bloco'

// ----------------------------------------------------------------------------
// Quem é o paciente.
//
// Fica no TOPO do painel, antes da leitura da IA: quem é a criança se lê antes
// de como o responsável está. Seis linhas, e cada uma diz de onde veio.
//
// A DECISÃO QUE DEFINE ESTE COMPONENTE: A PROCEDÊNCIA É VISÍVEL
//
// Quatro dos campos podem vir do cadastro do TiTa (alguém digitou com o
// documento na mão) ou da conversa (a Maia ouviu no WhatsApp). São coisas
// diferentes e a tela precisa dizer qual é qual, porque o atendente vai usar
// este painel para pedir autorização ao convênio — e um plano de saúde ouvido
// às onze da noite não tem o mesmo peso de um plano cadastrado.
//
// Sem essa marca, o painel converteria palpite em dado pelo simples fato de
// exibir os dois do mesmo jeito.
//
// DOIS ESTADOS VAZIOS, NÃO UM
//
// "Campo em branco porque a Maia ainda não perguntou" e "campo em branco porque
// este contato nem tem paciente vinculado" pedem ações opostas de quem lê: a
// primeira se resolve esperando a conversa, a segunda exige vincular o paciente.
// Mostrar um traço para os dois casos esconderia a diferença.
// ----------------------------------------------------------------------------

const ROTULO: Record<CampoFicha, string> = {
  patient_name:  'Paciente',
  birth_date:    'Nascimento',
  guardian_name: 'Responsável',
  shift:         'Turno',
  health_plan:   'Plano de saúde',
}

const TURNO: Record<string, string> = {
  manha:       'Manhã',
  tarde:       'Tarde',
  integral:    'Integral',
  indiferente: 'Indiferente',
}

export const BlocoFicha: React.FC<{
  ficha:      FichaPaciente | null
  carregando: boolean
  // Ausente quando não há contato selecionado: sem alguém, não há o que editar.
  aoSalvar?:  (campo: CampoFicha, valor: string | null) => Promise<void>
  erro?:      string | null
}> = ({ ficha, carregando, aoSalvar, erro }) => {
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

  return (
    <Bloco titulo="Ficha do paciente" icone={<IdCard className="w-3.5 h-3.5" />}>
      <div className="space-y-2">
        {(Object.keys(ROTULO) as CampoFicha[]).map((campo) => (
          <Linha
            key={campo}
            campo={campo}
            valor={ficha.campos[campo].valor}
            origem={ficha.campos[campo].origem}
            // A idade acompanha o nascimento na mesma linha: são a mesma
            // informação lida de dois jeitos, e separá-las em duas linhas faria
            // o painel sugerir que alguém pode editar a idade — que é derivada.
            sufixo={campo === 'birth_date' && ficha.idade !== null ? `${ficha.idade} anos` : null}
            vinculado={ficha.vinculado}
            editando={editando === campo}
            salvando={salvando}
            aoEditar={aoSalvar ? () => setEditando(campo) : undefined}
            aoCancelar={() => setEditando(null)}
            aoSalvar={(v) => salvar(campo, v)}
          />
        ))}
      </div>

      <Rodape ficha={ficha} erro={erro} />
    </Bloco>
  )
}

// ----------------------------------------------------------------------------
// Uma linha rótulo/valor, com a procedência e a edição inline.
// ----------------------------------------------------------------------------
const Linha: React.FC<{
  campo:      CampoFicha
  valor:      string | null
  origem:     OrigemCampo | null
  sufixo:     string | null
  vinculado:  boolean
  editando:   boolean
  salvando:   boolean
  aoEditar?:  () => void
  aoCancelar: () => void
  aoSalvar:   (valor: string | null) => void
}> = ({ campo, valor, origem, sufixo, vinculado, editando, salvando, aoEditar, aoCancelar, aoSalvar }) => {
  const [rascunho, setRascunho] = useState(valor ?? '')

  if (editando) {
    return (
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{ROTULO[campo]}</p>
        <div className="flex items-center gap-1">
          <input
            autoFocus
            value={rascunho}
            onChange={(e) => setRascunho(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter')  aoSalvar(rascunho.trim() || null)
              if (e.key === 'Escape') aoCancelar()
            }}
            placeholder={campo === 'birth_date' ? '12/03/2019' : ''}
            className="flex-1 min-w-0 text-xs bg-background border border-border rounded-md px-2 py-1
                       focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            type="button"
            onClick={() => aoSalvar(rascunho.trim() || null)}
            disabled={salvando}
            title="Salvar"
            className="p-1 rounded-md hover:bg-muted disabled:opacity-50"
          >
            {salvando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={aoCancelar}
            title="Cancelar"
            className="p-1 rounded-md hover:bg-muted"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="group flex items-baseline gap-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground w-24 shrink-0">
        {ROTULO[campo]}
      </p>

      <div className="flex-1 min-w-0 flex items-baseline gap-1.5 flex-wrap">
        {valor === null ? (
          // O texto do vazio é diferente conforme o mundo em que o contato está.
          // Ver o comentário no topo: os dois casos pedem ações opostas.
          <span className="text-xs italic text-muted-foreground">
            {vinculado ? 'não consta no cadastro' : 'a Maia ainda não perguntou'}
          </span>
        ) : (
          <>
            <span className="text-xs text-foreground break-words">{exibir(campo, valor)}</span>
            {sufixo && <span className="text-[11px] text-muted-foreground">· {sufixo}</span>}
            {origem === 'ia' && <MarcaIA />}
          </>
        )}

        {aoEditar && (
          <button
            type="button"
            onClick={aoEditar}
            title={`Editar ${ROTULO[campo].toLowerCase()}`}
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity
                       p-0.5 rounded hover:bg-muted"
          >
            <Pencil className="w-3 h-3 text-muted-foreground" />
          </button>
        )}
      </div>
    </div>
  )
}

// A marca que separa o que a IA ouviu do que tem lastro. Discreta de propósito:
// ela qualifica o dado, não compete com ele. O que veio do cadastro NÃO ganha
// marca — o cadastro é o padrão, e marcar os dois faria o ruído dobrar sem
// acrescentar distinção.
const MarcaIA: React.FC = () => (
  <span
    title="Informado pelo responsável na conversa e anotado pela Maia. Não foi conferido com documento."
    className="inline-flex items-center gap-0.5 text-[10px] px-1 py-px rounded
               bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30"
  >
    <Sparkles className="w-2.5 h-2.5" />
    IA
  </span>
)

const Rodape: React.FC<{ ficha: FichaPaciente; erro?: string | null }> = ({ ficha, erro }) => {
  const faltam = ficha.faltantes.length

  return (
    <div className="pt-2 mt-1 border-t border-border/50 space-y-1">
      {ficha.vinculado ? (
        <p className="text-[10px] text-muted-foreground">
          Paciente do cadastro
          {ficha.sincronizado_em && (
            // O plano vem de um cache derivado da agenda do TiTa, não de um
            // campo digitado. A data é o que permite ao atendente decidir se
            // confia nele para uma autorização.
            <> · sincronizado em {new Date(ficha.sincronizado_em).toLocaleDateString('pt-BR')}</>
          )}
        </p>
      ) : faltam > 0 ? (
        <p className="text-[10px] text-muted-foreground">
          Paciente novo · a Maia ainda vai perguntar {faltam} {faltam === 1 ? 'item' : 'itens'}
        </p>
      ) : (
        <p className="text-[10px] text-muted-foreground">
          Paciente novo · coleta completa, ainda não vinculado ao cadastro
        </p>
      )}

      {erro && <p className="text-[10px] text-rose-600 dark:text-rose-400">{erro}</p>}
    </div>
  )
}

// A data vem do banco como YYYY-MM-DD e é lida por gente que escreve
// DD/MM/AAAA. Sem `T00:00:00` o JavaScript interpreta a string como UTC e a
// data recua um dia em São Paulo — o paciente nasceria na véspera.
function exibir(campo: CampoFicha, valor: string): string {
  if (campo === 'shift') return TURNO[valor] ?? valor
  if (campo === 'birth_date') {
    const d = new Date(`${valor}T00:00:00`)
    return Number.isNaN(d.getTime()) ? valor : d.toLocaleDateString('pt-BR')
  }
  return valor
}
