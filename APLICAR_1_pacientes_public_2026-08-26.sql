

-- ############################################################
-- ##  20260826100000_pacientes_cadastro_colunas.sql
-- ############################################################

-- Tela /cadastros/pacientes — ESTRUTURA. Só as colunas aqui; matrícula,
-- responsáveis, ficha médica, storage e RLS vêm nas migrations seguintes.
--
-- A permissão `cadastros_pacientes` e a rota /cadastros/pacientes já existiam em
-- frontend/lib/permissions/routes.ts desde antes desta frente — o que faltava
-- era a tela e as colunas que ela precisa.
--
-- Nenhuma coluna nasce NOT NULL sem DEFAULT: `pacientes` tem linhas espelhadas
-- do TiTa que não têm esses dados e não podem fazer o próximo resync falhar.

alter table public.pacientes
  add column if not exists matricula            integer,
  add column if not exists tem_nome_civil       boolean,
  add column if not exists nome_civil           text,
  add column if not exists cor_raca             text,
  add column if not exists estado_civil         text,
  add column if not exists rg                   text,
  add column if not exists rg_orgao_emissor     text,
  add column if not exists rg_uf                text,
  add column if not exists rg_data_emissao      date,
  add column if not exists telefone_residencial text,
  add column if not exists falecido             boolean not null default false,
  -- NÃO é `foto_url`: o bucket `pacientes-fotos` é privado (20260826100400),
  -- então toda URL é ASSINADA e EXPIRA. Guardar URL assinada em coluna produz
  -- link morto em horas. Aqui vai o PATH do objeto; a URL é gerada no cliente.
  add column if not exists foto_path            text;

do $$
begin
  -- UNIQUE de constraint, não índice parcial: no Postgres o unique já permite N
  -- NULLs (e a maioria das linhas fica NULL, ver comentário de matricula), e é
  -- ele o backstop de corrida de proxima_matricula() em 20260826100100.
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.pacientes'::regclass
                   and conname = 'pacientes_matricula_key') then
    alter table public.pacientes
      add constraint pacientes_matricula_key unique (matricula);
  end if;

  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.pacientes'::regclass
                   and conname = 'pacientes_matricula_positiva_check') then
    alter table public.pacientes
      add constraint pacientes_matricula_positiva_check
      check (matricula is null or matricula > 0);
  end if;

  -- Vocabulário IBGE (PNAD), em snake_case sem acento: a coluna é chave de
  -- agrupamento, não rótulo de tela — o label bonito é do frontend.
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.pacientes'::regclass
                   and conname = 'pacientes_cor_raca_check') then
    alter table public.pacientes
      add constraint pacientes_cor_raca_check
      check (cor_raca is null or cor_raca in
        ('branca', 'preta', 'parda', 'amarela', 'indigena', 'nao_declarada'));
  end if;

  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.pacientes'::regclass
                   and conname = 'pacientes_estado_civil_check') then
    alter table public.pacientes
      add constraint pacientes_estado_civil_check
      check (estado_civil is null or estado_civil in
        ('solteiro', 'casado', 'divorciado', 'viuvo', 'separado', 'uniao_estavel'));
  end if;

  -- UF como CHECK de formato e não char(2): char(2) faz padding com espaço à
  -- direita, e comparação de string com padding já mordeu este projeto antes.
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.pacientes'::regclass
                   and conname = 'pacientes_rg_uf_check') then
    alter table public.pacientes
      add constraint pacientes_rg_uf_check
      check (rg_uf is null or rg_uf ~ '^[A-Z]{2}$');
  end if;
end $$;

-- Índice parcial: falecido é raro, e o filtro padrão da listagem é o contrário
-- (não-falecidos). Indexar só o lado raro mantém o índice pequeno.
create index if not exists idx_pacientes_falecido
  on public.pacientes (falecido) where falecido;

comment on column public.pacientes.matricula is
  'Número interno do paciente, auto-gerado apenas para origem_cadastro = ''pulsar'' (ver 20260826100100). Exibido com zero-padding de 5 dígitos via matricula_formatada(). NULL nas linhas espelhadas do TiTa — decisão explícita do usuário: numerar retroativamente colidiria com a numeração da base legada, que ainda vai ser importada em pacientes_matriculas_reservadas.';
comment on column public.pacientes.tem_nome_civil is
  'true quando o paciente usa nome social e o nome civil difere. `nome` continua sendo o NOME DE TRATAMENTO (o que aparece na agenda, no TiTa e nos relatórios) — esta coluna não muda o significado de `nome`.';
comment on column public.pacientes.nome_civil is
  'Nome de registro civil, preenchido só quando tem_nome_civil. Deve ser limpo pela tela quando o checkbox é desmarcado, para não ficar dado fantasma invisível.';
comment on column public.pacientes.falecido is
  'Marca de óbito. Deliberadamente INDEPENDENTE de `ativo`: um paciente pode estar inativo por alta e continuar vivo. A distinção importa para comunicação — nunca disparar cobrança ou aviso para falecido.';
comment on column public.pacientes.foto_path is
  'Path do objeto no bucket privado `pacientes-fotos`, no formato {id_paciente}/{arquivo}.{ext}. NUNCA guardar URL assinada aqui: ela expira.';
comment on column public.pacientes.rg_uf is
  'UF do órgão emissor do RG, duas maiúsculas.';

-- ===== Deprecação declarada das colunas legadas de responsável =====
-- NÃO são dropadas, e dropar quebraria duas coisas de uma vez:
--   1. o backfill do TiTa (20260817190100, linhas 120-186) escreve nelas a
--      partir de raw_json.favorecido.familiares[0];
--   2. frontend/services/pacientes.service.ts as lista NOMINALMENTE no array
--      COLUNAS — sumir com qualquer uma faz o PostgREST devolver 400 na
--      LISTAGEM INTEIRA de pacientes, não só no campo.
-- A verdade digitada passa a viver em public.responsaveis +
-- public.pacientes_responsaveis (20260826100200).
comment on column public.pacientes.responsavel_nome is
  'DEPRECADA para escrita manual. Espelho somente-leitura de raw_json.favorecido.familiares[0] do TiTa. A verdade digitada na tela /cadastros/pacientes está em public.responsaveis + public.pacientes_responsaveis (20260826100200). Em caso de divergência, o relacional vence na exibição.';
comment on column public.pacientes.responsavel_cpf        is 'DEPRECADA — ver comentário de responsavel_nome.';
comment on column public.pacientes.responsavel_email      is 'DEPRECADA — ver comentário de responsavel_nome.';
comment on column public.pacientes.responsavel_telefone   is 'DEPRECADA — ver comentário de responsavel_nome.';
comment on column public.pacientes.responsavel_parentesco is 'DEPRECADA — ver comentário de responsavel_nome.';
comment on column public.pacientes.responsavel_financeiro is
  'DEPRECADA — o responsável financeiro passa a ser a linha com tipo = ''financeiro'' em public.pacientes_responsaveis.';


-- ############################################################
-- ##  20260826100100_pacientes_matricula_auto.sql
-- ############################################################

-- Matrícula auto-gerada, à prova de corrida.
--
-- GAPS SÃO ESPERADOS E ACEITOS. nextval() é não-transacional de propósito — é
-- justamente o que torna a geração livre de lock. Se a transação que inseriu o
-- paciente der rollback (erro de validação, RLS negando o INSERT, aba fechada no
-- meio), o número consumido NÃO volta e fica um buraco na sequência. A
-- alternativa (max(matricula)+1 sob lock de tabela) serializaria todo cadastro e
-- ainda assim falharia sob concorrência. Buraco na numeração é contábil, não
-- clínico: nada no Pulsar deriva significado de matrículas serem contíguas.

create sequence if not exists public.pacientes_matricula_seq
  as integer
  start with 1
  minvalue 1
  no maxvalue
  owned by public.pacientes.matricula;

-- Números QUEIMADOS da base legada. Nasce VAZIA de propósito: o usuário insere
-- depois a lista de matrículas já usadas fora do Pulsar, e proxima_matricula()
-- passa a pulá-las. Inserir aqui é seguro a qualquer momento, inclusive depois
-- de a sequence já ter passado do número — o UNIQUE de pacientes.matricula
-- (20260826100000) é o backstop.
create table if not exists public.pacientes_matriculas_reservadas (
  matricula integer primary key,
  motivo    text,
  criado_em timestamptz not null default now()
);

comment on table public.pacientes_matriculas_reservadas is
  'Matrículas que proxima_matricula() deve PULAR — tipicamente a numeração da base legada, importada à mão. Vazia por padrão. Não referencia pacientes: o número pode estar queimado sem existir paciente correspondente no Pulsar.';

-- Exibição centralizada, para o zero-padding não ser reimplementado em cada
-- tela e relatório com largura diferente — foi assim que a normalização de nome
-- divergiu antes neste projeto.
create or replace function public.matricula_formatada(p_matricula integer)
returns text
language sql
immutable
as $$
  select case when p_matricula is null then null
              else lpad(p_matricula::text, 5, '0') end;
$$;

comment on function public.matricula_formatada(integer) is
  'Zero-padding de 5 dígitos (1 -> 00001). Largura MÍNIMA: acima de 99999 devolve o número inteiro, sem truncar.';

-- SECURITY DEFINER: a função lê `pacientes` e `pacientes_matriculas_reservadas`.
-- Sob RLS o chamador poderia não enxergar uma linha e "achar livre" um número
-- ocupado. Definer garante que a checagem enxerga a tabela inteira.
create or replace function public.proxima_matricula()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_matricula  integer;
  v_tentativas integer := 0;
begin
  loop
    v_matricula  := nextval('public.pacientes_matricula_seq')::integer;
    v_tentativas := v_tentativas + 1;

    exit when not exists (
                select 1 from public.pacientes_matriculas_reservadas r
                where r.matricula = v_matricula)
         and not exists (
                select 1 from public.pacientes p
                where p.matricula = v_matricula);

    -- Guarda contra loop infinito: se alguém reservar um bloco gigantesco por
    -- engano, falhar alto é melhor do que travar a conexão.
    if v_tentativas > 100000 then
      raise exception 'proxima_matricula: 100000 candidatas consecutivas reservadas/ocupadas a partir de %. Confira public.pacientes_matriculas_reservadas.', v_matricula;
    end if;
  end loop;

  return v_matricula;
end;
$$;

comment on function public.proxima_matricula() is
  'Próxima matrícula livre: nextval em loop, pulando o que está em pacientes_matriculas_reservadas ou já gravado em pacientes.matricula. Livre de corrida porque nextval é atômico; o UNIQUE de pacientes.matricula é o backstop final. Gera gaps em rollback — comportamento aceito, ver cabeçalho de 20260826100100.';

-- Mesmo padrão de usuario_tem_permissao (20260818210000): a função nasce com
-- EXECUTE para PUBLIC e anon é membro de PUBLIC — o revoke é o que fecha a rota
-- /rest/v1/rpc.
revoke all on function public.proxima_matricula() from public, anon;
grant execute on function public.proxima_matricula() to authenticated;
revoke all on function public.matricula_formatada(integer) from public, anon;
grant execute on function public.matricula_formatada(integer) to authenticated;

create or replace function public.set_paciente_matricula()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.matricula := public.proxima_matricula();
  return new;
end;
$$;

-- A cláusula WHEN é a parte importante, por DOIS motivos:
--   1. origem_cadastro = 'tita' fica com matricula NULL (decisão do usuário: a
--      numeração legada desses pacientes entra depois, via reservadas/import);
--   2. o sync faz INSERT ... ON CONFLICT (tita_paciente_id) DO UPDATE, e um
--      BEFORE INSERT roda ANTES da detecção de conflito. Sem o WHEN, cada
--      resync queimaria uma matrícula por paciente que JÁ EXISTE.
-- `new.matricula is null` deixa um import consciente fornecer o número.
drop trigger if exists trg_pacientes_matricula on public.pacientes;
create trigger trg_pacientes_matricula
  before insert on public.pacientes
  for each row
  when (new.origem_cadastro = 'pulsar' and new.matricula is null)
  execute function public.set_paciente_matricula();

-- ===== RLS da tabela de reservadas =====
alter table public.pacientes_matriculas_reservadas enable row level security;

-- Remoção por catálogo e não por nome (convenção de 20260818210000): não há
-- nome antigo a adivinhar, e uma policy permissiva sobrevivente anularia o
-- fechamento em silêncio, já que RLS é OR entre policies.
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'pacientes_matriculas_reservadas'
  loop
    execute format('drop policy %I on public.pacientes_matriculas_reservadas', pol.policyname);
  end loop;
end $$;

create policy "pacientes_matriculas_reservadas_all" on public.pacientes_matriculas_reservadas
  for all to authenticated
  using (public.usuario_tem_permissao('cadastros_pacientes'))
  with check (public.usuario_tem_permissao('cadastros_pacientes'));

revoke all on public.pacientes_matriculas_reservadas from public;
revoke all on public.pacientes_matriculas_reservadas from anon;
revoke all on public.pacientes_matriculas_reservadas from authenticated;
grant select, insert, update, delete on public.pacientes_matriculas_reservadas to authenticated;

-- SEM `force row level security` nesta tabela — deliberado, e é a única do
-- conjunto que abre essa exceção.
--
-- FORCE faz a RLS valer também para o DONO da tabela. proxima_matricula() é
-- SECURITY DEFINER justamente para enxergar todos os números queimados,
-- inclusive os que o usuário chamador não poderia ler; com FORCE, essa leitura
-- voltaria a passar pela policy e a garantia de unicidade dependeria de quem
-- está chamando. Um número "invisível" seria considerado livre, e o erro só
-- apareceria depois, como violação do UNIQUE de pacientes.matricula.
--
-- A tabela não fica exposta: RLS segue ENABLED, a policy acima é a única, e os
-- grants a public/anon foram revogados. FORCE aqui só mudaria o comportamento
-- do dono — que é exatamente quem precisa enxergar tudo.


-- ############################################################
-- ##  20260826100200_create_responsaveis.sql
-- ############################################################

-- Responsável vira ENTIDADE, não campo repetido dentro do paciente.
--
-- Motivo: irmãos atendidos na clínica compartilham responsável, e hoje isso é
-- duplicado linha a linha em pacientes.responsavel_* — com CPF e grafia
-- divergentes entre as cópias. É o mesmo problema que public.pacientes
-- (20260817190000) resolveu para a identidade do paciente.
--
-- As colunas legadas pacientes.responsavel_* NÃO são migradas nem dropadas
-- nesta migration; viram espelho somente-leitura do TiTa. Ver a deprecação
-- declarada por COMMENT em 20260826100000.

create table if not exists public.responsaveis (
  id                       bigint generated always as identity primary key,
  nome                     text not null,
  cpf                      text,
  rg                       text,
  rg_orgao_emissor         text,
  rg_uf                    text,
  data_nascimento          date,
  celular                  text,
  telefone_residencial     text,
  email                    text,
  cep                      text,
  logradouro               text,
  numero                   text,
  complemento              text,
  bairro                   text,
  cidade                   text,
  uf                       text,
  ativo                    boolean not null default true,
  criado_em                timestamptz not null default now(),
  atualizado_em            timestamptz not null default now(),
  id_usuario               uuid references public.usuarios(id),
  nome_usuario_responsavel text
);

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.responsaveis'::regclass
                   and conname = 'responsaveis_rg_uf_check') then
    alter table public.responsaveis
      add constraint responsaveis_rg_uf_check
      check (rg_uf is null or rg_uf ~ '^[A-Z]{2}$');
  end if;
end $$;

-- CPF SEM unique, pela mesma razão de pacientes.cpf: o dado de origem é sujo e
-- um unique transformaria import em falha em bloco. Duplicidade é para ser
-- RELATADA na tela (o picker avisa), não impedida no banco.
create index if not exists idx_responsaveis_cpf
  on public.responsaveis (cpf) where cpf is not null;
create index if not exists idx_responsaveis_nome
  on public.responsaveis (nome);

drop trigger if exists trg_responsaveis_atualizado_em on public.responsaveis;
create trigger trg_responsaveis_atualizado_em
  before update on public.responsaveis
  for each row execute function public.set_atualizado_em();

create table if not exists public.pacientes_responsaveis (
  paciente_id              bigint not null
                             references public.pacientes(id_paciente) on delete cascade,
  responsavel_id           bigint not null
                             references public.responsaveis(id) on delete restrict,
  tipo                     text not null,
  parentesco               text,
  criado_em                timestamptz not null default now(),
  atualizado_em            timestamptz not null default now(),
  id_usuario               uuid references public.usuarios(id),
  nome_usuario_responsavel text,
  constraint pacientes_responsaveis_pkey primary key (paciente_id, tipo),
  constraint pacientes_responsaveis_tipo_check
    check (tipo in ('filiacao_1', 'filiacao_2', 'financeiro', 'pedagogico'))
);

-- O outro lado do vínculo: "quais pacientes este responsável tem" é a consulta
-- do caso dos irmãos, e a PK só indexa (paciente_id, tipo).
create index if not exists idx_pacientes_responsaveis_responsavel
  on public.pacientes_responsaveis (responsavel_id);

drop trigger if exists trg_pacientes_responsaveis_atualizado_em on public.pacientes_responsaveis;
create trigger trg_pacientes_responsaveis_atualizado_em
  before update on public.pacientes_responsaveis
  for each row execute function public.set_atualizado_em();

comment on table public.responsaveis is
  'Pessoa responsável por paciente (filiação, financeiro, pedagógico). Entidade própria porque irmãos compartilham responsável. Substitui, PARA ESCRITA, as colunas pacientes.responsavel_* — que seguem existindo como espelho do sync do TiTa (ver 20260826100000).';
comment on table public.pacientes_responsaveis is
  'Vínculo paciente<->responsável. PK (paciente_id, tipo): um paciente tem no máximo UM responsável de cada tipo, e a segunda filiação tem tipo próprio (filiacao_2) em vez de papel repetido. ON DELETE CASCADE do lado do paciente (o vínculo não sobrevive ao paciente) e RESTRICT do lado do responsável (apagar responsável ainda vinculado tem que ser um ato consciente).';
comment on column public.pacientes_responsaveis.tipo is
  'filiacao_1/filiacao_2 = pai/mãe/tutores; financeiro = quem recebe cobrança; pedagogico = contato de escola/terapia.';
comment on column public.responsaveis.cpf is
  'Sem UNIQUE de propósito: o dado de origem é sujo e um unique transformaria import em falha em bloco. Duplicidade é relatada na tela.';

-- ===== RLS =====
alter table public.responsaveis           enable row level security;
alter table public.pacientes_responsaveis enable row level security;

-- Remoção por catálogo, convenção de 20260818210000: não há nome antigo a
-- adivinhar, e uma policy permissiva sobrevivente anularia o fechamento em
-- silêncio, porque RLS é OR entre policies.
do $$
declare pol record;
begin
  for pol in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('responsaveis', 'pacientes_responsaveis')
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

create policy "responsaveis_all" on public.responsaveis
  for all to authenticated
  using (public.usuario_tem_permissao('cadastros_pacientes'))
  with check (public.usuario_tem_permissao('cadastros_pacientes'));

create policy "pacientes_responsaveis_all" on public.pacientes_responsaveis
  for all to authenticated
  using (public.usuario_tem_permissao('cadastros_pacientes'))
  with check (public.usuario_tem_permissao('cadastros_pacientes'));

revoke all on public.responsaveis           from public;
revoke all on public.responsaveis           from anon;
revoke all on public.responsaveis           from authenticated;
revoke all on public.pacientes_responsaveis from public;
revoke all on public.pacientes_responsaveis from anon;
revoke all on public.pacientes_responsaveis from authenticated;

grant select, insert, update, delete on public.responsaveis           to authenticated;
grant select, insert, update, delete on public.pacientes_responsaveis to authenticated;

alter table public.responsaveis           force row level security;
alter table public.pacientes_responsaveis force row level security;


-- ############################################################
-- ##  20260826100300_create_pacientes_ficha_medica.sql
-- ############################################################

-- Ficha médica do paciente: 1:1, tabela separada em vez de mais seis colunas em
-- `pacientes`.
--
-- A razão é de SEGURANÇA, não de organização. A policy pacientes_select é
-- `for select to authenticated using (true)` (20260817190000, linha 307) e
-- PRECISA continuar assim — Cronograma, CCO, Central de Pacientes e
-- listar_central_pacientes() dependem de resolver paciente por ali. Alergia,
-- doença e tipo sanguíneo são dado sensível de saúde (LGPD) e não podem herdar
-- essa abertura: aqui a leitura exige a permissão da tela.

create table if not exists public.pacientes_ficha_medica (
  paciente_id              bigint primary key
                             references public.pacientes(id_paciente) on delete cascade,
  tipo_sanguineo           text,
  restricoes_alimentares   text,
  alergias                 text,
  doencas                  text,
  -- SEM foreign key POR ORA, de propósito: a tabela de planos de saúde está
  -- sendo criada em outra frente de trabalho. Quando ela existir, fechar com:
  --
  --   alter table public.pacientes_ficha_medica
  --     add constraint pacientes_ficha_medica_plano_saude_id_fkey
  --     foreign key (plano_saude_id) references public.<tabela_planos>(id);
  --
  -- Até lá o valor é um id solto, SEM integridade referencial garantida.
  plano_saude_id           bigint,
  numero_carteirinha       text,
  criado_em                timestamptz not null default now(),
  atualizado_em            timestamptz not null default now(),
  id_usuario               uuid references public.usuarios(id),
  nome_usuario_responsavel text,
  constraint pacientes_ficha_medica_tipo_sanguineo_check
    check (tipo_sanguineo is null or tipo_sanguineo in
      ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'))
);

drop trigger if exists trg_pacientes_ficha_medica_atualizado_em on public.pacientes_ficha_medica;
create trigger trg_pacientes_ficha_medica_atualizado_em
  before update on public.pacientes_ficha_medica
  for each row execute function public.set_atualizado_em();

comment on table public.pacientes_ficha_medica is
  'Ficha médica 1:1 do paciente (PK = FK). Tabela própria, e não colunas em `pacientes`, porque pacientes_select é aberta a todo authenticated e dado de saúde não pode herdar isso.';
comment on column public.pacientes_ficha_medica.plano_saude_id is
  'Sem FK ainda — a tabela de planos de saúde está em outra frente de trabalho. Ver o ALTER de fechamento no comentário do DDL.';
comment on column public.pacientes_ficha_medica.numero_carteirinha is
  'Carteirinha do PLANO DE SAÚDE, digitada no cadastro. NÃO confundir com pacientes.numero_carteirinha, que é CACHE derivado da última sessão em agenda_tita.';

-- ===== RLS =====
alter table public.pacientes_ficha_medica enable row level security;

do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'pacientes_ficha_medica'
  loop
    execute format('drop policy %I on public.pacientes_ficha_medica', pol.policyname);
  end loop;
end $$;

create policy "pacientes_ficha_medica_all" on public.pacientes_ficha_medica
  for all to authenticated
  using (public.usuario_tem_permissao('cadastros_pacientes'))
  with check (public.usuario_tem_permissao('cadastros_pacientes'));

revoke all on public.pacientes_ficha_medica from public;
revoke all on public.pacientes_ficha_medica from anon;
revoke all on public.pacientes_ficha_medica from authenticated;
grant select, insert, update, delete on public.pacientes_ficha_medica to authenticated;

alter table public.pacientes_ficha_medica force row level security;


-- ############################################################
-- ##  20260826100500_pacientes_rls_cadastros_pacientes.sql
-- ############################################################

-- Escrita em `pacientes` também por PERMISSÃO DE TELA, não só por papel.
--
-- A tela /cadastros/pacientes é governada pelo código `cadastros_pacientes`
-- (frontend/lib/permissions/routes.ts), mas a escrita em `pacientes` hoje é
-- gated por remuneracao_has_role(['admin','diretoria','cronograma']) — papel,
-- não permissão (20260817190000, linha 311).
--
-- É exatamente a divergência diagnosticada em 20260818210000: não existe tabela
-- ligando papel a grupo de permissão (roleDefaults é seed do frontend, editável
-- depois via /admin/permissoes), então quem recebeu a tela por
-- usuarios_permissoes e não tem o `role` certo veria o formulário e levaria
-- "new row violates row-level security policy" ao salvar — erro no fim do
-- preenchimento, com o trabalho perdido.
--
-- ADITIVA, NÃO SUBSTITUTIVA: RLS é OR entre policies. `pacientes_write`
-- continua existindo, para não tirar acesso de ninguém que escreve hoje; esta
-- soma quem tem a permissão de tela. Decisão confirmada com o usuário.
--
-- `pacientes_select` NÃO É TOCADA. Cronograma, CCO, Central de Pacientes e
-- listar_central_pacientes() dependem do `using (true)`.
--
-- PRÉ-CHECAGEM antes de aplicar (convenção de 20260818210000 — registrar aqui
-- quem passa a ter escrita, para a mudança de superfície ser auditável):
--   select u.nome, u.role from public.usuarios_permissoes up
--     join public.usuarios u on u.id = up.usuario_id
--    where up.permissao_codigo = 'cadastros_pacientes' and up.permitido = true;

drop policy if exists "pacientes_write_cadastro" on public.pacientes;

create policy "pacientes_write_cadastro" on public.pacientes
  for all to authenticated
  using (public.usuario_tem_permissao('cadastros_pacientes'))
  with check (public.usuario_tem_permissao('cadastros_pacientes'));

-- Sem revoke/grant e sem FORCE ROW LEVEL SECURITY aqui, de propósito:
--   - mexer nos grants de `pacientes` afeta TODA tela que a lê;
--   - FORCE faria a RLS valer para o dono da tabela, quebrando o backfill
--     20260817190100 e qualquer rotina que rode como owner.
