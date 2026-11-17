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
/* ---------- 章节标签 ---------- */
const DEFAULT_SEC_LABELS = { C: '完形填空', R: '阅读理解', PB: '新题型', T: '翻译', W: '写作' };
const V2_TYPE_LABEL = { single: '选择题', multi: '多选题', judge: '判断题', cloze: '选词填空', blank: '填空题', match: '匹配题', order: '排序题', subjective: '主观题' };
function secLabelsOf(y) {
  const d = dataOf(y) || {};
  return Object.assign({}, DEFAULT_SEC_LABELS, d.secLabels || {});
}
function secName(y, sec, ti) {
  const sl = secLabelsOf(y);
  if (sec === 'R') return sl.R === DEFAULT_SEC_LABELS.R ? `阅读理解 Text ${(ti || 0) + 1}` : `${sl.R} ${(ti || 0) + 1}`;
  if (sl[sec]) return sl[sec];
  const s = bankSections(y).find(x => x.sec === sec && (x.ti || -1) === (ti || -1));
  return s ? s.label : (sec || '');
}

/* ---------- 归一化层：v1（英语二五件套）与 v2（通用 sections）→ 统一内部结构 ----------
   统一 section：{ sec, ti, kind:'quiz'|'self', label, tag, count, desc, qList, material, selfItems }
   统一题目：   { num, stem, opts, answer, analysis, _kind: single|multi|judge|match|blank|order }
   判分规则由 _kind 唯一决定。 */
const asArr = v => Array.isArray(v) ? v : (v ? [v] : []);

function kindFor(q, type, mat) {
  if (Array.isArray(q.answer)) return 'blank';
  const ans = String(q.answer == null ? '' : q.answer);
  const hasOpts = q.opts && Object.keys(q.opts).length;
  if (type === 'multi') return 'multi';
  if (type === 'order') return 'order';
  if (type === 'blank') return 'blank';
  if (type === 'match') return 'match';
  if (type === 'judge') return 'judge';
  if (hasOpts) return ans.length > 1 ? 'multi' : 'single';
  if (mat && mat.options && mat.options.length) return 'match';
  return 'judge';
}
function normQ(q, y, sec, ti, kind) {
  return Object.assign({}, q, { sec, ti, _kind: kind, key: `${y}:${sec}:${ti}:${q.num}` });
}
function mkQuizSec(y, sec, ti, label, tag, desc, qs, mat, qtype) {
  const qList = (qs || []).map(q => normQ(q, y, sec, ti, kindFor(q, qtype, mat)));
  return { sec, ti, kind: 'quiz', label, tag, count: qList.length, desc, qList, material: mat };
}
function normV1(y, d) {
  const secs = [mkQuizSec(y, 'C', -1, secName(y, 'C'), 'Section I',
    d.cloze.questions.length + ' 题 · 语言知识运用', d.cloze.questions,
    { directions: asArr(d.cloze.directions), passage: asArr(d.cloze.passage), blob: d.cloze.analysisBlob || '' }, 'cloze')];
  (d.reading || []).forEach((tx, i) => {
    secs.push(mkQuizSec(y, 'R', i, secName(y, 'R', i), 'Part A',
      (tx.title || '') + ' · ' + tx.questions.length + ' 题', tx.questions,
      { passage: asArr(tx.passage), overview: tx.overview || '', discourse: tx.discourse || '' }, 'single'));
  });
  secs.push(mkQuizSec(y, 'PB', -1, secName(y, 'PB'), 'Part B',
    d.partB.questions.length + ' 题 · ' + ((d.partB.options || []).length ? '选择匹配' : '判断正误'),
    d.partB.questions,
    { directions: asArr(d.partB.directions), options: asArr(d.partB.options), passage: asArr(d.partB.passage), blob: d.partB.analysisBlob || '' }));
  if (d.translation && Array.isArray(d.translation.blocks) && d.translation.blocks.length) {
    secs.push({ sec: 'T', ti: -1, kind: 'self', label: secName(y, 'T') + ' · 自评', tag: 'Section III', count: 1,
      desc: '主观题 · 对照参考答案自评', qList: [],
      selfItems: [{ title: secName(y, 'T') + ' · 题目', directions: d.translation.blocks.slice(0, 2), body: d.translation.blocks.slice(2),
        reference: d.translation.reference || '', analysis: d.translation.analysis || '' }] });
  }
  if (d.writing && Array.isArray(d.writing.small) && d.writing.small.length) {
    secs.push({ sec: 'W', ti: -1, kind: 'self', label: secName(y, 'W') + ' · 自评', tag: 'Section IV', count: 2,
      desc: '主观题 · 对照参考范文自评', qList: [],
      selfItems: [
        { title: secName(y, 'W') + ' Part A', body: asArr(d.writing.small), reference: d.writing.small_ref || '', analysis: '' },
        { title: secName(y, 'W') + ' Part B', body: asArr(d.writing.large), reference: d.writing.large_ref || '', analysis: '' }] });
  }
  return secs;
}
function normV2(y, d) {
  return (d.sections || []).map((s, i) => {
    const t = s.type || '';
    const label = s.title || (V2_TYPE_LABEL[t] || '题目');
    const mat = {
      directions: asArr(s.directions),
      passage: asArr(s.material != null ? s.material : s.passage),
      options: asArr(s.options),
      overview: s.overview || '',
      discourse: s.discourse || '',
      blob: s.analysisBlob || s.blob || '',
    };
    if (t === 'subjective') {
      const items = (Array.isArray(s.questions) ? s.questions : []).map(q => ({
        title: (q.num ? q.num + '. ' : '') + String(q.stem || '主观题').replace(/^\d+[.、．]\s*/, ''),
        directions: asArr(q.directions),
        body: asArr(q.material != null ? q.material : q.body),
        reference: q.reference || (typeof q.answer === 'string' ? q.answer : '') || s.reference || '',
        analysis: q.analysis || s.analysis || '',
      }));
      if (!items.length) items.push({ title: label, directions: mat.directions, body: mat.passage, reference: s.reference || '', analysis: s.analysis || '' });
      return { sec: 'S' + i, ti: -1, kind: 'self', label, tag: '主观题', count: items.length, desc: '主观题 · 对照参考答案自评', qList: [], selfItems: items };
    }
    const first = (s.questions || [])[0] || {};
    return mkQuizSec(y, 'S' + i, -1, label, V2_TYPE_LABEL[t] || '题目',
      (s.questions || []).length + ' 题 · ' + (V2_TYPE_LABEL[kindFor(first, t, mat)] || '客观题'),
      s.questions || [], mat, t);
  });
}
function bankSections(y) {
  const d = dataOf(y);
  if (!d) return [];
  try {
    return Array.isArray(d.sections) ? normV2(y, d) : normV1(y, d);
  } catch (e) { return []; }
}
function findSection(y, sec, ti) {
  return bankSections(y).find(s => s.sec === sec && (s.ti || -1) === (ti || -1)) || null;
}
function getQuestion(y, sec, ti, num) {
  try {
    const s = findSection(y, sec, ti);
    if (!s) return undefined;
    return s.qList.find(q => q.num === num);
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
  let r;
  if (route.view === 'home') r = viewHome();
  else if (route.view === 'paper') r = viewPaper(route.y);
  else if (route.view === 'quiz') r = viewQuiz();
  else if (route.view === 'summary') r = viewSummary();
  else if (route.view === 'wrong') r = viewWrong();
  else if (route.view === 'self') r = viewSelf(route.y, route.sec);
  renderMath(app);
  return r;
}

/* ---------- KaTeX 公式渲染（数学等公式科目；未加载 CDN 时纯文本兜底） ---------- */
function renderMath(root) {
  try {
    if (!window.renderMathInElement || !root) return;
    window.renderMathInElement(root, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '\\(', right: '\\)', display: false },
        { left: '$', right: '$', display: false },
      ],
      throwOnError: false,
      ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option'],
    });
  } catch (e) { /* 公式渲染失败不影响功能 */ }
}
// KaTeX 为 defer 加载，晚于首帧渲染：加载完成后补渲染一次
document.addEventListener('DOMContentLoaded', () => renderMath(app));

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
    <div class="hero"><h1>刷题器 · 通用版</h1>
      <p>内置英语二 2010-2026 真题（解析为 AI 生成）+ AI 演示卷 · 可导入任意科目自建题库（选择题/判断题/主观题自评）</p></div>
    <div class="dropzone" id="dropzone" onclick="document.getElementById('bankfile').click()">
      <b>将题库 .js / .json 文件拖到这里</b>（或点击选择文件）
      <div class="sub">把你手里的原题材料（PDF/Word/照片文字）连同《题库生成规则.md》一起发给 AI，生成的题库拖到这里即可用</div>
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
  return bankSections(y).reduce((n, s) => n + (s.kind === 'quiz' ? s.qList.length : (s.selfItems || []).length), 0);
}

function viewPaper(y) {
  const secs = bankSections(y);
  const rows = secs.map((s, i) => `
    <div class="sec-row" onclick="${s.kind === 'quiz' ? `startQuiz(${y},${i})` : `go('self',{y:${y},sec:'${s.sec}'})`}">
      <span class="tag${s.kind === 'self' ? ' self' : ''}">${esc(s.tag)}</span>
      <div style="flex:1"><h3>${esc(s.label)}</h3><div class="sub">${esc(s.desc)}</div></div>
      <span class="sub">${s.kind === 'self' ? '自评对照 →' : '开始 →'}</span>
    </div>`).join('');
  app.innerHTML = `
    <div class="topbar"><button class="back" onclick="go('home')">← 返回</button>
      <h2>${esc(bankLabel(y))}</h2></div>
    <div class="sec-list">${rows}</div>`;
}

/* ---------- 练习 ---------- */
function startQuiz(y, secIdx) {
  const secs = bankSections(y);
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
  const sec0 = findSection(y, list[0].sec, list[0].ti) || {};
  quiz = {
    y, secIdx: -1, sec: { id: 'W', label: '错题重刷' },
    list, idx: 0, chosen: null, judged: false, correct: 0, results: [], mixed: true,
    matLabel: sec0.label || '材料',
    material: sec0.material || { passage: [] },
  };
  route = { view: 'quiz' };
  render();
}
function materialForMixed(list) {
  const first = list[0];
  const s = findSection(first.year, first.sec, first.ti);
  return s ? s.material : { passage: [] };
}

function materialHTML(m, header) {
  if (!m) return '';
  const det = (t, c) => c ? `<details style="margin-top:12px"><summary style="cursor:pointer;font-size:13px;color:var(--brand)">${t}</summary>
    <div class="analysis">${renderRich(c)}</div></details>` : '';
  let body = '';
  if (m.directions && m.directions.length) body += `<div class="directions">${esc(m.directions.join(' '))}</div>`;
  if (m.options && m.options.length) body += `<div style="margin-bottom:12px">${m.options.map(o => `<div class="pb-opt"><b>[${o.key}]</b> ${esc(o.text)}</div>`).join('')}</div>`;
  if (m.passage && m.passage.length) body += `<div class="passage">${renderPassage(m.passage)}</div>`;
  return `<h3>${esc(header)}</h3>${body}${det('文章总体分析', m.overview)}${det('语篇分析（逐段对照翻译）', m.discourse)}${det('本部分整体解析', m.blob)}`;
}

function viewQuiz() {
  const { y, sec, list, idx } = quiz;
  const q = list[idx];
  const kind = q._kind || 'single';
  const KIND_LABEL = { single: '单选', multi: '多选（选出全部正确项）', order: '排序（按顺序点击选项）',
    judge: '判断正误', match: '从上方选项中选择', blank: '填空（多个可接受答案任填其一）' };

  let opts = [], optLabel = () => '', blankMode = kind === 'blank';
  if (!blankMode) {
    if (q.opts && Object.keys(q.opts).length) {
      opts = Object.keys(q.opts); optLabel = k => q.opts[k];
    } else if (quiz.material.options && quiz.material.options.length) {
      const omap = {}; quiz.material.options.forEach(o => { omap[o.key] = o.text; });
      opts = quiz.material.options.map(o => o.key); optLabel = k => omap[k];
    } else {
      opts = ['T', 'F']; optLabel = k => (k === 'T' ? '正确（True）' : '错误（False）');
    }
  }

  const chosenArr = Array.isArray(quiz.chosen) ? quiz.chosen : null;
  const inChosen = k => chosenArr ? chosenArr.includes(k) : quiz.chosen === k;
  const ansSet = kind === 'multi' ? new Set(String(q.answer).split('')) : null;
  let optsHtml = opts.map(k => {
    let cls = 'opt';
    if (quiz.judged) {
      if (ansSet ? ansSet.has(k) : k === q.answer) cls += ' right';
      else if (inChosen(k)) cls += ' wrong';
    } else if (inChosen(k)) cls += ' chosen';
    return `<button class="${cls}" ${quiz.judged ? 'disabled' : ''} onclick="choose('${k}')">
      <span class="key">${k}.</span> <span>${esc(optLabel(k))}</span></button>`;
  }).join('');

  let verdict = '', anaHtml = '';
  if (quiz.judged) {
    const okFlag = quiz.lastOk;
    const dispAns = kind === 'blank' ? (Array.isArray(q.answer) ? q.answer.join(' / ') : q.answer) : q.answer;
    verdict = `<div class="verdict ${okFlag ? 'ok' : 'bad'}">${okFlag ? '✓ 回答正确' : `✗ 回答错误 · 正确答案 ${esc(String(dispAns))}`}</div>`;
    const blob = quiz.material.blob || '';
    anaHtml = `
      <div class="analysis">${q.analysis ? renderRich(q.analysis)
        : (blob ? '<p style="color:var(--ink2)">该题无逐题解析，请展开下方"本部分整体解析"。</p>' : '<p style="color:var(--ink2)">暂无解析。</p>')}
        ${blob ? `<details class="ana-toggle"><summary style="cursor:pointer;color:var(--brand)">本部分整体解析</summary>
          <div class="analysis">${renderRich(blob)}</div></details>` : ''}
      </div>`;
  }

  const secHeader = quiz.mixed ? (quiz.matLabel || '材料') : sec.label;
  app.innerHTML = `
    <div class="topbar">
      <button class="back" onclick="go(${quiz.mixed ? "'wrong'" : `'paper',{y:${y}}`})">← 返回</button>
      <h2>${quiz.mixed ? '错题重刷' : `${esc(bankLabel(y))} · ${esc(sec.label)}`}</h2>
      <span class="spacer"></span><span class="meta">第 ${idx + 1} / ${list.length} 题 · 已对 ${quiz.correct} 题</span>
    </div>
    <div class="layout">
      <div class="panel">${materialHTML(quiz.material, secHeader)}</div>
      <div class="panel qcard">
        <div class="qnum"><span>${esc(secName(y, q.sec, q.ti) || sec.label)} · 第 ${q.num} 题</span>
          <span>${KIND_LABEL[kind] || '单选'}</span></div>
        <div class="qstem">${esc(q.stem || (kind === 'judge' ? '判断以上说法的正误。' : ''))}</div>
        ${blankMode ? `<input id="blankin" class="blank-input" type="text" ${quiz.judged ? 'disabled' : ''}
          value="${esc(String(quiz.chosen == null ? '' : quiz.chosen))}" oninput="blankType(this.value)" placeholder="在此输入答案">` : ''}
        ${optsHtml ? `<div class="opts">${optsHtml}</div>` : ''}
        ${verdict}
        ${anaHtml}
        <div class="actions">
          ${quiz.judged
            ? `<button class="btn primary" onclick="nextQ()">${idx + 1 < list.length ? '下一题 →' : '查看结果 →'}</button>`
            : `<button class="btn primary" onclick="judge()" ${(!blankMode && (!quiz.chosen || (Array.isArray(quiz.chosen) && !quiz.chosen.length))) ? 'disabled' : ''}>确认答案</button>
               <button class="btn ghost" onclick="reveal()">直接看答案</button>`}
        </div>
      </div>
    </div>`;
}

function choose(k) {
  if (!quiz || quiz.judged) return;
  const q = quiz.list[quiz.idx];
  const kind = q._kind || 'single';
  if (kind === 'multi' || kind === 'order') {
    const arr = Array.isArray(quiz.chosen) ? quiz.chosen.slice() : [];
    const i = arr.indexOf(k);
    if (i >= 0) arr.splice(i, 1); else arr.push(k);
    quiz.chosen = arr;
  } else {
    quiz.chosen = k;
  }
  render();
}
function blankType(v) {
  if (quiz && !quiz.judged) quiz.chosen = v;
}
function scoreOne(q, chosen) {
  const kind = q._kind || 'single';
  if (kind === 'multi') {
    const c = [...new Set(chosen)].sort().join('');
    return { ok: c === [...new Set(String(q.answer).split(''))].sort().join(''), disp: c || '（未选）' };
  }
  if (kind === 'order') {
    const c = chosen.join('');
    return { ok: c === String(q.answer), disp: c || '（未排）' };
  }
  if (kind === 'blank') {
    const norm = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
    const acc = (Array.isArray(q.answer) ? q.answer : [q.answer]).map(norm);
    const c = norm(chosen);
    return { ok: acc.includes(c) && c !== '', disp: c || '（未填）' };
  }
  return { ok: chosen === q.answer, disp: chosen };
}
function judge() {
  if (!quiz || quiz.judged) return;
  const q = quiz.list[quiz.idx];
  const kind = q._kind || 'single';
  if (kind === 'blank' && !String(quiz.chosen == null ? '' : quiz.chosen).trim()) { alert('请先输入答案'); return; }
  if (!quiz.chosen || (Array.isArray(quiz.chosen) && !quiz.chosen.length)) return;
  quiz.judged = true;
  const { ok: okFlag, disp } = scoreOne(q, quiz.chosen);
  quiz.lastOk = okFlag;
  if (okFlag) quiz.correct++;
  quiz.results.push({ q, chosen: disp, ok: okFlag });
  if (!okFlag) {
    wrongBook = wrongBook.filter(w => !(w.y === (q.year || quiz.y) && w.sec === q.sec && w.ti === q.ti && w.num === q.num));
    wrongBook.push({ y: q.year || quiz.y, sec: q.sec, ti: q.ti, num: q.num,
      snippet: (q.stem || '').slice(0, 60), time: Date.now() });
    store.set(LS_WRONG, wrongBook);
  }
  render();
}
function reveal() {
  const q = quiz.list[quiz.idx];
  const kind = q._kind || 'single';
  if (kind === 'multi' || kind === 'order') quiz.chosen = String(q.answer).split('');
  else if (kind === 'blank') quiz.chosen = Array.isArray(q.answer) ? q.answer[0] : q.answer;
  else quiz.chosen = q.answer;
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
      <h2>${mixed ? '错题重刷' : `${esc(bankLabel(y))} · ${esc(sec.label)}`} · 练习结果</h2></div>
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
      <div class="meta">${w.y} · ${esc(secName(w.y, w.sec, w.ti))} · 第 ${w.num} 题</div>
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

/* ---------- 自评（主观题通用） ---------- */
function viewSelf(y, secId) {
  if (!dataOf(y)) {
    app.innerHTML = `<div class="topbar"><button class="back" onclick="go('home')">← 返回</button><h2>自评</h2></div>
      <div class="empty">该题库数据缺失，无法打开自评页。</div>`;
    return;
  }
  const s = bankSections(y).find(x => x.sec === secId && x.kind === 'self');
  const title = (s ? s.label.replace(/ · 自评$/, '') : (secName(y, secId) || '自评')) + ' · 自评对照';
  if (!s || !(s.selfItems || []).length) {
    app.innerHTML = `<div class="topbar"><button class="back" onclick="go('paper',{y:${y}})">← 返回</button><h2>${esc(title)}</h2></div>
      <div class="empty">该题库没有此自评部分。</div>`;
    return;
  }
  const body = s.selfItems.map(it => `
    <div class="panel" style="margin-bottom:16px">
      <h3>${esc(it.title)}</h3>
      ${it.directions && it.directions.length ? `<div class="directions">${esc(it.directions.join(' '))}</div>` : ''}
      <div class="passage" style="margin-bottom:10px">${renderPassage(it.body)}</div>
      ${it.reference ? `<details open><summary style="cursor:pointer;font-size:13px;color:var(--brand)">参考答案 / 答案对照</summary>
        <div class="ref-block">${renderRich(it.reference)}</div></details>` : '<div class="sub">暂无参考答案</div>'}
      ${it.analysis ? `<details style="margin-top:8px"><summary style="cursor:pointer;font-size:13px;color:var(--brand)">解析 / 答案要点</summary>
        <div class="analysis">${renderRich(it.analysis)}</div></details>` : ''}
    </div>`).join('');
  app.innerHTML = `
    <div class="topbar"><button class="back" onclick="go('paper',{y:${y}})">← 返回</button><h2>${y} ${esc(title)}</h2></div>
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
  // v2 通用形态：sections 数组，至少一节含题目或主观题
  if (Array.isArray(p.sections)) {
    const ok = p.sections.some(s => s && ((Array.isArray(s.questions) && s.questions.length) || s.type === 'subjective'));
    return ok ? p : null;
  }
  // v1 形态：英语二五件套
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
