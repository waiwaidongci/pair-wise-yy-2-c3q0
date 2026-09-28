// 页面交互：待消毒笼、可用笼位查询，笼位操作表单，每鸽履历时间线。

export const page = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>运输笼周转台 · 赛鸽登记站</title>
  <style>
    :root { --bg:#eff2f5; --panel:#fff; --ink:#1f2833; --muted:#697786; --line:#d3dce4; --accent:#315f83; --red:#9b3f35; --green:#2f6b3c; --amber:#8a6d1a; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } main { display:grid; grid-template-columns:380px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card,.stat { background:#fff; border:1px solid var(--line); border-radius:8px; padding:16px; } h2 { margin:0 0 12px; font-size:18px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; }
    button.ghost { background:#eef2f5; color:var(--ink); border:1px solid var(--line); }
    button.danger { background:var(--red); }
    button.on { background:var(--ink); }
    .toolbar { display:grid; grid-template-columns:1fr auto; gap:10px; margin-bottom:14px; } .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; }
    .card { display:grid; gap:8px; align-content:start; } .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .section { margin-top:14px; } .relation { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:14px; } .small { background:#f8fafb; border:1px solid var(--line); border-radius:8px; padding:10px; }
    .wide { grid-column:1 / -1; }
    .st-available { background:#e3f1e4; color:var(--green); border-color:#b7d5bd; }
    .st-in_use { background:#e7eef6; color:var(--accent); border-color:#b9ccdd; }
    .st-pending_disinfection { background:#fbf3dd; color:var(--amber); border-color:#e2d29b; }
    .st-pending_review { background:#f1e8f7; color:#6a3f8a; border-color:#d3bde3; }
    .st-disabled { background:#f8e4e1; color:var(--red); border-color:#ddb5af; }
    .bad { color:var(--red); font-size:13px; }
    .filters { display:flex; gap:8px; flex-wrap:wrap; }
    .newcage { display:flex; gap:8px; } .newcage input { width:130px; }
    .timeline { display:grid; gap:8px; margin-top:10px; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} .relation{grid-template-columns:1fr;} .wide{grid-column:auto;} }
  </style>
</head>
<body>
  <header><div><h1>运输笼周转台</h1><div class="meta">足环登记、血统档案 · 笼位周转、消毒复核</div></div><button id="reload">刷新</button></header>
  <main>
    <form id="form">
      <h2>创建鸽只档案</h2>
      <label>足环号</label><input name="ringNo" required>
      <label>鸽主</label><input name="owner" required>
      <label>父鸽足环号</label><input name="fatherRing">
      <label>母鸽足环号</label><input name="motherRing">
      <label>羽色</label><input name="color" required>
      <label>出生棚号</label><input name="loft" required>
      <button>保存档案</button>
    </form>
    <section>
      <div class="toolbar"><input id="search" placeholder="输入足环号查询血统"><button id="searchBtn">查询</button></div>
      <div class="panel" id="detail"></div>
      <div class="section grid" id="cards"></div>
    </section>

    <section class="wide">
      <div class="panel">
        <h2>运输笼周转台</h2>
        <div class="toolbar">
          <div class="filters">
            <button class="ghost on" data-filter="all">全部</button>
            <button class="ghost" data-filter="pending_disinfection">待消毒笼</button>
            <button class="ghost" data-filter="available">可用笼位</button>
            <button class="ghost" data-filter="in_use">使用中</button>
            <button class="ghost" data-filter="pending_review">待复核</button>
            <button class="ghost" data-filter="disabled">停用</button>
          </div>
          <div class="newcage"><input id="newCageId" placeholder="新笼位号 如C-07"><button id="newCageBtn">新增笼位</button></div>
        </div>
        <div class="grid" id="cageCards"></div>
      </div>
      <div class="panel section">
        <h2>每鸽履历</h2>
        <div class="newcage"><input id="histRing" placeholder="输入足环号，如 CHN-2026-001"><button id="histBtn">查询履历</button></div>
        <div id="history"></div>
      </div>
    </section>
  </main>
  <script>
    const form = document.querySelector("#form");
    const cards = document.querySelector("#cards");
    const detail = document.querySelector("#detail");
    const search = document.querySelector("#search");
    const cageCards = document.querySelector("#cageCards");
    const histBox = document.querySelector("#history");
    let pigeons = [];
    let cages = [];
    let cageFilter = "all";

    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers:{ "Content-Type":"application/json" } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "请求失败");
      return data;
    }
    // 状态变更类操作统一弹窗提示失败原因。
    async function act(promise) {
      try { await promise; await load(); } catch (error) { alert(error.message); }
    }
    function postJson(path, payload) {
      return act(api(path, { method:"POST", body: JSON.stringify(payload) }));
    }
    function val(name, id) {
      const el = document.querySelector('[data-'+name+'="'+id+'"]');
      return el ? el.value : "";
    }

    function renderCards() {
      cards.innerHTML = pigeons.map(p => '<article class="card"><h3>'+p.ringNo+'</h3><span class="pill">'+p.owner+'</span><div class="meta">'+p.color+' · '+p.loft+'</div><div>父：'+(p.fatherRing || "未登记")+'</div><div>母：'+(p.motherRing || "未登记")+'</div><label>录入转让</label><input data-to="'+p.ringNo+'" placeholder="新归属人"><button data-transfer="'+p.ringNo+'">保存转让</button><label>归巢成绩</label><input data-race="'+p.ringNo+'" placeholder="赛事/距离/名次，如200公里/200/6"><button data-score="'+p.ringNo+'">保存成绩</button></article>').join("");
      document.querySelectorAll("[data-transfer]").forEach(btn => btn.onclick = () => {
        const ringNo = btn.dataset.transfer;
        postJson('/api/pigeons/'+encodeURIComponent(ringNo)+'/transfers', { to: val("to", ringNo) });
      });
      document.querySelectorAll("[data-score]").forEach(btn => btn.onclick = () => {
        const ringNo = btn.dataset.score; const raw = val("race", ringNo).split("/");
        postJson('/api/pigeons/'+encodeURIComponent(ringNo)+'/races', { event: raw[0] || "未命名赛事", distance: Number(raw[1] || 0), rank: Number(raw[2] || 0) });
      });
    }
    function renderRelation(data) {
      if (!data) { detail.innerHTML = '<h2>血统查询</h2><p class="meta">请输入足环号查看父母、子代、转让和成绩。</p>'; return; }
      const p = data.pigeon;
      detail.innerHTML = '<h2>'+p.ringNo+' 血统档案</h2><div class="relation"><div class="small"><b>父鸽</b><br>'+(data.father?.ringNo || p.fatherRing || "未登记")+'</div><div class="small"><b>本鸽</b><br>'+p.owner+' · '+p.color+'</div><div class="small"><b>母鸽</b><br>'+(data.mother?.ringNo || p.motherRing || "未登记")+'</div></div><div><b>子代</b> '+(data.children.map(c => c.ringNo).join("、") || "暂无")+'</div><div class="meta">转让：'+(p.transfers.map(t => t.from+"→"+t.to).join(" / ") || "暂无")+'</div><div class="meta">归巢：'+(p.races.map(r => r.event+" 第"+r.rank+"名").join(" / ") || "暂无")+'</div>';
    }

    const STATUS_LABEL = { available:"可用", in_use:"使用中", pending_disinfection:"待消毒", pending_review:"待复核", disabled:"停用" };
    const ACTION_LABEL = { create:"建档", load:"装鸽", unload:"卸鸽", move:"换笼", move_out:"换出", move_in:"换入", disinfection:"消毒登记", review:"复核" };
    const REASON_LABEL = { contact_too_short:"药液接触不足十分钟", operator_equals_escort:"操作人与押运人为同一人", review_failed:"次日复核不合格" };

    function renderCages() {
      const shown = cages.filter(c => cageFilter === "all" || c.status === cageFilter);
      cageCards.innerHTML = shown.map(cageCard).join("") || '<p class="meta">没有符合条件的笼位。</p>';
      bindCageActions();
    }
    function cageCard(c) {
      let html = '<article class="card"><h3>'+c.id+' <span class="pill st-'+c.status+'">'+STATUS_LABEL[c.status]+'</span></h3>';
      html += c.occupant ? '<div>在笼足环：<b>'+c.occupant+'</b></div>' : '<div class="meta">笼内无鸽</div>';
      if (c.disinfection) {
        html += '<div class="meta">药液批号：'+c.disinfection.batchNo+'</div>';
        html += '<div class="meta">消毒：'+c.disinfection.startAt+' → '+c.disinfection.endAt+'（接触 '+(c.disinfection.minutes === null ? "?" : Math.round(c.disinfection.minutes))+' 分钟）</div>';
        html += '<div class="meta">操作人 '+c.disinfection.operator+' · 押运人 '+c.disinfection.escort+'</div>';
      }
      if (c.lastFail && c.lastFail.length) html += '<div class="bad">停用原因：'+c.lastFail.map(r => REASON_LABEL[r] || r).join("；")+'</div>';
      html += cageActions(c);
      html += '</article>';
      return html;
    }
    function cageActions(c) {
      const id = c.id;
      if (c.status === "available") {
        return '<label>装鸽足环号</label><input data-load-ring="'+id+'" placeholder="足环号"><label>经办人</label><input data-load-op="'+id+'"><button data-load="'+id+'">装鸽</button>';
      }
      if (c.status === "in_use") {
        const targets = cages.filter(x => x.status === "available");
        const options = targets.map(t => '<option value="'+t.id+'">'+t.id+'</option>').join("");
        return '<label>卸鸽经办人</label><input data-unload-op="'+id+'"><button class="danger" data-unload="'+id+'">卸鸽（进入待消毒）</button>'
          + '<label>换至笼位</label><select data-move-target="'+id+'">'+(options || '<option value="">无可用笼位</option>')+'</select>'
          + '<label>换笼经办人</label><input data-move-op="'+id+'"><button data-move="'+id+'">换笼</button>';
      }
      if (c.status === "pending_disinfection" || c.status === "disabled") {
        return '<label>药液批号</label><input data-batch="'+id+'" placeholder="批号">'
          + '<label>消毒开始时刻</label><input type="datetime-local" data-start="'+id+'">'
          + '<label>消毒结束时刻</label><input type="datetime-local" data-end="'+id+'">'
          + '<label>操作人</label><input data-operator="'+id+'"><label>押运人</label><input data-escort="'+id+'">'
          + '<button data-disinfect="'+id+'">'+(c.status === "disabled" ? "重新登记消毒" : "登记消毒")+'</button>'
          + '<div class="meta">接触不足十分钟，或操作人与押运人相同，笼位继续停用。</div>';
      }
      if (c.status === "pending_review") {
        return '<label>复核日期（须为消毒次日或之后）</label><input type="date" data-reviewdate="'+id+'">'
          + '<label>复核人</label><input data-reviewer="'+id+'">'
          + '<label>复核结论</label><select data-reviewresult="'+id+'"><option value="pass">合格</option><option value="fail">不合格</option></select>'
          + '<button data-review="'+id+'">提交复核</button>';
      }
      return "";
    }
    function bindCageActions() {
      document.querySelectorAll("[data-load]").forEach(btn => btn.onclick = () => {
        const id = btn.dataset.load;
        postJson('/api/cages/'+encodeURIComponent(id)+'/load', { ringNo: val("load-ring", id), operator: val("load-op", id) });
      });
      document.querySelectorAll("[data-unload]").forEach(btn => btn.onclick = () => {
        const id = btn.dataset.unload;
        postJson('/api/cages/'+encodeURIComponent(id)+'/unload', { operator: val("unload-op", id) });
      });
      document.querySelectorAll("[data-move]").forEach(btn => btn.onclick = () => {
        const id = btn.dataset.move;
        postJson('/api/cages/'+encodeURIComponent(id)+'/move', { toCageId: val("move-target", id), operator: val("move-op", id) });
      });
      document.querySelectorAll("[data-disinfect]").forEach(btn => btn.onclick = () => {
        const id = btn.dataset.disinfect;
        postJson('/api/cages/'+encodeURIComponent(id)+'/disinfection', { batchNo: val("batch", id), startAt: val("start", id), endAt: val("end", id), operator: val("operator", id), escort: val("escort", id) });
      });
      document.querySelectorAll("[data-review]").forEach(btn => btn.onclick = () => {
        const id = btn.dataset.review;
        postJson('/api/cages/'+encodeURIComponent(id)+'/review', { date: val("reviewdate", id), reviewer: val("reviewer", id), result: val("reviewresult", id) });
      });
    }

    function renderHistory(data) {
      let html = '<h3>'+data.pigeon.ringNo+'（'+data.pigeon.owner+'）当前笼位：'+(data.currentCage || "不在笼")+'</h3>';
      if (!data.events.length) {
        html += '<p class="meta">暂无笼位履历。</p>';
      } else {
        html += '<div class="timeline">' + data.events.map(e => {
          const place = e.cageId || (e.fromCageId + " → " + e.toCageId);
          return '<div class="small">'+e.at+' · '+(ACTION_LABEL[e.action] || e.action)+' · 笼位 '+place+' · 经办人 '+(e.operator || "—")+'</div>';
        }).join("") + '</div>';
      }
      histBox.innerHTML = html;
    }
    async function showHistory() {
      try { renderHistory(await api('/api/pigeons/'+encodeURIComponent(document.querySelector("#histRing").value)+'/history')); }
      catch (error) { alert(error.message); }
    }

    async function load(){
      pigeons = await api("/api/pigeons");
      cages = await api("/api/cages");
      renderCards(); renderCages(); renderRelation(null);
    }
    document.querySelector("#searchBtn").onclick = async () => {
      try { renderRelation(await api('/api/pigeons/'+encodeURIComponent(search.value)+'/relation')); }
      catch (error) { alert(error.message); }
    };
    document.querySelector("#histBtn").onclick = showHistory;
    document.querySelectorAll("[data-filter]").forEach(btn => btn.onclick = () => {
      cageFilter = btn.dataset.filter;
      document.querySelectorAll("[data-filter]").forEach(b => b.classList.toggle("on", b === btn));
      renderCages();
    });
    document.querySelector("#newCageBtn").onclick = () => {
      const input = document.querySelector("#newCageId");
      postJson('/api/cages', { id: input.value.trim() }).then(() => { input.value = ""; });
    };
    document.querySelector("#reload").onclick = load;
    form.onsubmit = event => {
      event.preventDefault();
      postJson("/api/pigeons", Object.fromEntries(new FormData(form).entries())).then(() => form.reset());
    };
    load();
  </script>
</body>
</html>`;
