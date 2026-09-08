-- Falta em lote: motivo estruturado e identificador do lançamento em massa.
--
-- Contexto: em feriado, ponto facultativo ou evento que fecha a clínica, o dia
-- inteiro cai. Até aqui a recepção só tinha o botão Falta de cada card e o
-- "Todos os atendimentos do dia", que é um lote de UM paciente. Marcar um
-- feriado significava abrir ~300 cards e reescrever a mesma justificativa.
--
-- Duas colunas resolvem o que faltava:
--
--   motivo_falta   — hoje o único registro do porquê é justificativa_falta, em
--                    texto livre. Não há como responder "quantas faltas do
--                    trimestre foram por feriado" sem ler string por string.
--                    Lista fechada, para que a pergunta passe a ser SQL.
--
--   falta_lote_id  — uma ação que escreve centenas de linhas de uma vez precisa
--                    ser desfazível como uma unidade. Sem essa coluna, desfazer
--                    um lote lançado na data errada exigiria reconstruir o
--                    recorte de memória e torcer para ele ainda dar o mesmo
--                    conjunto.
--
-- Rollback:
--   alter table public.fila_autorizacoes drop constraint if exists chk_motivo_falta;
--   drop index if exists public.idx_fila_autorizacoes_falta_lote;
--   alter table public.fila_autorizacoes
--     drop column if exists motivo_falta,
--     drop column if exists falta_lote_id;

-- ---------------------------------------------------------------------------
-- 1. Motivo estruturado
-- ---------------------------------------------------------------------------
-- Nullable de propósito: as faltas individuais existentes nasceram sem motivo e
-- continuam válidas. NULL aqui significa "registrada sem motivo estruturado",
-- não "motivo desconhecido a preencher".
ALTER TABLE public.fila_autorizacoes
  ADD COLUMN IF NOT EXISTS motivo_falta text;

-- `not valid` + `validate` em vez de um CHECK direto: a coluna nasce inteira
-- NULL, então a validação é instantânea, e o par deixa a migration reexecutável
-- sem o risco de a constraint ficar pela metade numa reaplicação.
ALTER TABLE public.fila_autorizacoes
  DROP CONSTRAINT IF EXISTS chk_motivo_falta;

ALTER TABLE public.fila_autorizacoes
  ADD CONSTRAINT chk_motivo_falta CHECK (
    motivo_falta IS NULL OR motivo_falta = ANY (ARRAY[
      'feriado'::text,
      'ponto_facultativo'::text,
      'falta_energia'::text,
      'evento_climatico'::text,
      'outro'::text
    ])
  ) NOT VALID;

ALTER TABLE public.fila_autorizacoes
  VALIDATE CONSTRAINT chk_motivo_falta;

COMMENT ON COLUMN public.fila_autorizacoes.motivo_falta IS
  'Motivo estruturado da falta, lista fechada (ver chk_motivo_falta). Complementa '
  'justificativa_falta, que segue sendo o texto livre e continua obrigatório na UI. '
  'NULL nas faltas individuais e em qualquer falta registrada sem motivo. '
  'Escrito por registrar_falta_em_lote().';

-- ---------------------------------------------------------------------------
-- 1b. tipo_falta ganha o valor 'unidade'
-- ---------------------------------------------------------------------------
-- Feriado NÃO é falta do paciente. Ele não deixou de vir: a clínica não abriu.
--
-- Até aqui só existiam 'paciente' e 'terapeuta', e o lançamento de feriado caía
-- em 'paciente' por ser o default — o que joga a ocorrência direto nos
-- indicadores de assiduidade (kpi_faltas, reposição, status_operacional
-- 'falta_paciente'). O paciente aparecia faltando num dia em que ninguém
-- atendeu.
--
-- 'unidade' é a terceira categoria: a sessão não ocorreu, mas a ausência não é
-- de ninguém — é da operação. O status continua 'falta' de propósito. Criar um
-- status novo parece mais limpo e é justamente o contrário: seis leituras
-- decidem por exclusão ('status NOT IN', 'status <> falta', 'ELSE true') e
-- deixariam o valor novo vazar em silêncio — inclusive pagando sessão que não
-- houve e deixando o cron da ASSIM sobrescrever a linha com 'glosa'. Mantendo
-- 'falta' como status, tudo que já funciona continua funcionando, e quem
-- precisa distinguir passa a olhar tipo_falta/motivo_falta EXPLICITAMENTE.
--
-- Sem CHECK em tipo_falta: a coluna nunca teve um, e adicionar agora exigiria
-- validar o histórico (que tem valores livres gravados por caminhos antigos).
COMMENT ON COLUMN public.fila_autorizacoes.tipo_falta IS
  'A quem a ausência pertence: ''paciente'' (não compareceu), ''terapeuta'' '
  '(o profissional faltou) ou ''unidade'' (a clínica não abriu — feriado, ponto '
  'facultativo, falta de energia; ver motivo_falta). NULL em linha que não é falta. '
  'IMPORTANTE: ''unidade'' não é assiduidade do paciente nem do profissional — '
  'toda contagem de falta por pessoa deve excluí-lo explicitamente.';

-- ---------------------------------------------------------------------------
-- 2. Identificador do lote
-- ---------------------------------------------------------------------------
ALTER TABLE public.fila_autorizacoes
  ADD COLUMN IF NOT EXISTS falta_lote_id uuid;

-- Índice parcial: só uma fração ínfima das linhas pertence a um lote, e a única
-- consulta que usa a coluna é a reversão (WHERE falta_lote_id = $1). Indexar as
-- centenas de milhares de linhas com NULL seria pagar por nada.
CREATE INDEX IF NOT EXISTS idx_fila_autorizacoes_falta_lote
  ON public.fila_autorizacoes (falta_lote_id)
  WHERE falta_lote_id IS NOT NULL;

COMMENT ON COLUMN public.fila_autorizacoes.falta_lote_id IS
  'Identificador do lançamento em massa que criou ou atualizou esta linha '
  '(registrar_falta_em_lote). Todas as linhas de um mesmo clique compartilham o '
  'valor e é por ele que reverter_falta_em_lote desfaz o conjunto inteiro. '
  'NULL em falta individual e nas linhas já revertidas.';

-- ---------------------------------------------------------------------------
-- Nota sobre granularidade, para quem vier depois
-- ---------------------------------------------------------------------------
-- A linha de falta representa o HORÁRIO, não a terapia:
--
--   unique_fila_agendamento  UNIQUE (paciente_id, data_atendimento, horario)
--
-- O banco admite uma única linha por horário, mesmo quando o paciente tem duas
-- terapias nele. Por isso tanto o fluxo individual (handleFalta, que casa por
-- `tuss = codigos_tuss[0]`) quanto o lote gravam uma linha só, com as terapias
-- concatenadas em terapia_falta.
--
-- Isso foi verificado da forma difícil: uma versão desta entrega tentou gravar
-- uma linha por terapia, por parecer mais fiel ao fato de o card agregar N
-- terapias, e o lote inteiro abortava com 23505 no primeiro paciente com duas
-- terapias no mesmo horário.
--
-- Consequência conhecida: ma_consumos_falta casa por matricula+dep+codigo_tuss,
-- então só o PRIMEIRO tuss do horário consome posição no pareamento com a ASSIM.
-- Se um horário com duas terapias precisar consumir duas posições, o modelo de
-- dados atual não expressa isso — mudá-lo exigiria relaxar a UNIQUE, o que
-- afeta todo o resto do sistema. Fora do escopo desta entrega, registrado aqui
-- para quem esbarrar no sintoma.

-- Nada aqui toca chk_status: 'falta', 'pendente' e 'cancelado' já são valores
-- válidos, e as leituras que testam `status = 'falta'` (~15 lugares) seguem
-- valendo sem alteração.
