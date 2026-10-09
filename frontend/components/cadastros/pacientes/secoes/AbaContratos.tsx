"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertCircle, AlertTriangle, FilePlus2, FileSignature, Plus } from "lucide-react"
import { hojeBrasilia, type TipoContrato } from "@/lib/contratos/status"
import {
  buscarContratosDoPaciente,
  ErroContratos,
  type ContratosDoPaciente,
} from "@/services/pacienteContratos.service"
import type { ContratoPaciente } from "@/types/contratosPaciente"
import { foco } from "../ui/campos"
import { DetalheContratoPainel } from "./contratos/DetalheContratoPainel"
import { ListaContratos } from "./contratos/ListaContratos"
import { NovoContratoPainel } from "./contratos/NovoContratoPainel"

// Aba "Contratos": Avaliação Neuropsicológica, Terapias, Técnico Terapêutico
// Particular e Termo de Uso de Imagem — início, vencimento e se foi assinado.
//
// Os tipos que têm MODELO de documento (lib/contratos/documento/montarDados.ts,
// MODELOS) ganham um botão "Gerar …" próprio: cria o registro já no tipo certo,
// e o detalhe dele visualiza e baixa o documento preenchido. "Outro contrato"
// registra os tipos que ainda não têm modelo.
//
// Fica FORA do fluxo Editar/Salvar do cadastro (como Escola e Disponibilidade):
// cada ação grava na hora por RPC e vira um evento na linha do tempo do
// contrato. Nada aqui entra no `dirtyCount` da ficha.
//
// Hoje a assinatura é MANUAL (anexa o PDF, marca "assinado" com a data). A
// integração D4Sign + WhatsApp (fases 3 e 4 do docs/PLANO_CONTRATOS_PACIENTE.md)
// passa a mover o mesmo registro pelo webhook, sem mudar esta tela de forma.
//
// Três estados que não podem se confundir: carregando, falha de leitura (com
// "migração pendente" à parte, em âmbar — o localhost usa o banco de produção)
// e "nenhum contrato".

export function AbaContratos({ pacienteId }: { pacienteId: number }) {
  const [dados, setDados] = useState<ContratosDoPaciente | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<{ mensagem: string; migracao: boolean } | null>(null)
  /** Formulário aberto: o tipo escolhido pelo botão, ou null = "Outro contrato" (escolhe no formulário). */
  const [novo, setNovo] = useState<{ tipo: TipoContrato | null } | null>(null)
  const [editando, setEditando] = useState<ContratoPaciente | null>(null)
  const [abertoId, setAbertoId] = useState<number | null>(null)

  const carregar = useCallback(async () => {
    setErro(null)
    try {
      setDados(await buscarContratosDoPaciente(pacienteId))
    } catch (e) {
      setErro({
        mensagem:
          e instanceof ErroContratos
            ? e.message
            : "Não foi possível consultar os contratos. Isto é uma falha de leitura, não quer dizer que o paciente não tenha contrato.",
        migracao: e instanceof ErroContratos && e.migracaoPendente,
      })
    } finally {
      setCarregando(false)
    }
  }, [pacienteId])

  useEffect(() => {
    setCarregando(true)
    void carregar()
  }, [carregar])

  const hoje = hojeBrasilia()
  // O painel lê do estado recarregado, não de uma cópia: depois de uma ação, o
  // detalhe já mostra o status e o evento novos.
  const aberto = abertoId !== null ? dados?.contratos.find((c) => c.id === abertoId) ?? null : null

  if (carregando) {
    return (
      <div className="min-w-0 flex-1 rounded-lg border border-border bg-card px-4 py-4">
        <div className="space-y-3">
          <div className="h-4 w-48 animate-pulse rounded bg-muted" />
          <div className="h-16 animate-pulse rounded bg-muted" />
          <div className="h-16 animate-pulse rounded bg-muted" />
        </div>
      </div>
    )
  }

  if (erro || !dados) {
    const migracao = erro?.migracao
    return (
      <div className="min-w-0 flex-1 rounded-lg border border-border bg-card px-4 py-4">
        <div
          role="alert"
          className={`rounded-md border px-3 py-3 text-sm ${
            migracao
              ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          }`}
        >
          <div className="flex items-start gap-2">
            {migracao ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <span>{erro?.mensagem ?? "Não foi possível consultar os contratos."}</span>
          </div>
          {!migracao && (
            <button
              type="button"
              onClick={() => {
                setCarregando(true)
                void carregar()
              }}
              className={`mt-3 rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted ${foco}`}
            >
              Tentar novamente
            </button>
          )}
        </div>
      </div>
    )
  }

  const gerar = (tipo: TipoContrato | null) => {
    setAbertoId(null)
    setEditando(null)
    setNovo({ tipo })
  }
  const botaoGerar = "inline-flex min-h-11 items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold sm:min-h-0"
  const botaoNovo = (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => gerar("avaliacao_neuropsicologica")}
        className={`${botaoGerar} bg-primary text-primary-foreground hover:bg-primary/90 ${foco}`}
      >
        <FilePlus2 className="h-4 w-4" aria-hidden="true" />
        Gerar contrato de Avaliação Neuropsicológica
      </button>
      <button
        type="button"
        onClick={() => gerar("termo_uso_imagem")}
        className={`${botaoGerar} bg-primary text-primary-foreground hover:bg-primary/90 ${foco}`}
      >
        <FilePlus2 className="h-4 w-4" aria-hidden="true" />
        Gerar Termo de uso de imagem
      </button>
      <button
        type="button"
        onClick={() => gerar(null)}
        className={`${botaoGerar} border border-border text-foreground hover:bg-muted ${foco}`}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Outro contrato
      </button>
    </div>
  )

  const formAberto = !!novo || !!editando

  return (
    <div className="min-w-0 flex-1 space-y-4">
      {formAberto && (
        <NovoContratoPainel
          key={editando?.id ?? `novo-${novo?.tipo ?? "outro"}`}
          pacienteId={pacienteId}
          contratos={dados.contratos}
          tipoInicial={novo?.tipo ?? undefined}
          editando={editando ?? undefined}
          onFechar={() => {
            setNovo(null)
            setEditando(null)
          }}
          onSalvo={(c) => {
            setNovo(null)
            setEditando(null)
            setAbertoId(c.id)
            void carregar()
          }}
        />
      )}

      {dados.contratos.length === 0 ? (
        !formAberto && (
        <div className="rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center">
          <FileSignature className="mx-auto h-8 w-8 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-foreground">Nenhum contrato registrado</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Gere o contrato de Avaliação Neuropsicológica ou o Termo de uso de imagem preenchidos com o cadastro, ou registre outro contrato (Terapias, Técnico Terapêutico Particular).
          </p>
          <div className="mt-4 flex justify-center">{botaoNovo}</div>
        </div>
        )
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Contratos</h2>
              <p className="text-sm text-muted-foreground">
                Status da assinatura e vigência de cada contrato. Clique para ver o detalhe e o histórico.
              </p>
            </div>
            {!formAberto && botaoNovo}
          </div>
          <ListaContratos contratos={dados.contratos} hoje={hoje} onAbrir={(c) => setAbertoId(c.id)} />
        </>
      )}

      {aberto && !editando && (
        <DetalheContratoPainel
          key={aberto.id}
          contrato={aberto}
          contratos={dados.contratos}
          eventos={dados.eventos.get(aberto.id) ?? []}
          signatarios={dados.signatarios.get(aberto.id) ?? []}
          pacienteId={pacienteId}
          onFechar={() => setAbertoId(null)}
          onEditar={() => setEditando(aberto)}
          onMudou={carregar}
        />
      )}
    </div>
  )
}
