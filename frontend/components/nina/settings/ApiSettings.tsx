import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from 'react';
import {
  Mic, Volume2, Loader2, Eye, EyeOff, Check, ChevronDown, Download, Play,
  AlertTriangle, KeyRound, ExternalLink, Brain,
} from 'lucide-react';
import { Button } from '../Button';
import { EvolutionSettings } from './EvolutionSettings';
import { toast } from 'sonner';
import * as Collapsible from '@radix-ui/react-collapsible';
import {
  obterConfiguracao,
  salvarConfiguracao,
  listarVozesDaConta,
  obterStatusOpenAI,
  testarVoz,
  audioParaUrl,
  VozApiError,
  type ConfiguracaoAgente,
  type VozDaConta,
  type ContaElevenLabs,
  type ResultadoTeste,
  type StatusOpenAI,
} from '@/services/connect/voz';

// ============================================================================
// Aba "APIs" das Configurações.
//
// O que mudou e por quê: esta tela falava com um segundo projeto Supabase (o do
// Nina) que não existe mais — o host não resolve nem em DNS. Salvar a chave da
// ElevenLabs exibia sucesso e não gravava nada; o teste de áudio invocava uma
// Edge Function inexistente. Agora tudo passa por /api/central/*, que fala com
// o banco do Pulsar.
//
// A chave da ElevenLabs não é mais carregada para o estado do React. A tela
// mostra a máscara (quatro últimos caracteres) e envia uma chave nova só quando
// o admin digita uma.
//
// As vozes vêm da conta ElevenLabs, não de uma lista fixa no código: voz que
// sai do catálogo público — ou voz clonada da clínica — deixava a lista antiga
// mentindo, e o erro resultante parecia problema de credencial.
// ============================================================================

// Modelos podem ser constante enquanto as vozes não podem: modelo é global da
// ElevenLabs (poucos, estáveis, iguais para todas as contas), voz é do
// inventário de cada conta e muda sem aviso.
const MODELOS = [
  { id: 'eleven_multilingual_v2', nome: 'Multilingual v2', nota: 'Melhor prosódia em português' },
  { id: 'eleven_turbo_v2_5',      nome: 'Turbo v2.5',      nota: 'Mais rápido e mais barato' },
  { id: 'eleven_flash_v2_5',      nome: 'Flash v2.5',      nota: 'Menor latência, dicção mais dura' },
];

const TEXTO_TESTE_PADRAO =
  'Olá! Aqui é da clínica. Confirmando a sessão de terapia ocupacional na terça-feira às nove horas.';

export interface ApiSettingsRef {
  save: () => Promise<void>;
  cancel: () => void;
  isSaving: boolean;
}

// Rascunho editável — o que o admin mexeu antes de salvar.
interface Rascunho {
  vozId:           string | null;
  modeloVoz:       string;
  stability:       number;
  similarityBoost: number;
  style:           number;
  speed:           number;
  speakerBoost:    boolean;
  ttsAtivo:        boolean;
}

function rascunhoDe(c: ConfiguracaoAgente): Rascunho {
  return {
    vozId:           c.vozId,
    modeloVoz:       c.modeloVoz,
    stability:       c.stability,
    similarityBoost: c.similarityBoost,
    style:           c.style,
    speed:           c.speed,
    speakerBoost:    c.speakerBoost,
    ttsAtivo:        c.ttsAtivo,
  };
}

const ApiSettings = forwardRef<ApiSettingsRef>((props, ref) => {
  const [config, setConfig]     = useState<ConfiguracaoAgente | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando]     = useState(false);
  const [erroConfig, setErroConfig] = useState<string | null>(null);
  const [semPermissao, setSemPermissao] = useState(false);

  // Credencial
  const [chaveNova, setChaveNova] = useState('');
  const [mostrarChave, setMostrarChave] = useState(false);
  const [verificando, setVerificando] = useState(false);

  // Inventário da conta
  const [vozes, setVozes] = useState<VozDaConta[] | null>(null);
  const [conta, setConta] = useState<ContaElevenLabs | null>(null);
  const [erroVozes, setErroVozes] = useState<VozApiError | null>(null);

  // OpenAI — só leitura. Estado separado do resto porque a origem é outra
  // (variável de ambiente do servidor, não o banco): uma falha aqui não deve
  // derrubar a configuração de voz, nem o contrário.
  const [statusIa, setStatusIa] = useState<StatusOpenAI | null>(null);
  const [erroStatusIa, setErroStatusIa] = useState<string | null>(null);

  // Teste de áudio
  const [testeAberto, setTesteAberto] = useState(false);
  const [avancadoAberto, setAvancadoAberto] = useState(false);
  const [textoTeste, setTextoTeste] = useState(TEXTO_TESTE_PADRAO);
  const [gerando, setGerando] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [stats, setStats] = useState<ResultadoTeste | null>(null);

  // Guarda a URL do Blob para revogar: sem isso cada teste vaza alguns KB e o
  // <audio> anterior segue ocupando memória até a navegação.
  const audioUrlRef = useRef<string | null>(null);
  const trocarAudio = useCallback((url: string | null) => {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = url;
    setAudioUrl(url);
  }, []);
  useEffect(() => () => {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
  }, []);

  const carregarVozes = useCallback(async () => {
    try {
      const { vozes, conta } = await listarVozesDaConta();
      setVozes(vozes);
      setConta(conta);
      setErroVozes(null);
      return true;
    } catch (err) {
      setVozes(null);
      setConta(null);
      setErroVozes(err instanceof VozApiError ? err : null);
      return false;
    }
  }, []);

  // Não propaga erro: o bloco da OpenAI é informativo, e um 500 aqui não pode
  // impedir o admin de configurar a voz.
  const carregarStatusIa = useCallback(async () => {
    try {
      setStatusIa(await obterStatusOpenAI());
      setErroStatusIa(null);
    } catch (err) {
      setStatusIa(null);
      setErroStatusIa(err instanceof Error ? err.message : 'Falha ao consultar o status da OpenAI');
    }
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErroConfig(null);
    try {
      const c = await obterConfiguracao();
      setConfig(c);
      setRascunho(rascunhoDe(c));
      setChaveNova('');
      if (c.chaveConfigurada) await carregarVozes();
      await carregarStatusIa();
    } catch (err) {
      if (err instanceof VozApiError && err.semPermissao) setSemPermissao(true);
      else setErroConfig(err instanceof Error ? err.message : 'Falha ao carregar a configuração');
    } finally {
      setCarregando(false);
    }
  }, [carregarVozes, carregarStatusIa]);

  useEffect(() => { carregar(); }, [carregar]);

  // ---------------------------------------------------------------------------
  // Salvar — acionado pelo botão "Salvar Alterações" do cabeçalho (via ref)
  // ---------------------------------------------------------------------------
  const salvar = useCallback(async () => {
    if (!rascunho) return;
    setSalvando(true);
    try {
      const trocouChave = chaveNova.trim().length > 0;
      const atualizado = await salvarConfiguracao({
        ...rascunho,
        ...(trocouChave ? { chaveApi: chaveNova.trim() } : {}),
      });
      setConfig(atualizado);
      setRascunho(rascunhoDe(atualizado));
      setChaveNova('');
      toast.success('Configuração de voz salva');
      if (trocouChave) await carregarVozes();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao salvar';
      toast.error('Não foi possível salvar', { description: msg });
    } finally {
      setSalvando(false);
    }
  }, [rascunho, chaveNova, carregarVozes]);

  useImperativeHandle(ref, () => ({
    save: salvar,
    cancel: carregar,
    isSaving: salvando,
  }));

  // Grava a chave e imediatamente pergunta à ElevenLabs quem ela é. Substitui o
  // auto-save silencioso no blur: o admin acabou de colar uma credencial, a
  // pergunta na cabeça dele é "funcionou?", e a resposta chega agora.
  const verificarChave = async () => {
    const chave = chaveNova.trim();
    if (!chave) {
      toast.error('Cole a API Key antes de verificar');
      return;
    }
    setVerificando(true);
    try {
      const atualizado = await salvarConfiguracao({ chaveApi: chave });
      setConfig(atualizado);
      setChaveNova('');
      const okVozes = await carregarVozes();
      if (okVozes) toast.success('Chave aceita pela ElevenLabs');
      else toast.error('Chave gravada, mas a ElevenLabs a recusou');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao gravar a chave';
      toast.error('Não foi possível gravar a chave', { description: msg });
    } finally {
      setVerificando(false);
    }
  };

  const gerarAudio = async () => {
    if (!textoTeste.trim()) {
      toast.error('Escreva um texto para converter');
      return;
    }
    setGerando(true);
    trocarAudio(null);
    setStats(null);
    try {
      const resultado = await testarVoz(textoTeste);
      trocarAudio(audioParaUrl(resultado));
      setStats(resultado);
      toast.success(`Áudio gerado em ${(resultado.geracaoMs / 1000).toFixed(1)}s`);
    } catch (err) {
      if (err instanceof VozApiError) {
        // A mensagem é a da ElevenLabs — é ela que diz se o problema é a chave,
        // a voz ou a cota.
        toast.error(err.faltaConfigurar ? 'Configuração incompleta' : 'A ElevenLabs recusou', {
          description: err.message,
        });
      } else {
        toast.error('Falha ao gerar áudio');
      }
    } finally {
      setGerando(false);
    }
  };

  if (carregando) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
      </div>
    );
  }

  if (semPermissao) {
    return (
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 text-sm text-amber-700 dark:text-amber-200">
        Apenas administradores da Central de Atendimento podem ver as credenciais do agente.
      </div>
    );
  }

  if (erroConfig || !config || !rascunho) {
    return (
      <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-6">
        <p className="text-sm text-rose-700 dark:text-rose-200">{erroConfig ?? 'Configuração indisponível'}</p>
        <Button variant="ghost" size="sm" onClick={carregar} className="mt-3 text-muted-foreground">
          Tentar novamente
        </Button>
      </div>
    );
  }

  const vozSelecionada = vozes?.find(v => v.voiceId === rascunho.vozId) ?? null;
  // Voz gravada que não está mais no inventário da conta: gerar áudio vai falhar
  // e a mensagem da ElevenLabs não deixa óbvio que a causa é esta.
  const vozOrfa = !!rascunho.vozId && !!vozes && !vozSelecionada;
  const restantes = conta && conta.caracteresLimite !== null && conta.caracteresUsados !== null
    ? conta.caracteresLimite - conta.caracteresUsados
    : null;

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------------- */}
      {/* ElevenLabs                                                        */}
      {/* ---------------------------------------------------------------- */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Mic className="w-5 h-5 text-violet-400" />
            <h3 className="font-semibold text-foreground">ElevenLabs — voz da atendente</h3>
          </div>
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
            erroVozes                ? 'bg-rose-500/10 text-rose-400'
            : config.chaveConfigurada && vozes ? 'bg-emerald-500/10 text-emerald-400'
            : 'bg-amber-500/10 text-amber-400'
          }`}>
            <span className={`h-2 w-2 rounded-full ${
              erroVozes ? 'bg-rose-500' : config.chaveConfigurada && vozes ? 'bg-emerald-500' : 'bg-amber-500'
            }`} />
            {erroVozes ? 'Chave recusada' : config.chaveConfigurada && vozes ? 'Verificada' : 'Aguardando chave'}
          </div>
        </div>

        {/* API Key */}
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              API Key
              {config.chaveConfigurada && (
                <span className="ml-2 font-mono text-muted-foreground/70">
                  gravada: {config.chaveMascarada}
                </span>
              )}
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={mostrarChave ? 'text' : 'password'}
                  value={chaveNova}
                  onChange={e => setChaveNova(e.target.value)}
                  placeholder={config.chaveConfigurada
                    ? 'Cole uma chave nova apenas se for substituir'
                    : 'sk_...'}
                  autoComplete="off"
                  className="h-9 w-full rounded-lg border border-border bg-background px-3 pr-10 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                />
                <button
                  type="button"
                  onClick={() => setMostrarChave(!mostrarChave)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-muted-foreground"
                >
                  {mostrarChave ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <Button
                onClick={verificarChave}
                disabled={verificando || !chaveNova.trim()}
                className="bg-violet-600 hover:bg-violet-700 gap-2 shrink-0"
              >
                {verificando
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Verificando</>
                  : <><KeyRound className="w-4 h-4" /> Gravar e verificar</>}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground/70 mt-1.5">
              A chave fica no servidor. Esta tela nunca a recebe de volta — só os quatro últimos caracteres.
            </p>
          </div>

          {/* Resultado da verificação */}
          {erroVozes && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
                <div className="text-xs">
                  <p className="text-rose-700 dark:text-rose-200 font-medium">
                    {erroVozes.chaveRejeitada
                      ? 'A ElevenLabs recusou esta chave'
                      : erroVozes.cotaEsgotada
                        // Aqui a chave está certa: trocá-la não resolve nada.
                        ? 'Cota de caracteres esgotada'
                        : erroVozes.faltaConfigurar
                          ? 'Nenhuma chave gravada'
                          : 'A ElevenLabs respondeu com erro'}
                  </p>
                  {/* Mensagem original do provider: é ela que distingue chave
                      inválida de cota estourada. */}
                  <p className="text-muted-foreground mt-1">{erroVozes.message}</p>
                  <a
                    href="https://elevenlabs.io/app/settings/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-cyan-400 hover:underline mt-2"
                  >
                    Abrir as chaves da minha conta <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>
          )}

          {conta && (
            <div className="rounded-lg border border-border bg-background p-3 text-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Plano <span className="text-foreground font-medium">{conta.tier ?? '—'}</span></span>
                {restantes !== null && (
                  <span className={restantes < 1000 ? 'text-amber-400' : 'text-muted-foreground'}>
                    {restantes.toLocaleString('pt-BR')} caracteres restantes
                  </span>
                )}
              </div>
              {conta.caracteresLimite ? (
                <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-violet-500"
                    style={{ width: `${Math.min(100, ((conta.caracteresUsados ?? 0) / conta.caracteresLimite) * 100)}%` }}
                  />
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Voz e modelo */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-5">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Voz {vozes && <span className="text-muted-foreground/70">({vozes.length} na sua conta)</span>}
            </label>
            <select
              value={rascunho.vozId ?? ''}
              onChange={e => setRascunho({ ...rascunho, vozId: e.target.value || null })}
              disabled={!vozes}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/50 disabled:opacity-50"
            >
              <option value="">
                {vozes ? 'Selecione uma voz' : 'Grave uma chave para listar as vozes'}
              </option>
              {/* Voz gravada fora do inventário continua na lista para o admin
                  ver o que está configurado — marcada como indisponível. */}
              {vozOrfa && (
                <option value={rascunho.vozId ?? ''}>
                  {rascunho.vozId} — indisponível nesta conta
                </option>
              )}
              {vozes?.map(v => (
                <option key={v.voiceId} value={v.voiceId}>
                  {v.nome}{v.idioma ? ` — ${v.idioma}` : ''}{v.categoria ? ` (${v.categoria})` : ''}
                </option>
              ))}
            </select>
            {vozOrfa && (
              <p className="text-xs text-amber-400 mt-1.5">
                A voz gravada não está na sua conta ElevenLabs. Escolha outra, senão a geração de áudio falha.
              </p>
            )}
            {vozSelecionada?.previewUrl && (
              <button
                type="button"
                onClick={() => new Audio(vozSelecionada.previewUrl!).play()}
                className="inline-flex items-center gap-1.5 text-xs text-cyan-400 hover:underline mt-1.5"
              >
                <Play className="w-3 h-3" /> Ouvir amostra (não consome cota)
              </button>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Modelo</label>
            <select
              value={rascunho.modeloVoz}
              onChange={e => setRascunho({ ...rascunho, modeloVoz: e.target.value })}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/50"
            >
              {MODELOS.map(m => (
                <option key={m.id} value={m.id}>{m.nome} — {m.nota}</option>
              ))}
              {/* Modelo gravado que não está na lista (ex: lançamento novo) não
                  pode desaparecer do select, senão salvar o troca sem aviso. */}
              {!MODELOS.some(m => m.id === rascunho.modeloVoz) && (
                <option value={rascunho.modeloVoz}>{rascunho.modeloVoz}</option>
              )}
            </select>
          </div>
        </div>

        {/* Respostas em áudio */}
        <div className="mt-5 p-4 bg-violet-500/5 border border-violet-500/20 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Volume2 className="w-4 h-4 text-violet-400" />
                <span className="text-sm font-medium text-foreground">Responder em áudio</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Quando ativado, a atendente responde por áudio em vez de texto.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={rascunho.ttsAtivo}
                onChange={e => setRascunho({ ...rascunho, ttsAtivo: e.target.checked })}
                disabled={!config.chaveConfigurada || !rascunho.vozId}
                className="sr-only peer"
              />
              <div className={`w-11 h-6 bg-accent rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-500 ${
                !config.chaveConfigurada || !rascunho.vozId ? 'opacity-50 cursor-not-allowed' : ''
              }`} />
            </label>
          </div>
          {(!config.chaveConfigurada || !rascunho.vozId) && (
            <p className="text-xs text-amber-400 mt-2">
              Grave a chave e escolha uma voz para poder ativar.
            </p>
          )}
          {/* O envio de áudio depende do canal de WhatsApp, que ainda não existe. */}
          {rascunho.ttsAtivo && (
            <p className="text-xs text-muted-foreground mt-2">
              O áudio só chega ao paciente quando o canal de WhatsApp estiver conectado.
            </p>
          )}
        </div>

        {/* Parâmetros avançados */}
        <Collapsible.Root open={avancadoAberto} onOpenChange={setAvancadoAberto} className="mt-4">
          <Collapsible.Trigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-muted-foreground transition-colors">
            <ChevronDown className={`w-4 h-4 transition-transform ${avancadoAberto ? 'rotate-180' : ''}`} />
            Ajuste fino da voz
          </Collapsible.Trigger>
          <Collapsible.Content className="mt-3 p-4 bg-background rounded-lg border border-border space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Slider
                rotulo="Stability" dica="Baixo = mais expressivo, alto = mais monótono"
                valor={rascunho.stability} min={0} max={1} passo={0.05}
                onChange={v => setRascunho({ ...rascunho, stability: v })}
              />
              <Slider
                rotulo="Similarity" dica="Fidelidade ao timbre original da voz"
                valor={rascunho.similarityBoost} min={0} max={1} passo={0.05}
                onChange={v => setRascunho({ ...rascunho, similarityBoost: v })}
              />
              <Slider
                rotulo="Style" dica="Acima de 0,50 a dicção começa a falhar"
                valor={rascunho.style} min={0} max={1} passo={0.05}
                onChange={v => setRascunho({ ...rascunho, style: v })}
              />
              <Slider
                rotulo="Velocidade" dica="1,0 = natural"
                valor={rascunho.speed} min={0.5} max={2} passo={0.1}
                onChange={v => setRascunho({ ...rascunho, speed: v })}
              />
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <span className="relative inline-flex items-center">
                <input
                  type="checkbox"
                  checked={rascunho.speakerBoost}
                  onChange={e => setRascunho({ ...rascunho, speakerBoost: e.target.checked })}
                  className="sr-only peer"
                />
                <span className="w-9 h-5 bg-accent rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-violet-500" />
              </span>
              <span className="text-sm text-muted-foreground">Speaker Boost</span>
              <span className="text-xs text-muted-foreground/70">aproxima o timbre original, com mais latência</span>
            </label>
          </Collapsible.Content>
        </Collapsible.Root>

        {/* Teste de áudio */}
        <Collapsible.Root open={testeAberto} onOpenChange={setTesteAberto} className="mt-4">
          <Collapsible.Trigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-muted-foreground transition-colors">
            <ChevronDown className={`w-4 h-4 transition-transform ${testeAberto ? 'rotate-180' : ''}`} />
            <Volume2 className="w-4 h-4" />
            Ouvir antes de usar
          </Collapsible.Trigger>
          <Collapsible.Content className="mt-3 p-4 bg-background rounded-lg border border-border space-y-4">
            <div>
              <textarea
                value={textoTeste}
                onChange={e => setTextoTeste(e.target.value)}
                rows={3}
                maxLength={1000}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-violet-500/50 resize-none"
              />
              <p className="text-xs text-muted-foreground/70 mt-1">
                {textoTeste.length}/1000 caracteres — cobrados da cota da conta
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={gerarAudio}
                disabled={gerando || !config.chaveConfigurada || !rascunho.vozId}
                className="bg-violet-600 hover:bg-violet-700 gap-2"
              >
                {gerando
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Gerando</>
                  : <><Volume2 className="w-4 h-4" /> Gerar e ouvir</>}
              </Button>

              {audioUrl && (
                <a
                  href={audioUrl}
                  download="teste-voz.mp3"
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Download className="w-4 h-4" /> Baixar
                </a>
              )}
            </div>

            {/* O teste usa a voz e os parâmetros JÁ SALVOS. Avisar disso evita a
                conclusão errada de que os sliders não fazem efeito. */}
            {(!config.chaveConfigurada || !rascunho.vozId) ? (
              <p className="text-xs text-amber-400">Grave a chave e escolha uma voz para testar.</p>
            ) : (
              <p className="text-xs text-muted-foreground/70">
                O teste usa a configuração salva. Ajustou os controles? Salve antes de gerar.
              </p>
            )}

            {audioUrl && (
              <div className="space-y-2">
                <audio src={audioUrl} controls autoPlay className="w-full h-10" />
                {stats && (
                  <p className="text-xs text-muted-foreground/70 flex items-center gap-1.5">
                    <Check className="w-3 h-3 text-emerald-400" />
                    {(stats.geracaoMs / 1000).toFixed(1)}s para gerar • {stats.tamanhoKb} KB • {stats.caracteres} caracteres cobrados
                  </p>
                )}
              </div>
            )}
          </Collapsible.Content>
        </Collapsible.Root>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* OpenAI — deliberadamente sem campo                                */}
      {/*                                                                   */}
      {/* Este bloco existe para responder uma pergunta que a tela deixava   */}
      {/* sem resposta: "onde eu cadastro a chave da OpenAI?". Ela não se     */}
      {/* cadastra aqui — é variável de runtime no Coolify. Ausência sem      */}
      {/* explicação parece defeito, e o caminho natural para quem procura o  */}
      {/* campo é concluir que falta implementar e ir criar uma coluna no     */}
      {/* banco, que é exatamente o que a decisão evitou.                     */}
      {/* ---------------------------------------------------------------- */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Brain className="w-5 h-5 text-cyan-400" />
            <h3 className="font-semibold text-foreground">OpenAI — o raciocínio da atendente</h3>
          </div>
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
            erroStatusIa            ? 'bg-rose-500/10 text-rose-400'
            : statusIa?.configurada ? 'bg-emerald-500/10 text-emerald-400'
            : 'bg-amber-500/10 text-amber-400'
          }`}>
            <span className={`h-2 w-2 rounded-full ${
              erroStatusIa ? 'bg-rose-500' : statusIa?.configurada ? 'bg-emerald-500' : 'bg-amber-500'
            }`} />
            {erroStatusIa            ? 'Status indisponível'
             : statusIa?.configurada ? 'Configurada'
             : 'Não configurada'}
          </div>
        </div>

        {/* A chave não aparece nem mascarada: o admin não a colou por aqui,
            então mostrar pedaço dela seria expor sem nenhum ganho de
            reconhecimento. O que a tela mostra é o modelo, que é a decisão de
            custo e comportamento. */}
        {statusIa?.configurada && statusIa.modelo && (
          <div className="rounded-lg border border-border bg-background p-3 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Modelo ativo</span>
            <span className="text-xs font-mono text-emerald-700 dark:text-emerald-200">{statusIa.modelo}</span>
          </div>
        )}

        {statusIa && !statusIa.configurada && statusIa.motivo && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-700 dark:text-amber-200">{statusIa.motivo}</p>
            </div>
          </div>
        )}

        {erroStatusIa && (
          <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
            <p className="text-xs text-rose-700 dark:text-rose-200">{erroStatusIa}</p>
            <Button variant="ghost" size="sm" onClick={carregarStatusIa} className="mt-2 text-muted-foreground">
              Tentar novamente
            </Button>
          </div>
        )}

        <div className="mt-4 space-y-3">
          {/* Instrução, não justificativa. A versão anterior explicava ARG e
              Dockerfile — verdadeiro, mas quem lê está diante de duas caixas de
              seleção no Coolify e precisa saber qual marcar. */}
          <p className="text-sm text-muted-foreground">
            A chave não se cadastra aqui: ela é variável de ambiente do servidor,
            definida no Coolify.
          </p>
          <p className="text-sm text-muted-foreground">
            Ao criar as variáveis, marque{' '}
            <span className="text-foreground">Available at Runtime</span> e deixe{' '}
            <span className="text-foreground">Buildtime</span> desmarcado — em
            buildtime a chave fica gravada na imagem e aparece no log de build.
            Variável nova só chega ao ar no próximo deploy.
          </p>

          <div className="rounded-lg border border-border bg-background divide-y divide-border">
            <div className="flex items-center justify-between gap-4 px-3 py-2">
              <code className="text-xs font-mono text-cyan-700 dark:text-cyan-200">OPENAI_API_KEY</code>
              <span className="text-xs text-muted-foreground/70 text-right">a chave da conta</span>
            </div>
            <div className="flex items-center justify-between gap-4 px-3 py-2">
              <code className="text-xs font-mono text-cyan-700 dark:text-cyan-200">OPENAI_MODEL</code>
              <span className="text-xs text-muted-foreground/70 text-right">
                {statusIa?.modelosPermitidos.length
                  ? statusIa.modelosPermitidos.join(' ou ')
                  : 'obrigatória, sem valor padrão'}
              </span>
            </div>
          </div>

          {/* A allowlist fechada é decisão de custo. Dizer isso na tela evita a
              tentativa de "só trocar a variável" para um modelo mais novo e a
              conclusão de que o sistema está com bug quando ele recusa. */}
          <p className="text-xs text-muted-foreground/70">
            As duas são obrigatórias e não têm valor padrão. Se uma faltar, ou se o
            modelo não estiver na lista, a chamada falha com erro explícito — o
            sistema não escolhe outro modelo por conta própria. Incluir um modelo
            novo exige alteração de código, porque cada um cobra um preço diferente.
          </p>

          {/* Honestidade sobre o efeito: configurar as variáveis hoje não muda
              nada visível, e sem esta frase o admin conclui que configurou errado. */}
          <p className="text-xs text-muted-foreground/70">
            Configurar as variáveis não liga a atendente. Quem as usa é o
            orquestrador, que vem junto com o canal de WhatsApp.
          </p>
        </div>
      </div>

      {/* WhatsApp: o número da Maia (Meta, só leitura) e os números Evolution de
          atendimento humano, criados e distribuídos por pessoa aqui. */}
      <EvolutionSettings />
    </div>
  );
});

// Slider com valor tabular — números alinhados evitam o texto pular a cada
// arrasto do controle.
function Slider({
  rotulo, dica, valor, min, max, passo, onChange,
}: {
  rotulo: string; dica: string; valor: number;
  min: number; max: number; passo: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <label className="text-xs text-muted-foreground">{rotulo}</label>
        <span className="text-xs font-mono tabular-nums text-muted-foreground">{valor.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={passo} value={valor}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-violet-500"
      />
      <p className="text-[11px] text-muted-foreground/70 mt-1">{dica}</p>
    </div>
  );
}

ApiSettings.displayName = 'ApiSettings';

export default ApiSettings;
