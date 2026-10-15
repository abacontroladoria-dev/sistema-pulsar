"use client"

// Uma linha de paciente dentro do bloco do setor. Serve igual no desktop e no
// celular: quem é e o que falta fazer (com verbo). O status fica no título do
// grupo (Atrasados, Vencem hoje, No prazo), por isso a linha não repete prazo;
// o detalhe dos dias está no painel do paciente. Tocar na linha abre o detalhe;
// o ícone abre a tarefa certa do ClickUp.

import { ExternalLink, FileWarning } from "lucide-react"
import { TONE_SOFT } from "@/components/cronograma/ui/tones"
import {
  dispPedeAcao,
  idFormulario,
  linkDaEtapa,
  proximaAcao,
  textoPrazo,
  textosDosAlertas,
  type DisponibilidadePainel,
  type PacienteEmAndamento,
} from "@/lib/indicadores/entradaConvenio"
import { SeloDisponibilidade } from "./comum"

export function LinhaPaciente({ p, disp, onAbrir }: {
  p: PacienteEmAndamento
  disp: DisponibilidadePainel | undefined
  onAbrir: (p: PacienteEmAndamento) => void
}) {
  const acao = proximaAcao(p)
  const link = linkDaEtapa(p)
  const avisos = textosDosAlertas(p).length
  // Mesmo critério do resumo (sem_formulario): não há data de abertura do
  // formulário. O link do ClickUp pode faltar por outros motivos.
  const semFormulario = !p.aberto
  const formulario = idFormulario(p)
  const mostrarDisp = dispPedeAcao(disp, p.atual.etapa)
  const prazo = textoPrazo(p.atual)

  return (
    <li className="flex items-stretch gap-1 transition-colors hover:bg-muted/40">
      <button
        type="button"
        onClick={() => onAbrir(p)}
        aria-label={`${p.paciente}: ${prazo.texto}. ${acao.texto}. Ver detalhes`}
        className="flex min-w-0 flex-1 items-start gap-3 py-2.5 pl-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:pl-4"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold leading-snug text-foreground">{p.paciente}</span>
          <span className="block text-[11px] text-muted-foreground">
            {p.convenio}{p.tipo === "Neuro" ? " · Neuro" : ""}
            {formulario && <> · formulário <span className="font-mono">{formulario}</span></>}
          </span>
          <span className="mt-1 block text-sm leading-snug text-foreground">
            {acao.travado && <b className={TONE_SOFT.amber.text}>Travado: </b>}
            {acao.texto}
          </span>
          {p.atual.obs && <span className="mt-0.5 block text-xs text-muted-foreground">{p.atual.obs}</span>}
          {(mostrarDisp || avisos > 0 || semFormulario) && (
            <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              {mostrarDisp && <SeloDisponibilidade disp={disp} />}
              {semFormulario && <span className={`text-[11px] font-semibold ${TONE_SOFT.amber.text}`}>Sem formulário</span>}
              {avisos > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <FileWarning size={12} aria-hidden />
                  {avisos} {avisos === 1 ? "aviso" : "avisos"} de registro
                </span>
              )}
            </span>
          )}
        </span>
      </button>
      <span className="flex w-12 shrink-0 items-start justify-center pt-2 sm:w-11">
        {link && (
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Abrir ${p.paciente} no ClickUp (${link.rotulo})`}
            title={`Abrir no ClickUp: ${link.rotulo}`}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:w-8"
          >
            <ExternalLink size={15} aria-hidden />
          </a>
        )}
      </span>
    </li>
  )
}
