type FieldInfo = {
  name?: string
  id?: string
  placeholder?: string
  label?: string
  className?: string
}

// Returns all matching field variation strings for a single field from the
// fieldVariations mapping config. Used by both ai-field-analysis and ai-batch-analysis.
export function getFieldVariationsForOneField(
  fieldInfo: FieldInfo,
  fieldVariations: Record<string, unknown>
): string[] {
  const variations = new Set<string>()
  const searchTerms = [
    fieldInfo.name,
    fieldInfo.id,
    fieldInfo.placeholder,
    fieldInfo.label,
    ...(fieldInfo.className?.split(' ') ?? [])
  ].filter(Boolean) as string[]

  for (const [, value] of Object.entries(fieldVariations || {})) {
    if (Array.isArray(value)) {
      if (searchTerms.some(term =>
        value.some((v: string) => v.toLowerCase().includes(term.toLowerCase()) ||
                                  term.toLowerCase().includes(v.toLowerCase()))
      )) {
        value.forEach((v: string) => variations.add(v))
      }
    } else if (typeof value === 'object' && value !== null) {
      for (const [, subValue] of Object.entries(value as Record<string, unknown>)) {
        if (Array.isArray(subValue)) {
          if (searchTerms.some(term =>
            subValue.some((v: string) => v.toLowerCase().includes(term.toLowerCase()) ||
                                         term.toLowerCase().includes(v.toLowerCase()))
          )) {
            subValue.forEach((v: string) => variations.add(v))
          }
        }
      }
    }
  }

  return Array.from(variations)
}
