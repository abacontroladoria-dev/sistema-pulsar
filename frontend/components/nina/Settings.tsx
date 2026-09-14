import React, { useRef, useState } from 'react';
import { Shield, Bot, Plug, Loader2, Save, RotateCcw, BookOpen, Lock } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import AgentSettings, { AgentSettingsRef } from './settings/AgentSettings';
import ApiSettings, { ApiSettingsRef } from './settings/ApiSettings';
import SystemRoadmap from './SystemRoadmap';
import { useCompanySettings } from '@/hooks/nina/useCompanySettings';
import { Button } from './Button';
import { useOnboardingStatus } from '@/hooks/nina/useOnboardingStatus';

const Settings: React.FC<{ setShowOnboarding?: (show: boolean) => void }> = ({ setShowOnboarding = () => {} }) => {
  const { companyName, isAdmin, centralRole } = useCompanySettings();

  // Três estados de permissão nesta tela, e não dois. O director edita o prompt
  // do agente (RLS em 20260914190000, recorte por campo na rota), mas continua
  // sem nada na aba de APIs — onde mora a chave da ElevenLabs. Tratá-lo como
  // "somente leitura", como era antes, escondia o botão Salvar e deixava a aba
  // do Agente editável e insalvável.
  const podeEditarAgente = isAdmin || centralRole === 'director';
  const agentRef = useRef<AgentSettingsRef>(null);
  const apiRef = useRef<ApiSettingsRef>(null);
  const [activeTab, setActiveTab] = useState('agent');

  // Permissão por aba: 'apis' segue exclusiva de admin.
  const podeSalvarAqui =
    activeTab === 'agent' ? podeEditarAgente :
    activeTab === 'apis'  ? isAdmin :
    false;
  const { resetWizard } = useOnboardingStatus();

  const handleReopenOnboarding = () => {
    resetWizard();
    setShowOnboarding(true);
  };

  const handleSave = async () => {
    if (activeTab === 'agent') {
      await agentRef.current?.save();
    } else if (activeTab === 'apis') {
      await apiRef.current?.save();
    }
  };

  const handleCancel = () => {
    if (activeTab === 'agent') {
      agentRef.current?.cancel();
    } else if (activeTab === 'apis') {
      apiRef.current?.cancel();
    }
  };

  const isSaving = activeTab === 'agent'
    ? agentRef.current?.isSaving
    : apiRef.current?.isSaving;

  return (
    <div className="p-8 w-full h-full overflow-y-auto bg-slate-950 text-slate-50 custom-scrollbar">
      <div className="mb-10 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">Configurações</h2>
          <p className="text-sm text-slate-400 mt-1">
            Central de controle da sua instância {companyName}.
            {!isAdmin && podeEditarAgente && (
              <span className="ml-2 text-amber-400">(Você edita o prompt do agente)</span>
            )}
            {!podeEditarAgente && (
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
            ) : podeEditarAgente ? (
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

      <Tabs defaultValue="agent" className="w-full" onValueChange={setActiveTab}>
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
            <div className="flex gap-3">
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
              {/* Quem pode salvar na aba do Agente mas não nesta precisa saber
                  que o bloqueio é DESTA aba, e não da tela toda. */}
              {podeEditarAgente
                ? 'Esta aba é exclusiva de administradores'
                : 'Apenas administradores podem editar'}
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
