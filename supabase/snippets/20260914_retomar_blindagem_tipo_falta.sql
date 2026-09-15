-- ============================================================
-- Retomada da migration 20260914180000 apos DEADLOCK
--
-- O QUE ACONTECEU
-- A migration parou no meio com:
--   ERROR: 40P01 deadlock detected
--   Process A waits for AccessExclusiveLock on relation 20292
--   blocked by process B / B waits for ShareLock on transaction A
--
-- Nao foi erro de SQL. `ALTER TABLE` precisa de AccessExclusiveLock, que nao
-- convive com NENHUMA outra operacao na tabela. Medido no momento da falha:
-- 26.349 linhas escritas em fila_autorizacoes nos 5 minutos anteriores — um
-- processo em massa (sync/cron) estava varrendo a tabela. O ALTER entrou na
-- fila de lock, o outro processo pediu algo que o ALTER ja segurava, e o
-- Postgres matou um dos dois para desatar o no.
--
-- O QUE JA PASSOU (nao repetir e inofensivo se repetir — os UPDATEs sao
-- idempotentes, o WHERE nao casa mais nada):
--   passo 1  higiene de "" e falta_paciente    OK
--   passo 2  rename unidade -> unidade_fechada  OK (336 linhas)
--
-- O QUE FALTA (este arquivo):
--   passo 3  CHECK chk_tipo_falta
--   passo 4a trigger de codigo lendo o nome novo
--   passo 4b whitelist da RPC de lote
--   passo 4c trigger normalizador
--
-- COMO RODAR SEM REPETIR O DEADLOCK
-- `lock_timeout` faz o ALTER DESISTIR em vez de esperar na fila. Sem ele, o
-- ALTER fica em fila segurando a porta: toda escrita que chega depois tambem
-- para, e um bloqueio de segundos vira uma fila de minutos na aplicacao inteira.
-- Com 5s, no pior caso voce recebe um erro de timeout e roda de novo — a
-- producao nao sente.
--
-- Rode BLOCO A PRIMEIRO. Se ele der lock_timeout, espere um minuto e repita;
-- so siga para o B quando o A passar.
-- ============================================================


-- ============================================================
-- BLOCO A — o CHECK (unica parte que precisa de lock forte)
-- ============================================================
-- Conferencia previa: se isto voltar > 0, NAO rode o ALTER (o VALIDATE falharia).
-- Esperado: 0.
select count(*) as violariam_o_check
  from public.fila_autorizacoes
 where tipo_falta is not null
   and tipo_falta not in ('paciente','terapeuta','unidade_fechada');

-- Desiste em 5s em vez de travar a tabela. Vale so para esta sessao.
set lock_timeout = '5s';

alter table public.fila_autorizacoes
  drop constraint if exists chk_tipo_falta;

-- NOT VALID: so mexe no catalogo, nao varre a tabela. Instantaneo.
alter table public.fila_autorizacoes
  add constraint chk_tipo_falta check (
    tipo_falta is null or tipo_falta = any (array[
      'paciente'::text,
      'terapeuta'::text,
      'unidade_fechada'::text
    ])
  ) not valid;

-- VALIDATE usa ShareUpdateExclusive (lock FRACO): nao bloqueia leitura nem
-- escrita. Por isso esta separado do ADD — e a razao de o par NOT VALID +
-- VALIDATE ser o padrao do repo.
alter table public.fila_autorizacoes
  validate constraint chk_tipo_falta;

reset lock_timeout;

comment on column public.fila_autorizacoes.tipo_falta is
  'Quem faltou: paciente, terapeuta, ou unidade_fechada (a clinica nao abriu — '
  'feriado, recesso, falta de energia; NAO conta como falta de ninguem, fica fora '
  'da assiduidade e da reposicao). NULL = a linha nao e falta. Lista fechada por '
  'chk_tipo_falta: ate 2026-09-14 a coluna era text nu e acumulou "" e '
  '"falta_paciente", invisiveis a todo o sistema.';


-- ============================================================
-- BLOCO B — funcoes e triggers
-- ============================================================
-- CREATE OR REPLACE FUNCTION nao pega lock na tabela. O CREATE TRIGGER pega,
-- mas e catalogo puro e instantaneo; o lock_timeout cobre de qualquer forma.

set lock_timeout = '5s';

-- 4a. Trigger de codigo: passa a casar o nome NOVO.
-- Enquanto isto nao roda, uma falta de unidade registrada agora cai no ELSE e
-- recebe 102 ("ausencia de justificativa") em vez de 113 ("feriado") — indo
-- errada para o sistema parceiro.
create or replace function public.fn_set_codigo_justificativa()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.tipo_falta is null then
    new.codigo_justificativa := null;
    return new;
  end if;

  if new.codigo_justificativa is not null then
    return new;
  end if;

  new.codigo_justificativa := case
    when new.tipo_falta = 'terapeuta'       then 106
    when new.tipo_falta = 'unidade_fechada' then public.codigo_justificativa_do_motivo(new.motivo_falta)
    else 102
  end;

  return new;
end;
$$;

-- 4b. Whitelist da RPC de lote: aceitar o nome novo sem reescrever as ~500
-- linhas da funcao. Le a definicao viva, troca a linha, reexecuta. Idempotente.
do $migr$
declare
  v_def text;
  v_old text := '''paciente'',''terapeuta'',''unidade''';
  v_new text := '''paciente'',''terapeuta'',''unidade_fechada'',''unidade''';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'registrar_falta_em_lote';

  if v_def is null then
    raise notice 'registrar_falta_em_lote nao existe; nada a ajustar';
    return;
  end if;

  if position(v_old in v_def) = 0 then
    raise notice 'whitelist ja ajustada; nada a fazer';
    return;
  end if;

  execute replace(v_def, v_old, v_new);
  raise notice 'whitelist de registrar_falta_em_lote aceita unidade_fechada';
end
$migr$;

-- 4c. Normalizador: rede para chamador desatualizado (o DEFAULT da RPC ainda e
-- 'unidade'). Sem ele, o CHECK do bloco A derruba escrita legitima enquanto o
-- frontend novo nao estiver no ar.
create or replace function public.fn_normaliza_tipo_falta()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.tipo_falta = 'unidade' then
    new.tipo_falta := 'unidade_fechada';
  elsif new.tipo_falta = 'falta_paciente' then
    new.tipo_falta := 'paciente';
  elsif btrim(coalesce(new.tipo_falta, '')) = '' then
    new.tipo_falta := null;
  end if;
  return new;
end;
$$;

-- Nome com 'aaa' de proposito: o Postgres dispara triggers BEFORE em ordem
-- ALFABETICA, e este precisa rodar antes de trg_set_codigo_justificativa —
-- senao o codigo e calculado sobre o nome velho.
drop trigger if exists aaa_normaliza_tipo_falta on public.fila_autorizacoes;

create trigger aaa_normaliza_tipo_falta
  before insert or update on public.fila_autorizacoes
  for each row execute function public.fn_normaliza_tipo_falta();

reset lock_timeout;

comment on function public.fn_normaliza_tipo_falta() is
  'Rede de compatibilidade do rename 2026-09-14: aceita o nome velho (unidade) e '
  'os lixos historicos ("", falta_paciente) e grava o vocabulario canonico.';


-- ============================================================
-- BLOCO C — conferencia final
-- ============================================================

-- 1. O CHECK existe e esta validado? (convalidated deve ser true)
select conname, convalidated
  from pg_constraint
 where conrelid = 'public.fila_autorizacoes'::regclass
   and conname = 'chk_tipo_falta';

-- 2. Os dois triggers existem, e na ordem certa?
--    Esperado: aaa_normaliza_tipo_falta ANTES de trg_set_codigo_justificativa.
select tgname
  from pg_trigger
 where tgrelid = 'public.fila_autorizacoes'::regclass
   and not tgisinternal
   and tgname in ('aaa_normaliza_tipo_falta','trg_set_codigo_justificativa')
 order by tgname;

-- 3. Vocabulario final da coluna
select coalesce(tipo_falta,'(null)') as tipo_falta, count(*)
  from public.fila_autorizacoes
 group by 1
 order by 2 desc;
