/**
 * How the core's copy of a project and the desktop mod's copy become one (docs/design/v1-core.md 2.4, E1 and E2).
 * Pure: no file is read here, so the mod (hooks/, which reads files through the engine) merges the two copies the very
 * same way the core does.
 */
import { isSameId } from '../../hooks/qa'
import type { CoreItem, CoreProject } from './types'

/** The fields of a work item the mod writes, and may clear on purpose (criteria, a verdict): never brought back. */
const MOD_FIELDS = ['id', 'text', 'owner', 'status', 'note', 'createdAt', 'updatedAt', 'criteria', 'qa', 'formerOwners', 'closedAt']
/** The fields the core writes, and may clear on purpose. */
const CORE_FIELDS = ['uid', 'createdBy', 'updatedBy', 'rev', 'commits']

/** Copies into `to` each field of `from` it lacks, but those the side `to` came from manages itself. */
function carryOver(to: CoreItem, from: CoreItem, managed: string[]) {
  const target = to as Record<string, unknown>
  for (const [key, value] of Object.entries(from)) if (!managed.includes(key) && target[key] === undefined && value !== undefined) target[key] = value
}

/** formerOwners only ever grows: the owners either copy kept, each once (isSameId), the standing copy's first. */
function withFormerOwners(to: CoreItem, from: CoreItem) {
  const extra = (from.formerOwners ?? []).filter(o => !(to.formerOwners ?? []).some(mine => isSameId(mine, o)))
  if (extra.length) to.formerOwners = [...(to.formerOwners ?? []), ...extra]
}

/**
 * The project as the core and the mod both left it (E1). Items are matched by id. The one updated later stands;
 * when that is the mod's copy, the fields the mod does not know are carried over from the core's copy, and the QA's
 * new fields only when both copies hold the same verdict (the mod may have recorded a newer one). The PM and the
 * band's dismissal follow the file written last.
 */
export function mergeLegacy(core: CoreProject, legacy: CoreProject, isLegacyNewer: boolean): CoreProject {
  const byId = new Map<number, CoreItem>()
  for (const item of core.ledger) byId.set(item.id, item)
  const ledger: CoreItem[] = core.ledger.map(item => ({ ...item }))
  for (const old of legacy.ledger) {
    const ours = byId.get(old.id)
    if (!ours) {
      ledger.push({ ...old })
      continue
    }
    if (!(old.updatedAt > ours.updatedAt)) {
      // The core's copy stands. A field only a newer mod knows comes back from the mod's copy, and formerOwners from both.
      const kept = ledger[ledger.findIndex(item => item.id === old.id)]!
      carryOver(kept, old, [...MOD_FIELDS, ...CORE_FIELDS])
      withFormerOwners(kept, old)
      continue
    }
    const merged: CoreItem = { ...old }
    // Every field the mod does not know comes back from the core's copy (uid, createdBy, commits, and any later one).
    carryOver(merged, ours, MOD_FIELDS)
    withFormerOwners(merged, ours)
    if (merged.qa && ours.qa && merged.qa.at === ours.qa.at && ours.qa.byPerson && !merged.qa.byPerson) merged.qa = { ...merged.qa, byPerson: ours.qa.byPerson }
    merged.rev = (ours.rev ?? 0) + 1
    merged.updatedBy = { actor: 'desktop-mod' }
    ledger[ledger.findIndex(item => item.id === old.id)] = merged
  }
  ledger.sort((a, b) => a.id - b.id)
  const highest = ledger.reduce((max, item) => Math.max(max, item.id), 0)

  return {
    ...core,
    pmId: isLegacyNewer ? legacy.pmId : core.pmId,
    isDismissed: isLegacyNewer ? legacy.isDismissed : core.isDismissed,
    ledger,
    nextId: Math.max(core.nextId, legacy.nextId, highest + 1),
  }
}
