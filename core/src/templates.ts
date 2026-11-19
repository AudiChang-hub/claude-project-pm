/** The files init can write into a project, carried inside the program (scripts/web-assets.mjs packs core/templates). */
import { TEMPLATES } from './templates.generated'

/** The CI workflow init --ci adds as .github/workflows/project-pm-qa.yml (docs/design/v1-core.md 6.3). */
export const CI_TEMPLATE: string = TEMPLATES['project-pm-qa.yml']!
