-- Critérios da auditoria de evoluções: histórico de versões.
--
-- POR QUE EXISTE: os critérios (4 perguntas, termos proibidos, regras de
-- sigilo, limiares de risco) viviam hardcoded em frontend/lib/auditoria/prompts.ts.
-- Quem conhece essa régua é o setor terapêutico, e qualquer ajuste exigia deploy.
--
-- POR QUE APPEND-ONLY: sem histórico, ninguém consegue explicar por que a
-- evolução de setembro passou e a de outubro, idêntica, foi reprovada — nem
-- provar, num questionamento de glosa, sob qual regra auditou. Cada linha de
-- auditoria_evolucoes aponta para a versão que a julgou (migration ..._versao_e_rls),
-- e essa versão não pode mudar depois. Daí o trigger abaixo: a imutabilidade é
-- garantida no BANCO, não na confiança da aplicação.
--
-- O conteúdo NÃO inclui o schema JSON da resposta da IA. Esse bloco é contrato
-- do parser e fica constante no código (SCHEMA_RESPOSTA_AUDITORIA), fora do
-- alcance de quem edita — senão uma edição inocente quebraria a leitura da
-- resposta em silêncio.

create table if not exists public.auditoria_criterios_versoes (
  id uuid primary key default gen_random_uuid(),
  versao int not null,
  conteudo jsonb not null,
  publicado_por uuid references public.usuarios(id),
  publicado_por_nome text not null,
  publicado_em timestamptz not null default now(),
  nota_publicacao text,
  constraint uq_auditoria_criterios_versao unique (versao)
);

comment on table public.auditoria_criterios_versoes is
  'Versões dos critérios da auditoria de evoluções por IA. Append-only: nunca sofre UPDATE nem DELETE (trigger trg_auditoria_criterios_imutavel).';
comment on column public.auditoria_criterios_versoes.conteudo is
  'Critérios em JSONB: abertura, conferencia_estrutural, pilares (4 chaves congeladas), regras_especificas, termos_proibidos, status_risco (3 chaves congeladas). Validado por parseCriterios() no app.';

-- Índice para "a versão vigente é a de maior número".
create index if not exists idx_auditoria_criterios_versao_desc
  on public.auditoria_criterios_versoes (versao desc);

-- Guarda de imutabilidade. Não existia função equivalente no repo.
create or replace function public.auditoria_criterios_impedir_alteracao()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'auditoria_criterios_versoes é append-only: % não é permitido. Publique uma nova versão.',
    tg_op
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists trg_auditoria_criterios_imutavel on public.auditoria_criterios_versoes;
create trigger trg_auditoria_criterios_imutavel
  before update or delete on public.auditoria_criterios_versoes
  for each row execute function public.auditoria_criterios_impedir_alteracao();

-- RLS: mesma condição da tela de auditoria (ver migration ..._versao_e_rls).
-- Sem update/delete: além do trigger, não há sequer policy que os permita.
alter table public.auditoria_criterios_versoes enable row level security;
alter table public.auditoria_criterios_versoes force row level security;

drop policy if exists auditoria_criterios_versoes_select on public.auditoria_criterios_versoes;
create policy auditoria_criterios_versoes_select
  on public.auditoria_criterios_versoes for select to authenticated
  using (
    public.usuario_tem_permissao('terapeutico_auditoria_evolucoes')
    or public.remuneracao_has_role(array['admin', 'diretoria', 'terapeutico'])
  );

drop policy if exists auditoria_criterios_versoes_insert on public.auditoria_criterios_versoes;
create policy auditoria_criterios_versoes_insert
  on public.auditoria_criterios_versoes for insert to authenticated
  with check (
    public.usuario_tem_permissao('terapeutico_auditoria_evolucoes')
    or public.remuneracao_has_role(array['admin', 'diretoria', 'terapeutico'])
  );

grant select, insert on public.auditoria_criterios_versoes to authenticated;
