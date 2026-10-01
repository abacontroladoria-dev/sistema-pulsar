-- Liga a ENTREGA AUTOMÁTICA do robô SharePoint → PEP e reprocessa todo mês
-- ainda não liberado. Depois disso, todo arquivo reconhecido e no padrão de
-- nome (SIGLA-PACIENTE-MMAAAA) vira entrega sozinho (roxo na tela Entregas
-- PEP); o RP desfaz quando o robô errar.
--
-- O mesmo pode ser feito pela tela: /admin/robo-sharepoint → "Entrega
-- automática" → "Ligar entrega automática" (só admin). Este arquivo existe
-- para quem prefere ligar pelo SQL Editor e ver a conferência na hora.
--
-- Rodar SOMENTE DEPOIS de:
--   1. migration 20261002100000_robo_pep_entrega_automatica.sql aplicada, e
--   2. o frontend novo (feat/robo-entrega-automatica) publicado.
-- Com o frontend antigo no ar: a tela antiga não mostra roxo/azul nem
-- "Desfazer", e a apuração antiga não grava valor_robo/valor_humano.
--
-- TRAVA: este arquivo falha de propósito até você trocar `false` por `true`
-- na linha abaixo — só depois que os dois passos acima estiverem feitos.
DO $$
DECLARE
  migration_e_frontend_novos_no_ar boolean := false;
BEGIN
  IF NOT migration_e_frontend_novos_no_ar THEN
    RAISE EXCEPTION 'Pare: aplique a migration 20261002100000 e publique o frontend novo antes. Nada foi alterado.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'sp_pep_robo_entregar') THEN
    RAISE EXCEPTION 'Pare: a migration 20261002100000 não está aplicada neste banco. Nada foi alterado.';
  END IF;
END $$;

-- 1. Liga a chave e reprocessa (o robô entrega o que já está no padrão).
INSERT INTO public.sp_pep_estado (id, entrega_automatica, entrega_automatica_por_nome, entrega_automatica_em)
VALUES (1, true, 'SQL Editor', now())
ON CONFLICT (id) DO UPDATE
   SET entrega_automatica = true, entrega_automatica_por_nome = 'SQL Editor', entrega_automatica_em = now();

SELECT public.sp_pep_reavaliar() -> 'entrega' AS resultado_da_entrega;

-- 2. Conferência: o que o robô entregou, por analista e mês.
SELECT prestador_nome, competencia, robo_vigentes AS robo_entregou, humano_aprovou AS pessoas_entregaram,
       segue_padrao, fora_padrao, duplicados
  FROM public.vw_pep_indices_robo
 ORDER BY competencia DESC, prestador_nome;

-- 3. Conferência: por que arquivos ficaram de fora (padrão de nome).
SELECT padrao, COALESCE(padrao_motivo, '—') AS motivo, count(*) AS arquivos
  FROM public.sp_pep_itens
 WHERE tipo = 'evidencia' AND status <> 'removido'
 GROUP BY 1, 2
 ORDER BY 1, 3 DESC;

-- 4. O caso que motivou o padrão: Adrian (prestadora Aline). Esperado: os
--    arquivos do PIC fora do padrão e nenhuma entrega de PIC do robô.
SELECT i.nome, i.sigla, i.padrao, i.padrao_motivo, i.status, i.entregue_por
  FROM public.sp_pep_itens i
 WHERE i.paciente_nome ILIKE 'adrian%' OR i.caminho ILIKE '%/adrian%'
 ORDER BY i.sigla, i.nome;

-- ─── ROLLBACK (só se for preciso voltar atrás) ───────────────────────────────
-- Desligar para o robô na hora (não apaga o que ele já entregou):
--   UPDATE public.sp_pep_estado SET entrega_automatica = false,
--          entrega_automatica_por_nome = 'SQL Editor (rollback)', entrega_automatica_em = now() WHERE id = 1;
-- Desfazer TODAS as entregas do robô em mês aberto: não há atalho de SQL de
-- propósito — use "Desfazer" na tela Entregas PEP (cada uma pede motivo e fica
-- no histórico). Se for mesmo preciso em lote, peça o snippet com trava próprio.
