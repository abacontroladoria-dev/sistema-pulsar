# Inventário do SharePoint → PEP

Gerado em 2026-09-30 16:22 UTC pelo `robo-pep-sharepoint/scripts/inventario.js` (só leitura, cruzamento com o Pulsar em modo simulação).
Relatório agregado: não contém nome, CPF nem caminho de nenhum paciente ou prestador.

## Estrutura

| Medida | Valor |
|---|---|
| Pastas no site | 1769 |
| Pastas de prestador | 14 |
| Pastas de prestador fora do padrão de nome | 0 |
| Arquivos de evidência (em pasta de item do PEP) | 72 |
| Planilhas de planejamento | 5 |
| Arquivos ignorados (pastas 6/7, soltos) | 14 |
| Arquivos fora do padrão | 0 |

## Planilhas de planejamento

| Medida | Valor |
|---|---|
| Lidas | 4 |
| Ilegíveis | 0 |
| Com CNPJ ausente ou inválido | 0 |
| Pacientes listados nas abas "Pacientes" | 62 |
| CPFs com dígito verificador inválido | 0 (0%) |

## Cruzamento com o Pulsar (simulação)

| Medida | Valor |
|---|---|
| Prestadores reconhecidos pelo CNPJ | 4 de 14 (29%) |
| Pastas de paciente reconhecidas (3 sinais) | 56 de 210 (27%) |
| Evidências que virariam sugestão | 4 |
| Evidências que iriam para "não reconheci" | 68 |

### Motivos de não reconhecimento

| Motivo | Quantidade |
|---|---|
| `planilha_ausente` | 226 |
| `cpf_duplicado_no_pulsar` | 3 |
| `paciente_fora_da_planilha` | 3 |


## Tempo e custo desta leitura

| Etapa | Tempo |
|---|---|
| autenticar | 0.39 s |
| listar | 4.68 s |
| classificar | 0.01 s |
| planilhas | 2.52 s |
| enviar | 1.32 s |
| **Total** | **11.38 s** |

- Microsoft Graph: 16 chamadas, 3216 KB, 0 esperas por limite.
- Pulsar: 12 chamadas, 411 ms dentro do banco.
- Esta é a leitura COMPLETA (pior caso). As execuções agendadas leem só o que mudou.
