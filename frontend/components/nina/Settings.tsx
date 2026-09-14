import React, { useEffect, useRef, useState } from 'react';
import { Shield, Bot, Plug, Loader2, Save, RotateCcw, BookOpen, Lock, Check } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import AgentSettings, { AgentSettingsRef } from './settings/AgentSettings';
import ApiSettings, { ApiSettingsRef } from './settings/ApiSettings';
import SystemRoadmap from './SystemRoadmap';
import { useCompanySettings } from '@/hooks/nina/useCompanySettings';
import { Button } from './Button';
import { useOnboardingStatus } from '@/hooks/nina/useOnboardingStatus';

const Settings: React.FC<{ setShowOnboarding?: (show: boolean) => void }> = ({ setShowOnboarding = () => {} }) => {
  const { companyName, isAdmin, centralRole } = useCompanySettings();

  // A diretoria tem a página inteira, igual ao admin — as duas abas, incluindo
  // a chave da ElevenLabs em APIs (gravável, nunca legível). Houve uma etapa
  // intermediária em que director só editava o prompt do agente; o recorte por
  // aba e por campo saiu junto com ela.
  const podeEditar = isAdmin || centralRole === 'director';
  const agentRef = useRef<AgentSettingsRef>(null);
  const apiRef = useRef<ApiSettingsRef>(null);
  const [activeTab, setActiveTab] = useState('agent');

  const podeSalvarAqui = activeTab !== 'docs' && podeEditar;
  const { resetWizard } = useOnboardingStatus();

  const handleReopenOnboarding = () => {
    resetWizard();
    setShowOnboarding(true);
  };

  // Confirmação inline, ao lado do botão. O toast aparece no canto oposto da
  // tela e passa despercebido justamente quando mais importa — depois de um
  // texto longo, com o olhar ainda no campo. Este selo fica onde a pessoa
  // acabou de clicar. `salvoEm` guarda o instante para reiniciar o timer a
  // cada novo salvamento, em vez de um boolean que o segundo clique não muda.
  const [salvoEm, setSalvoEm] = useState<number | null>(null);

  useEffect(() => {
    if (salvoEm === null) return;
    const t = setTimeout(() => setSalvoEm(null), 4000);
    return () => clearTimeout(t);
  }, [salvoEm]);

  // Estado próprio, e não `agentRef.current?.isSaving`: valor lido de ref não
  // dispara render, então o botão nunca chegava a mostrar "Salvando...". Quem
  // conhece o instante do clique é este componente.
  const [salvando, setSalvando] = useState(false);

  const handleSave = async () => {
    // O `save()` das abas relança o erro depois de exibir o toast vermelho:
    // sem o catch, a exceção sobe como unhandled rejection e — pior — o selo
    // de "salvo" apareceria para uma gravação que falhou.
    setSalvando(true);
    try {
      if (activeTab === 'agent') {
        await agentRef.current?.save();
      } else if (activeTab === 'apis') {
        await apiRef.current?.save();
      }
      setSalvoEm(Date.now());
    } catch {
      setSalvoEm(null);
    } finally {
      setSalvando(false);
    }
  };

  const handleCancel = () => {
    if (activeTab === 'agent') {
      agentRef.current?.cancel();
    } else if (activeTab === 'apis') {
      apiRef.current?.cancel();
    }
  };

  const isSaving = salvando;

  return (
    <div className="p-8 w-full h-full overflow-y-auto bg-slate-950 text-slate-50 custom-scrollbar">
      <div className="mb-10 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">Configurações</h2>
          <p className="text-sm text-slate-400 mt-1">
            Central de controle da sua instância {companyName}.
            {!podeEditar && (
              <span className="ml-2 text-amber-400">(Somente leitura)</span>
            )}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {isAdmin && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReopenOnboarding}
              className="text-slate-400 hover:text-white gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Refazer Onboarding
            </Button>
          )}
          <span className="px-3 py-1 bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs rounded-full font-mono flex items-center">
            {isAdmin ? (
              <>
                <Shield className="w-3 h-3 mr-1" /> Admin
              </>
            ) : podeEditar ? (
              <>
                <Shield className="w-3 h-3 mr-1" /> Diretoria
              </>
            ) : (
              <>
                <Lock className="w-3 h-3 mr-1" /> Somente Leitura
              </>
            )}
          </span>
        </div>
      </div>

      <Tabs
        defaultValue="agent"
        className="w-full"
        onValueChange={tab => { setActiveTab(tab); setSalvoEm(null); }}
      >
        <div className="flex items-center justify-between mb-8">
          <TabsList>
            <TabsTrigger value="agent" className="gap-2">
              <Bot className="w-4 h-4" />
              Agente
            </TabsTrigger>
            <TabsTrigger value="apis" className="gap-2">
              <Plug className="w-4 h-4" />
              APIs
            </TabsTrigger>
            <TabsTrigger value="docs" className="gap-2">
              <BookOpen className="w-4 h-4" />
              Documentação
            </TabsTrigger>
          </TabsList>

          {activeTab !== 'docs' && podeSalvarAqui && (
            <div className="flex gap-3 items-center">
              {salvoEm !== null && !isSaving && (
                <span
                  role="status"
                  aria-live="polite"
                  className="flex items-center gap-1.5 text-sm text-emerald-400"
                >
                  <Check className="w-4 h-4" />
                  Alterações salvas
                </span>
              )}
              <Button
                variant="ghost"
                onClick={handleCancel}
                disabled={isSaving}
              >
                Cancelar
              </Button>
              <Button
                variant="primary"
                onClick={handleSave}
                disabled={isSaving}
                className="gap-2"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Salvar Alterações
                  </>
                )}
              </Button>
            </div>
          )}

          {activeTab !== 'docs' && !podeSalvarAqui && (
            <div className="flex items-center gap-2 text-sm text-amber-400">
              <Lock className="w-4 h-4" />
              Apenas administradores e diretoria podem editar
            </div>
          )}
        </div>

        <TabsContent value="agent">
          <AgentSettings ref={agentRef} />
        </TabsContent>

        <TabsContent value="apis">
          <ApiSettings ref={apiRef} />
        </TabsContent>

        <TabsContent value="docs">
          <SystemRoadmap />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Settings;
