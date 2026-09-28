import { describe, expect, it } from 'vitest'
import { abaPadraoLiberada, isSuperRole, podeAcessarRota, resolverPermissoes, temPermissao, uniaoDosModelos } from './resolver'

// O bug que originou `podeAcessarRota`: o proxy.ts retornava cedo para `admin`
// (liberava a rota sem olhar código nenhum) e o `canAccess` do Sidebar não tinha
// esse atalho — exigia o código em codigosToRotas. Sem `autorizacoes_avulsas` no
// conjunto, o admin abria a página pelo link direto e não via o item no menu.
//
// Estes testes travam a propriedade que importa: menu e navegação decidem igual,
// porque agora são a MESMA função.

describe('podeAcessarRota — admin', () => {
  it('admin acessa rota cujo código ele não tem no conjunto (o caso do bug)', () => {
    // Conjunto vazio de propósito: prova que o acesso vem do papel, não do código.
    expect(podeAcessarRota('admin', new Set(), '/autorizacoes-avulsas')).toBe(true)
  })

  it('admin acessa qualquer rota, inclusive uma que não existe no catálogo', () => {
    expect(podeAcessarRota('admin', new Set(), '/rota-que-nao-existe')).toBe(true)
  })
})

// Grupos ao vivo (29/09/2026): telas = união dos modelos dos grupos + ajustes
// individuais. A MESMA regra está no banco (permissoes_efetivas e
// usuario_tem_permissao, 20260929140000) — estes casos são o contrato das duas.
const RECEPCAO = { atendimentos: true, gestao: true, autorizacoes_avulsas: false }
const FATURAMENTO = { insumos: true, conferencia_guias: true, gestao: false }

describe('resolverPermissoes — grupos ao vivo + ajustes', () => {
  it('o grupo dá as telas do modelo, e só elas', () => {
    const codigos = resolverPermissoes([], [RECEPCAO])
    expect(podeAcessarRota('recepcao', codigos, '/solicitar')).toBe(true)
    expect(podeAcessarRota('recepcao', codigos, '/autorizacoes-avulsas')).toBe(false)
  })

  it('sem grupo e sem ajuste, nada (o nível técnico não dá tela)', () => {
    expect(resolverPermissoes([], []).size).toBe(0)
    expect(podeAcessarRota('diretoria', resolverPermissoes([], []), '/solicitar')).toBe(false)
  })

  it('dois grupos somam; um false num modelo não tira o que o outro dá', () => {
    // gestao: true em Recepção, false em Faturamento → fica.
    const codigos = resolverPermissoes([], [RECEPCAO, FATURAMENTO])
    expect([...codigos].sort()).toEqual(['atendimentos', 'conferencia_guias', 'gestao', 'insumos'])
  })

  it('ajuste liberado dá tela que nenhum grupo dá ("modelo + 1")', () => {
    const codigos = resolverPermissoes([{ permissao_codigo: 'autorizacoes_avulsas', permitido: true }], [RECEPCAO])
    expect(podeAcessarRota('recepcao', codigos, '/autorizacoes-avulsas')).toBe(true)
  })

  it('ajuste retirado vence o grupo ("modelo − 1")', () => {
    const codigos = resolverPermissoes([{ permissao_codigo: 'gestao', permitido: false }], [RECEPCAO, FATURAMENTO])
    expect(codigos.has('gestao')).toBe(false)
  })

  it('uniaoDosModelos ignora os false', () => {
    expect([...uniaoDosModelos([RECEPCAO])].sort()).toEqual(['atendimentos', 'gestao'])
  })
})

describe('podeAcessarRota — conjunto vazio', () => {
  it('papel desconhecido não acessa nada além do que o conjunto disser', () => {
    expect(podeAcessarRota('inexistente', new Set(), '/autorizacoes-avulsas')).toBe(false)
  })
})

describe('podeAcessarRota — permissão por aba (querystring)', () => {
  // /cronograma/indicadores é uma rota só, com abas separadas por ?tab=. Se a
  // querystring fosse ignorada, quem tem uma aba veria todas.
  it('a aba concedida abre', () => {
    const soUmaAba = new Set(['indicadores_pacientes'])
    expect(
      podeAcessarRota('diretoria', soUmaAba, '/cronograma/indicadores', '?tab=pacientes')
    ).toBe(true)
  })

  it('a aba não concedida não abre na mesma rota', () => {
    const soUmaAba = new Set(['indicadores_pacientes'])
    expect(
      podeAcessarRota('diretoria', soUmaAba, '/cronograma/indicadores', '?tab=profissionais')
    ).toBe(false)
  })

  it('admin passa por cima da checagem de aba', () => {
    expect(
      podeAcessarRota('admin', new Set(), '/cronograma/indicadores', '?tab=profissionais')
    ).toBe(true)
  })
})

describe('isSuperRole / temPermissao', () => {
  it('só admin é super', () => {
    expect(isSuperRole('admin')).toBe(true)
    expect(isSuperRole('diretoria')).toBe(false)
    expect(isSuperRole('')).toBe(false)
  })

  it('temPermissao e podeAcessarRota concordam sobre o admin', () => {
    // As duas portas (código e rota) não podem divergir para o mesmo papel.
    expect(temPermissao('admin', new Set(), 'insumos')).toBe(true)
    expect(podeAcessarRota('admin', new Set(), '/insumos')).toBe(true)
  })

  it('ajuste retirado não derruba o admin (o papel vence)', () => {
    const codigos = resolverPermissoes([{ permissao_codigo: 'insumos', permitido: false }], [{ insumos: true }])
    expect(codigos.has('insumos')).toBe(false)
    expect(temPermissao('admin', codigos, 'insumos')).toBe(true)
  })
})

describe('ASSIM — uma permissão por aba', () => {
  // 29/09/2026: Conferência e Reconciliação ASSIM viraram itens independentes.
  it('quem só tem a Conferência não abre a Reconciliação', () => {
    const so = new Set(['auditoria_assim'])
    expect(podeAcessarRota('recepcao', so, '/auditoria-assim', '?tab=auditoria')).toBe(true)
    expect(podeAcessarRota('recepcao', so, '/auditoria-assim', '?tab=reconciliacao')).toBe(false)
  })

  it('quem só tem a Reconciliação não abre a Conferência', () => {
    const so = new Set(['reconciliacao_assim'])
    expect(podeAcessarRota('recepcao', so, '/auditoria-assim', '?tab=reconciliacao')).toBe(true)
    expect(podeAcessarRota('recepcao', so, '/auditoria-assim', '?tab=auditoria')).toBe(false)
  })

  it('URL pura vai para a primeira aba liberada', () => {
    expect(abaPadraoLiberada('recepcao', new Set(['auditoria_assim', 'reconciliacao_assim']), '/auditoria-assim'))
      .toBe('/auditoria-assim?tab=auditoria')
    expect(abaPadraoLiberada('recepcao', new Set(['reconciliacao_assim']), '/auditoria-assim'))
      .toBe('/auditoria-assim?tab=reconciliacao')
  })

  it('URL pura sem aba liberada, ou com ?tab= já presente, não redireciona', () => {
    expect(abaPadraoLiberada('recepcao', new Set(), '/auditoria-assim')).toBeNull()
    expect(abaPadraoLiberada('recepcao', new Set(['auditoria_assim']), '/auditoria-assim', '?tab=auditoria')).toBeNull()
    expect(abaPadraoLiberada('recepcao', new Set(['auditoria_assim']), '/cco')).toBeNull()
  })
})

describe('subpágina com código próprio', () => {
  // O prefixo de '/admin' (usuarios) abria /admin/permissoes e /admin/api.
  it('Usuários não abre Permissões nem API', () => {
    const so = new Set(['usuarios'])
    expect(podeAcessarRota('diretoria', so, '/admin')).toBe(true)
    expect(podeAcessarRota('diretoria', so, '/admin/permissoes')).toBe(false)
    expect(podeAcessarRota('diretoria', so, '/admin/api')).toBe(false)
    expect(podeAcessarRota('diretoria', so, '/admin/api/documentacao')).toBe(false)
  })

  it('Permissões abre sem precisar de Usuários', () => {
    expect(podeAcessarRota('diretoria', new Set(['permissoes']), '/admin/permissoes')).toBe(true)
  })

  it('subpágina sem código próprio continua seguindo a mãe', () => {
    expect(podeAcessarRota('diretoria', new Set(['api_integracao']), '/admin/api/documentacao')).toBe(true)
    expect(podeAcessarRota('diretoria', new Set(['cadastros_pacientes']), '/cadastros/pacientes/123')).toBe(true)
  })
})
