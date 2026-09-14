import React, { useState, useEffect, forwardRef, useImperativeHandle, useCallback } from 'react';
import { Bot, Loader2, Info, PauseCircle, PenLine, Send, CalendarCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  obterConfiguracao,
  salvarConfiguracao,
  VozApiError,
  type AiMode,
} from '@/services/connect/voz';

// ============================================================================
// Aba "Agente" das Configurações.
//
// O que mudou e por quê: esta tela lia e gravava `nina_settings` num segundo
// projeto Supabase — o do CRM Nina — que não existe mais; o host não resolve nem
// em DNS. Toda montagem disparava 404 e todo "Salvar" exibia sucesso sem gravar
// nada. Agora fala com /api/central/agent-settings, que serve
// central.agent_settings no banco do Pulsar.
//
// O seletor de modelo saiu. Ele oferecia quatro opções Gemini (Flash, Pro 2.5,
// Pro 3, Adaptativo) que escreviam em `ai_model_mode` — coluna cujo único
// consumidor histórico traduzia aqueles valores para modelos do Google. Modelo
// não é configuração de organização: é decisão de instalação, e agora vive em
// OPENAI_MODEL, variável de runtime validada contra allowlist no servidor. Uma
// tela que deixasse escolher modelo aqui voltaria a criar duas fontes de verdade.
//
// O que esta tela controla é AUTONOMIA, que é a pergunta de negócio real: o
// agente está desligado, escrevendo rascunho para revisão, ou respondendo
// sozinho? São os três estados de `ai_mode`.
//
// Campos que existiam aqui e não voltaram nesta etapa: nome da empresa, nome da
// atendente, horário de funcionamento e dias de atendimento. Eles moram em
// central.organizations, e /api/central/organization hoje é somente leitura.
// Renderizar os campos sem rota de escrita reproduziria o defeito que acabamos
// de remover — controle que parece configurado e não grava. Entram quando o
// PATCH da rota existir.
// ============================================================================

export interface AgentSettingsRef {
  save: () => Promise<void>;
  cancel: () => void;
  isSaving: boolean;
}

const MODOS: { id: AiMode; rotulo: string; nota: string; Icone: typeof PauseCircle }[] = [
  {
    id: 'off',
    rotulo: 'Desligado',
    nota: 'Não aciona a IA',
    Icone: PauseCircle,
  },
  {
    id: 'assisted',
    rotulo: 'Assistido',
    nota: 'Escreve rascunho',
    Icone: PenLine,
  },
  {
    id: 'autonomous',
    rotulo: 'Autônomo',
    nota: 'Responde sozinho',
    Icone: Send,
  },
];

const EXPLICACAO: Record<AiMode, string> = {
  off:
    'O agente não é acionado. Nenhuma chamada à OpenAI acontece e nada é cobrado.',
  assisted:
    'O agente lê a conversa e escreve a resposta, mas ela fica como rascunho para revisão. Nada é enviado ao responsável sem um humano aprovar.',
  autonomous:
    'O agente responde e a mensagem é enviada ao responsável sem revisão. Só ligue depois de acompanhar os rascunhos do modo Assistido.',
};

// Rascunho editável — o que o admin mexeu antes de salvar.
interface Rascunho {
  aiMode:           AiMode;
  agendamentoPorIa: boolean;
  systemPrompt:     string;
}

const AgentSettings = forwardRef<AgentSettingsRef>((_props, ref) => {
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando]     = useState(false);
  const [erro, setErro]             = useState<string | null>(null);
  const [rascunho, setRascunho]     = useState<Rascunho | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const cfg = await obterConfiguracao();
      setRascunho({
        aiMode:           cfg.aiMode,
        agendamentoPorIa: cfg.agendamentoPorIa,
        systemPrompt:     cfg.systemPrompt ?? '',
      });
    } catch (err) {
      // A mensagem da API é preservada: "apenas administradores…" e "schema
      // central não exposto" pedem ações completamente diferentes, e um
      // "erro ao carregar" genérico esconderia qual das duas é.
      const msg = err instanceof VozApiError
        ? err.message
        : 'Não foi possível carregar a configuração do agente.';
      setErro(msg);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const salvar = useCallback(async () => {
    if (!rascunho) return;
    setSalvando(true);
    try {
      const cfg = await salvarConfiguracao({
        aiMode:           rascunho.aiMode,
        agendamentoPorIa: rascunho.agendamentoPorIa,
        systemPrompt:     rascunho.systemPrompt.trim() || null,
      });
      setRascunho({
        aiMode:           cfg.aiMode,
        agendamentoPorIa: cfg.agendamentoPorIa,
        systemPrompt:     cfg.systemPrompt ?? '',
      });
      toast.success('Configuração do agente salva');
    } catch (err) {
      const msg = err instanceof VozApiError
        ? err.message
        : 'Não foi possível salvar a configuração do agente.';
      toast.error(msg);
      // Propaga: o botão do cabeçalho (Settings.tsx) aguarda esta promise.
      throw err;
    } finally {
      setSalvando(false);
    }
  }, [rascunho]);

  useImperativeHandle(ref, () => ({
    save:     salvar,
    cancel:   () => { void carregar(); },
    isSaving: salvando,
  }), [salvar, carregar, salvando]);

  if (carregando) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
      </div>
    );
  }

  if (erro || !rascunho) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-6">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-white mb-1">
              Configuração do agente indisponível
            </h3>
            <p className="text-sm text-rose-200">{erro}</p>
          </div>
        </div>
      </div>
    );
  }

  const emAutonomo = rascunho.aiMode === 'autonomous';

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* ---------------------------------------------------------------- */}
        {/* Autonomia — a decisão de negócio, não a marca do modelo.        */}
        {/* ---------------------------------------------------------------- */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="flex items-center gap-3 mb-1">
            <Bot className="w-5 h-5 text-cyan-400" />
            <h3 className="font-semibold text-white">Autonomia do agente</h3>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Quanto o agente pode fazer sozinho. O modelo de linguagem é definido
            no servidor, por variável de ambiente, e não é configurável aqui.
          </p>

          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Autonomia do agente">
            {MODOS.map(({ id, rotulo, nota, Icone }) => {
              const ativo = rascunho.aiMode === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={ativo}
                  onClick={() => setRascunho({ ...rascunho, aiMode: id })}
                  className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-all ${
                    ativo
                      ? 'bg-cyan-500/15 border-cyan-500 text-cyan-200'
                      : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  <Icone className="w-5 h-5" />
                  <span className="text-xs font-medium">{rotulo}</span>
                  <span className="text-[10px] text-center opacity-70">{nota}</span>
                </button>
              );
            })}
          </div>

          <p className="text-xs text-slate-400 mt-3">{EXPLICACAO[rascunho.aiMode]}</p>

          {emAutonomo && (
            <div className="mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
              <p className="flex items-start gap-2">
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Neste modo as mensagens vão para o responsável sem revisão
                  humana. O canal de WhatsApp ainda não está conectado, então
                  nada sai por enquanto — mas a configuração já vale para quando
                  ele estiver.
                </span>
              </p>
            </div>
          )}
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Ferramentas que gravam agenda — interruptor separado.            */}
        {/* ---------------------------------------------------------------- */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CalendarCheck className="w-5 h-5 text-indigo-400" />
              <div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="font-semibold text-white cursor-help flex items-center gap-1.5">
                      Agendamento pela IA
                      <Info className="w-3 h-3 text-slate-500" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs max-w-60">
                      Habilita as ferramentas que gravam: agendar, reagendar e
                      cancelar. Desligado, o agente ainda consulta e informa
                      horários livres — só não reserva.
                    </p>
                  </TooltipContent>
                </Tooltip>
                <p className="text-xs text-slate-500 mt-0.5">
                  Consultar horários funciona nos dois casos.
                </p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={rascunho.agendamentoPorIa}
                onChange={e => setRascunho({ ...rascunho, agendamentoPorIa: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-cyan-500/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:inset-s-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500" />
            </label>
          </div>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* System prompt                                                    */}
        {/* ---------------------------------------------------------------- */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="flex items-center gap-3 mb-1">
            <Bot className="w-5 h-5 text-violet-400" />
            <h3 className="font-semibold text-white">Prompt do sistema</h3>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            As instruções fixas que o agente recebe antes de cada conversa.
          </p>

          <textarea
            value={rascunho.systemPrompt}
            onChange={e => setRascunho({ ...rascunho, systemPrompt: e.target.value })}
            placeholder="Descreva como a atendente deve se comportar: tom, o que pode prometer, quando encaminhar para a recepção…"
            rows={12}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500/50 resize-y font-mono custom-scrollbar"
          />
          <p className="text-xs text-slate-500 mt-2">
            Dados do contato, data e hora, e horário de funcionamento são
            injetados pelo servidor a cada conversa — não precisam ser escritos
            aqui, e o que for escrito aqui não substitui o que o servidor manda.
          </p>
        </div>
      </div>
    </TooltipProvider>
  );
});

AgentSettings.displayName = 'AgentSettings';

export default AgentSettings;
