// Project PM web board: read-only, drawn as the desktop pane draws it (hooks/view.tsx). Every word from the board is set
// as text (never as HTML). The pane's own words and figures come with the board (data.pane); the words here are only
// the page's own: its states, its controls, its empty lists.
;(() => {
  'use strict'

  const WORDS = {
    en: {
      project: 'Project',
      attention: 'Needs attention',
      showDone: 'Show done and dropped',
      readonly: 'This board only shows. To close, hand over or drop a work item, tell the PM in Claude Code, for example "close T-03".',
      theme: { auto: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' },
      themeShort: { auto: 'System', light: 'Light', dark: 'Dark' },
      progress: (d, n) => `${d} of ${n} work items done`,
      updated: s => (s < 5 ? 'Live · just updated' : `Live · updated ${s}s ago`),
      stale: 'Not updating: the board server does not answer',
      pm: name => `PM: ${name}`,
      noPm: 'No PM yet. Open this project in Claude Code and tell Claude: "Be the PM for this project."',
      nothing: ['Nothing needs you right now', 'Questions, failed checks and work left half done show up here.'],
      noItems: ['No work items yet', 'Tell the PM what you want built; it adds each request to this list.'],
      allDone: ['Every work item is done', 'Tick "Show done and dropped" to see them.'],
      noSessions: ['No session has reported yet', 'The sessions you open in Claude Code for this project show up here once they start working.'],
      status: { open: 'open', done: 'done', dropped: 'dropped' },
      criteria: 'How it is checked',
      note: 'Note',
      untracked: 'No record',
      ago: ms => {
        const m = Math.round(ms / 60000)
        if (m < 1) return 'just now'
        if (m < 60) return `${m} min ago`
        const h = Math.round(m / 60)
        return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`
      },
      states: {
        noToken: ['Open the board from Project PM', 'This page needs the link Project PM gives you, with its key: the address alone does not open it. In the desktop app, press “Open in browser” on the board pane, or ask the PM for “the board link”. In a terminal, run this in your project’s folder:', 'git pm open'],
        expired: ['This board link has expired', 'The board server restarted and its key changed. In the desktop app, press “Open in browser” on the board pane again. In a terminal, run this in your project’s folder for a fresh link:', 'git pm open'],
        down: ['The board server does not answer', 'It stops after 30 minutes without use, or it was closed. In the desktop app, press “Open in browser” on the board pane to start it again. In a terminal, run this in your project’s folder:', 'git pm open'],
        noProject: ['No project yet', 'Open your project in Claude Code and tell Claude: "Be the PM for this project." Once there is work to track, it shows up here.', ''],
      },
      retry: 'Try again',
      loading: 'Loading the board…',
    },
    'zh-TW': {
      project: '專案',
      attention: '需要處理',
      showDone: '顯示已結案和放棄的',
      readonly: '這個看板只能看。要結案、換負責人或放棄工作項目，請在 Claude Code 裡對 PM 說，例如「T-03 結案」。',
      theme: { auto: '配色：跟隨系統', light: '配色：淺色', dark: '配色：深色' },
      themeShort: { auto: '跟隨系統', light: '淺色', dark: '深色' },
      progress: (d, n) => `${n} 項工作完成 ${d} 項`,
      updated: s => (s < 5 ? '即時 · 剛更新' : `即時 · ${s} 秒前更新`),
      stale: '沒有更新：看板伺服器沒有回應',
      pm: name => `PM：${name}`,
      noPm: '還沒有 PM。在 Claude Code 打開這個專案，跟 Claude 說：「請當這個專案的 PM」。',
      nothing: ['目前沒有需要你處理的事', '等你回覆的問題、沒過的檢查、做到一半停下的工作，都會出現在這裡。'],
      noItems: ['還沒有工作項目', '把要做的事告訴 PM，它會一項一項登記在這裡。'],
      allDone: ['工作項目都完成了', '勾選「顯示已結案和放棄的」可以看到它們。'],
      noSessions: ['還沒有 Session 回報', '你在 Claude Code 為這個專案開的對話，開始工作後就會出現在這裡。'],
      status: { open: '進行中', done: '已結案', dropped: '已放棄' },
      criteria: '驗收條件',
      note: '備註',
      untracked: '無追蹤紀錄',
      ago: ms => {
        const m = Math.round(ms / 60000)
        if (m < 1) return '剛剛'
        if (m < 60) return `${m} 分鐘前`
        const h = Math.round(m / 60)
        return h < 48 ? `${h} 小時前` : `${Math.round(h / 24)} 天前`
      },
      states: {
        noToken: ['請從 Project PM 打開看板', '這個頁面需要 Project PM 給的連結（含金鑰），只輸入網址打不開。桌面版：按看板面板上的「在瀏覽器開啟」，或問 PM「看板網址」。終端機：在專案資料夾執行：', 'git pm open'],
        expired: ['這個看板連結已過期', '看板伺服器重新啟動過，金鑰換了。桌面版：再按一次看板面板上的「在瀏覽器開啟」。終端機：在專案資料夾執行下面的指令，打開新的連結：', 'git pm open'],
        down: ['看板伺服器沒有回應', '它閒置 30 分鐘會自動停止，或已經被關掉。桌面版：按看板面板上的「在瀏覽器開啟」重新啟動。終端機：在專案資料夾執行：', 'git pm open'],
        noProject: ['還沒有專案', '在 Claude Code 打開你的專案，跟 Claude 說：「請當這個專案的 PM」。有了要追蹤的工作，就會出現在這裡。', ''],
      },
      retry: '再試一次',
      loading: '正在讀取看板…',
    },
  }

  /** The pane's theme colors (hooks/sessions.ts STATUS .color), as this page's text tokens. */
  const TONES = ['claude', 'success', 'warning', 'error', 'permission', 'suggestion', 'planMode', 'inactive', 'subtle']
  const tone = look => (TONES.includes(look) ? `var(--c-${look})` : 'var(--muted)')

  const $ = id => document.getElementById(id)
  const el = (tag, cls, text) => {
    const node = document.createElement(tag)
    if (cls) node.className = cls
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }
  /** A hue from the board, used only as a color: anything else is left out. */
  const hue = value => (/^#[0-9a-f]{3,8}$/i.test(String(value || '')) ? value : '')

  let lang = /^zh/i.test(navigator.language || '') ? 'zh-TW' : 'en'
  let words = WORDS[lang]
  let token = ''
  let project = ''
  let etag = ''
  let lastOk = 0
  let timer = 0
  let board = null

  const store = {
    get: key => {
      try {
        return sessionStorage.getItem(key) || ''
      } catch {
        return ''
      }
    },
    set: (key, value) => {
      try {
        sessionStorage.setItem(key, value)
      } catch {}
    },
    local: (key, value) => {
      try {
        if (value === undefined) return localStorage.getItem(key) || ''
        localStorage.setItem(key, value)
      } catch {}
      return ''
    },
  }

  // The token comes in the fragment (never sent to a server, never in a Referer), then lives in sessionStorage.
  const fragment = new URLSearchParams(location.hash.slice(1))
  if (fragment.get('t')) store.set('pm-token', fragment.get('t'))
  if (fragment.get('p')) store.set('pm-project', fragment.get('p'))
  if (location.hash) history.replaceState(null, '', location.pathname)
  token = store.get('pm-token')
  project = store.get('pm-project')

  function applyWords() {
    document.documentElement.lang = lang
    words = WORDS[lang]
    for (const node of document.querySelectorAll('[data-t]')) node.textContent = words[node.dataset.t]
    themeLabel()
  }

  // ── Theme: system, light, dark (a per-viewer convenience) ──
  const THEMES = ['auto', 'light', 'dark']
  let theme = store.local('pm-theme') || 'auto'
  function setTheme(next) {
    theme = THEMES.includes(next) ? next : 'auto'
    if (theme === 'auto') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = theme
    store.local('pm-theme', theme)
    themeLabel()
  }
  function themeLabel() {
    const button = $('theme')
    button.textContent = words.themeShort[theme]
    button.setAttribute('aria-label', words.theme[theme])
    button.title = words.theme[theme]
  }
  $('theme').addEventListener('click', () => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]))
  setTheme(theme)

  // ── States ──
  function showState(kind, isError) {
    const [title, body, command] = words.states[kind]
    const box = $('state')
    box.replaceChildren(el('h1', '', title), el('p', '', body))
    if (command) box.append(el('code', '', command))
    if (kind === 'down') {
      const retry = el('button', 'retry', words.retry)
      retry.type = 'button'
      retry.addEventListener('click', () => load(true))
      box.append(retry)
    }
    box.classList.toggle('is-error', !!isError)
    box.hidden = false
    $('board').hidden = true
  }

  function showLoading() {
    const box = $('state')
    const line = el('p')
    line.append(el('span', 'spinner'), document.createTextNode(words.loading))
    box.replaceChildren(line)
    box.classList.remove('is-error')
    box.hidden = false
  }

  async function api(path, withTag) {
    const headers = { Authorization: `Bearer ${token}` }
    if (withTag && etag) headers['If-None-Match'] = etag
    return fetch(path, { headers, cache: 'no-store' })
  }

  async function loadProjects() {
    const res = await api('/api/projects')
    if (res.status === 401) return 'expired'
    if (!res.ok) throw new Error(String(res.status))
    const data = await res.json()
    if (data.lang && WORDS[data.lang]) {
      lang = data.lang
      applyWords()
    }
    const select = $('project')
    select.replaceChildren(
      ...data.projects.map(p => {
        const option = el('option', '', `${p.name}${p.open ? ` (${p.open})` : ''}`)
        option.value = p.key
        return option
      }),
    )
    select.closest('.picker').hidden = data.projects.length < 2
    if (!data.projects.length) return 'noProject'
    if (!data.projects.some(p => p.key === project)) project = data.projects[0].key
    select.value = project
    return 'ok'
  }

  async function load(isFirst) {
    clearTimeout(timer)
    try {
      if (isFirst) {
        showLoading()
        const state = await loadProjects()
        if (state !== 'ok') return showState(state, state === 'expired')
      }
      const query = `/api/board?p=${encodeURIComponent(project)}${$('done').checked ? '&done=1' : ''}`
      const res = await api(query, !isFirst)
      if (res.status === 401) return showState('expired', true)
      if (res.status === 404) return showState('noProject')
      if (res.status !== 304) {
        if (!res.ok) throw new Error(String(res.status))
        etag = res.headers.get('ETag') || ''
        board = await res.json()
        render(board)
      }
      lastOk = Date.now()
      tickLive()
    } catch {
      if (!board) showState('down', true)
      else tickLive()
    } finally {
      timer = setTimeout(() => load(false), 5000)
    }
  }

  function tickLive() {
    const live = $('live')
    const age = Math.round((Date.now() - lastOk) / 1000)
    const isStale = !lastOk || age > 20
    live.classList.toggle('is-stale', isStale)
    $('live-text').textContent = isStale ? words.stale : words.updated(age)
  }
  setInterval(tickLive, 1000)

  // ── Pieces ──

  function empty([title, body], tag = 'li') {
    const box = el(tag, 'empty')
    box.append(el('strong', '', title))
    if (body) box.append(document.createTextNode(body))
    return box
  }

  /** A session's dot or an agent's diamond, in the pane's hue; it pulses while it runs. */
  function mark(color, isAgent, isRunning) {
    const node = el('span', `mark${isAgent ? ' is-agent' : ''}${isRunning ? ' is-running' : ''}`)
    node.setAttribute('aria-hidden', 'true')
    if (hue(color)) node.style.setProperty('--hue', hue(color))
    return node
  }

  /** The pane's step bar: one segment per step. */
  function stepsBar(steps, color) {
    const bar = el('div', `steps${steps.length > 24 ? ' is-dense' : ''}`)
    bar.setAttribute('aria-hidden', 'true')
    if (hue(color)) bar.style.setProperty('--hue', hue(color))
    for (const status of steps) bar.append(el('span', `is-${['completed', 'in_progress', 'pending'].includes(status) ? status : 'pending'}`))
    return bar
  }

  /** The lines of a card's status: the label in its color, then each piece of meta after a dot. */
  function statusLine(label, look, meta) {
    const line = el('p', 'scard__status')
    const strong = el('span', 'label', label)
    strong.style.setProperty('--tone', tone(look))
    line.append(strong)
    for (const piece of meta.filter(Boolean)) line.append(el('span', 'meta', piece))
    return line
  }

  // ── Render ──

  function render(data) {
    if (data.lang && WORDS[data.lang] && data.lang !== lang) {
      lang = data.lang
      applyWords()
    }
    const pane = data.pane
    $('state').hidden = true
    $('board').hidden = false
    document.title = `${data.project.name} · Project PM`
    $('eyebrow').textContent = pane.words.project
    $('name').textContent = data.project.name
    $('path').textContent = data.project.path
    $('pm').textContent = data.project.pmId ? words.pm(data.project.pmName) : words.noPm

    renderProgress(data)
    renderAttention(data.attention)
    renderItems(data)
    renderAgents(data)
    renderSessions(data)
  }

  function renderProgress(data) {
    const { pane, breakdown } = data
    const ratio = pane.percent === null ? 0 : pane.percent / 100
    const circumference = 2 * Math.PI * 17
    $('ring-arc').setAttribute('stroke-dasharray', `${(ratio * circumference).toFixed(2)} ${circumference.toFixed(2)}`)
    $('ring').setAttribute('aria-label', words.progress(data.progress.done, data.progress.total))
    $('percent').textContent = pane.percent === null ? '—' : `${pane.percent}%`
    $('ratio-caption').textContent = pane.words.ratioCaption
    // The open items by kind, in the board's own words (T-42): the line the pane and the text board say.
    const line = $('breakdown')
    line.hidden = !breakdown || !breakdown.total
    if (breakdown && breakdown.total) {
      line.replaceChildren(el('span', '', breakdown.prefix))
      breakdown.parts.forEach((part, i) => {
        if (i) line.append(el('span', '', breakdown.joiner))
        line.append(el('span', `is-${part.kind}`, part.text))
      })
    }
    const metric = (id, value, label, sub) => {
      const box = $(id)
      box.querySelector('dt').textContent = label
      box.querySelector('dd').textContent = String(value)
      box.classList.toggle('is-zero', !value)
      const small = box.querySelector('.metric__sub')
      if (small) {
        small.textContent = sub || ''
        small.hidden = !sub
      }
    }
    metric('m-running', pane.kpi.running, pane.words.kpiRunning, pane.words.kpiAgents)
    metric('m-asking', pane.kpi.asking, pane.words.kpiAsking)
    metric('m-open', pane.kpi.open, pane.words.kpiOpen)
  }

  function renderAttention(list) {
    const box = $('attention')
    $('attention-n').textContent = list.length ? String(list.length) : ''
    if (!list.length) return box.replaceChildren(empty(words.nothing))
    box.replaceChildren(
      ...list.map(a => {
        const li = el('li')
        const m = /^-\s*\[([^\]]+)\]\s*(.*)$/s.exec(a.text)
        if (m) {
          li.append(el('span', 'tag', m[1]), document.createTextNode(m[2]))
          if (/fail|失敗|不通過|lost|遺失|失聯|gone/i.test(m[1])) li.classList.add('is-failed')
        } else li.textContent = a.text.replace(/^-\s*/, '')
        return li
      }),
    )
  }

  function renderItems(data) {
    const pane = data.pane
    $('items-h').textContent = pane.words.items
    $('items-n').textContent = pane.words.itemsMeta
    const list = $('items')
    if (!data.items.length) return list.replaceChildren(empty(data.progress.total ? words.allDone : words.noItems))
    list.replaceChildren(...data.items.map(itemRow))
  }

  function itemRow(item) {
    const li = el('li', `item${item.status === 'open' ? '' : ' is-closed'}`)
    li.append(el('span', 'item__code', item.code))
    const body = el('div')
    body.append(el('p', 'item__text', item.text))
    if (item.status !== 'open') body.append(el('p', 'item__state', words.status[item.status] || item.status))
    // An owner missing is something to see to only while the item is open; a closed one keeps a known owner quietly.
    const isOpen = item.status === 'open'
    if (isOpen || item.ownerLook !== 'warning') {
      const owner = el('p', `item__owner${isOpen && item.ownerLook === 'warning' ? ' is-warning' : ''}`)
      if (item.ownerAgentHex) owner.append(mark(item.ownerAgentHex, true, item.ownerAgentRunning))
      owner.append(document.createTextNode(item.ownerLine))
      body.append(owner)
    }
    if (item.qaText) body.append(el('p', `item__qa${item.qaLook ? ` is-${item.qaLook}` : ''}`, item.qaText))
    for (const [label, text] of [
      [words.criteria, item.criteria],
      [words.note, item.note],
    ]) {
      if (!text) continue
      const details = el('details')
      details.append(el('summary', '', label), el('p', '', text))
      body.append(details)
    }
    li.append(body)
    return li
  }

  function renderAgents(data) {
    const pane = data.pane
    const cards = data.agentCards || []
    $('agents-block').hidden = !cards.length && !data.agentsHidden
    $('agents-h').textContent = pane.words.agents
    $('agents-n').textContent = pane.words.agentsMeta
    $('agents').replaceChildren(...cards.map(agentCard))
    const hidden = $('agents-hidden')
    hidden.hidden = !data.agentsHidden
    hidden.textContent = data.agentsHidden ? pane.words.agentsHidden : ''
  }

  function agentCard(one) {
    const li = el('li', 'scard')
    if (hue(one.hex)) li.style.setProperty('--hue', hue(one.hex))
    const head = el('div', 'scard__head')
    head.append(mark(one.hex, true, one.isRunning), el('span', 'scard__title', one.name), el('span', 'card__time', one.time))
    li.append(head, statusLine(one.label, one.look, one.meta), el('p', 'scard__line', one.line))
    if (one.usage) li.append(el('p', 'scard__usage', one.usage))
    return li
  }

  function renderSessions(data) {
    const pane = data.pane
    $('sessions-h').textContent = pane.words.sessions
    $('sessions-n').textContent = pane.words.sessionsMeta
    const active = data.actors.filter(a => a.isActive)
    const ended = data.actors.filter(a => !a.isActive)
    const list = $('sessions')
    if (!data.actors.length) list.replaceChildren(empty(words.noSessions))
    else if (!active.length) list.replaceChildren(empty([pane.words.noLive, '']))
    else list.replaceChildren(...active.map(sessionCard))
    const fold = $('ended')
    fold.hidden = !ended.length
    $('ended-toggle').textContent = fold.open ? pane.words.hideEnded : pane.words.showEnded
    $('ended-list').replaceChildren(
      ...ended.map(one => {
        const li = el('li')
        li.append(mark(one.hex, false, false), el('span', 'row__title', one.title), el('span', 'card__time', words.ago(Date.now() - one.at)))
        return li
      }),
    )
  }

  function sessionCard(one) {
    const li = el('li', 'scard')
    if (hue(one.hex)) li.style.setProperty('--hue', hue(one.hex))
    const head = el('div', 'scard__head')
    head.append(mark(one.hex, false, one.status === 'running'), el('span', 'scard__title', one.title), el('span', 'card__time', words.ago(Date.now() - one.at)))
    const meta = [one.stepsText, one.untracked ? words.untracked : '']
    li.append(head, statusLine(one.label, one.look, meta))
    if (one.steps.length) li.append(stepsBar(one.steps, one.hex))
    if (one.current) li.append(el('p', `scard__current${one.status === 'open' ? ' is-open' : ''}`, one.current))
    if (one.caveat) {
      const line = el('p', 'scard__caveat')
      line.append(el('b', '', board ? board.pane.words.caveat : ''), document.createTextNode(one.caveat))
      li.append(line)
    } else li.append(el('p', 'scard__line', one.summary))
    return li
  }

  $('project').addEventListener('change', event => {
    project = event.target.value
    store.set('pm-project', project)
    etag = ''
    board = null
    load(false)
  })
  $('done').addEventListener('change', () => {
    etag = ''
    load(false)
  })
  // The folded ended sessions say whether they open or close, in the pane's words.
  $('ended').addEventListener('toggle', () => {
    if (board) $('ended-toggle').textContent = $('ended').open ? board.pane.words.hideEnded : board.pane.words.showEnded
  })

  // A fresh link opened in a tab that already shows the board changes only the fragment: take its token and start over.
  window.addEventListener('hashchange', () => {
    const next = new URLSearchParams(location.hash.slice(1))
    if (!next.get('t')) return
    store.set('pm-token', next.get('t'))
    if (next.get('p')) store.set('pm-project', next.get('p'))
    history.replaceState(null, '', location.pathname)
    token = next.get('t')
    project = next.get('p') || project
    etag = ''
    board = null
    load(true)
  })

  applyWords()
  if (!token) showState('noToken')
  else load(true)
})()
