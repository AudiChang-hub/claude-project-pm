// The PM pane and the "no PM yet" band. Status reads by a colored mark and a
// short label; numbers are tabular; actions stay out of sight until hovered.

import { atom, read, update } from 'claude-code'
import type { ElementConstructor, EngineInterface, RenderInputOf, RenderSurface, SvgProps } from 'claude-code'

import type { CiCheck, LastWord, LedgerItem, Me, Notice, ProjectFile, Scope, Session, Sessions, Step, Track } from '../types'
import { STATUS, ago, caveatOf, clip, groupProjects, isActive, itemCode, liveTracks, openSteps, projectKey, statusOf } from './sessions'
import type { Project, Status } from './sessions'
import { archive, claim, dismissBand, refresh, startPmSession } from './actions'

// The engine reads each module's state refs from its own source: these name the same values as the other modules'.
const me = atom({ plugin: 'project-pm', key: 'me' } as const, null as Me | null)
const sessions = atom({ plugin: 'project-pm', key: 'sessions' } as const, { list: [], fetchedAt: 0, error: null } as Sessions)
const tracks = atom({ plugin: 'project-pm', key: 'tracks' } as const, {} as Record<string, Track>)
const lastWords = atom({ plugin: 'project-pm', key: 'lastWords' } as const, {} as Record<string, LastWord>)
const ciChecks = atom({ plugin: 'project-pm', key: 'ciChecks' } as const, {} as Record<string, CiCheck>)
const projects = atom({ plugin: 'project-pm', key: 'projects' } as const, {} as Record<string, ProjectFile>)
const scope = atom({ plugin: 'project-pm', key: 'scope' } as const, 'project' as Scope)
const confirm = atom({ plugin: 'project-pm', key: 'confirm' } as const, null as string | null)
const busy = atom({ plugin: 'project-pm', key: 'busy' } as const, null as string | null)
const notice = atom({ plugin: 'project-pm', key: 'notice' } as const, null as Notice | null)
const isBandHidden = atom({ plugin: 'project-pm', key: 'isBandHidden' } as const, false)
const isEndedShown = atom({ plugin: 'project-pm', key: 'isEndedShown' } as const, false)

const TRACK_HEX = '#9ca3af'
const ACCENT_HEX = '#d97757'

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
          專案 PM
        </Text>
        <Text dimColor>{`　「${self.projectName}」尚未指派 PM`}</Text>
      </Text>
      <Button key="pm:start" variant="primary" label={isStarting ? '建立中…' : '建立 PM Session'} onPress={() => (isStarting ? undefined : startPmSession($))} />
      <Button key="pm:here" variant="secondary" label="由此 Session 擔任" onPress={() => void claim($)} />
      <Button key="pm:no" plain dimColor label="略過" onPress={() => dismissBand($)} />
    </Box>
  )
}

// ── The pane ──

export async function renderPane($: EngineInterface, e: RenderInputOf<'Pane', RenderSurface>) {
  const els = $.ui.resolve(e)
  const { Box, Text, Button } = els
  const Svg = 'Svg' in els ? (els as unknown as { Svg: ElementConstructor<SvgProps> }).Svg : null
  const self = await read($, me)
  const state = await read($, sessions)
  const words = await read($, lastWords)
  const all = liveTracks(state.list, await read($, tracks), words)
  const ci = await read($, ciChecks)
  const files = await read($, projects)
  const view = await read($, scope)
  const asking = await read($, confirm)
  const working = await read($, busy)
  const note = await read($, notice)
  const isEndedOpen = await read($, isEndedShown)
  const now = await $.clock.now()

  if (state.fetchedAt === 0 && !state.error) {
    return (
      <Text size="footnote" dimColor>
        正在同步 Session…
      </Text>
    )
  }
  if (state.error && state.list.length === 0) {
    return (
      <Text size="footnote" color="error" wrap="wrap">
        {`無法讀取 Session 清單：${state.error}`}
      </Text>
    )
  }

  const svg = (key: string, source: string, alt: string, size?: { width?: number; height?: number }, isInteractive = false) =>
    Svg ? <Svg key={key} source={source} alt={alt} width={size?.width} height={size?.height} isInteractive={isInteractive || undefined} /> : null

  const statusOfOne = (one: Session) => statusOf(one, all[one.id], words[one.id], now, ci[one.id])
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
  const unassigned = ledgers.filter(({ item }) => !item.owner).length
  const steps = everyone.flatMap(one => all[one.id]?.plan ?? [])
  const stepsDone = steps.filter(s => s.status === 'completed').length
  const isByItems = items.length > 0
  const ratio = isByItems ? itemsDone / items.length : steps.length ? stepsDone / steps.length : 0
  const hasRatio = isByItems || steps.length > 0
  const count = (s: Status) => everyone.filter(one => statusOfOne(one) === s).length
  const pmFile: ProjectFile | undefined = !isAll && self ? files[self.projectKey] : undefined
  const role = isAll
    ? `${shown.length} 個專案`
    : pmFile?.pmId
      ? pmFile.pmId === self?.id
        ? 'PM：本 Session'
        : 'PM：已指派'
      : 'PM：未指派'

  const metric = (key: string, value: number, label: string, color: string) => (
    <Box key={key} flexDirection="column" width="33%" paddingX="sm">
      <Text size="title" weight="semibold" tabular color={value ? color : undefined} dimColor={!value}>
        {String(value)}
      </Text>
      <Text size="caption" dimColor wrap="truncate-end">
        {label}
      </Text>
    </Box>
  )

  const progress = (
    <Box key="kpi" flexDirection="column" rowGap="sm" borderStyle="round" borderDimColor paddingX="md" paddingY="sm">
      <Box flexDirection="row" alignItems="center" columnGap="md">
        {svg('ring', ringSvg(ratio), hasRatio ? `完成率 ${Math.round(ratio * 100)}%` : '尚無資料', { width: 42, height: 42 })}
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Text size="title" weight="semibold" tabular>
            {hasRatio ? `${Math.round(ratio * 100)}%` : '—'}
          </Text>
          <Text size="caption" dimColor wrap="truncate-end">
            {isByItems
              ? `工作項目完成 ${itemsDone}/${items.length}`
              : steps.length
                ? `Session 步驟完成 ${stepsDone}/${steps.length}（尚無工作項目）`
                : '尚無工作項目'}
          </Text>
          {isByItems && (ledgers.length > 0 || unassigned > 0) && (
            <Text size="caption" wrap="truncate-end">
              <Text dimColor>{`${ledgers.length} 項進行中`}</Text>
              {unassigned > 0 && <Text color="warning">{`　·　${unassigned} 項未指派`}</Text>}
            </Text>
          )}
        </Box>
      </Box>
      <Box flexDirection="row">
        {metric('kpi:running', count('running') + count('waiting'), '執行中', 'success')}
        {metric('kpi:asking', count('asking'), '待回覆', 'warning')}
        {metric('kpi:open', count('open') + count('ci') + count('failed'), '未完成・待 CI', 'claude')}
      </Box>
    </Box>
  )

  const header = (
    <Box key="header" flexDirection="column" rowGap="sm">
      <Box flexDirection="row" justifyContent="space-between" alignItems="flex-start" columnGap="sm">
        <Box flexDirection="column" flexShrink={1}>
          <Text size="caption" weight="medium" color="claude">
            {isAll ? 'PORTFOLIO' : 'PROJECT'}
          </Text>
          <Text size="heading" weight="semibold" wrap="truncate-end">
            {isAll ? '全部專案' : (shown[0]?.name ?? '')}
          </Text>
          <Text size="caption" dimColor tabular wrap="truncate-end">
            {`${everyone.length} Sessions　·　${role}`}
          </Text>
        </Box>
        <Box flexDirection="row" columnGap="xs" flexShrink={0}>
          <Button key="scope:project" label="本專案" variant={view === 'project' ? 'primary' : 'secondary'} onPress={() => update($, scope, () => 'project')} />
          <Button key="scope:all" label="全部" variant={view === 'all' ? 'primary' : 'secondary'} onPress={() => update($, scope, () => 'all')} />
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
          {warn ? `確定封存？${warn}` : '確定封存此 Session？'}
        </Text>
        <Button key={`yes:${one.id}`} variant="primary" label="封存" onPress={() => archive($, one)} />
        <Button key={`no:${one.id}`} variant="secondary" label="取消" onPress={() => update($, confirm, () => null)} />
      </Box>
    ) : status === 'running' ? null : (
      <Box key={`actions:${one.id}`} flexDirection="row" display="none" hover={{ scope: `card:${one.id}`, display: 'flex' }}>
        <Button
          key={`archive:${one.id}`}
          plain
          dimColor
          label={working === one.id ? '封存中…' : '封存'}
          onPress={() => (working ? undefined : update($, confirm, () => one.id))}
        />
      </Box>
    )

  const summaryOf = (track: Track | undefined, one: Session) => {
    if (track) return track.ask ? `問題：${track.ask}` : track.recap || track.lastAnswer || (track.lastPrompt ? `指令：${track.lastPrompt}` : '尚無回報')
    const word = words[one.id]
    if (word?.error) return `無法讀取紀錄：${word.error}`

    return word ? word.said || '尚無回報' : '讀取中…'
  }

  const card = (one: Session) => {
    const status = statusOfOne(one)
    const look = STATUS[status]
    const track = all[one.id]
    const plan = track?.plan ?? []
    const left = openSteps(track)
    const caveat = status === 'running' ? null : caveatOf(track)
    const summary = summaryOf(track, one)
    const isPm = files[projectKey(one.cwd)]?.pmId === one.id
    const meta = [
      plan.length ? `步驟 ${plan.length - left.length}/${plan.length}` : '',
      one.hasOpenPr ? 'PR 開啟中' : '',
      isPm ? 'PM' : '',
      track ? '' : '無追蹤紀錄',
    ].filter(Boolean)
    const warn = [left.length ? `尚有 ${left.length} 項步驟未完成` : '', one.hasOpenPr ? 'PR 仍開啟' : '', one.isPinned ? '已釘選' : '']
      .filter(Boolean)
      .join('、')
    const current = left.find(s => s.status === 'in_progress') ?? left[0]

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
              {one.title}
            </Text>
          </Box>
          <Text size="caption" dimColor tabular>
            {ago(one.lastActivityAt, now)}
          </Text>
        </Box>
        <Text size="caption" wrap="truncate-end">
          <Text color={look.color} weight="medium">
            {look.label}
          </Text>
          {meta.length > 0 && <Text dimColor>{`　·　${meta.join('　·　')}`}</Text>}
        </Text>
        {plan.length > 0 && svg(`steps:${one.id}`, stepsSvg(plan, look.hex), `步驟 ${plan.length - left.length}/${plan.length}`)}
        {current && (
          <Text size="footnote" wrap="truncate-end" color={status === 'open' ? 'claude' : undefined}>
            {`▸ ${current.content}${left.length > 1 ? `　（另 ${left.length - 1} 項）` : ''}`}
          </Text>
        )}
        {caveat ? (
          <Text size="footnote" wrap="truncate-end">
            <Text color="warning" weight="medium">
              需追蹤
            </Text>
            <Text dimColor>{clip(caveat, 160)}</Text>
          </Text>
        ) : (
          <Text size="footnote" dimColor wrap="truncate-end">
            {clip(summary, 160)}
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
              {one.title}
            </Text>
          </Box>
          <Text size="caption" dimColor tabular>
            {ago(one.lastActivityAt, now)}
          </Text>
        </Box>
        {archiveControls(one, status, one.hasOpenPr ? 'PR 仍開啟' : '')}
      </Box>
    )
  }

  const ledgerRow = ({ project, item }: { project: Project; item: LedgerItem }) => {
    // An owner working from another project's folder is still there: only one gone from the list is lost.
    const owner = item.owner ? state.list.find(s => s.id === item.owner) : undefined
    const elsewhere = owner && !project.sessions.includes(owner) ? '・其他專案' : ''
    const ownerText = !item.owner ? '尚未指派' : owner ? `負責　${owner.title}・${STATUS[statusOfOne(owner)].label}${elsewhere}` : '負責 Session 已不在清單中'

    return (
      <Box key={`ledger:${project.key}:${item.id}`} flexDirection="row" columnGap="sm" alignItems="flex-start" paddingY="xs">
        <Text size="caption" mono dimColor>
          {itemCode(item.id)}
        </Text>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Text size="footnote" wrap="wrap">
            {item.text}
          </Text>
          <Text size="caption" color={owner ? undefined : 'warning'} dimColor={!!owner} wrap="truncate-end">
            {isAll ? `${project.name}　·　${ownerText}` : ownerText}
          </Text>
        </Box>
      </Box>
    )
  }

  const byRank = (a: Session, b: Session) => STATUS[statusOfOne(a)].rank - STATUS[statusOfOne(b)].rank
  // A session that owns open work stays in sight, whatever it is doing.
  const owners = new Set(ledgers.map(({ item }) => item.owner).filter(Boolean))
  const active = (list: Session[]) =>
    list.filter(one => isActive(statusOfOne(one)) || !!caveatOf(all[one.id]) || one.hasOpenPr || owners.has(one.id)).sort(byRank)
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
              {`${live.length} 進行中　·　${rest.length} 已結束${files[project.key]?.pmId ? '　·　PM' : ''}`}
            </Text>
          </Box>
        )}
        {live.length === 0 && (
          <Text size="footnote" dimColor>
            {project.sessions.length ? '沒有進行中的 Session。' : '此專案目前沒有其他 Session。'}
          </Text>
        )}
        {live.map(card)}
        {rest.length > 0 && (isEndedOpen ? rest.map(endedRow) : null)}
      </Box>
    )
  }

  const endedTotal = shown.reduce((n, p) => n + ended(p.sessions).length, 0)
  const liveTotal = everyone.length - endedTotal
  const canClaim = !!self?.id && !self.isScratch && !self.isPm && !isAll && !pmFile?.pmId

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
      {canClaim && (
        <Box key="claim" flexDirection="row" flexWrap="wrap" columnGap="sm" alignItems="center" marginTop="sm">
          <Text size="footnote" dimColor>
            此專案尚未指派 PM
          </Text>
          <Button key="claim" variant="secondary" label="由此 Session 擔任" onPress={() => void claim($)} />
        </Box>
      )}
      {ledgers.length > 0 && sectionTitle('h:ledger', '工作項目', `${ledgers.length} 項進行中`)}
      {ledgers.map(ledgerRow)}
      {sectionTitle('h:sessions', 'SESSIONS', `${liveTotal} 進行中　·　${endedTotal} 已結束`)}
      {shown.map(sessionsBlock)}
      {endedTotal > 0 && (
        <Box key="ended-toggle" flexDirection="row">
          <Button
            key="ended:toggle"
            plain
            dimColor
            label={isEndedOpen ? `收合已結束的 Session` : `顯示已結束的 Session（${endedTotal}）`}
            onPress={() => update($, isEndedShown, v => !v)}
          />
        </Box>
      )}
      <Box key="footer" flexDirection="row" justifyContent="space-between" alignItems="center" marginTop="sm">
        <Text size="caption" dimColor tabular>
          {`同步於 ${ago(state.fetchedAt, now)}　·　每 30 秒自動更新`}
        </Text>
        <Button key="refresh" plain dimColor label="重新同步" onPress={() => refresh($, true)} />
      </Box>
    </Box>
  )
}
