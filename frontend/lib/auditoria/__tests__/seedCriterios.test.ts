import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CRITERIOS_FALLBACK, parseCriterios } from '../criterios'

/**
 * O seed no banco e o fallback em código são a MESMA v1 escrita duas vezes (SQL
 * e TS). Este teste é o que impede as duas cópias de divergirem: se alguém
 * editar uma e esquecer a outra, o ambiente que ler do banco passa a auditar
 * por uma régua diferente do que o código diz — e nada denunciaria isso.
 */
describe('seed da v1 × CRITERIOS_FALLBACK', () => {
  const caminho = join(
    __dirname,
    '../../../../supabase/migrations/20260922180100_seed_auditoria_criterios_v1.sql'
  )

  it('o JSONB do arquivo de seed é igual aos critérios em código', () => {
    const sql = readFileSync(caminho, 'utf8')

    // O seed usa dollar-quoting ($criterios$...$criterios$) justamente para não
    // escapar as aspas do JSON.
    const inicio = sql.indexOf('$criterios$')
    const fim = sql.lastIndexOf('$criterios$')
    expect(inicio, 'delimitador $criterios$ não encontrado no seed').toBeGreaterThan(-1)
    expect(fim).toBeGreaterThan(inicio)

    const bruto = sql.slice(inicio + '$criterios$'.length, fim)
    const doSeed = parseCriterios(JSON.parse(bruto))

    expect(doSeed).toEqual(CRITERIOS_FALLBACK)
  })
})
