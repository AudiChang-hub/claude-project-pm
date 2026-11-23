// The PM pane and the "no PM yet" band. Status reads by a colored mark and a
// short label; numbers are tabular; actions stay out of sight until hovered.

import { atom, read, update } from 'claude-code'
import type { ElementConstructor, EngineInterface, RenderInputOf, RenderSurface, SvgProps } from 'claude-code'

import type { AgentRecord, AgentState, CiCheck, LastWord, LedgerItem, Me, Notice, ProjectFile, PushCheck, Scope, Session, Sessions, Setup, Step, Track } from '../types'
import { agentName } from './agents'
import { AGENT_STATUS, STATUS, agentTime, ago, cardSummary, caveatOf, clip, kpiOf, groupProjects, isActive, isDeliveredAgent, isDeliveredStatus, isHandedOff, itemCode, limitOf, liveTracks, openSteps, projectKey, sessionName, settledAt, shortId, shownAgents, statusOf, statusText } from './sessions'
import { isAgentId, isSameId, openBreakdown, qaShown, qaText } from './qa'
import type { OpenKind, QaShown } from './qa'
import type { Project, Status } from './sessions'
import { archive, claim, dismissBand, getMine, refresh, startPmSession } from './actions'
import { t } from './messages'
import { openWebBoard } from './webboard'
import { NO_SETUP, REPO, applySetup, checkSetup, removeSetup } from './setup'
import { compactedLine, contextLine } from './context'
import { needsButton, setAutoCompact, undoAutoCompact } from './quota'

// The engine reads each module's state refs from its own source: these name the same values as the other modules'.
const me = atom({ plugin: 'project-pm', key: 'me' } as const, null as Me | null)
const sessions = atom({ plugin: 'project-pm', key: 'sessions' } as const, { list: [], fetchedAt: 0, error: null } as Sessions)
const tracks = atom({ plugin: 'project-pm', key: 'tracks' } as const, {} as Record<string, Track>)
const lastWords = atom({ plugin: 'project-pm', key: 'lastWords' } as const, {} as Record<string, LastWord>)
const ciChecks = atom({ plugin: 'project-pm', key: 'ciChecks' } as const, {} as Record<string, CiCheck>)
const pushChecks = atom({ plugin: 'project-pm', key: 'pushChecks' } as const, {} as Record<string, PushCheck>)
const projects = atom({ plugin: 'project-pm', key: 'projects' } as const, {} as Record<string, ProjectFile>)
const scope = atom({ plugin: 'project-pm', key: 'scope' } as const, 'project' as Scope)
const confirm = atom({ plugin: 'project-pm', key: 'confirm' } as const, null as string | null)
const busy = atom({ plugin: 'project-pm', key: 'busy' } as const, null as string | null)
const notice = atom({ plugin: 'project-pm', key: 'notice' } as const, null as Notice | null)
const isBandHidden = atom({ plugin: 'project-pm', key: 'isBandHidden' } as const, false)
const isEndedShown = atom({ plugin: 'project-pm', key: 'isEndedShown' } as const, false)
const detailShown = atom({ plugin: 'project-pm', key: 'detailShown' } as const, null as { id: string; text: string } | null)
const agents = atom({ plugin: 'project-pm', key: 'agents' } as const, [] as AgentRecord[])
const webOpening = atom({ plugin: 'project-pm', key: 'webOpening' } as const, false)
const webHelp = atom({ plugin: 'project-pm', key: 'webHelp' } as const, false)
const liveContext = atom({ plugin: 'project-pm', key: 'liveContext' } as const, {} as Record<string, { tokens: number; at: number }>)
const setup = atom({ plugin: 'project-pm', key: 'setup' } as const, NO_SETUP)

/** An agent state's look, in the hues of the session statuses that mean the same (hooks/sessions.ts AGENT_STATUS). */
const AGENT_LOOK = Object.fromEntries(
  (Object.keys(AGENT_STATUS) as AgentState[]).map(state => [state, { color: STATUS[AGENT_STATUS[state]].color, hex: STATUS[AGENT_STATUS[state]].hex }]),
) as Record<AgentState, { color: string; hex: string }>

/** An agent's mark: the session dot's size and hues, as a diamond, so an owner shows which kind it is. */
function diamondSvg(hex: string, isPulsing: boolean): string {
  const pulse = isPulsing
    ? `<rect x="3" y="3" width="6" height="6" fill="none" stroke="${hex}" stroke-width="1.1" transform="rotate(45 6 6)"><animate attributeName="opacity" values="0.9;0" dur="1.8s" repeatCount="indefinite"/></rect>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12">${pulse}<rect x="3.4" y="3.4" width="5.2" height="5.2" rx="0.6" fill="${hex}" transform="rotate(45 6 6)"/></svg>`
}

/** How much of a report's detail file a card shows: the file itself has the rest. */
const DETAIL_SHOWN = 4000

/** Opens a report's detail file on its card, read from disk for the person: the PM never reads it. Pressed again, it closes. */
async function toggleDetail($: EngineInterface, id: string, path: string) {
  if ((await read($, detailShown))?.id === id) {
    await update($, detailShown, () => null)

    return
  }
  let text: string
  try {
    text = await $.fs.read(path)
  } catch {
    text = t('pane.detailMissing', { path })
  }
  await update($, detailShown, () => ({ id, text: text.length > DETAIL_SHOWN ? `${text.slice(0, DETAIL_SHOWN)}\n…` : text }))
}

const TRACK_HEX = '#9ca3af'
const ACCENT_HEX = '#d97757'

/** A work item's QA by its theme color: passed green, failed red, awaiting amber; skipped dimmed (none). */
const QA_COLOR: Record<QaShown, string | undefined> = { pass: 'success', fail: 'error', awaiting: 'warning', skipped: undefined }

/** An open item's kind by its theme color (T-42): the QA colors, unassigned amber, on track dimmed (none). */
const OPEN_COLOR: Record<OpenKind, string | undefined> = { qaFailed: 'error', qaAwaiting: 'warning', unassigned: 'warning', normal: undefined }

// ── SVG marks: no text inside, mid-tone hues that read on light and dark ──

function dotSvg(hex: string, isPulsing: boolean): string {
  const pulse = isPulsing
    ? `<circle cx="6" cy="6" r="3" fill="none" stroke="${hex}" stroke-width="1.2"><animate attributeName="r" values="3;5.6" dur="1.8s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.9;0" dur="1.8s" repeatCount="indefinite"/></circle>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12">${pulse}<circle cx="6" cy="6" r="3" fill="${hex}"/></svg>`
}

function ringSvg(ratio: number): string {
  const r = 17
  const c = 2 * Math.PI * r
  const arc = Math.max(0, Math.min(1, ratio)) * c

  return `<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 42 42"><circle cx="21" cy="21" r="${r}" fill="none" stroke="${TRACK_HEX}" stroke-opacity="0.22" stroke-width="4"/><circle cx="21" cy="21" r="${r}" fill="none" stroke="${ACCENT_HEX}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${arc.toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 21 21)"/></svg>`
}

/** One segment per step: done in the status hue, current at half, the rest as track. */
function stepsSvg(plan: Step[], hex: string): string {
  const width = 320
  const gap = plan.length > 24 ? 1 : 3
  const seg = (width - gap * (plan.length - 1)) / plan.length
  const rects = plan
    .map((step, i) => {
      const x = (i * (seg + gap)).toFixed(2)
      const fill = step.status === 'pending' ? TRACK_HEX : hex
      const opacity = step.status === 'completed' ? 1 : step.status === 'in_progress' ? 0.5 : 0.22

      return `<rect x="${x}" y="0" width="${seg.toFixed(2)}" height="4" rx="2" fill="${fill}" fill-opacity="${opacity}"/>`
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="4" viewBox="0 0 ${width} 4">${rects}</svg>`
}

// ── The band ──

export async function renderBand<R>($: EngineInterface, e: RenderInputOf<'AbovePrompt', RenderSurface>, pass: () => Promise<R>) {
  const self = await read($, me)
  if (e.props.hasSurvey || !self || self.isPm || self.isScratch || !self.id || (await read($, isBandHidden))) return pass()
  const project = (await read($, projects))[self.projectKey]
  if (!project || project.pmId || project.isDismissed) return pass()
  const { Box, Text, Button } = $.ui.resolve(e)
  const isStarting = (await read($, busy)) === 'start-pm'

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap="sm" rowGap="xs" alignItems="center">
      <Text size="footnote">
        <Text color="claude" weight="semibold">
          {t('band.title')}
        </Text>
        <Text dimColor>{t('band.noPm', { project: self.projectName })}</Text>
      </Text>
      <Button key="pm:start" variant="primary" label={isStarting ? t('band.starting') : t('band.start')} onPress={() => (isStarting ? undefined : startPmSession($))} />
      <Button key="pm:here" variant="secondary" label={t('band.claim')} onPress={() => void claim($)} />
      <Button key="pm:no" plain dimColor label={t('band.skip')} onPress={() => dismissBand($)} />
    </Box>
  )
}

// ── The pane ──

/** The last-resort button (T-48) and its undo: what happened, said in the pane's notice. */
async function pressAutoCompact($: EngineInterface, isUndo: boolean) {
  const text = isUndo ? await undoAutoCompact($) : await setAutoCompact($)
  const isBad = text.startsWith(t('context.buttonFailed', { reason: '' }).trim())
  await update($, notice, () => ({ tone: isBad ? 'bad' : 'good', text }))
}

export async function renderPane($: EngineInterface, e: RenderInputOf<'Pane', RenderSurface>) {
  const els = $.ui.resolve(e)
  const { Box, Text, Button } = els
  const Svg = 'Svg' in els ? (els as unknown as { Svg: ElementConstructor<SvgProps> }).Svg : null
  const self = await read($, me)
  const state = await read($, sessions)
  const words = await read($, lastWords)
  const all = liveTracks(state.list, await read($, tracks), words)
  const ci = await read($, ciChecks)
  const push = await read($, pushChecks)
  const files = await read($, projects)
  const view = await read($, scope)
  const asking = await read($, confirm)
  const working = await read($, busy)
  const note = await read($, notice)
  const isEndedOpen = await read($, isEndedShown)
  const myAgents = self?.isPm ? await read($, agents) : []
  const detail = await read($, detailShown)
  const isWebOpening = await read($, webOpening)
  const isWebHelp = await read($, webHelp)
  const liveFigures = await read($, liveContext)
  const setupNow = await read($, setup)
  const now = await $.clock.now()

  if (state.fetchedAt === 0 && !state.error) {
    return (
      <Text size="footnote" dimColor>
        {t('pane.syncing')}
      </Text>
    )
  }
  if (state.error && state.list.length === 0) {
    return (
      <Text size="footnote" color="error" wrap="wrap">
        {t('pane.cannotRead', { error: state.error })}
      </Text>
    )
  }

  const svg = (key: string, source: string, alt: string, size?: { width?: number; height?: number }, isInteractive = false) =>
    Svg ? <Svg key={key} source={source} alt={alt} width={size?.width} height={size?.height} isInteractive={isInteractive || undefined} /> : null

  // Every project's ledger: an owner may work from another project's folder.
  const allItems = Object.values(files).flatMap(file => file.ledger)
  const settled = (id: string) => settledAt(id, allItems)
  const statusOfOne = (one: Session) => statusOf(one, all[one.id], words[one.id], now, ci[one.id], push[one.id], settled(one.id), isHandedOff(one.id, allItems))
  /** A status as the pane reads it: a usage limit with when it resets. */
  const labelOf = (one: Session, status: Status) => statusText(status, status === 'limit' ? limitOf(one, all[one.id], words[one.id]) : null, 'label')
  const caveatOfOne = (one: Session) => (settled(one.id) === undefined ? caveatOf(all[one.id], push[one.id]) : null)
  const groups = groupProjects(state.list)
  const isAll = view === 'all' || !self || self.isScratch
  const shown: Project[] = isAll
    ? groups
    : [groups.find(p => p.key === self.projectKey) ?? { key: self.projectKey, name: self.projectName, path: self.projectPath, sessions: [] }]
  const everyone = shown.flatMap(p => p.sessions)
  const ledgers: { project: Project; item: LedgerItem }[] = shown.flatMap(project =>
    (files[project.key]?.ledger ?? []).filter(i => i.status === 'open').map(item => ({ project, item })),
  )

  // ── Header and KPIs ──

  // Progress is the work the person asked for (the ledger), not the sessions' own
  // checklists: a session ticks its list off when its turn ends, done or not.
  const items = shown.flatMap(project => (files[project.key]?.ledger ?? []).filter(i => i.status !== 'dropped'))
  const itemsDone = items.filter(i => i.status === 'done').length
  // An owner is found however its id was spaced or cased (items written before ids were trimmed).
  const agentOwner = (id: string | null) => (isAgentId(id) ? myAgents.find(a => isSameId(`agent:${a.id}`, id)) : undefined)
  const sessionOwner = (id: string | null) => (id && !isAgentId(id) ? state.list.find(s => isSameId(s.id, id)) : undefined)
  /**
   * An item's QA: its verdict, or awaiting once its owner has delivered (a session ended, to release or on CI, or no
   * longer listed; an agent done or to verify, or no longer recorded, in the PM's own project, where its agents are).
   */
  const qaOfItem = (item: LedgerItem, project: Project): QaShown | null => {
    if (!item.owner) return qaShown(item, false)
    if (isAgentId(item.owner)) {
      const agent = agentOwner(item.owner)
      const holdsAgents = !!self?.isPm && project.key === self.projectKey

      return qaShown(item, agent ? isDeliveredAgent(agent.state) : holdsAgents)
    }
    const owner = sessionOwner(item.owner)

    return qaShown(item, !owner || isDeliveredStatus(statusOfOne(owner)))
  }
  /** Who checked an item, as people read it (T-43): an agent by its task, a session by its name, else a short id. */
  const whoIs = (id: string) => {
    if (isAgentId(id)) {
      const agent = agentOwner(id)

      return agent ? agentName(agent) : `agent ${shortId(id)}`
    }
    const one = sessionOwner(id)

    return one ? sessionName(one, all[one.id]) : shortId(id)
  }
  // Each open item under the one kind it most needs, so the counts add up (T-42): the board and the web board say the same.
  const breakdown = openBreakdown(ledgers.map(({ item, project }) => ({ item, qa: qaOfItem(item, project) })))
  const steps = everyone.flatMap(one => all[one.id]?.plan ?? [])
  const stepsDone = steps.filter(s => s.status === 'completed').length
  const isByItems = items.length > 0
  const ratio = isByItems ? itemsDone / items.length : steps.length ? stepsDone / steps.length : 0
  const hasRatio = isByItems || steps.length > 0
  // The three figures, as the web board counts them too (kpiOf).
  const kpi = kpiOf(everyone.map(statusOfOne), myAgents)
  const runningAgents = kpi.runningAgents
  const pmFile: ProjectFile | undefined = !isAll && self ? files[self.projectKey] : undefined
  const role = isAll
    ? t('pane.projects', { n: shown.length })
    : pmFile?.pmId
      ? pmFile.pmId === self?.id
        ? t('pane.pmSelf')
        : t('pane.pmOther')
      : t('pane.pmNone')

  const metric = (key: string, value: number, label: string, color: string, sub?: string) => (
    <Box key={key} flexDirection="column" width="33%" paddingX="sm">
      <Text size="title" weight="semibold" tabular color={value ? color : undefined} dimColor={!value}>
        {String(value)}
      </Text>
      <Text size="caption" dimColor wrap="truncate-end">
        {label}
      </Text>
      {sub && (
        <Text size="caption" color={color} wrap="truncate-end">
          {sub}
        </Text>
      )}
    </Box>
  )

  const progress = (
    <Box key="kpi" flexDirection="column" rowGap="sm" borderStyle="round" borderDimColor paddingX="md" paddingY="sm">
      <Box flexDirection="row" alignItems="center" columnGap="md">
        {svg('ring', ringSvg(ratio), hasRatio ? t('pane.ratio', { percent: Math.round(ratio * 100) }) : t('pane.noData'), { width: 42, height: 42 })}
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Text size="title" weight="semibold" tabular>
            {hasRatio ? `${Math.round(ratio * 100)}%` : '—'}
          </Text>
          <Text size="caption" dimColor wrap="truncate-end">
            {isByItems
              ? t('pane.itemsDone', { done: itemsDone, total: items.length })
              : steps.length
                ? t('pane.stepsDone', { done: stepsDone, total: steps.length })
                : t('pane.noItems')}
          </Text>
          {isByItems && breakdown.total > 0 && (
            <Text key="kpi:open" size="caption" wrap="wrap">
              <Text dimColor>{breakdown.prefix}</Text>
              {breakdown.parts.map((part, i) => [
                i > 0 ? <Text key={`kpi:sep:${part.kind}`} dimColor>{t('items.joiner')}</Text> : null,
                <Text key={`kpi:${part.kind}`} color={OPEN_COLOR[part.kind]} dimColor={!OPEN_COLOR[part.kind]}>
                  {part.text}
                </Text>,
              ])}
            </Text>
          )}
        </Box>
      </Box>
      <Box flexDirection="row">
        {metric('kpi:running', kpi.running, t('pane.kpiRunning'), 'success', runningAgents ? t('pane.kpiAgents', { n: runningAgents }) : undefined)}
        {metric('kpi:asking', kpi.asking, t('pane.kpiAsking'), 'warning')}
        {metric('kpi:open', kpi.open, t('pane.kpiOpen'), 'claude')}
      </Box>
    </Box>
  )

  const header = (
    <Box key="header" flexDirection="column" rowGap="sm">
      <Box flexDirection="row" justifyContent="space-between" alignItems="flex-start" columnGap="sm">
        <Box flexDirection="column" flexShrink={1}>
          <Text size="caption" weight="medium" color="claude">
            {isAll ? t('pane.portfolio') : t('pane.project')}
          </Text>
          <Text size="heading" weight="semibold" wrap="truncate-end">
            {isAll ? t('pane.allProjects') : (shown[0]?.name ?? '')}
          </Text>
          <Text size="caption" dimColor tabular wrap="truncate-end">
            {t('pane.sessionsCount', { n: everyone.length, role })}
          </Text>
        </Box>
        <Box flexDirection="row" columnGap="xs" flexShrink={0}>
          <Button key="scope:project" label={t('pane.scopeProject')} variant={view === 'project' ? 'primary' : 'secondary'} onPress={() => update($, scope, () => 'project')} />
          <Button key="scope:all" label={t('pane.scopeAll')} variant={view === 'all' ? 'primary' : 'secondary'} onPress={() => update($, scope, () => 'all')} />
        </Box>
      </Box>
      {progress}
    </Box>
  )

  // ── Pieces ──

  const sectionTitle = (key: string, title: string, meta: string) => (
    <Box key={key} flexDirection="row" justifyContent="space-between" alignItems="center" marginTop="md">
      <Text size="caption" weight="semibold" dimColor>
        {title}
      </Text>
      <Text size="caption" dimColor tabular>
        {meta}
      </Text>
    </Box>
  )

  const mark = (key: string, status: Status) =>
    svg(key, dotSvg(STATUS[status].hex, status === 'running'), STATUS[status].label, { width: 12, height: 12 }, status === 'running') ?? (
      <Text key={key} color={STATUS[status].color}>
        ●
      </Text>
    )

  const archiveControls = (one: Session, status: Status, warn: string) =>
    asking === one.id ? (
      <Box key={`confirm:${one.id}`} flexDirection="row" flexWrap="wrap" columnGap="sm" rowGap="xs" alignItems="center">
        <Text size="caption" color="warning">
          {warn ? t('pane.confirmArchiveWarn', { warn }) : t('pane.confirmArchive')}
        </Text>
        <Button key={`yes:${one.id}`} variant="primary" label={t('pane.archive')} onPress={() => archive($, one)} />
        <Button key={`no:${one.id}`} variant="secondary" label={t('pane.cancel')} onPress={() => update($, confirm, () => null)} />
      </Box>
    ) : status === 'running' ? null : (
      <Box key={`actions:${one.id}`} flexDirection="row" display="none" hover={{ scope: `card:${one.id}`, display: 'flex' }}>
        <Button
          key={`archive:${one.id}`}
          plain
          dimColor
          label={working === one.id ? t('pane.archiving') : t('pane.archive')}
          onPress={() => (working ? undefined : update($, confirm, () => one.id))}
        />
      </Box>
    )

  const summaryOf = (track: Track | undefined, one: Session) => cardSummary(track, words[one.id])

  // The last resort of the PM's context (T-48): its compaction and its own hand-over both failed. One plain sentence
  // and one button; what it changes is said under it, and once pressed it can be undone.
  const compactButton = (track: Track | undefined) => {
    if (track?.autoCompactSet) {
      return (
        <Box key="autocompact" flexDirection="row" flexWrap="wrap" columnGap="sm" rowGap="xs" alignItems="center">
          <Text size="caption" dimColor>
            {t('context.buttonDone')}
          </Text>
          <Button key="autocompact:undo" plain dimColor label={t('context.buttonUndo')} onPress={() => pressAutoCompact($, true)} />
        </Box>
      )
    }
    if (!needsButton(track)) return null

    return (
      <Box key="autocompact" flexDirection="column" rowGap="xs" marginTop="sm">
        <Box flexDirection="row">
          <Button key="autocompact:set" variant="primary" label={t('context.button')} onPress={() => pressAutoCompact($, false)} />
        </Box>
        <Text size="caption" dimColor wrap="wrap">
          {t('context.buttonScope', { project: self?.projectName ?? '' })}
        </Text>
      </Box>
    )
  }

  const card = (one: Session) => {
    const status = statusOfOne(one)
    const look = STATUS[status]
    const track = all[one.id]
    const plan = track?.plan ?? []
    const left = openSteps(track)
    const caveat = status === 'running' ? null : caveatOfOne(one)
    const summary = summaryOf(track, one)
    const isPm = files[projectKey(one.cwd)]?.pmId === one.id
    const meta = [
      plan.length ? t('pane.steps', { done: plan.length - left.length, total: plan.length }) : '',
      one.hasOpenPr ? t('pane.prOpen') : '',
      isPm ? 'PM' : '',
      track ? '' : t('pane.untracked'),
    ].filter(Boolean)
    const warn = [left.length ? t('pane.warnSteps', { n: left.length }) : '', one.hasOpenPr ? t('pane.warnPr') : '', one.isPinned ? t('pane.warnPinned') : '']
      .filter(Boolean)
      .join(t('list.joiner'))
    const current = left.find(s => s.status === 'in_progress') ?? left[0]
    // Its context, idle time and what waking it costs (T-48); the PM's, its last compaction too.
    const context = contextLine(one, track, liveFigures[one.id], now)
    const compacted = isPm ? compactedLine(track) : null

    return (
      <Box
        key={`card:${one.id}`}
        flexDirection="column"
        rowGap="xs"
        borderStyle="round"
        borderDimColor
        paddingX="md"
        paddingY="sm"
        hover={{ scope: `card:${one.id}`, borderColor: look.color, borderDimColor: false }}
      >
        <Box flexDirection="row" alignItems="center" columnGap="sm">
          {mark(`dot:${one.id}`, status)}
          <Box flexGrow={1} flexShrink={1}>
            <Text weight="semibold" wrap="truncate-end">
              {sessionName(one, track)}
            </Text>
          </Box>
          <Text size="caption" dimColor tabular>
            {ago(one.lastActivityAt, now)}
          </Text>
        </Box>
        <Text size="caption" wrap="truncate-end">
          <Text color={look.color} weight="medium">
            {labelOf(one, status)}
          </Text>
          {meta.length > 0 && <Text dimColor>{`　·　${meta.join('　·　')}`}</Text>}
        </Text>
        {context && (
          <Text key={`context:${one.id}`} size="footnote" dimColor tabular wrap="truncate-end">
            {context}
          </Text>
        )}
        {compacted && (
          <Text key={`compacted:${one.id}`} size="footnote" dimColor tabular wrap="truncate-end">
            {compacted}
          </Text>
        )}
        {plan.length > 0 && svg(`steps:${one.id}`, stepsSvg(plan, look.hex), t('pane.steps', { done: plan.length - left.length, total: plan.length }))}
        {current && (
          <Text size="footnote" wrap="truncate-end" color={status === 'open' ? 'claude' : undefined}>
            {`▸ ${current.content}${left.length > 1 ? t('pane.moreSteps', { n: left.length - 1 }) : ''}`}
          </Text>
        )}
        {caveat ? (
          <Text size="footnote" wrap="truncate-end">
            <Text color="warning" weight="medium">
              {t('pane.caveat')}
            </Text>
            <Text dimColor>{`　${clip(caveat, 160)}`}</Text>
          </Text>
        ) : (
          <Text size="footnote" dimColor wrap="truncate-end">
            {clip(summary, 160)}
          </Text>
        )}
        {track?.report?.detail && (
          <Box flexDirection="row">
            <Button
              key={`detail:${one.id}`}
              plain
              dimColor={detail?.id !== one.id}
              label={detail?.id === one.id ? t('pane.detailHide') : t('pane.detailShow')}
              onPress={() => toggleDetail($, one.id, track.report!.detail!)}
            />
          </Box>
        )}
        {detail?.id === one.id && (
          <Text key={`detailText:${one.id}`} size="footnote" wrap="wrap">
            {detail.text}
          </Text>
        )}
        {archiveControls(one, status, warn)}
      </Box>
    )
  }

  const endedRow = (one: Session) => {
    const status = statusOfOne(one)

    return (
      <Box key={`ended:${one.id}`} flexDirection="column" rowGap="xs" paddingX="md" paddingY="xs" hover={{ scope: `card:${one.id}` }}>
        <Box flexDirection="row" alignItems="center" columnGap="sm">
          {mark(`dot:${one.id}`, status)}
          <Box flexGrow={1} flexShrink={1}>
            <Text size="footnote" wrap="truncate-end">
              {sessionName(one, all[one.id])}
            </Text>
          </Box>
          <Text size="caption" dimColor tabular>
            {ago(one.lastActivityAt, now)}
          </Text>
        </Box>
        {archiveControls(one, status, one.hasOpenPr ? t('pane.warnPr') : '')}
      </Box>
    )
  }

  const ledgerRow = ({ project, item }: { project: Project; item: LedgerItem }) => {
    // An owner working from another project's folder is still there: only one gone from the list is lost.
    const owner = sessionOwner(item.owner)
    // An agent owner: the PM's agent, by its record (its name without the item code the row already shows).
    const agent = agentOwner(item.owner)
    const elsewhere = owner && !project.sessions.includes(owner) ? t('pane.elsewhere') : ''
    const ownerText = !item.owner
      ? t('pane.ownerNone')
      : agent
        ? t('pane.ownerAgent', { name: agentName(agent).replace(/^\s*T-\d+\s*/i, ''), status: t(`agent.state.${agent.state}`) })
        : owner
          ? t('pane.owner', { title: sessionName(owner, all[owner.id]), status: labelOf(owner, statusOfOne(owner)), elsewhere })
          : t('pane.ownerGone')
    const isKnown = !!owner || !!agent
    const qa = qaOfItem(item, project)

    return (
      <Box key={`ledger:${project.key}:${item.id}`} flexDirection="row" columnGap="sm" alignItems="flex-start" paddingY="xs">
        <Text size="caption" mono dimColor>
          {itemCode(item.id)}
        </Text>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Text size="footnote" wrap="wrap">
            {item.text}
          </Text>
          <Box flexDirection="row" columnGap="xs" alignItems="center">
            {agent && agentMark(`ownerMark:${item.id}`, agent.state)}
            <Text size="caption" color={isKnown ? undefined : 'warning'} dimColor={isKnown} wrap="truncate-end">
              {isAll ? `${project.name}　·　${ownerText}` : ownerText}
            </Text>
          </Box>
          {qa && (
            <Text key={`qa:${item.id}`} size="caption" color={QA_COLOR[qa]} dimColor={!QA_COLOR[qa]} wrap="truncate-end">
              {qaText(item, qa, false, whoIs)}
            </Text>
          )}
        </Box>
      </Box>
    )
  }

  const agentMark = (key: string, state: AgentState) =>
    svg(key, diamondSvg(AGENT_LOOK[state].hex, state === 'running'), t(`agent.state.${state}`), { width: 12, height: 12 }, state === 'running') ?? (
      <Text key={key} color={AGENT_LOOK[state].color}>
        ◆
      </Text>
    )

  /** An agent's card: its name and time, its state and kind, its first line, and its usage with its detail file. */
  const agentCard = (one: AgentRecord) => {
    const look = AGENT_LOOK[one.state]
    const meta = [one.type, one.isolated ? t('pane.agentWorktree') : t('pane.agentReadOnly')]

    return (
      <Box key={`agent:${one.id}`} flexDirection="column" rowGap="xs" borderStyle="round" borderDimColor paddingX="md" paddingY="sm" hover={{ scope: `agent:${one.id}`, borderColor: look.color, borderDimColor: false }}>
        <Box flexDirection="row" alignItems="center" columnGap="sm">
          {agentMark(`agentMark:${one.id}`, one.state)}
          <Box flexGrow={1} flexShrink={1}>
            <Text weight="semibold" wrap="truncate-end">
              {agentName(one)}
            </Text>
          </Box>
          <Text size="caption" dimColor tabular>
            {agentTime(one, now)}
          </Text>
        </Box>
        <Text size="caption" wrap="truncate-end">
          <Text color={look.color} weight="medium">
            {t(`agent.state.${one.state}`)}
          </Text>
          <Text dimColor>{meta.map(m => `　·　${m}`).join('')}</Text>
        </Text>
        <Text size="footnote" dimColor={one.state === 'running'} wrap="truncate-end">
          {one.result ? clip(one.result, 160) : t('pane.agentWorking')}
        </Text>
        {(one.tokens !== undefined || one.detail) && (
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap="sm">
            <Text size="caption" dimColor tabular wrap="truncate-end">
              {one.tokens !== undefined ? t('pane.agentUsage', { tokens: Math.round(one.tokens / 1000), tools: one.tools ?? 0 }) : ''}
            </Text>
            {one.detail && (
              <Button
                key={`agentDetail:${one.id}`}
                plain
                dimColor={detail?.id !== one.id}
                label={detail?.id === one.id ? t('pane.detailHide') : t('pane.detailShow')}
                onPress={() => toggleDetail($, one.id, one.detail!)}
              />
            )}
          </Box>
        )}
        {detail?.id === one.id && (
          <Text key={`agentDetailText:${one.id}`} size="footnote" wrap="wrap">
            {detail.text}
          </Text>
        )}
      </Box>
    )
  }

  const byRank = (a: Session, b: Session) => STATUS[statusOfOne(a)].rank - STATUS[statusOfOne(b)].rank
  // A session that owns open work stays in sight, whatever it is doing.
  const isOwner = (one: Session) => ledgers.some(({ item }) => isSameId(item.owner, one.id))
  const active = (list: Session[]) =>
    list.filter(one => isActive(statusOfOne(one)) || !!caveatOfOne(one) || one.hasOpenPr || isOwner(one)).sort(byRank)
  const ended = (list: Session[]) => list.filter(one => !active(list).includes(one))

  const sessionsBlock = (project: Project) => {
    const live = active(project.sessions)
    const rest = ended(project.sessions)

    return (
      <Box key={`sessions:${project.key}`} flexDirection="column" rowGap="sm">
        {isAll && (
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" marginTop="md">
            <Text weight="semibold" wrap="truncate-end">
              {project.name}
            </Text>
            <Text size="caption" dimColor tabular>
              {t('pane.projectCounts', { live: live.length, ended: rest.length, pm: files[project.key]?.pmId ? t('pane.projectPm') : '' })}
            </Text>
          </Box>
        )}
        {live.length === 0 && (
          <Text size="footnote" dimColor>
            {project.sessions.length ? t('pane.noLive') : t('pane.noSessions')}
          </Text>
        )}
        {live.map(card)}
        {rest.length > 0 && (isEndedOpen ? rest.map(endedRow) : null)}
      </Box>
    )
  }

  // ── One-click setup (T-51) ──
  /** A size in MB, as the card says it: about 100 when the release does not say. */
  const megabytes = (bytes: number | null) => (bytes ? Math.max(1, Math.round(bytes / (1024 * 1024))) : 100)

  /**
   * The card that sets this project up: one sentence, init's own list of changes, and 設定; a plain message and 再試一次
   * when it stopped; 移除設定 once it is set up (asked once more before anything is undone).
   */
  const setupCard = () => {
    if (!self || self.isScratch || isAll || setupNow.project !== self.projectKey) return null
    const path = self.projectPath
    const key = self.projectKey
    const phase: Setup['phase'] = setupNow.phase
    const isAskingRemove = asking === 'setup:remove'
    if (phase === 'unknown' || (setupNow.isHidden && (phase === 'ready' || phase === 'fetching'))) return null
    // 移除設定, asked once more before anything is undone.
    const removeControls = () =>
      phase === 'removing' ? (
        <Text size="caption" dimColor>
          {t('setup.removing')}
        </Text>
      ) : isAskingRemove ? (
        <Box flexDirection="row" flexWrap="wrap" columnGap="sm" alignItems="center">
          <Button
            key="setup:remove-yes"
            variant="secondary"
            label={t('setup.removeYes')}
            onPress={async () => {
              await update($, confirm, () => null)
              await removeSetup($, path, key)
            }}
          />
          <Button key="setup:remove-no" plain label={t('setup.removeNo')} onPress={() => update($, confirm, () => null)} />
        </Box>
      ) : (
        <Button key="setup:remove" plain dimColor label={t('setup.remove')} onPress={() => update($, confirm, () => 'setup:remove')} />
      )
    if (phase === 'set' || phase === 'removing') {
      return (
        <Box key="setup" flexDirection="row" flexWrap="wrap" columnGap="sm" rowGap="xs" alignItems="center" marginTop="sm">
          <Text size="caption" dimColor wrap="wrap">
            {isAskingRemove ? t('setup.removeAsk') : t('setup.set')}
          </Text>
          {removeControls()}
        </Box>
      )
    }
    const isFailed = phase === 'failed'
    const canRetry = isFailed && setupNow.error !== 'platform'

    return (
      <Box key="setup" flexDirection="column" rowGap="xs" borderStyle="round" borderColor={isFailed ? 'error' : phase === 'done' ? 'success' : undefined} borderDimColor={!isFailed && phase !== 'done'} paddingX="sm" paddingY="xs" marginTop="sm">
        <Text size="footnote" bold>
          {t('setup.title')}
        </Text>
        {phase === 'done' ? (
          <Text size="footnote" wrap="wrap">
            {isAskingRemove ? t('setup.removeAsk') : t('setup.done')}
          </Text>
        ) : isFailed ? (
          <Text size="footnote" color="error" wrap="wrap">
            {t(`setup.error.${setupNow.error ?? 'download'}`)}
          </Text>
        ) : phase === 'fetching' ? (
          <Text size="footnote" dimColor wrap="wrap">
            {setupNow.download ? t('setup.downloading', { version: setupNow.download.version, mb: megabytes(setupNow.download.bytes) }) : t('setup.fetching')}
          </Text>
        ) : (
          <Text size="footnote" wrap="wrap">
            {t('setup.intro')}
          </Text>
        )}
        {(phase === 'ready' || phase === 'applying') && setupNow.checked && (
          <Text key="setup-checked" size="caption" dimColor wrap="wrap">
            {t('setup.checked', { version: setupNow.checked.version, mb: megabytes(setupNow.checked.bytes) })}
          </Text>
        )}
        {(phase === 'ready' || phase === 'applying') &&
          setupNow.changes.map((line, i) => (
            <Text key={`setup-change:${i}`} size="caption" wrap="wrap">
              {line.split('\n')[0]}
            </Text>
          ))}
        {(phase === 'ready' || phase === 'applying') && setupNow.notes.length > 0 && (
          <Text key="setup-notes" size="caption" dimColor wrap="wrap">
            {[t('setup.notes'), ...setupNow.notes].join('\n')}
          </Text>
        )}
        {isFailed && (setupNow.error === 'offline' || setupNow.error === 'blocked') && (
          <Text key="setup-manual" size="caption" dimColor wrap="wrap">
            {t('setup.manual', { url: `https://github.com/${REPO}/releases` })}
          </Text>
        )}
        {isFailed &&
          setupNow.failed.map((line, i) => (
            <Text key={`setup-failed:${i}`} size="caption" wrap="wrap">
              {line}
            </Text>
          ))}
        {(phase === 'ready' || phase === 'applying' || canRetry) && (
          <Box flexDirection="row" flexWrap="wrap" columnGap="sm" alignItems="center">
            {phase === 'ready' && <Button key="setup:apply" variant="primary" label={t('setup.button')} onPress={() => applySetup($, path, key)} />}
            {phase === 'applying' && (
              <Text size="footnote" dimColor>
                {t('setup.applying')}
              </Text>
            )}
            {canRetry && <Button key="setup:retry" variant="primary" label={t('setup.retry')} onPress={() => checkSetup($, path, key, true)} />}
            {phase === 'ready' && <Button key="setup:hide" plain dimColor label={t('setup.hide')} onPress={() => update($, setup, v => ({ ...v, isHidden: true }))} />}
          </Box>
        )}
        {phase === 'done' && removeControls()}
      </Box>
    )
  }

  const endedTotal = shown.reduce((n, p) => n + ended(p.sessions).length, 0)
  const liveTotal = everyone.length - endedTotal
  const canClaim = !!self?.id && !self.isScratch && !self.isPm && !isAll && !pmFile?.pmId
  // Every agent that is not done, and the done ones of the last hour.
  const listedAgents = shownAgents(myAgents, now, false)

  return (
    <Box flexDirection="column" rowGap="xs">
      {header}
      {note && (
        <Box key="notice" borderStyle="round" borderColor={note.tone === 'bad' ? 'error' : 'success'} paddingX="sm" paddingY="xs" marginTop="sm">
          <Text size="footnote" wrap="wrap">
            {note.text}
          </Text>
        </Box>
      )}
      {setupCard()}
      {self?.isPm && compactButton(getMine() ?? (self.id ? all[self.id] : undefined))}
      {canClaim && (
        <Box key="claim" flexDirection="row" flexWrap="wrap" columnGap="sm" alignItems="center" marginTop="sm">
          <Text size="footnote" dimColor>
            {t('pane.noPm')}
          </Text>
          <Button key="claim" variant="secondary" label={t('band.claim')} onPress={() => void claim($)} />
        </Box>
      )}
      {ledgers.length > 0 && sectionTitle('h:ledger', t('pane.items'), t('pane.itemsOpen', { n: ledgers.length }))}
      {ledgers.map(ledgerRow)}
      {listedAgents.length > 0 && sectionTitle('h:agents', t('pane.agents'), t('pane.agentsMeta', { running: runningAgents, ended: myAgents.length - runningAgents }))}
      {listedAgents.map(agentCard)}
      {myAgents.length > listedAgents.length && (
        <Text key="agents-hidden" size="caption" dimColor>
          {t('pane.agentsHidden', { n: myAgents.length - listedAgents.length })}
        </Text>
      )}
      {sectionTitle('h:sessions', t('pane.sessions'), t('pane.sessionsMeta', { live: liveTotal, ended: endedTotal }))}
      {shown.map(sessionsBlock)}
      {endedTotal > 0 && (
        <Box key="ended-toggle" flexDirection="row">
          <Button
            key="ended:toggle"
            plain
            dimColor
            label={isEndedOpen ? t('pane.hideEnded') : t('pane.showEnded', { n: endedTotal })}
            onPress={() => update($, isEndedShown, v => !v)}
          />
        </Box>
      )}
      {isWebHelp && (
        <Box key="web-help" flexDirection="column" rowGap="xs" borderStyle="round" borderDimColor paddingX="sm" paddingY="xs" marginTop="sm">
          <Text size="footnote" bold>
            {t('pane.webHelpTitle')}
          </Text>
          <Text size="footnote" wrap="wrap">
            {t('pane.webHelp')}
          </Text>
          <Box flexDirection="row" flexWrap="wrap" columnGap="sm" alignItems="center">
            <Button key="web-help:close" plain label={t('pane.webHelpClose')} onPress={() => update($, webHelp, () => false)} />
          </Box>
        </Box>
      )}
      <Box key="web" flexDirection="row" flexWrap="wrap" columnGap="sm" alignItems="center" marginTop="sm">
        <Button
          key="web:open"
          variant="secondary"
          label={isWebOpening ? t('pane.webOpening') : t('pane.web')}
          onPress={() => (isWebOpening ? undefined : openWebBoard($, self?.projectPath ?? shown[0]?.path ?? '', isAll ? null : (self?.projectKey ?? null)))}
        />
        <Text size="caption" wrap="wrap">
          {t('pane.webHint')}
        </Text>
      </Box>
      <Box key="footer" flexDirection="row" justifyContent="space-between" alignItems="center" marginTop="sm">
        <Text size="caption" dimColor tabular>
          {t('pane.synced', { ago: ago(state.fetchedAt, now) })}
        </Text>
        <Button key="refresh" plain dimColor label={t('pane.refresh')} onPress={() => refresh($, true)} />
      </Box>
    </Box>
  )
}
