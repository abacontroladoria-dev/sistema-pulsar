# Robô da ASSIM e o caminho até o robô do SharePoint para o PEP

Estudo técnico de 30/09/2026. Somente leitura: nenhum arquivo do código foi alterado para produzi-lo.

## Resumo

- A tela PEP não guarda arquivo nenhum, só o caminho do documento. Por isso o robô do SharePoint provavelmente só precisa **listar os arquivos** (nome, pasta, data, autor, link), sem abrir PDF. Isso reduz a complexidade e a exposição de dados de pacientes.
- O robô atual (`robo-autorizador`, v1.1.10) roda no PC da recepção, preenche o formulário da ASSIM e para antes de enviar. Quem envia é uma pessoa.
- O repositório não tem nenhuma integração com SharePoint ou Microsoft 365.
- No código, PEP significa **Parcela por Entregas por Paciente** (PRD "Sistema de Faturamento de Prestadores PA/PEP v2.7").
- Caminho mais seguro, em fases: inventário só de leitura, depois sugestões que uma pessoa confirma na tela, e só no fim gravação automática.
- **Atualização (30/09/2026, após ver o SharePoint real):** o repositório é organizado por prestador, com 7 subpastas fixas por paciente (uma por documento). O **item do PEP sai do caminho da pasta**, não do nome do arquivo, e o **prestador e o paciente devem ser identificados por CNPJ e CPF**, não por comparação de nomes (seção 3-B e 3-C). O administrador do SharePoint (Bernardo Salotto) concordou em liberar o acesso (opção A1).
- **Ressalva:** as pastas de documentos ainda estão vazias. Só existe a planilha de planejamento de cada prestador. Ainda não dá para medir se os prestadores vão seguir um padrão de nomes.

---

## 1. Como funciona o robô atual

É um RPA instalado no PC da recepção (Windows). Abre um Chromium visível, faz login no portal da ASSIM, preenche o formulário de autorização e espera a recepcionista clicar em enviar. Depois lê o comprovante e grava o resultado no Supabase.

**Tecnologia:** Node 20 e Chromium embutidos no instalador (.exe feito com Inno Setup, levado por pendrive), Playwright para controlar o navegador, `fetch` nativo para falar com o banco. Liga sozinho quando alguém entra no Windows: `start.vbs` abre `start.bat`, que mantém o `worker.js` rodando.

### Caminho de uma autorização

```
/solicitar (navegador da atendente)
   | 1. pergunta ao robô local: GET 127.0.0.1:3010/machine-id   (frontend/lib/machine.ts)
   | 2. grava a solicitação em fila_autorizacoes com o machine_id daquele PC
   v
Supabase <---- o robô consulta robo_buscar_tarefa a cada 1s (ocupado) ou 5s (ocioso)
   |           cada tarefa é travada no banco: duas máquinas nunca pegam a mesma
   v
worker.js -> assim.js (login e sessão) -> rpa.js (preenchimento)
   v
Portal ASSIM: a pessoa identifica o beneficiário e clica em enviar
   v
rpa.js lê o comprovante (guia, data/hora, motivo da glosa) -> robo_concluir_tarefa
```

### Arquivos do robô (`robo-autorizador/`)

| Arquivo | Função |
|---|---|
| `worker.js` | Laço principal. Sobe uma API só local (`/health`, `/machine-id`), manda sinal de vida a cada 30s, busca tarefas, trata pedidos de reinício e de atualização. |
| `assim.js` | Faz login uma vez e guarda só o cookie `PHPSESSID`. Abre cada tarefa numa janela separada já logada, para o portal não detectar várias abas e mandar para `bloqueio.php`. Fecha janelas velhas, mas nunca uma que esteja em uso. |
| `rpa.js` | Preenche operação, natureza, serviço, carteirinha, executor, solicitante, CRM/UF e TUSS. Preenche o modal de nascimento e CPF, espera a identificação do beneficiário e o envio, lê o comprovante e abre o modal "forma de validação". |
| `api.js` | Único ponto de contato com o servidor: 7 funções `robo_*` no banco, com nova tentativa em falha de rede. |
| `segredo.js` | Guarda o token da máquina cifrado com a proteção do Windows (DPAPI). |
| `updater.js` / `publicar.js` | Atualização automática por pacotes assinados (Ed25519). O mantenedor gera o SQL de publicação. |
| `humano.js` | Digita com ritmo humano, porque o portal ignora campo preenchido instantaneamente. |
| `testes/` | 4 testes de regressão (nascimento e CPF, prazo do token, envio sem prazo). |

### Lado do servidor (Supabase)

- **Funções do robô** (`supabase/migrations/20260813100200_robo_rpcs.sql`): `robo_heartbeat`, `robo_buscar_tarefa`, `robo_status_tarefa`, `robo_registrar_log`, `robo_concluir_tarefa`, `robo_obter_config_assim`, `robo_obter_pacote`. Todas são `SECURITY DEFINER` e começam validando o token por hash em `public.maquinas`.
- **`robo_config`**: linha única com os valores do formulário da ASSIM e os tempos. Mudar algo no portal vira um UPDATE, não um pendrive.
- **Senha da ASSIM**: fica no Vault e chega ao robô só em memória (`robo_obter_config_assim`).
- **`robo_pacotes`**: atualizações assinadas. A chave pública fica embutida no instalador, então quem escrever no banco não consegue publicar código na frota.
- **Resultados que o robô grava na fila:** `concluido`, `concluido_sem_guia`, `glosa` (motivo em `status_assim`) e `erro`.

### Decisões de projeto que valem para qualquer robô novo

1. Nada de chave de serviço (`service_role`) no PC. Só a chave pública (anon) mais um token por máquina, revogável sozinho.
2. Configuração no banco e segredo no Vault, nunca no `.env`.
3. Superfície estreita: funções no banco com um objetivo cada, sem acesso direto às tabelas.
4. Uma pessoa confere antes do passo sem volta (o envio).
5. Todo desfecho é gravado de forma legível. A glosa é resultado, não erro. Guia não capturada vira `concluido_sem_guia`, não um falso "verde".
6. Supervisor com códigos de saída: 0 relança, 99 para e chama alguém.
7. Esperas humanas sem prazo, e o robô nunca fecha uma janela em uso.

### Pontos frágeis

- Os seletores do portal estão fixos no código. Se a ASSIM mudar a tela, o robô quebra.
- A página da ASSIM chega sem declarar a codificação de caracteres, por isso as marcas de texto são só ASCII.
- Uma tarefa por vez por máquina: uma tela abandonada prende a fila daquela recepção.
- A atualização automática não troca Node, Chromium nem dependências. Para isso ainda é preciso um .exe novo.

### Não confundir com os outros robôs

- **Robô do relatório:** preenche `status_assim` depois. Não está neste repositório.
- **`robo-laudos`:** roda num container no Coolify, baixa o relatório de laudos do Órbita e reaproveita a mesma identidade por máquina (`supabase/snippets/20260827_cadastrar_maquina_robo_laudos.sql`). É o precedente mais próximo do robô novo.

---

## 2. O que a tela PEP recebe hoje

Página: `frontend/app/(dashboard)/relacionamento-prestador/pep/page.tsx`, que renderiza `frontend/components/cronograma/remuneracao/PepEntregasTab.tsx` (1635 linhas). Não existe API, função de borda nem importação. Toda leitura e escrita é feita no navegador com a sessão do usuário.

### Itens do catálogo (`pep_catalogo_itens`)

| Sigla | Classe | Periodicidade | Registro | Peso |
|---|---|---|---|---|
| STC | recorrente | semanal (4/mês) | GERAL | 30% |
| ETC | recorrente | semanal (4/mês) | GERAL | 30% |
| TAP | recorrente | quinzenal (2/mês) | por paciente | 25% |
| TOP | recorrente | mensal (1/mês) | por paciente | 15% |
| OE | semestral | - | por paciente | 10% |
| RT | semestral | - | por paciente | 20% |
| PIC | semestral | - | por paciente | 20% |

### Tabela que o robô escreveria: `pep_registros_entrega`

- `paciente_nome` (vazio nos itens GERAL), `paciente_cpf`, `prestador_nome`, `item_id`, `competencia` (`YYYY-MM`).
- `status`: `pendente` ou `entregue`. `quantidade_entregue` só nas recorrentes. `data_entrega` só nas semestrais.
- `evidencias` (jsonb): `[{caminho, nome}]`. Hoje a tela preenche só `caminho`.
- Chave de conflito para upsert: coluna gerada `chave_conflito`, com índice único `(chave_conflito, item_id, competencia)`.
- Tabelas relacionadas: `pep_planejamento_semestral`, `pep_apuracao_mensal`, `pep_calendario_competencias`, `pep_trilha_auditoria`.

### Como uma entrega é registrada hoje

- **Recorrentes:** a pessoa marca N caixas até o esperado e informa uma evidência por unidade. O status é derivado: `entregue` se a quantidade chegou ao esperado.
- **Semestrais:** primeiro vem o planejamento (`data_planejada` obrigatória). Depois "Marcar entregue" exige `data_entrega` e 1 evidência. Entrega antecipada cria novo planejamento para +6 meses. Reprogramação (REP-) exige motivo, nova data e evidência.
- Editar ou excluir exige motivo, que vai para a trilha de auditoria.
- Nomenclatura esperada dos arquivos (PRD §13.6): `SIGLA-NN-PACIENTE-MMAAAA` e `REP-SIGLA-PACIENTE-MMAAAA`.
- Placeholder do campo (`PepEntregasTab.tsx:1045`): `ex.: SharePoint/Pacientes/Fulano/STC-01-082026.pdf`. O comentário da migration `20260807140000` diz "SharePoint ou equivalente. Nunca um upload".

### Riscos para um robô que grave direto

- **A apuração roda no navegador.** `apurarESalvarPEP` só é chamada quando alguém abre a tela ou salva algo. Se o robô gravar em `pep_registros_entrega`, `pep_apuracao_mensal` (que alimenta a remuneração) fica desatualizada até alguém abrir a tela. A lógica de "Marcar entregue" das semestrais também está dentro do componente (linhas 584 a 610).
- **Bloqueio só na tela.** Competência com `estado='liberado'` fica congelada na tela, mas o banco aceita a escrita. O robô teria que checar esse estado antes de gravar.
- **Ligação por nome em texto.** Paciente e prestador se ligam por nome, sem chave estrangeira. O robô precisa casar exatamente com os nomes da Grade.
- **Quem é elegível:** profissionais com sessões da especialidade "Coordenador de Caso" na Grade do mês.
- **Permissão:** leitura para `rp`, `admin`, `diretoria`; escrita para `rp` e `admin`. Com `service_role` o RLS é ignorado, e `registrado_por` e a trilha ficam sem usuário.
- **Competência de teste:** `2026-08` não tem efeito financeiro e serve para comparar.

---

## 3. Frentes a investigar para o robô do SharePoint

### A. Acesso ao SharePoint

Começa pela conversa com a TI ou o administrador do Microsoft 365, porque isso decide o resto.

| Opção | Como funciona | Avaliação |
|---|---|---|
| **A1. Microsoft Graph com app no Entra ID e `Sites.Selected`** | O app autentica sozinho (de preferência com certificado) e recebe acesso só a esse site. Roda no Coolify sem ninguém logado. | **Recomendado.** Depende do consentimento do administrador. |
| A2. Graph com login de uma pessoa (device code) | Usa a conta de um funcionário. | Frágil: MFA, token que expira, preso a uma pessoa. |
| A3. Power Automate | Fluxo "quando um arquivo for criado" chama o Órbita por HTTP. | Viável. O conector HTTP exige licença Premium. |
| A4. Biblioteca sincronizada no OneDrive num PC da clínica | Robô local no molde do `robo-autorizador` lê a pasta. | Plano B se a TI não liberar A1. |
| A5. Playwright navegando no SharePoint | Igual ao robô da ASSIM. | Evitar: login Microsoft com MFA e interface que muda muito. |

**Situação:** o administrador do SharePoint, Bernardo Salotto, concordou em liberar a opção A1. Site: `https://clinicauniversoaba.sharepoint.com/sites/RepositorioPrestadordeServico`. O endereço `https://graph.microsoft.com/v1.0` é o que o robô chama; aberto no navegador ele só mostra o índice público da API, e o acesso vem de um app cadastrado no Entra ID.

**Passo a passo para o administrador** (cerca de 20 minutos, tudo só leitura):

0. **Teste no Graph Explorer** (https://developer.microsoft.com/graph/graph-explorer): `GET https://graph.microsoft.com/v1.0/sites/clinicauniversoaba.sharepoint.com:/sites/RepositorioPrestadordeServico`. Deve devolver o site com `id` no formato `clinicauniversoaba.sharepoint.com,xxxx,yyyy`. Anotar o `id`.
1. **Registrar o app** em entra.microsoft.com → Aplicativos → Registros de aplicativo → Novo registro. Nome `Pulsar - Robo PEP SharePoint`, só este diretório, sem URI de redirecionamento. Anotar o ID do aplicativo e o ID do diretório (locatário).
2. **Permissão:** Permissões de API → Microsoft Graph → Permissões de aplicativo → `Sites.Selected` → "Conceder consentimento do administrador". Sozinha, essa permissão não libera site nenhum.
3. **Liberar só este site, só leitura:** `POST /sites/{id-do-site}/permissions` com `{"roles":["read"],"grantedToIdentities":[{"application":{"id":"<ID do aplicativo>","displayName":"Pulsar - Robo PEP SharePoint"}}]}` (resposta esperada 201). Alternativa em PowerShell: `Grant-PnPAzureADAppSitePermission -AppId <ID> -Site <URL do site> -Permissions Read`.
4. **Credencial:** certificado (preferível, a chave privada fica só no Coolify) ou segredo do cliente com validade de 12 a 24 meses e lembrete de renovação. O valor do segredo aparece uma única vez e **não deve ser enviado por chat nem gravado no repositório**: vai direto para o Coolify.

**Leitura do `.xlsx`:** o robô baixa o arquivo e lê no container. A API de Excel do Graph tem limitações quando roda sem usuário logado.

A conferir ainda: se há acesso condicional no tenant, se prestadores externos (convidados) enviam arquivos por conta própria e se cada pasta de prestador tem permissão própria.

### B. O que existe dentro do repositório do SharePoint

Observado em 30/09/2026 (capturas de tela do site): é uma biblioteca de documentos ("Documentos Compartilhados"), com esta estrutura:

```
Documentos Compartilhados
└── Prestador de Serviço - <Nome> (<RAZÃO SOCIAL>)      ← 1 pasta por prestador (mais de 10)
    ├── 1. Planejamento - Prestador de Serviço
    │   └── Planejamento Documentos Técnicos - <Nome>.xlsx
    ├── 2. Geral
    │   ├── 1. Supervisão Técnica ABA do Caso            ← STC
    │   └── 2. Estudo Técnico de Caso                    ← ETC
    └── 3. Pacientes
        └── <Nome do paciente>                           ← 1 pasta por paciente
            ├── 1. Treinamento de Aplicadores ABA        ← TAP
            ├── 2. Treinamento e Orientação Parental     ← TOP
            ├── 3. Plano Individualizado Comportamental (PIC)  ← PIC
            ├── 4. Relatório de Fechamento Técnico       ← RT
            ├── 5. Orientação Escolar                    ← OE
            ├── 6. Avaliações Gerais                     (fora do PEP hoje)
            └── 7. Protocolo de Conduta                  (fora do PEP hoje)
```

**Planilha de planejamento** (uma por prestador):
- Cabeçalho: Prestador (Razão Social), **CNPJ** (B2) e e-mail.
- Aba "Planejamento": Paciente, **CPF (automático)**, Documento (PIC, Relatório de Fechamento Técnico, Orientação Escolar) e Competência (`Mai/2026`, `Nov/2026`...). É o planejamento das semestrais (`pep_planejamento_semestral`) já pronto. A linha 6 diz "Planejamento definido com autonomia técnica pelo PRESTADOR".
- Aba "Pacientes": Nome/código do paciente e CPF (sem formatação), cerca de 13 por prestador no exemplo visto.

**Achados que importam:**
- O mesmo prestador aparece com três grafias: "Aline Miranda" (pasta), "Aline De Miranda Costa" (arquivo) e "ALINE MIRANDA PSICOLOGIA LTDA" (razão social). Comparar nomes não é confiável.
- **As pastas de documentos estão vazias** (Geral/Supervisão, Geral/Estudo, Pacientes/Treinamento de Aplicadores, Treinamento e Orientação Parental). Só existe o `.xlsx`. Ainda não se sabe como os prestadores vão nomear os arquivos, se será um arquivo por sessão ou por mês, nem de onde sairá a competência.
- **O campo "Modificado por" não identifica o prestador.** As pastas aparecem como criadas por Bernardo Salotto (administrador) e o `.xlsx` como modificado por Juliana Matos (Diretora Terapêutica). Portanto quem envia ou edita pode ser um terceiro, e o autor só serve como informação de auditoria, nunca como regra de autoria. A identidade do prestador vem da pasta de nível 1 e do CNPJ da planilha.
- Sem os arquivos reais, a pergunta "quantos nomes seguem `SIGLA-NN-PACIENTE-MMAAAA`" continua em aberto. A primeira entrega útil é um inventário só de leitura que responda isso em porcentagem, quando houver arquivos.

### C. De arquivo para registro PEP

**Item do PEP: vem do caminho da pasta**, com o número da subpasta como chave (mais estável que o nome do arquivo).

| Onde está no SharePoint | Campo do PEP |
|---|---|
| `2. Geral / 1. Supervisão Técnica ABA do Caso` | item STC, tipo GERAL (sem paciente) |
| `2. Geral / 2. Estudo Técnico de Caso` | item ETC, tipo GERAL (sem paciente) |
| `3. Pacientes / <paciente> / 1. Treinamento de Aplicadores ABA` | item TAP |
| `3. Pacientes / <paciente> / 2. Treinamento e Orientação Parental` | item TOP |
| `3. Pacientes / <paciente> / 3. Plano Individualizado Comportamental (PIC)` | item PIC |
| `3. Pacientes / <paciente> / 4. Relatório de Fechamento Técnico` | item RT |
| `3. Pacientes / <paciente> / 5. Orientação Escolar` | item OE |
| `6. Avaliações Gerais`, `7. Protocolo de Conduta` | fora do PEP hoje; ignorar |
| Pasta de nível 1 | `prestador_nome` (confirmado pelo CNPJ) |
| Data de criação do arquivo, ou o nome | `competencia` (`YYYY-MM`) e `data_entrega` nas semestrais. **A decidir** com o RP, porque as pastas ainda estão vazias. |
| Quantidade de arquivos | `quantidade_entregue` nas recorrentes (uma evidência por unidade) |
| `webUrl` do arquivo | `evidencias[].caminho` |

**Como identificar prestador e paciente sem "casar nomes":**

1. **Prestador: pelo CNPJ.** O robô lê o CNPJ da célula B2 da planilha e procura em `remuneracao_contratos` (que tem `cnpj` e `razao_social`). A razão social entre parênteses no nome da pasta serve de segunda conferência.
2. **Paciente: pasta → CPF → cadastro.**
   - O nome da pasta é procurado na aba "Pacientes" da planilha **do mesmo prestador** (lista curta, pouco risco de confundir).
   - O CPF obtido é procurado na tabela `pacientes` do Pulsar (coluna `cpf`).
   - **Só grava sozinho quando três sinais concordam:** CPF existe e tem dígito verificador válido; o nome no Pulsar é parecido com o da pasta (ignorando acento e caixa); e o paciente tem sessão com aquele prestador na Grade. Se um discordar, o caso vai para a fila "não reconheci".
3. **Chave estável: o `id` do item no SharePoint.** Ele não muda quando a pasta é renomeada ou movida. Uma pessoa confirma uma vez que "a pasta X é o CPF Y"; depois disso, mudança de grafia não quebra o vínculo.
4. **Risco residual:** o CPF da planilha é digitado à mão. Um CPF errado, mas pertencente a outro paciente real, só é pego pelas conferências de nome e de Grade. Por isso o CPF nunca é usado sozinho.
5. **Alternativa mais robusta:** criar uma coluna "CPF" na biblioteca, preenchida nas pastas de paciente, para o robô ler direto sem abrir a planilha. Não colocar o CPF no nome da pasta.

Outros pontos:
- Nomes que não batem (acentos, abreviações, nomes compostos) precisam de tabela de-para e de uma fila de "não reconheci" para revisão humana.
- **A planilha de planejamento já traz o planejamento das semestrais** (PIC, RT, OE por competência). O robô pode ler isso para preencher `pep_planejamento_semestral`, em vez de a pessoa redigitar. Se a planilha e o planejamento do Pulsar divergirem, vale a última alteração? Definir com o RP, dado que a planilha é editada também pela Diretora Terapêutica.
- Semestral sem planejamento: o fluxo atual exige `pep_planejamento_semestral` antes de marcar entregue. Com a planilha, esse caso tende a ser raro. O que o robô faz quando ainda assim acontecer?
- As pastas 6 e 7 do paciente (Avaliações Gerais e Protocolo de Conduta) não pertencem a nenhum item do PEP hoje. O robô deve ignorá-las até haver decisão do negócio.

### D. Regras de escrita

Sugestão: o robô **não escreve direto** nas tabelas `pep_*`. Ele grava numa tabela intermediária de evidências encontradas, com o id do arquivo no SharePoint como chave estável (mesmo raciocínio do "ID Laudo").

- Nunca diminuir o que foi lançado à mão.
- Nunca tocar competência `liberado`.
- Registrar na trilha `pep_trilha_auditoria` com `usuario_nome='robo-sharepoint'`.
- Definir o que fazer quando o arquivo for apagado ou renomeado no SharePoint.

### E. Onde roda e como se identifica

- **Onde:** container no Coolify com agendamento (diário ou de hora em hora), como o `robo-laudos`.
- **Identidade:** cadastro em `public.maquinas`, token próprio e funções `robo_pep_*` específicas, em vez de `service_role`. A rotação da chave `service_role` exposta ainda está pendente.
- **Segredo:** certificado ou segredo do app Microsoft fica no Coolify, nunca no repositório.
- **Só o que mudou:** "delta query" do Graph por biblioteca, com o `deltaLink` guardado no banco. Ela também informa arquivos apagados.
- **Paginação:** no Graph e no PostgREST, que corta em 1000 linhas sem dar erro.

### F. Perguntas para o negócio (RP)

1. O RP quer confirmar cada evidência ou aceita gravação automática?
2. A existência do arquivo basta como prova, ou alguém valida o conteúdo (assinatura, paciente certo)?
3. Se o arquivo chegar depois do fechamento do mês, a regra de devolução retroativa das semestrais continua valendo?
4. Como o prestador deve nomear e organizar os arquivos dentro de cada subpasta (um por sessão? um por mês?), e de onde sai a competência: da data de envio ou do nome?
5. Quem pode alterar a planilha de planejamento (Diretora Terapêutica, prestador, ambos)? Em caso de divergência, qual versão vale?
6. Quando alguém sobe um arquivo em nome do prestador (administrador, diretora), isso conta como entrega do prestador?

---

## 4. Fases sugeridas

| Fase | Nome | O que entrega |
|---|---|---|
| 1 | Só leitura | Inventário dos arquivos e relatório de quanto bate com o que já foi lançado à mão. A competência de teste 2026-08 serve de comparação. |
| 2 | Sugestões na tela | Painel lateral "o SharePoint tem 3 evidências para este paciente". O analista confirma com um clique, e a gravação usa o mesmo caminho da tela, com cálculo, auditoria e bloqueio de mês liberado. |
| 3 | Gravação automática | Só para o que tem alta confiança. Antes, levar `apurarESalvarPEP` e o "Marcar entregue" do navegador para uma rota no servidor. |

## 5. Primeiros passos

1. ~~Conversar com a TI sobre a opção A1 (`Sites.Selected`).~~ O administrador (Bernardo Salotto) concordou. Falta executar o passo a passo da seção 3-A e guardar o `id` do site, o ID do aplicativo e o ID do diretório. O segredo ou certificado vai direto para o Coolify.
2. Com o acesso liberado, rodar um inventário só de leitura (fora do banco, só relatório) que:
   - lista as pastas de prestador e confere se todas têm a mesma estrutura;
   - lê a planilha de planejamento de cada prestador e valida o CNPJ e os CPFs;
   - cruza CPFs com `pacientes` e `remuneracao_contratos`;
   - lista o que ficaria na fila "não reconheci".
3. Alinhar com o RP as perguntas 4 a 6 da seção F, porque as pastas de documentos ainda estão vazias.
4. Só então desenhar a tabela intermediária e o painel de sugestões.

## Fontes

`robo-autorizador/*`, `supabase/migrations/20260813100100` e `20260813100200`, `20260807120000` a `20260902140000` (tabelas `pep_*`), `PepEntregasTab.tsx`, `frontend/lib/machine.ts`.
