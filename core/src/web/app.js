// Project PM web board: read-only. Every word from the board is set as text (never as HTML).
;(() => {
  'use strict'

  const WORDS = {
    en: {
      project: 'Project',
      attention: 'Needs attention',
      items: 'Work items',
      sessions: 'Sessions',
      agents: 'Agents',
      showDone: 'Show done and dropped',
      readonly: 'This board only shows. To close, hand over or drop a work item, tell the PM in your AI tool, for example "close T-03".',
      theme: { auto: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' },
      progress: (d, n) => `${d} of ${n} work items done`,
      done: 'done',
      updated: s => (s < 5 ? 'Live · just updated' : `Live · updated ${s}s ago`),
      stale: 'Not updating: the board server does not answer',
      pm: id => `PM: ${id}`,
      noPm: 'No PM yet. In your AI tool, ask it to call the pm tool with action "claim".',
      nothing: 'Nothing needs you right now.',
      noItems: ['No work items yet', 'Tell the PM what you want built; it adds each request to this list.'],
      allDone: ['Every work item is done', 'Show done items to see them.'],
      noSessions: ['No session has reported yet', 'Sessions show up here once their hooks or the report tool write to Project PM.'],
      owner: who => `Owner: ${who}`,
      unassigned: 'unassigned',
      qa: { pass: 'QA passed', fail: 'QA failed', skipped: 'QA skipped', awaiting: 'Awaiting QA' },
      status: { open: 'open', done: 'done', dropped: 'dropped' },
      criteria: 'How it is checked',
      note: 'Note',
      tasks: (d, n) => `Tasks ${d}/${n}`,
      ago: ms => {
        const m = Math.round(ms / 60000)
        if (m < 1) return 'just now'
        if (m < 60) return `${m} min ago`
        const h = Math.round(m / 60)
        return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`
      },
      states: {
        noToken: ['Open the board from your terminal', 'This page needs the address Project PM prints, with its key. Run:', 'git pm open'],
        expired: ['This board link has expired', 'The board server restarted and its key changed. Run this in a terminal to open a fresh link:', 'git pm open'],
        down: ['The board server does not answer', 'It stops after 30 minutes without use, or it was closed. Run this in a terminal to start it again:', 'git pm open'],
        noProject: ['No project yet', 'Project PM keeps a ledger once someone uses it in a git project: ask your AI tool to call the pm tool with action "claim", or add a work item.', ''],
      },
      retry: 'Try again',
      loading: 'Loading the board…',
    },
    'zh-TW': {
      project: '專案',
      attention: '需要處理',
      items: '工作項目',
      sessions: 'Sessions',
      agents: 'Agents',
      showDone: '顯示已結案和放棄的',
      readonly: '這個看板只能看。要結案、換負責人或放棄工作項目，請在 AI 工具裡對 PM 說，例如「T-03 結案」。',
      theme: { auto: '配色：跟隨系統', light: '配色：淺色', dark: '配色：深色' },
      progress: (d, n) => `${n} 項工作完成 ${d} 項`,
      done: '完成',
      updated: s => (s < 5 ? '即時 · 剛更新' : `即時 · ${s} 秒前更新`),
      stale: '沒有更新：看板伺服器沒有回應',
      pm: id => `PM：${id}`,
      noPm: '還沒有 PM。在 AI 工具裡請它呼叫 pm 工具，action 填 claim。',
      nothing: '目前沒有需要你處理的事。',
      noItems: ['還沒有工作項目', '把要做的事告訴 PM，它會一項一項登記在這裡。'],
      allDone: ['工作項目都完成了', '勾選「顯示已結案」可以看到它們。'],
      noSessions: ['還沒有 Session 回報', 'Session 的 hook 或 report 工具寫入 Project PM 後，就會出現在這裡。'],
      owner: who => `負責：${who}`,
      unassigned: '未指派',
      qa: { pass: 'QA 通過', fail: 'QA 不通過', skipped: 'QA 略過', awaiting: '待 QA' },
      status: { open: '進行中', done: '已結案', dropped: '已放棄' },
      criteria: '驗收條件',
      note: '備註',
      tasks: (d, n) => `任務 ${d}/${n}`,
      ago: ms => {
        const m = Math.round(ms / 60000)
        if (m < 1) return '剛剛'
        if (m < 60) return `${m} 分鐘前`
        const h = Math.round(m / 60)
        return h < 48 ? `${h} 小時前` : `${Math.round(h / 24)} 天前`
      },
      states: {
        noToken: ['請從終端機打開看板', '這個頁面需要 Project PM 給的網址（含金鑰）。請在終端機執行：', 'git pm open'],
        expired: ['這個看板連結已過期', '看板伺服器重新啟動過，金鑰換了。請在終端機執行下面的指令，打開新的連結：', 'git pm open'],
        down: ['看板伺服器沒有回應', '它閒置 30 分鐘會自動停止，或已經被關掉。請在終端機執行下面的指令重新啟動：', 'git pm open'],
        noProject: ['還沒有專案', '在 git 專案裡使用 Project PM 之後才會有交辦清單：請 AI 工具呼叫 pm 工具（action 填 claim），或新增一個工作項目。', ''],
      },
      retry: '再試一次',
      loading: '正在讀取看板…',
    },
  }

  const STATUS_COLOR = {
    asking: '--s-asking',
    failed: '--s-failed',
    open: '--s-open',
    unreleased: '--s-unreleased',
    ci: '--s-ci',
    running: '--s-running',
    waiting: '--s-waiting',
    done: '--s-done',
    stale: '--s-stale',
  }
  const QA_COLOR = { pass: '--s-running', fail: '--s-failed', skipped: '--s-done', awaiting: '--s-asking' }

  const $ = id => document.getElementById(id)
  const el = (tag, cls, text) => {
    const node = document.createElement(tag)
    if (cls) node.className = cls
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }

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
    theme = next
    if (theme === 'auto') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = theme
    store.local('pm-theme', theme)
    themeLabel()
  }
  function themeLabel() {
    $('theme').textContent = words.theme[theme]
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
    box.replaceChildren(el('p', '', words.loading))
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
    select.replaceChildren(...data.projects.map(p => {
      const option = el('option', '', `${p.name}${p.open ? ` (${p.open})` : ''}`)
      option.value = p.key
      return option
    }))
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

  // ── Render ──
  function empty([title, body]) {
    const box = el('li', 'empty')
    box.append(el('strong', '', title), document.createTextNode(body))
    return box
  }

  function render(data) {
    if (data.lang && WORDS[data.lang] && data.lang !== lang) {
      lang = data.lang
      applyWords()
    }
    $('state').hidden = true
    $('board').hidden = false
    document.title = `${data.project.name} · Project PM`
    $('name').textContent = data.project.name
    $('path').textContent = data.project.path
    $('pm').textContent = data.project.pmId ? words.pm(data.project.pmId) : words.noPm

    // Progress: one segment per counted work item.
    const { done, total } = data.progress
    const progress = $('progress')
    progress.setAttribute('aria-label', words.progress(done, total))
    const rail = el('div', 'progress__rail')
    for (let i = 0; i < Math.max(total, 1); i++) rail.append(el('span', `progress__seg${i < done ? ' is-done' : ''}`))
    const num = el('p', 'progress__num', `${done}/${total}`)
    num.append(el('small', '', words.done))
    progress.replaceChildren(rail, num)

    // Attention.
    const attention = $('attention')
    $('attention-n').textContent = data.attention.length ? String(data.attention.length) : ''
    if (!data.attention.length) attention.replaceChildren(empty([words.nothing, '']))
    else
      attention.replaceChildren(
        ...data.attention.map(a => {
          const li = el('li')
          const m = /^-\s*\[([^\]]+)\]\s*(.*)$/s.exec(a.text)
          if (m) {
            li.append(el('span', 'tag', m[1]), document.createTextNode(m[2]))
            if (/fail|失敗|不通過|lost|遺失/i.test(m[1])) li.classList.add('is-failed')
          } else li.textContent = a.text.replace(/^-\s*/, '')
          return li
        }),
      )

    // Work items.
    const items = $('items')
    const open = data.items.filter(i => i.status === 'open').length
    $('items-n').textContent = String(open)
    if (!data.items.length) items.replaceChildren(empty(data.progress.total ? words.allDone : words.noItems))
    else items.replaceChildren(...data.items.map(itemRow))

    // Sessions.
    const sessions = $('sessions')
    $('sessions-n').textContent = data.actors.length ? String(data.actors.length) : ''
    if (!data.actors.length) sessions.replaceChildren(empty(words.noSessions))
    else sessions.replaceChildren(...data.actors.map(sessionCard))

    const agents = data.agents || []
    $('agents-block').hidden = !agents.length
    $('agents').replaceChildren(
      ...agents.map(a => {
        const li = el('li', 'session')
        const head = el('div', 'session__head')
        const mark = el('span', 'mark')
        mark.style.background = `var(${a.state === 'failed' || a.state === 'lost' ? '--s-failed' : a.state === 'running' ? '--s-running' : a.state === 'done' ? '--s-done' : '--s-asking'})`
        head.append(mark, el('span', '', a.state))
        li.append(head, el('p', 'session__title', a.description), el('p', 'session__said', a.result || ''))
        return li
      }),
    )
  }

  function itemRow(item) {
    const li = el('li', `item${item.status === 'open' ? '' : ' is-closed'}`)
    li.append(el('span', 'item__code', item.code))
    const body = el('div')
    body.append(el('p', 'item__text', item.text))
    const facts = el('p', 'item__facts')
    const status = el('span', 'fact', words.status[item.status] || item.status)
    facts.append(status)
    facts.append(el('span', 'fact', words.owner(item.owner || words.unassigned)))
    if (item.qaShown) {
      const qa = el('span', 'fact')
      const mark = el('span', 'mark')
      mark.style.background = `var(${QA_COLOR[item.qaShown] || '--s-done'})`
      qa.append(mark, document.createTextNode(words.qa[item.qaShown] || item.qaShown))
      facts.append(qa)
    }
    body.append(facts)
    for (const [label, text] of [[words.criteria, item.criteria], [words.note, item.note]]) {
      if (!text) continue
      const details = el('details')
      details.append(el('summary', '', label), el('p', '', text))
      body.append(details)
    }
    li.append(body)
    return li
  }

  function sessionCard(actor) {
    const li = el('li', 'session')
    const head = el('div', 'session__head')
    const mark = el('span', 'mark')
    mark.style.background = `var(${STATUS_COLOR[actor.status] || '--s-done'})`
    head.append(mark, el('span', '', actor.label), el('span', 'session__tool', actor.tool))
    li.append(head, el('p', 'session__title', actor.title))
    if (actor.said) li.append(el('p', 'session__said', actor.said))
    const foot = [words.ago(Date.now() - actor.at)]
    if (actor.plan && actor.plan.total) foot.push(words.tasks(actor.plan.done, actor.plan.total))
    li.append(el('p', 'session__foot', foot.join(' · ')))
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
