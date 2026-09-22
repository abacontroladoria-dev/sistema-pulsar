-- ============================================================================
-- APLICAR EM PRODUÇÃO — Auditoria de Evoluções Terapêuticas (IA & Anti-Glosa)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.auditoria_evolucoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grade_id UUID NOT NULL REFERENCES public.csv_grades_profissionais(id) ON DELETE CASCADE,
    tita_agendamento_id BIGINT,
    data_sessao DATE NOT NULL,
    profissional_id BIGINT,
    profissional_nome TEXT NOT NULL,
    paciente_id BIGINT,
    paciente_nome TEXT NOT NULL,
    terapia_nome TEXT,
    unidade_id BIGINT,
    unidade_nome TEXT,
    
    -- Dados da Evolução
    texto_original TEXT,
    
    -- Resultados da Análise da IA
    status_risco TEXT NOT NULL CHECK (status_risco IN ('sem_risco', 'risco_especifico', 'risco_relevante')),
    resumo_justificativa TEXT,
    apontamentos JSONB DEFAULT '[]'::jsonb, -- [{ tipo: string, descricao: string, trecho?: string, gravidade: string }]
    checklist_perguntas JSONB DEFAULT '{"chegou": false, "objetivo": false, "recursos": false, "reacao_saida": false}'::jsonb,
    inconsistencias_estruturais TEXT[] DEFAULT '{}',
    texto_revisado TEXT,
    
    -- Controle de Cobrança / Tratativa da Coordenação
    status_cobranca TEXT NOT NULL DEFAULT 'pendente' 
        CHECK (status_cobranca IN ('pendente', 'cobrado', 'aguardando_correcao', 'corrigido_tita', 'ignorado')),
    historico_cobranca JSONB DEFAULT '[]'::jsonb,
    cobrado_em TIMESTAMPTZ,
    cobrado_por_nome TEXT,
    
    -- Metadados
    modelo_ia TEXT DEFAULT 'gpt-4o-mini',
    auditado_em TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    CONSTRAINT uq_auditoria_grade UNIQUE (grade_id)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_auditoria_evolucoes_data ON public.auditoria_evolucoes(data_sessao);
CREATE INDEX IF NOT EXISTS idx_auditoria_evolucoes_prof ON public.auditoria_evolucoes(profissional_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_evolucoes_risco ON public.auditoria_evolucoes(status_risco);
CREATE INDEX IF NOT EXISTS idx_auditoria_evolucoes_cobranca ON public.auditoria_evolucoes(status_cobranca);

-- RLS
ALTER TABLE public.auditoria_evolucoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auditoria_evolucoes_select_all ON public.auditoria_evolucoes;
CREATE POLICY auditoria_evolucoes_select_all
  ON public.auditoria_evolucoes FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS auditoria_evolucoes_write_all ON public.auditoria_evolucoes;
CREATE POLICY auditoria_evolucoes_write_all
  ON public.auditoria_evolucoes FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT ALL ON public.auditoria_evolucoes TO authenticated;
GRANT ALL ON public.auditoria_evolucoes TO service_role;
