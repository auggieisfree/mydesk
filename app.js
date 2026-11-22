// My Desk 폰 (261123). 데이터는 Supabase public.docs(정본). 맥 서버가 켜지면 맥 JSON과 양방향으로 맞춘다.
const CFG = window.MD_CFG;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad = n => String(n).padStart(2, "0");
const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const parseYmd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d) };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x };
const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()) };
const TD = () => ymd(today());
const WD = "일월화수목금토";
const monOf = d => addDays(d, -((d.getDay() + 6) % 7));
const sunOf = d => addDays(d, -d.getDay());
const isoWeek = d => { const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const n = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - n); const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1)); return { w: Math.ceil(((x - y0) / 864e5 + 1) / 7), y: x.getUTCFullYear() } };
const wkKey = d => { const k = isoWeek(d); return k.y + "-W" + pad(k.w) };
const fmtMD = s => { const d = parseYmd(s); return (d.getMonth() + 1) + "/" + d.getDate() + " " + WD[d.getDay()] };
const rid = () => [...crypto.getRandomValues(new Uint8Array(5))].map(b => b.toString(16).padStart(2, "0")).join("");
const nowIso = () => new Date().toISOString();
const toM = s => { const [h, m] = String(s).split(":").map(Number); return h * 60 + (m || 0) };
const fromM = m => pad(Math.floor(m / 60) % 24) + ":" + pad(m % 60);
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch (e) { return d } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) {} };
let toastT; function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2000) }

// ───── 로그인 (이메일+비밀번호, 토큰은 이 폰에만)
const AUTH = { s: lsGet("md.auth", null) };
async function authReq(grant, body) {
  const r = await fetch(`${CFG.url}/auth/v1/token?grant_type=${grant}`, { method: "POST", headers: { apikey: CFG.anon, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error_description || j.msg || "로그인 실패");
  AUTH.s = { at: j.access_token, rt: j.refresh_token, exp: Date.now() + (j.expires_in - 60) * 1000 }; lsSet("md.auth", AUTH.s); return AUTH.s;
}
async function token() {
  if (!AUTH.s) throw new Error("login");
  if (Date.now() > AUTH.s.exp) { try { await authReq("refresh_token", { refresh_token: AUTH.s.rt }) } catch (e) { logout(); throw new Error("login") } }
  return AUTH.s.at;
}
function logout() { AUTH.s = null; try { localStorage.removeItem("md.auth") } catch (e) {} render() }

// ───── 데이터 (docs: col,id,data,deleted)
async function rest(method, path, body, prefer) {
  const t = await token();
  const h = { apikey: CFG.anon, Authorization: "Bearer " + t, "Content-Type": "application/json" }; if (prefer) h.Prefer = prefer;
  const r = await fetch(CFG.url + "/rest/v1" + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { logout(); throw new Error("login") }
  if (!r.ok) throw new Error(r.status + " " + (await r.text()).slice(0, 120));
  const tx = await r.text(); return tx ? JSON.parse(tx) : null;
}
const COLS = ["tasks", "plan", "weektodo", "habits", "swim", "events"];
const S = { tasks: [], plan: [], weektodo: [], habits: [], swim: [], events: {}, loaded: false, at: null, err: null };
async function loadAll() {
  try {
    const rows = await rest("GET", `/docs?select=col,id,data&deleted=eq.false&col=in.(${COLS.join(",")})&limit=5000`);
    const g = {}; COLS.forEach(c => g[c] = []);
    rows.forEach(r => g[r.col].push(Object.assign({ id: r.id }, r.data)));
    S.tasks = g.tasks; S.plan = g.plan; S.weektodo = g.weektodo.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    S.habits = g.habits.sort((a, b) => (a.order || 0) - (b.order || 0)); S.swim = g.swim;
    S.events = (g.events.find(x => x.id === "cache")) || {};
    S.loaded = true; S.err = null; S.at = Date.now();
  } catch (e) { if (e.message !== "login") S.err = "불러오지 못했어요" }
  render();
}
const strip = o => { const { id, ...rest } = o; return rest };
// 일부 고치기(맥 PATCH와 같음: 맨 위 키만 합침)
async function patch(col, id, obj) {
  const x = (S[col] || []).find(d => d.id === id); if (x) Object.assign(x, obj); render();
  try { await rest("POST", "/rpc/patch_doc", { p_col: col, p_id: id, p_patch: obj }) } catch (e) { fail(e) }
}
async function put(col, id, doc) {
  const arr = S[col]; const i = arr.findIndex(d => d.id === id); const o = Object.assign({ id }, doc); if (i >= 0) arr[i] = o; else arr.push(o); render();
  try { await rest("POST", "/docs?on_conflict=col,id", [{ col, id, data: doc, deleted: false }], "resolution=merge-duplicates,return=minimal") } catch (e) { fail(e) }
  return id;
}
const add = (col, doc) => put(col, rid(), doc);
async function del(col, id) {
  S[col] = S[col].filter(d => d.id !== id); render();
  try { await rest("PATCH", `/docs?col=eq.${col}&id=eq.${encodeURIComponent(id)}`, { deleted: true }, "return=minimal") } catch (e) { fail(e) }
}
function fail(e) { if (e.message === "login") return; toast("저장하지 못했어요"); loadAll() }
const later = (() => { const T = {}; return (k, fn, ms) => { clearTimeout(T[k]); T[k] = setTimeout(fn, ms) } })();

// ───── 공통
const WORK_RE=/남유|베리아워|아이보들|아포테|프릭|무브랩|루솜|f45|프사오|프리워킹|아로마케미|워크덴|굿띵스|광고|소재|기획|리포트|보고|세팅|캠페인|메타|네이버|구글|gfa|예산|정산|견적|세금계산서|광고주|대표|회의|미팅|공지|피드백|컨펌|소구|카피|촬영|상세페이지|올영|입점|매체|성과|분석|제안|발주|업체|클라이언트|메일 회신/i;
const isDone = t => t.status === "done";
const isPersonal = t => t.scope ? t.scope === "personal" : t.client === "개인" ? true : t.client && t.client !== "기타" && t.client !== "Inbox" ? false : !WORK_RE.test(t.title || "");
const hOn = (h, d) => (h.days || "월화수목금토일").includes(WD[d.getDay()]);
const hDone = (h, k) => !!(h.log || {})[k];
const HG = { 몸: "#4CAF50", 콘텐츠: "#E8833A", 머니: "#CA8A04", 공부: "#7C5CE0", 생활: "#2B7FFF" };
const hColor = h => h.color || HG[h.group] || "#4CAF50";
const U = Object.assign({ tab: "day" }, lsGet("md.ui", {}), { anchor: today() });
const saveUI = () => lsSet("md.ui", { tab: U.tab });
const cb = (on, act, id, extra = "", c = "") => `<button class="cb ${on ? "done" : ""}" ${c ? `style="--c:${c}"` : ""} data-act="${act}" data-id="${esc(id)}" ${extra}></button>`;
const navHtml = () => `<div class="nav"><button data-act="nav" data-v="-1">‹</button><button data-act="nav" data-v="0">오늘</button><button data-act="nav" data-v="1">›</button></div>`;

// ───── Day
function evsOn(k) {
  const d0 = parseYmd(k), d1 = addDays(d0, 1);
  return (S.events.events || []).filter(e => { const s = new Date(e.start), en = new Date(e.end); return s < d1 && (e.allDay ? en > d0 : en > d0 || +s === +d0) });
}
function timeline(k) {
  const L = [];
  const hm = iso => { const d = new Date(iso); return pad(d.getHours()) + ":" + pad(d.getMinutes()) };
  evsOn(k).filter(e => !e.allDay).forEach(e => L.push({ k: "ev", s: new Date(e.start) < parseYmd(k) ? "00:00" : hm(e.start), e: hm(e.end), t: e.title, c: e.color }));
  S.plan.filter(x => x.date === k && x.start).forEach(x => L.push({ k: "pl", id: x.id, s: x.start, e: x.end || "", t: x.title, c: x.client === "개인" ? "#E0A800" : "#2B7FFF" }));
  S.tasks.filter(t => t.due === k && t.at).forEach(t => L.push({ k: "tk", id: t.id, s: t.at, e: fromM(toM(t.at) + (t.dur || 60)), t: t.title, c: isPersonal(t) ? "#E0A800" : "#2B7FFF", done: isDone(t) }));
  return L.sort((a, b) => a.s.localeCompare(b.s) || a.e.localeCompare(b.e));
}
function taskRow(t, showDue) {
  return `<div class="it ${isDone(t) ? "done" : ""}">${cb(isDone(t), "tk", t.id, "", isPersonal(t) ? "#E0A800" : "#2B7FFF")}<span class="t">${esc(t.title)}</span>${showDue && t.due ? `<span class="dd">${fmtMD(t.due)}</span>` : t.at ? `<span class="dd">${t.at}</span>` : ""}</div>`;
}
function renderDay() {
  const d = U.anchor, k = ymd(d), isT = k === TD();
  const nowM = new Date().getHours() * 60 + new Date().getMinutes();
  const ad = evsOn(k).filter(e => e.allDay);
  const tl = timeline(k);
  const tlHtml = tl.map(x => { const now = isT && toM(x.s) <= nowM && nowM < toM(x.e || x.s);
    return `<div class="tl ${x.k === "ev" ? "ev" : ""} ${now ? "now" : ""}" ${x.k !== "ev" ? `data-act="blk" data-k="${x.k}" data-id="${esc(x.id)}"` : ""}><span class="tm">${x.s}${x.e ? "–" + x.e : ""}</span><i class="bar" style="--c:${x.c || "#C3C7CE"}"></i><span class="t" ${x.done ? 'style="color:var(--faint);text-decoration:line-through"' : ""}>${esc(x.t)}</span></div>` }).join("");
  const tk = S.tasks.filter(t => t.due === k && !t.routineId);
  const grp = (name, f, scope) => { const ls = tk.filter(f).sort((a, b) => isDone(a) - isDone(b));
    return `<div class="sec">${name}<small>${ls.filter(isDone).length}/${ls.length}</small></div><div class="card">${ls.map(t => taskRow(t)).join("")}<input class="add" data-add="task" data-scope="${scope}" placeholder="+ 추가"></div>` };
  const hs = S.habits.filter(h => hOn(h, d));
  const rts = S.tasks.filter(t => t.routineId && t.due === k);
  const od = isT ? S.tasks.filter(t => !isDone(t) && t.due && t.due < k && !t.routineId).sort((a, b) => a.due.localeCompare(b.due)) : [];
  return `<div class="hd"><div><small>${d.getFullYear()} · ${WD[d.getDay()]}요일</small><h1>${isT ? "오늘" : ""} ${d.getMonth() + 1}/${d.getDate()}</h1></div>${navHtml()}</div>
  ${ad.length ? `<div class="chips">${ad.map(e => `<span class="chip">${esc(e.title)}</span>`).join("")}</div>` : ""}
  <div class="sec">시간표<button data-act="blk-new" style="color:var(--muted);font-weight:600">+ 블록</button></div>
  <div class="card">${tlHtml || `<div class="it"><span class="t" style="color:var(--muted)">비어 있음</span></div>`}</div>
  ${hs.length ? `<div class="sec">루틴</div><div class="card">${hs.map(h => `<div class="it ${hDone(h, k) ? "done" : ""}">${cb(hDone(h, k), "hb", h.id, `data-d="${k}"`, hColor(h))}<span class="t">${esc(h.title)}</span></div>`).join("")}</div>` : ""}
  ${grp("굿띵스커밍", t => !isPersonal(t), "work")}${grp("개인", isPersonal, "personal")}
  ${rts.length ? `<div class="sec">정기 업무</div><div class="card">${rts.map(t => taskRow(t)).join("")}</div>` : ""}
  ${od.length ? `<div class="sec" style="color:var(--red)">밀린 일 ${od.length}</div><div class="card">${od.slice(0, 15).map(t => taskRow(t, true)).join("")}</div>` : ""}`;
}
function blockSheet(kind, id) {
  const k = ymd(U.anchor);
  const x = kind === "pl" ? S.plan.find(p => p.id === id) : kind === "tk" ? S.tasks.find(t => t.id === id) : null;
  const s = kind === "tk" ? x.at : x ? x.start : fromM(Math.min(23 * 60, Math.ceil((new Date().getHours() * 60 + new Date().getMinutes()) / 30) * 30));
  const e = kind === "tk" ? fromM(toM(x.at) + (x.dur || 60)) : x ? (x.end || fromM(toM(x.start) + 60)) : fromM(toM(s) + 60);
  sheet(`<h3>${kind === "tk" ? esc(x.title) : `<input class="inp" id="bt" value="${esc(x ? x.title : "")}" placeholder="제목">`}</h3>
   <div class="fld"><div><label>시작</label><input type="time" id="bs" value="${s}"></div><div><label>끝</label><input type="time" id="be" value="${e}"></div></div>
   <div class="fld" style="grid-template-columns:1fr"><div><label>날짜</label><input type="date" id="bd" value="${kind === "tk" ? x.due : x ? x.date : k}"></div></div>
   <div class="btns">${x ? `<button class="btn red" data-act="blk-del" data-k="${kind}" data-id="${esc(id)}">${kind === "tk" ? "시간 빼기" : "삭제"}</button>` : ""}<button class="btn dark" data-act="blk-save" data-k="${kind}" data-id="${esc(id || "")}">저장</button></div>`);
}
async function blockSave(kind, id) {
  const s = $("#bs").value, e = $("#be").value, d = $("#bd").value;
  if (!s || !d) return; const dur = e ? toM(e) - toM(s) : 60;
  if (e && dur < 15) { toast("끝이 시작보다 늦어야 해요"); return }
  const title = ($("#bt")?.value || "").trim();
  closeSheet();
  if (kind === "tk") return patch("tasks", id, { at: s, dur, due: d });
  if (kind === "pl") return patch("plan", id, { start: s, end: e, date: d, ...(title ? { title } : {}) });
  if (!title) return;
  return add("plan", { date: d, start: s, end: e, title, client: "개인", taskId: null });
}

// ───── Week (이번 주 할 일: data/weektodo, 못 끝낸 건 다음 주에도 남음)
const weekTodoOf = wk => S.weektodo.filter(x => x.week === wk || (x.week < wk && (!x.done || x.doneWeek === wk)));
function renderWeek() {
  const m = monOf(U.anchor), wk = wkKey(m), items = weekTodoOf(wk);
  const k0 = ymd(m), k6 = ymd(addDays(m, 6));
  const due = S.tasks.filter(t => t.due >= k0 && t.due <= k6 && !t.routineId && !isDone(t)).sort((a, b) => a.due.localeCompare(b.due) || (a.at || "").localeCompare(b.at || ""));
  return `<div class="hd"><div><small>${wk.replace("-W", " · W")}</small><h1>${m.getMonth() + 1}/${m.getDate()} – ${addDays(m, 6).getMonth() + 1}/${addDays(m, 6).getDate()}</h1></div>${navHtml()}</div>
  <div class="sec">이번 주 할 일<small>${items.filter(x => x.done).length}/${items.length}</small></div>
  <div class="card">${items.map(x => `<div class="it ${x.done ? "done" : ""}">${cb(x.done, "wt", x.id, `data-wk="${wk}"`, x.client === "개인" || (!x.client && !WORK_RE.test(x.title)) ? "#E0A800" : "#2B7FFF")}<span class="t">${esc(x.title)}${x.week < wk ? ` <small style="color:var(--muted)">지난주</small>` : ""}</span><button class="x" data-act="wt-del" data-id="${esc(x.id)}">✕</button></div>`).join("")}<input class="add" data-add="wt" data-wk="${wk}" placeholder="+ 추가"></div>
  ${due.length ? `<div class="sec">마감 남은 일<small>${due.length}</small></div><div class="card">${due.map(t => taskRow(t, true)).join("")}</div>` : ""}`;
}

// ───── Swim (일요일 시작 주)
const swDocs = t => S.swim.filter(x => x.type === t);
const setDist = s => (+s.reps || 1) * (+s.dist || 0);
const planDist = x => (x.sets || []).reduce((a, s) => a + setDist(s), 0);
const realDist = x => x.done ? (+(x.log || {}).dist || planDist(x)) : 0;
const fmtM = m => m >= 1000 ? (m / 1000).toFixed(m % 1000 ? 1 : 0) + "km" : m + "m";
const sName = st => String(st.note || "").split(" · ")[0];
const sCue = st => String(st.note || "").split(" · ").slice(1).join(" · ");
const swFocus = x => x.focus || String(x.title || "").replace(/^[LF]\s*·\s*/, "").replace(/^발차기\s*\+\s*/, "").replace(/\s*[①②③④⑤]\s*$/, "") || "훈련";
function swLines(x) { const sets = (x.sets || []).filter(st => +st.dist > 0 || (+st.reps || 1) > 1); const groups = [];
  sets.forEach(st => { const lb = st.label || "세트"; let g = groups[groups.length - 1]; if (!g || g.label !== lb) { g = { label: lb, sets: [] }; groups.push(g) } g.sets.push(st) });
  groups.forEach(g => { g.main = g.sets.some(st => st.main || /^\dR\b/.test(sName(st))); g.lines = [];
    g.sets.forEach(st => { const prev = g.lines[g.lines.length - 1], one = (+st.reps || 1) === 1;
      if (!g.main && one && prev && prev.merge && prev.dist === +st.dist) prev.sets.push(st); else g.lines.push({ key: st.id, dist: +st.dist, merge: !g.main && one, sets: [st] }) }) });
  return groups }
function renderSwim() {
  const s = sunOf(U.anchor), k0 = ymd(s), k1 = ymd(addDays(s, 6));
  const st = S.swim.find(x => x.id === "settings") || {}, goal = +st.weeklyGoal || 0;
  const wk = swDocs("session").filter(x => x.date >= k0 && x.date <= k1).sort((a, b) => a.date.localeCompare(b.date));
  const done = wk.reduce((a, x) => a + realDist(x), 0), plan = wk.reduce((a, x) => a + planDist(x), 0);
  const wfk = "wf-" + wkKey(addDays(s, 1)), wf = S.swim.find(z => z.id === wfk) || {};
  return `<div class="hd"><div><small>Swim</small><h1>${s.getMonth() + 1}/${s.getDate()} – ${addDays(s, 6).getMonth() + 1}/${addDays(s, 6).getDate()}</h1></div>${navHtml()}</div>
  <div class="goal"><b>${fmtM(done)}</b> <span>/ ${goal ? fmtM(goal) : "-"} · 계획 ${fmtM(plan)}</span><div class="barw"><i style="width:${goal ? Math.min(100, Math.round(done / goal * 100)) : 0}%"></i></div></div>
  <div class="sec">훈련</div>
  <div class="card">${wk.map(x => `<div class="it ${x.done ? "done" : ""}">${cb(x.done, "sw-done", x.id, "", "#0891B2")}<span class="t" data-act="sw-open" data-id="${esc(x.id)}">${esc(swFocus(x))}</span><span class="dd">${fmtMD(x.date)} · ${fmtM(planDist(x))}</span></div>`).join("") || `<div class="it"><span class="t" style="color:var(--muted)">없음</span></div>`}</div>
  <div class="sec">이번 주 포인트</div>
  <div class="card">${["접영", "배영", "평영", "자유형"].map(k => `<div class="wf"><span>${k}</span><input data-wf="${k}" data-wfk="${wfk}" value="${esc((wf.points || {})[k] || "")}"></div>`).join("")}</div>`;
}
function swSheet(id) {
  const x = S.swim.find(d => d.id === id); if (!x) return; const chk = x.checks || {}, g = x.log || {};
  const doneD = swLines(x).flatMap(gr => gr.lines).filter(l => chk[l.key]).reduce((a, l) => a + l.sets.reduce((b, st) => b + setDist(st), 0), 0);
  const line = l => { const st = l.sets[0], n = l.sets.length, on = !!chk[l.key];
    const nm = n > 1 ? l.sets.map(s2 => sName(s2).replace(/^킥판\s*/, "")).join(" · ") : sName(st), cue = n > 1 ? "" : sCue(st);
    const dn = n > 1 ? `${n}×${l.dist}` : ((+st.reps || 1) > 1 ? `${st.reps}×${st.dist}` : st.dist);
    return `<div class="sl ${on ? "on" : ""}" data-act="sw-l" data-id="${esc(id)}" data-k="${esc(l.key)}"><span class="cb ${on ? "done" : ""}"></span><span class="d">${dn}</span><span class="n">${esc(nm)}${cue ? `<div class="c">${esc(cue)}</div>` : ""}</span></div>` };
  sheet(`<h3>${cb(x.done, "sw-done", id, "", "#0891B2")}<span>${esc(swFocus(x))}</span></h3>
   <div class="meta">${fmtMD(x.date)} · ${fmtM(doneD)} / ${fmtM(planDist(x))}</div>
   ${swLines(x).map(gr => `<div class="sg ${gr.main ? "main" : ""}"><div class="sg-h"><span>${esc(gr.label)}</span><span>${fmtM(gr.sets.reduce((a, st) => a + setDist(st), 0))}</span></div>${gr.lines.map(line).join("")}</div>`).join("")}
   <textarea class="inp" data-swnote="${esc(id)}" rows="3" placeholder="메모" style="margin-top:14px;resize:vertical">${esc(g.note || "")}</textarea>`, id);
}

// ───── 시트·화면
let sheetId = null;
function sheet(html, id = null) { sheetId = id; $("#layer").innerHTML = `<div class="sheet-bg" data-act="close"></div><div class="sheet"><div class="grab"></div>${html}</div>` }
function closeSheet() { sheetId = null; $("#layer").innerHTML = "" }
function render() {
  const app = $("#app");
  if (!AUTH.s) { $("#tabs").hidden = true; closeSheet();
    app.innerHTML = `<form class="login" id="login"><h1>My Desk</h1><input class="inp" type="email" id="em" autocomplete="username" placeholder="이메일"><input class="inp" type="password" id="pw" autocomplete="current-password" placeholder="비밀번호"><button class="btn dark">로그인</button><div class="err" id="lerr"></div></form>`; return }
  $("#tabs").hidden = false;
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === U.tab));
  if (!S.loaded) { app.innerHTML = `<div class="off">${S.err || "불러오는 중"}</div>`; return }
  const ae = document.activeElement, keep = ae && ae.matches && ae.matches("#app input") ? { sel: ae.dataset.add ? `[data-add="${ae.dataset.add}"][data-scope="${ae.dataset.scope || ""}"]` : ae.dataset.wf ? `[data-wf="${ae.dataset.wf}"]` : null, v: ae.value } : null;
  app.innerHTML = (U.tab === "week" ? renderWeek() : U.tab === "swim" ? renderSwim() : renderDay()) + `<div class="off">${S.err ? S.err + " · " : ""}<button data-act="logout" style="color:var(--faint)">로그아웃</button></div>`;
  if (keep && keep.sel) { const el = $(keep.sel.replace('[data-scope=""]', "")); if (el) { el.value = keep.v; el.focus() } }
  if (sheetId && U.tab === "swim" && $("#layer").innerHTML && !$("#layer textarea:focus")) swSheet(sheetId);
}

// ───── 입력
document.addEventListener("submit", async e => {
  if (e.target.id !== "login") return; e.preventDefault();
  try { await authReq("password", { email: $("#em").value.trim(), password: $("#pw").value }); render(); loadAll() }
  catch (x) { $("#lerr").textContent = "이메일 또는 비밀번호가 맞지 않아요" }
});
document.addEventListener("click", async e => {
  const tb = e.target.closest("#tabs button"); if (tb) { U.tab = tb.dataset.tab; U.anchor = today(); saveUI(); window.scrollTo(0, 0); render(); return }
  const el = e.target.closest("[data-act]"); if (!el) return; const a = el.dataset.act, id = el.dataset.id;
  switch (a) {
    case "close": closeSheet(); return;
    case "logout": if (confirm("로그아웃할까요?")) logout(); return;
    case "nav": { const v = +el.dataset.v, step = U.tab === "day" ? 1 : 7; U.anchor = v ? addDays(U.anchor, v * step) : today(); render(); return }
    case "tk": { const t = S.tasks.find(x => x.id === id); if (!t) return; const on = !isDone(t); return patch("tasks", id, { status: on ? "done" : "todo", doneAt: on ? TD() : null }) }
    case "hb": { const h = S.habits.find(x => x.id === id); if (!h) return; const log = { ...(h.log || {}) }; if (log[el.dataset.d]) delete log[el.dataset.d]; else log[el.dataset.d] = true; return patch("habits", id, { log }) }
    case "wt": { const x = S.weektodo.find(y => y.id === id); if (!x) return; const on = !x.done; return patch("weektodo", id, { done: on, doneWeek: on ? el.dataset.wk : null, doneAt: on ? nowIso() : null }) }
    case "wt-del": if (confirm("지울까요?")) return del("weektodo", id); return;
    case "blk": return blockSheet(el.dataset.k, id);
    case "blk-new": return blockSheet("new", null);
    case "blk-save": return blockSave(el.dataset.k, id);
    case "blk-del": closeSheet(); return el.dataset.k === "tk" ? patch("tasks", id, { at: null, dur: null }) : del("plan", id);
    case "sw-open": return swSheet(id);
    case "sw-done": { e.stopPropagation(); const x = S.swim.find(d => d.id === id); if (!x) return; const done = !x.done, o = { done }; if (done && !(x.log || {}).dist) o.log = { ...(x.log || {}), dist: planDist(x) || "" }; await patch("swim", id, o); if (sheetId) swSheet(sheetId); return }
    case "sw-l": { const x = S.swim.find(d => d.id === id); if (!x) return; const checks = { ...(x.checks || {}) }, k = el.dataset.k; if (checks[k]) delete checks[k]; else checks[k] = true;
      const dist = swLines({ ...x, checks }).flatMap(gr => gr.lines).filter(l => checks[l.key]).reduce((s, l) => s + l.sets.reduce((b, st) => b + setDist(st), 0), 0);
      const p = patch("swim", id, { checks, log: { ...(x.log || {}), dist: dist || "" } }); swSheet(id); return p }
  }
});
document.addEventListener("keydown", async e => {
  const el = e.target; if (e.key !== "Enter" || e.isComposing || e.keyCode === 229 || !el.dataset || !el.dataset.add) return;
  e.preventDefault(); const v = el.value.trim(); if (!v) return; el.value = "";
  if (el.dataset.add === "task") { const pers = el.dataset.scope === "personal";
    return add("tasks", { title: v, client: pers ? "개인" : "기타", scope: el.dataset.scope, status: "todo", priority: "normal", due: ymd(U.anchor), note: "", createdAt: nowIso(), doneAt: null }) }
  if (el.dataset.add === "wt") return add("weektodo", { title: v, client: WORK_RE.test(v) ? "기타" : "개인", week: el.dataset.wk, done: false, doneWeek: null, createdAt: nowIso(), doneAt: null });
});
document.addEventListener("input", e => {
  const el = e.target;
  if (el.dataset.wf) { const k = el.dataset.wfk; later("wf", () => { const cur = S.swim.find(z => z.id === k) || {}; const points = { ...(cur.points || {}) }; document.querySelectorAll(`[data-wfk="${k}"]`).forEach(i => points[i.dataset.wf] = i.value); put("swim", k, { type: "weekfocus", points }) }, 700); return }
  if (el.dataset.swnote) { const id = el.dataset.swnote; later("swn", () => { const x = S.swim.find(d => d.id === id); if (x) patch("swim", id, { log: { ...(x.log || {}), note: el.value } }) }, 700) }
});
// 열 때·돌아올 때·30초마다 새로
document.addEventListener("visibilitychange", () => { if (!document.hidden && AUTH.s) loadAll() });
setInterval(() => { if (!document.hidden && AUTH.s && !document.activeElement?.matches("input,textarea")) loadAll() }, 30000);
render(); if (AUTH.s) loadAll();
