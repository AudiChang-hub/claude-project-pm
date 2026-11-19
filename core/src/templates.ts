/** The files init can write into a project, carried inside the program (scripts/web-assets.mjs packs core/templates). */
import type { CoreKey } from './messages'
import { CORE_MESSAGES, ct, getLang } from './messages'
import { TEMPLATES } from './templates.generated'

/**
 * The CI workflow init --ci adds as .github/workflows/project-pm-qa.yml (docs/design/v1-core.md 6.3), in the
 * language the core speaks: every `{{pm:<key>}}` becomes that message as a YAML double-quoted string.
 */
export function ciTemplate(): string {
  return TEMPLATES['project-pm-qa.yml']!.replace(/\{\{pm:([\w.]+)\}\}/g, (whole, key: string) => {
    if (!(key in CORE_MESSAGES[getLang()])) throw new Error(`templates/project-pm-qa.yml: no message ${key}`)

    return JSON.stringify(ct(key as CoreKey))
  })
}
