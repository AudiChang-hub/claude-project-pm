/** One of the person's sessions, as the desktop app lists it. */
export type Session = {
  id: string
  title: string
  cwd: string
  isRunning: boolean
  lastActivityAt: string
  isPinned: boolean
  hasOpenPr: boolean
}

export type Sessions = {
  list: Session[]
  fetchedAt: number
  error: string | null
}

/** Where a session's transcript left off, read from list_events for a session that keeps no track. */
export type LastWord = {
  said: string
  isAsking: boolean
  isWaiting: boolean
  /** The session's lastActivityAt when this was read: a newer one reads again. */
  activity: string
  error: string | null
}

export type StepStatus = 'pending' | 'in_progress' | 'completed'

export type Step = { content: string; status: StepStatus }

/** What a session writes about itself after each change: its task list, its last recap and question. */
export type Track = {
  id: string
  title: string
  cwd: string
  plan: Step[]
  recap: string | null
  ask: string | null
  lastPrompt: string
  lastAnswer: string
  /** When the last turn ended, ms. */
  turnAt: number
  /** When the task list last changed, ms. */
  planAt: number
  /** When wrap_up last wrote the recap, ms: a turn that ends after it without its own wrap_up drops it. */
  recapAt?: number
  /** Background commands the session started and has not been notified of yet. */
  background?: BackgroundTask[]
}

/** A command a session runs in the background (run_in_background, or moved there), until its task-notification. */
export type BackgroundTask = {
  id: string
  /** What it runs: the command's description, else the command. */
  label: string
  /** When it started, ms. */
  at: number
}

/** What GitHub says about the CI a session's words left running. */
export type CiCheck = {
  /** The words it was checked for: other words check again. */
  words: string
  /** What was asked: `run 123`, `commit <sha>`; empty when nothing could be named. */
  target: string
  state: 'pending' | 'success' | 'failure' | 'unknown'
  checkedAt: number
}

/** Something the person asked the PM for, kept until it is done. */
export type LedgerItem = {
  id: number
  text: string
  /** The session it was handed to, a `local_…` id, or null while nobody has it. */
  owner: string | null
  status: 'open' | 'done' | 'dropped'
  note: string
  createdAt: number
  updatedAt: number
}

/** A project's PM and ledger, one file per project. */
export type ProjectFile = {
  key: string
  name: string
  path: string
  pmId: string | null
  isDismissed: boolean
  ledger: LedgerItem[]
  nextId: number
}

/** This session: its desktop id, its project, whether it is that project's PM. */
export type Me = {
  id: string | null
  title: string
  projectKey: string
  projectName: string
  projectPath: string
  isScratch: boolean
  isPm: boolean
}

export type Notice = { tone: 'good' | 'bad'; text: string }

export type Scope = 'project' | 'all'

declare module 'claude-code' {
  interface PluginState {
    'project-pm': {
      me: Me | null
      sessions: Sessions
      tracks: Record<string, Track>
      lastWords: Record<string, LastWord>
      ciChecks: Record<string, CiCheck>
      projects: Record<string, ProjectFile>
      scope: Scope
      confirm: string | null
      busy: string | null
      notice: Notice | null
      isBandHidden: boolean
      isEndedShown: boolean
    }
  }
}
