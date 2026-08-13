import type { Schema } from '../schema-runtime'

/**
 * Normalizes a decoded kiwi schema so that legacy `WindingRule` enum member
 * `ODD` (numeric value 1) is also addressable as `EVENODD`.
 *
 * Older `.fig` files embed a kiwi schema (canvas chunk[0]) whose `WindingRule`
 * enum still names numeric value 1 `ODD`, while newer scenes encode the value
 * `'EVENODD'`. Field ids and enum numeric values are unchanged between the two,
 * so adding an `EVENODD` alias before compiling the codec keeps roundtrip
 * fidelity intact while letting both the encoder (save) and decoder (read)
 * resolve value 1 as `'EVENODD'`. The embedded schema bytes themselves are
 * left untouched (they are written back verbatim on save).
 *
 * No-op when the enum already exposes `EVENODD` or when no `WindingRule` enum
 * exists in the schema.
 */
export function normalizeWindingRuleSchema(schema: Schema): Schema {
  const windingRule = schema.definitions.find(
    (definition) => definition.kind === 'ENUM' && definition.name === 'WindingRule'
  )
  if (!windingRule) return schema
  if (windingRule.fields.some((field) => field.name === 'EVENODD')) return schema
  const oddField = windingRule.fields.find((field) => field.name === 'ODD' && field.value === 1)
  if (!oddField) return schema
  windingRule.fields.push({ ...oddField, name: 'EVENODD' })
  return schema
}
