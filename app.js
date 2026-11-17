/* 考研英语二刷题器 · 开放版（无内置真题，支持拖拽导入自建题库） */
'use strict';

const LS_STATS = 'kyz_stats_v1';
const LS_WRONG = 'kyz_wrong_v1';
const LS_BANKS = 'kyz_banks_v1';
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
};
let stats = store.get(LS_STATS, {});
let wrongBook = store.get(LS_WRONG, []);
let customBanks = store.get(LS_BANKS, {});   // {y: paper}，y 为数字

const app = document.getElementById('app');
let route = { view: 'home' };   // home | paper | quiz | summary | wrong | self
let quiz = null;                // 当前练习状态

/* ---------- 数据模型 ---------- */
function dataOf(y) {
  return customBanks[y] || QUIZ_DATA[y];
}
function allYears() {
  const bundled = Object.keys(window.QUIZ_DATA || {}).map(Number);
  const custom = Object.keys(customBanks).map(Number);
  return [...new Set([...bundled, ...custom])].sort((a, b) => a - b);
}
function bankLabel(y) {
  const d = dataOf(y);
  return (d && d.label) || (y + ' 年题库');
}
function sectionsOf(y) {
  const d = dataOf(y);
  const secs = [{
    id: 'C', label: '完形填空', tag: 'Section I', count: d.cloze.questions.length,
    desc: d.cloze.questions.length + ' 题 · 语言知识运用', qList: d.cloze.questions.map(q => ({ ...q, sec: 'C', ti: -1, key: `${y}:C:-1:${q.num}` })),
    material: { type: 'C', directions: d.cloze.directions, passage: d.cloze.passage, blob: d.cloze.analysisBlob },
  }];
  d.reading.forEach((tx, i) => {
    secs.push({
      id: 'R', ti: i, label: `阅读理解 Text ${i + 1}`, tag: 'Part A',
      count: tx.questions.length, desc: (tx.title || '') + ' · ' + tx.questions.length + ' 题',
      qList: tx.questions.map(q => ({ ...q, sec: 'R', ti: i, key: `${y}:R:${i}:${q.num}` })),
      material: { type: 'R', passage: tx.passage, overview: tx.overview, discourse: tx.discourse },
    });
  });
  secs.push({
    id: 'PB', label: '新题型 Part B', tag: 'Part B', count: d.partB.questions.length,
    desc: d.partB.questions.length + ' 题 · ' + ((d.partB.options || []).length ? '选择匹配' : '判断正误'),
    qList: d.partB.questions.map(q => ({ ...q, sec: 'PB', ti: -1, key: `${y}:PB:-1:${q.num}` })),
    material: { type: 'PB', directions: d.partB.directions, options: d.partB.options, passage: d.partB.passage, blob: d.partB.analysisBlob },
  });
  return secs;
}
function getQuestion(y, sec, ti, num) {
  try {
    const d = dataOf(y);
    if (!d) return undefined;
    if (sec === 'C') return (d.cloze.questions || []).find(q => q.num === num);
    if (sec === 'PB') return (d.partB.questions || []).find(q => q.num === num);
    const tx = (d.reading || [])[ti];
    return tx ? tx.questions.find(q => q.num === num) : undefined;
  } catch (e) { return undefined; }
}

/* ---------- 工具 ---------- */
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function renderRich(s) {
  if (!s) return '';
  let lines = esc(s).split('\n');
  let html = '', inList = false;
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  for (let raw of lines) {
    let l = raw.trim();
    if (!l) { closeList(); continue; }
    l = l.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    l = l.replace(/\[([A-GTF])\]/g, '<span class="opt-tag">[$1]</span>');
    const hm = l.match(/^#{1,6}\s*(.*)$/);
    if (hm) { closeList(); html += `<h4>${hm[1]}</h4>`; continue; }
    if (/^[-•]\s+/.test(l)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${l.replace(/^[-•]\s+/, '')}</li>`; continue;
    }
    closeList();
    if (/^\*\*【/.test(l)) html += `<div class="ana-block">${l}</div>`;
    else html += `<p>${l}</p>`;
  }
  closeList();
  return html;
}
function renderPassage(paras) {
  return (paras || []).map(p => {
    let t = esc(p)
                 .replace(/_{2,3}\s*(\d{1,2})\s*_{2,3}/g, '<span class="blank">__$1__</span>')
                 .replace(/\((\d{1,2})\)(?=[ \u4e00-\u9fffA-Za-z])/g, '<span class="blank">($1)</span>');
    return `<p style="margin:8px 0">${t}</p>`;
  }).join('');
}

/* ---------- 渲染 ---------- */
function render() {
  window.scrollTo(0, 0);
  if (route.view === 'home') return viewHome();
  if (route.view === 'paper') return viewPaper(route.y);
  if (route.view === 'quiz') return viewQuiz();
  if (route.view === 'summary') return viewSummary();
  if (route.view === 'wrong') return viewWrong();
  if (route.view === 'self') return viewSelf(route.y, route.sec);
}

function viewHome() {
  const years = allYears().reverse();
  let cards = years.map(y => {
    const st = stats[y];
    const stat = st ? `已刷 ${st.attempts} 次 · 最佳正确率 ${st.best}%` : '未开始';
    const custom = !!customBanks[y];
    const kind = custom ? '自建题库（本地保存）'
      : (y >= 2010 && y <= 2026 ? '真题库 · 解析为 AI 生成' : 'AI 演示题库');
    const del = custom ? `<button class="btn ghost" style="margin-top:8px;font-size:12px;padding:4px 10px" onclick="event.stopPropagation();deleteBank(${y})">删除此题库</button>` : '';
    return `<div class="card" onclick="go('paper',{y:${y}})">
      <h3>${esc(bankLabel(y))}</h3>
      <div class="sub">${kind} · ${countOf(y)} 题</div>
      <div class="stat">${stat}</div>${del}</div>`;
  }).join('');
  const wrongN = wrongBook.length;
  app.innerHTML = `
    <div class="hero"><h1>考研英语（二）真题刷题器</h1>
      <p>2010 – 2026 · 17 套真题 + AI 演示卷 · 解析与译文/范文均为 AI 生成 · 支持拖拽导入自建题库</p></div>
    <div class="dropzone" id="dropzone" onclick="document.getElementById('bankfile').click()">
      <b>将题库 .js / .json 文件拖到这里</b>（或点击选择文件）
      <div class="sub">想要更高质量的深度解析？看 README 里的提示词模板，让 AI 生成专属题库拖入即可</div>
      <input type="file" id="bankfile" accept=".js,.json" style="display:none" onchange="importBank(this.files)">
    </div>
    <div class="grid">
      <div class="card" onclick="go('wrong')"><h3>错题本</h3>
        <div class="sub">自动收录做错的题目</div><div class="stat">${wrongN ? wrongN + ' 道错题待重刷' : '暂无错题'}</div></div>
      ${cards}
      <div class="card wide" style="text-align:center">
        <button class="btn ghost" onclick="exportRecords()">⬇ 导出全部（题库 + 做题记录 + 错题本）</button>
        <button class="btn ghost" style="margin-left:10px" onclick="document.getElementById('impfile').click()">⬆ 导入备份</button>
        <input type="file" id="impfile" accept=".json,application/json" style="display:none" onchange="importRecords(this)">
        <div class="sub" style="margin-top:8px">题库、记录都保存在浏览器本地；换电脑/换浏览器前导出，新环境导入即可无缝续刷</div>
      </div>
      <div class="card wide"><h3 style="font-size:15px">版权与质量说明（重要）</h3>
        <div class="sub" style="font-size:13px">
        · <b style="color:var(--bad)">版权边界</b>：本项目包含历年真题的题目、文章与答案（公开流传版本），但<b>不包含任何原版解析书内容</b>——逐题解析、整体解析、参考译文与范文<b>全部为 AI 生成</b>，与官方解析无关。历年真题版权归教育部教育考试院，如权利方提出异议请联系删除。<br>
        · <b style="color:#b45309">质量提示</b>：AI 解析为简版（词义辨析/定位思路/同义转述说明），<b>不保证与官方解析同等深度</b>。想要高质量深度解析，请看 README 的提示词模板——把任意 Word/PDF 交给 AI 生成专属题库，然后拖入本页面即可使用。<br>
        · 导入的题库保存在浏览器本地（localStorage，约 5MB 上限）；导出备份时题库一并导出。</div></div>
    </div>`;
}
function countOf(y) {
  const d = dataOf(y);
  return (d.cloze.questions.length || 0) + (d.reading || []).reduce((s, t) => s + (t.questions || []).length, 0) + ((d.partB && d.partB.questions) || []).length;
}

function viewPaper(y) {
  const secs = sectionsOf(y);
  const rows = secs.map((s, i) => `
    <div class="sec-row" onclick="${s.id === 'C' || s.id === 'R' || s.id === 'PB'
      ? `startQuiz(${y},${i})` : `go('self',{y:${y},sec:'${s.id === 'T' ? 'T' : 'W'}'})`}">
      <span class="tag${s.id === 'T' || s.id === 'W' ? ' self' : ''}">${s.tag}</span>
      <div style="flex:1"><h3>${s.label}</h3><div class="sub">${s.desc}</div></div>
      <span class="sub">${s.id === 'T' || s.id === 'W' ? '自评对照 →' : '开始 →'}</span>
    </div>`).join('');
  app.innerHTML = `
    <div class="topbar"><button class="back" onclick="go('home')">← 返回</button>
      <h2>${esc(bankLabel(y))}</h2></div>
    <div class="sec-list">${rows}</div>`;
}

/* ---------- 练习 ---------- */
function startQuiz(y, secIdx) {
  const secs = sectionsOf(y);
  const s = secs[secIdx];
  quiz = {
    y, secIdx, sec: s, list: s.qList.slice(), idx: 0,
    chosen: null, judged: false, correct: 0, results: [], material: s.material,
  };
  route = { view: 'quiz' };
  render();
}
function startWrongQuiz(entries) {
  const list = entries.map(e => {
    const q = getQuestion(e.y, e.sec, e.ti, e.num);
    if (!q) return null;
    return { ...q, sec: e.sec, ti: e.ti, key: `${e.y}:${e.sec}:${e.ti}:${e.num}`, year: e.y };
  }).filter(Boolean);
  if (!list.length) { alert('这批错题对应的题库数据已不存在（题库可能已删除），无法重做'); return; }
  const y = list[0].year;
  quiz = {
    y, secIdx: -1, sec: { id: 'W', label: '错题重刷' },
    list, idx: 0, chosen: null, judged: false, correct: 0, results: [], mixed: true,
    material: materialForMixed(list),
  };
  route = { view: 'quiz' };
  render();
}
function materialForMixed(list) {
  const d = dataOf(list[0].year) || QUIZ_DATA[list[0].year] || {};
  const first = list[0];
  if (first.sec === 'C') return { type: 'C', directions: (d.cloze || {}).directions, passage: (d.cloze || {}).passage, blob: (d.cloze || {}).analysisBlob };
  if (first.sec === 'PB') return { type: 'PB', directions: (d.partB || {}).directions, options: (d.partB || {}).options, passage: (d.partB || {}).passage, blob: (d.partB || {}).analysisBlob };
  const tx = (d.reading || [])[first.ti] || {};
  return { type: 'R', passage: tx.passage, overview: tx.overview, discourse: tx.discourse };
}

function materialHTML(m) {
  if (!m) return '';
  if (m.type === 'C') {
    return `<h3>完形填空 · 原文</h3>
      ${m.directions && m.directions.length ? `<div class="directions">${esc(m.directions.join(' '))}</div>` : ''}
      <div class="passage">${renderPassage(m.passage)}</div>`;
  }
  if (m.type === 'R') {
    return `<h3>文章原文</h3><div class="passage">${renderPassage(m.passage)}</div>
      ${m.overview ? `<details style="margin-top:12px"><summary style="cursor:pointer;font-size:13px;color:var(--brand)">文章总体分析</summary>
        <div class="analysis">${renderRich(m.overview)}</div></details>` : ''}
      ${m.discourse ? `<details style="margin-top:8px"><summary style="cursor:pointer;font-size:13px;color:var(--brand)">语篇分析（逐段对照翻译）</summary>
        <div class="analysis">${renderRich(m.discourse)}</div></details>` : ''}`;
  }
  if (m.type === 'PB') {
    const opts = (m.options || []).map(o => `<div class="pb-opt"><b>[${o.key}]</b> ${esc(o.text)}</div>`).join('');
    return `<h3>新题型 · 材料与选项</h3>
      ${m.directions && m.directions.length ? `<div class="directions">${esc(m.directions.join(' '))}</div>` : ''}
      ${opts ? `<div style="margin-bottom:12px">${opts}</div>` : ''}
      <div class="passage">${renderPassage(m.passage)}</div>
      ${m.blob ? `<details style="margin-top:12px"><summary style="cursor:pointer;font-size:13px;color:var(--brand)">本部分整体解析</summary>
        <div class="analysis">${renderRich(m.blob)}</div></details>` : ''}`;
  }
  return '';
}

function viewQuiz() {
  const { y, sec, list, idx } = quiz;
  const q = list[idx];
  let opts, optLabel, isTF;
  if (q.opts && Object.keys(q.opts).length) {
    opts = Object.keys(q.opts); optLabel = k => q.opts[k]; isTF = false;
  } else if (q.sec === 'PB' && quiz.material.options && quiz.material.options.length) {
    const omap = {}; quiz.material.options.forEach(o => { omap[o.key] = o.text; });
    opts = quiz.material.options.map(o => o.key); optLabel = k => omap[k]; isTF = false;
  } else {
    opts = ['T', 'F']; optLabel = k => (k === 'T' ? '正确（True）' : '错误（False）'); isTF = true;
  }

  let optsHtml = opts.map(k => {
    let cls = 'opt';
    if (quiz.judged) {
      if (k === q.answer) cls += ' right';
      else if (k === quiz.chosen) cls += ' wrong';
    } else if (k === quiz.chosen) cls += ' chosen';
    return `<button class="${cls}" ${quiz.judged ? 'disabled' : ''} onclick="choose('${k}')">
      <span class="key">${k}.</span> <span>${esc(optLabel(k))}</span></button>`;
  }).join('');

  let verdict = '', anaHtml = '';
  if (quiz.judged) {
    const okFlag = quiz.chosen === q.answer;
    verdict = `<div class="verdict ${okFlag ? 'ok' : 'bad'}">${okFlag ? '✓ 回答正确' : `✗ 回答错误 · 正确答案 ${q.answer}`}</div>`;
    const blob = q.sec === 'C' ? quiz.material.blob : (q.sec === 'PB' ? quiz.material.blob : '');
    anaHtml = `
      <div class="analysis">${q.analysis ? renderRich(q.analysis)
        : (blob ? '<p style="color:var(--ink2)">该题无逐题解析，请展开下方"本部分整体解析"。</p>' : '<p style="color:var(--ink2)">暂无解析。</p>')}
        ${blob && q.sec !== 'PB' ? `<details class="ana-toggle"><summary style="cursor:pointer;color:var(--brand)">本部分整体解析</summary>
          <div class="analysis">${renderRich(blob)}</div></details>` : ''}
      </div>`;
  }

  app.innerHTML = `
    <div class="topbar">
      <button class="back" onclick="go(${quiz.mixed ? "'wrong'" : `'paper',{y:${y}}`})">← 返回</button>
      <h2>${quiz.mixed ? '错题重刷' : `${y} · ${sec.label}`}</h2>
      <span class="spacer"></span><span class="meta">第 ${idx + 1} / ${list.length} 题 · 已对 ${quiz.correct} 题</span>
    </div>
    <div class="layout">
      <div class="panel">${materialHTML(quiz.material)}</div>
      <div class="panel qcard">
        <div class="qnum"><span>${q.sec === 'C' ? '完形填空' : q.sec === 'PB' ? '新题型' : '阅读理解'} · 第 ${q.num} 题</span>
          <span>${isTF ? '判断正误' : '单选'}</span></div>
        <div class="qstem">${esc(q.stem || (isTF ? '判断以上说法的正误。' : ''))}</div>
        <div class="opts">${optsHtml}</div>
        ${verdict}
        ${anaHtml}
        <div class="actions">
          ${quiz.judged
            ? `<button class="btn primary" onclick="nextQ()">${idx + 1 < list.length ? '下一题 →' : '查看结果 →'}</button>`
            : `<button class="btn primary" onclick="judge()" ${quiz.chosen ? '' : 'disabled'}>确认答案</button>
               <button class="btn ghost" onclick="reveal()">直接看答案</button>`}
        </div>
      </div>
    </div>`;
}

function choose(k) {
  if (!quiz || quiz.judged) return;
  quiz.chosen = k;
  render();
}
function judge() {
  if (!quiz.chosen || quiz.judged) return;
  quiz.judged = true;
  const q = quiz.list[quiz.idx];
  const okFlag = quiz.chosen === q.answer;
  if (okFlag) quiz.correct++;
  quiz.results.push({ q, chosen: quiz.chosen, ok: okFlag });
  if (!okFlag) {
    wrongBook = wrongBook.filter(w => !(w.y === (q.year || quiz.y) && w.sec === q.sec && w.ti === q.ti && w.num === q.num));
    wrongBook.push({ y: q.year || quiz.y, sec: q.sec, ti: q.ti, num: q.num,
      snippet: (q.stem || '').slice(0, 60), time: Date.now() });
    store.set(LS_WRONG, wrongBook);
  }
  render();
}
function reveal() {
  quiz.chosen = quiz.list[quiz.idx].answer;
  judge();
}
function nextQ() {
  if (quiz.idx + 1 < quiz.list.length) {
    quiz.idx++; quiz.chosen = null; quiz.judged = false;
    route.view = 'quiz'; render();
  } else {
    finishQuiz();
  }
}
function finishQuiz() {
  const { y, sec, results, correct, mixed } = quiz;
  if (results.length) {
    if (!mixed) {
      const rate = Math.round(correct / results.length * 100);
      const st = stats[y] || { attempts: 0, best: 0 };
      st.attempts++; st.best = Math.max(st.best, rate);
      stats[y] = st; store.set(LS_STATS, stats);
    }
    // 答对的题从错题本移除（含错题重刷）
    results.filter(r => r.ok).forEach(r => {
      wrongBook = wrongBook.filter(w => !(w.y === (r.q.year || y) && w.sec === r.q.sec && w.ti === r.q.ti && w.num === r.q.num));
    });
    store.set(LS_WRONG, wrongBook);
  }
  route = { view: 'summary' };
  render();
}

function viewSummary() {
  const { y, sec, results, correct, mixed } = quiz;
  const rate = results.length ? Math.round(correct / results.length * 100) : 0;
  const wrongRows = results.filter(r => !r.ok).map(r => `
    <div class="w"><span>第 ${r.q.num} 题</span><span>${esc((r.q.stem || '').slice(0, 40))}…</span>
      <span style="color:var(--bad)">选 ${r.chosen}</span><span style="color:var(--ok)">应 ${r.q.answer}</span></div>`).join('');
  app.innerHTML = `
    <div class="topbar"><button class="back" onclick="go('home')">← 返回首页</button>
      <h2>${mixed ? '错题重刷' : `${y} · ${sec.label}`} · 练习结果</h2></div>
    <div class="summary card">
      <h3 style="color:var(--ink2)">${mixed ? '本轮重刷结果' : '本次练习正确率'}</h3>
      <div class="score">${correct} / ${results.length}</div>
      <div style="color:var(--ink2)">正确率 ${rate}%　·　错题已自动加入错题本，答对的错题自动移除</div>
      ${wrongRows ? `<div class="wrong-list"><h4 style="margin:14px 0 6px">本轮错题</h4>${wrongRows}</div>` : '<p style="margin-top:14px;color:var(--ok)">全部正确！</p>'}
      <div class="actions" style="justify-content:center;margin-top:22px">
        <button class="btn primary" onclick="retry()">再刷一遍</button>
        <button class="btn ghost" onclick="go(${mixed ? "'wrong'" : `'paper',{y:${y}}`})">返回</button>
      </div>
    </div>`;
}
function retry() {
  const { y, secIdx, mixed } = quiz;
  if (mixed) {
    const entries = quiz.list.map(q => ({ y: q.year, sec: q.sec, ti: q.ti, num: q.num }));
    startWrongQuiz(entries);
  } else {
    startQuiz(y, secIdx);
  }
}

/* ---------- 错题本 ---------- */
function viewWrong() {
  const items = wrongBook.slice().reverse();
  if (!items.length) {
    app.innerHTML = `<div class="topbar"><button class="back" onclick="go('home')">← 返回</button><h2>错题本</h2></div>
      <div class="empty">暂无错题。去刷一套真题吧！</div>`;
    return;
  }
  const rows = items.map((w, i) => `
    <div class="wrong-item" style="cursor:pointer" onclick="redoOne(${i})"><div class="wq">
      <div class="meta">${w.y} 年 · ${w.sec === 'C' ? '完形' : w.sec === 'PB' ? '新题型' : '阅读 Text ' + ((w.ti || 0) + 1)} · 第 ${w.num} 题</div>
      <div>${esc(w.snippet || '')}…</div></div>
      <button class="btn ghost" onclick="event.stopPropagation();redoOne(${i})">重做</button></div>`).join('');
  app.innerHTML = `
    <div class="topbar"><button class="back" onclick="go('home')">← 返回</button><h2>错题本（${items.length}）</h2>
      <span class="spacer"></span><button class="btn primary" onclick="redoAll()">全部重刷</button></div>
    <div>${rows}</div>`;
}
function redoOne(i) {
  startWrongQuiz([wrongBook.slice().reverse()[i]]);
}
function redoAll() {
  startWrongQuiz(wrongBook.slice());
}

/* ---------- 自评（翻译/写作） ---------- */
function viewSelf(y, secId) {
  const d = dataOf(y);
  if (!d) {
    app.innerHTML = `<div class="topbar"><button class="back" onclick="go('home')">← 返回</button><h2>自评</h2></div>
      <div class="empty">该题库数据缺失，无法打开自评页。</div>`;
    return;
  }
  let body, title;
  if (secId === 'T') {
    title = '翻译（46 题）· 自评对照';
    body = `<div class="panel">
      <h3>题目原文</h3><div class="directions">${esc(d.translation.blocks.slice(0, 2).join(' '))}</div>
      <div class="passage">${renderPassage(d.translation.blocks.slice(2))}</div>
      ${d.translation.reference ? `<h3 style="margin-top:16px">参考译文</h3>
        <div class="ref-block">${renderRich(d.translation.reference)}</div>` : ''}
      ${d.translation.analysis ? `<details style="margin-top:12px"><summary style="cursor:pointer;font-size:13px;color:var(--brand)">逐句解析</summary>
        <div class="analysis">${renderRich(d.translation.analysis)}</div></details>` : ''}</div>`;
  } else {
    title = '写作（47-48 题）· 自评对照';
    const one = (label, blocks, ref) => `
      <div class="panel" style="margin-bottom:16px">
        <h3>${label}</h3>
        <div class="passage" style="margin-bottom:10px">${renderPassage(blocks)}</div>
        ${ref ? `<details><summary style="cursor:pointer;font-size:13px;color:var(--brand)">参考范文</summary>
          <div class="ref-block">${renderRich(ref)}</div></details>` : '<div class="sub">暂无参考范文</div>'}
      </div>`;
    body = one('Part A · 小作文（47）', d.writing.small, d.writing.small_ref) +
           one('Part B · 大作文（48）', d.writing.large, d.writing.large_ref);
  }
  app.innerHTML = `
    <div class="topbar"><button class="back" onclick="go('paper',{y:${y}})">← 返回</button><h2>${y} ${title}</h2></div>
    ${body}`;
}

/* ---------- 记录导出/导入 ---------- */
function exportRecords() {
  const payload = JSON.stringify({ app: 'kyz-open', stats, wrongBook, banks: customBanks, exportedAt: new Date().toISOString() }, null, 2);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  a.download = '刷题备份_' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}
function importRecords(input) {
  const f = input.files && input.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const d = JSON.parse(rd.result);
      if (!d || (d.app !== 'kyz-open' && d.app !== 'kyz') || typeof d.stats !== 'object' || !Array.isArray(d.wrongBook)) throw new Error('格式');
      const parts = [Object.keys(d.stats).length + ' 卷统计', d.wrongBook.length + ' 道错题'];
      if (d.banks && Object.keys(d.banks).length) parts.push(Object.keys(d.banks).length + ' 个题库');
      if (!confirm(`导入：${parts.join(' + ')}，将覆盖当前对应内容。确定？`)) return;
      stats = d.stats; wrongBook = d.wrongBook;
      store.set(LS_STATS, stats); store.set(LS_WRONG, wrongBook);
      if (d.banks) { customBanks = d.banks; store.set(LS_BANKS, customBanks); }
      render();
    } catch (e) {
      alert(e.message === '格式' ? '导入失败：不是本刷题器的备份文件' : '导入失败：文件读取错误');
    }
  };
  rd.readAsText(f, 'utf-8');
  input.value = '';
}

/* ---------- 自建题库导入（拖拽 / 选择文件） ---------- */
function validateBank(p) {
  if (!p || typeof p !== 'object') return null;
  if (!p.cloze || !Array.isArray(p.cloze.questions) || !Array.isArray(p.reading) || !p.partB || !Array.isArray(p.partB.questions)) return null;
  const n = p.cloze.questions.length + p.reading.reduce((s, t) => s + ((t && t.questions) || []).length, 0) + p.partB.questions.length;
  if (n < 1) return null;
  return p;
}
function parseBankText(text) {
  // .js：window.QUIZ_DATA[9002]={...}; —— 沙箱执行捕获
  try {
    const fakeWindow = { QUIZ_DATA: {} };
    new Function('window', 'QUIZ_DATA', text)(fakeWindow, fakeWindow.QUIZ_DATA);
    const ks = Object.keys(fakeWindow.QUIZ_DATA);
    if (ks.length === 1) {
      const p = validateBank(fakeWindow.QUIZ_DATA[ks[0]]);
      if (p) return { bank: p, year: Number(ks[0]) };
    }
  } catch (e) { /* fallthrough */ }
  // .json：纯对象
  try {
    const j = JSON.parse(text);
    const p = validateBank(j);
    if (p) return { bank: p, year: Number(j.year) || null };
  } catch (e) { /* fallthrough */ }
  return null;
}
function importBank(files) {
  const f = files && files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    const res = parseBankText(String(rd.result));
    if (!res) { alert('导入失败：文件格式不符合题库 schema。请看 README 的提示词模板让 AI 生成标准格式。'); return; }
    let y = res.year;
    if (!y || !Number.isFinite(y) || y < 1000 || y > 9999) y = 9000 + Math.floor(Math.random() * 999);
    const sizeKB = Math.round(JSON.stringify(res.bank).length / 1024);
    if (sizeKB > 4000) { alert('题库过大（' + sizeKB + 'KB），超出浏览器本地存储上限，请拆分后导入'); return; }
    if (customBanks[y] && !confirm(`编号 ${y} 已有题库「${bankLabel(y)}」，将覆盖。继续？`)) return;
    if (!res.bank.label) res.bank.label = '自建题库 ' + y;
    res.bank.year = y;
    customBanks[y] = res.bank;
    try {
      store.set(LS_BANKS, customBanks);
    } catch (e) { alert('本地存储空间不足（浏览器 localStorage 约 5MB），请删除部分题库后重试'); return; }
    route = { view: 'home' };
    render();
  };
  rd.readAsText(f, 'utf-8');
}
function deleteBank(y) {
  if (!confirm(`删除题库「${bankLabel(y)}」？做题记录与错题会保留。`)) return;
  delete customBanks[y];
  store.set(LS_BANKS, customBanks);
  render();
}
// 全局拖拽：仅首页响应；阻止浏览器默认打开文件
document.addEventListener('dragover', e => { if (route.view === 'home') { e.preventDefault(); const z = document.getElementById('dropzone'); if (z) z.classList.add('dragging'); } });
document.addEventListener('dragleave', e => { const z = document.getElementById('dropzone'); if (z && !z.contains(e.relatedTarget)) z.classList.remove('dragging'); });
document.addEventListener('drop', e => {
  const z = document.getElementById('dropzone');
  if (route.view === 'home' || z) e.preventDefault();
  if (z) z.classList.remove('dragging');
  if (route.view !== 'home') return;
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) importBank(e.dataTransfer.files);
});

/* ---------- 路由 ---------- */
function go(view, params) {
  route = { view, ...(params || {}) };
  render();
}
render();
