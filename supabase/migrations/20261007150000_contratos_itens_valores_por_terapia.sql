-- Valor por sessão diferente por terapia DENTRO do mesmo contrato.
--
-- Caso que motivou: Brena Alves Soares de Barros tem um único contrato vigente
-- (PS.ABA-01-00000025, por atendimento, sem função) a R$ 30 por sessão, mas a
-- Avaliação Neuropsicopedagógica é paga a R$ 45. Sem onde guardar essa
-- exceção, o contrato único valia para tudo e setembro/2026 saiu com
-- "Avaliação Neuropsicopedagógica 2×R$ 30,00" em vez de 2×R$ 45,00.
--
-- Formato: array jsonb de {"terapia": text, "valorPA": number}. NULL ou []
-- = o valor_pa do item vale para todas as terapias (comportamento de sempre).
-- Lido por paDoContrato em frontend/lib/remuneracao/calculo.ts, que dá
-- precedência à exceção da terapia sobre o valor_pa geral. Só faz sentido em
-- modelo_faturamento = 'atendimento' (banco de horas não paga por sessão).
--
-- A tabela já tem RLS (rp/admin/diretoria); a coluna nova herda as mesmas
-- políticas — nada a abrir.
--
-- Pode ser aplicada antes ou depois do deploy do frontend:
--   • antes: o código atual ignora a coluna. ATENÇÃO: enquanto o deploy não
--     sai, salvar o contrato da Brena pela tela antiga apaga a exceção (a tela
--     regrava os itens sem conhecer a coluna). Basta não editar esse contrato
--     até o redeploy — ou reaplicar só o bloco 2 abaixo.
--   • depois: o código novo trata a coluna ausente como "sem exceção" e só
--     recusa salvar uma exceção (sem apagar nada) até a coluna existir.

-- 1. Coluna -------------------------------------------------------------------
ALTER TABLE public.remuneracao_contratos_itens
  ADD COLUMN IF NOT EXISTS valores_por_terapia jsonb;

ALTER TABLE public.remuneracao_contratos_itens
  DROP CONSTRAINT IF EXISTS remuneracao_contratos_itens_valores_por_terapia_array;
ALTER TABLE public.remuneracao_contratos_itens
  ADD CONSTRAINT remuneracao_contratos_itens_valores_por_terapia_array
  CHECK (valores_por_terapia IS NULL OR jsonb_typeof(valores_por_terapia) = 'array');

COMMENT ON COLUMN public.remuneracao_contratos_itens.valores_por_terapia IS
  'Exceções de PA por terapia dentro deste contrato: array de {"terapia": text, "valorPA": number}. A terapia listada paga valorPA por sessão em vez de valor_pa. NULL/[] = valor_pa vale para tudo. Ver paDoContrato em frontend/lib/remuneracao/calculo.ts.';

-- 2. Contrato da Brena: Avaliação Neuropsicopedagógica a R$ 45 ------------------
-- Casa por profissional + número + vigente, e exige exatamente 1 linha: se o
-- contrato tiver sido renumerado/encerrado desde 07/10/2026, a migration para
-- em vez de gravar no item errado ou em nenhum.
DO $$
DECLARE
  n integer;
BEGIN
  UPDATE public.remuneracao_contratos_itens i
     SET valores_por_terapia = '[{"terapia": "Avaliação Neuropsicopedagógica", "valorPA": 45}]'::jsonb
    FROM public.remuneracao_contratos c
   WHERE i.contrato_id = c.id
     AND c.profissional_nome = 'Brena Alves Soares de Barros'
     AND i.numero = 'PS.ABA-01-00000025'
     AND i.vigente IS TRUE
     AND i.modelo_faturamento = 'atendimento';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'Esperava 1 contrato vigente PS.ABA-01-00000025 da Brena, encontrei %. Nada foi aplicado.', n;
  END IF;
END $$;

-- 3. Valor padrão da especialidade em Taxas e Parâmetros ----------------------
-- Para quem atender Avaliação Neuropsicopedagógica sem contrato com valor
-- próprio. Não sobrescreve se alguém já cadastrou pela tela.
INSERT INTO public.remuneracao_taxas_especialidade (especialidade, taxa_pa, diaria)
VALUES ('Avaliação Neuropsicopedagógica', 45, 0)
ON CONFLICT (especialidade) DO NOTHING;
