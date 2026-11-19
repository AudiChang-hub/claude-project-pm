/**
 * The core's data, as the mod's types (types/index.d.ts) extended for v1 (docs/design/v1-core.md 2.3 and 10.1).
 * Every new field is optional: an old file without it reads as it always did, and is not filled in on write.
 */
import type { AgentRecord, BackgroundTask, LedgerItem, ProjectFile, QaRecord, Report, Step } from '../../types'

/** Who did something: the session or agent (on this machine), and the person (their GitHub login) when known. */
export type Author = { actor: string; person?: string }

export type CoreQaRecord = QaRecord & {
  /** The checker's GitHub login (v1.1 shows it to the others). */
  byPerson?: string
}

export type CoreItem = Omit<LedgerItem, 'qa'> & {
  qa?: CoreQaRecord
  /** The commits of this item (report, ledger update): the pre-push check finds the item by them. */
  commits?: string[]
  /** A stable unique id (UUID v7): two machines adding items at once never clash. Written from v1.0 on. */
  uid?: string
  createdBy?: Author
  updatedBy?: Author
  /** How many times this item was written: v1.1 compares it with the last sync. */
  rev?: number
}

export type CoreProject = Omit<ProjectFile, 'ledger'> & {
  ledger: CoreItem[]
  /** Absent: the old format. */
  schema?: 2
  /** One more on every write: the board redraws when it moves. */
  revision?: number
}

/** A session (or agent) as the core keeps it: where it works, and what it last reported (the mod's Track). */
export type Actor = {
  id: string
  /** The tool it runs in: claude-code, codex, … (MCP clientInfo, or the hook). */
  tool: string
  title: string
  cwd: string
  /** The project it reported for (projectKey), so the board finds it without git. */
  projectKey?: string
  lastSeenAt: number
  state?: 'running' | 'idle' | 'asking'
  plan?: Step[]
  recap?: string | null
  ask?: string | null
  lastPrompt?: string
  lastAnswer?: string
  turnAt?: number
  planAt?: number
  background?: BackgroundTask[]
  agents?: AgentRecord[]
  report?: Report
  reportAt?: number
}

