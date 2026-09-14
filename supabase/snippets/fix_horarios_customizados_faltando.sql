-- Bug (2026-09-14): Juliana (role 'terapeutico') não consegue alterar a
-- capacidade de sala em /relacionamento-prestador/ocupacao-salas. Mensagem no
-- rodapé do modal:
--
--   Could not find the 'horarios_customizados' column of 'cronograma_salas'
--   in the schema cache
--
-- Causa: a migration 20260908095723_add_horarios_customizados_cronograma_salas
-- NUNCA foi aplicada em produção. Conferido em supabase_migrations.schema_migrations:
-- 20260908100000 e TODAS as posteriores (até 20260914150000) estão lá; só a
-- 095723 foi pulada. Não é atraso de deploy — é um buraco isolado, e as
-- migrations seguintes passaram por cima sem reclamar porque nenhuma delas
-- depende desta coluna.
--
-- Por que derruba a edição INTEIRA, e não só os horários personalizados:
-- SalaEditModal.handleSalvar monta o payload com a coluna SEMPRE, mesmo quando
-- não há override nenhum configurado (`horariosCustomizados` vira `{}`):
--
--   const payload: SalaInput = { ...form, horarios_customizados: horariosCustomizados }
--
-- O PostgREST valida o payload contra o cache de schema ANTES de emitir o
-- UPDATE. Coluna desconhecida = request inteiro rejeitado, nenhum campo
-- gravado. Ou seja: hoje NENHUMA edição de sala funciona em produção —
-- capacidade, nome de exibição, status, dias/turnos. A capacidade só foi o que
-- a Juliana tentou primeiro.
--
-- Note que este erro NÃO é da família PGRST116/42501 tratada por
-- lancarErroDeEscrita() em salas.service.ts, então ele chega cru na tela. Foi
-- justamente a mensagem crua que permitiu achar a causa — três hipóteses
-- anteriores (RLS, `andar` obrigatório, status não-operacional) foram
-- descartadas por medição antes desta.
--
-- IDEMPOTÊNCIA: `add column if not exists` com default não reescreve linha
-- existente (default não-volátil é metadado desde o PG 11) e não invalida quem
-- já lê a tabela. Reexecutável sem efeito.
--
-- POR QUE NÃO `supabase db push`: ele empurraria todo o pendente, não só esta
-- — ver reference_db_push_blast_radius. Aplicar por aqui, no SQL Editor.

BEGIN;

ALTER TABLE public.cronograma_salas
  ADD COLUMN IF NOT EXISTS horarios_customizados jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.cronograma_salas.horarios_customizados IS
  'Override opcional de horários por sala/dia/turno, para turno cuja duração de sessão difere do padrão de 40min (ex.: sábado da Equoterapia em Movimento, 30min das 08:00 às 12:00). Chave "<dow>-<turno>" (ex.: "6-Manhã"); chave ausente = grid padrão HORAS_GRID. Ver calcularSlotsDaSala em frontend/lib/cronograma/salas.ts.';

-- Livro-caixa: sem isto a migration continua "pendente" e um `db push` futuro
-- tentaria aplicá-la de novo. O ALTER é idempotente, mas o registro é o que
-- mantém o histórico honesto sobre o que existe em produção.
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260908095723', 'add_horarios_customizados_cronograma_salas')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- Fora da transação, e obrigatório: sem recarregar o cache, o PostgREST segue
-- com o schema velho e o erro persiste mesmo com a coluna já criada.
NOTIFY pgrst, 'reload schema';

-- ─── Conferência ─────────────────────────────────────────────────────────────
-- 1) A coluna existe?
--    select column_name, data_type, column_default, is_nullable
--    from information_schema.columns
--    where table_schema = 'public' and table_name = 'cronograma_salas'
--      and column_name = 'horarios_customizados';
--
-- 2) O livro-caixa registrou?
--    select version from supabase_migrations.schema_migrations
--    where version = '20260908095723';
--
-- 3) Na tela: editar a capacidade de qualquer sala e salvar. O erro de schema
--    cache some e o valor persiste depois de recarregar.
