// ============================================================
// QUANT STRATEGY MODULE — Correl Tracker (Blocks 1/2/3)
// Loaded dynamically by Index.html into #quantStrategyMount.
// Relies on globals already defined in the main page: FINANCIALS_URL,
// fmt(), cleanTicker(), sortFinRows(), openTickerChart().
// Exposes window.renderQuantStrategy() as its entry point.
// ============================================================

const CORREL_BLOCK1_URL = FINANCIALS_URL.replace("financials_baskets.json", "financials_correl_block1.json");
const CORREL_BLOCK2_URL = FINANCIALS_URL.replace("financials_baskets.json", "financials_correl_block2.json");
const CORREL_BLOCK3_URL = FINANCIALS_URL.replace("financials_baskets.json", "financials_correl_block3.json");

let finCorrel1Data = null, finCorrel2Data = null, finCorrel3Data = null;
let finCorrel1UpSort = { key: "Corr_Delta", dir: 1 };
let finCorrel1DownSort = { key: "Corr_Delta", dir: 1 };
let finCorrel2FragSort = { key: "Cohesion_Delta", dir: 1 };
let finCorrel2ConvSort = { key: "Cohesion_Delta", dir: -1 };
let finCorrel3RisingSort = { key: "Corr_Delta", dir: -1 };
let finCorrel3FallingSort = { key: "Corr_Delta", dir: 1 };

const QUANT_STOCK_TOP_N = 5;
const QUANT_COHESION_TOP_N = 5;
const QUANT_PAIR_TOP_N = 3;

async function renderQuantStrategy(){
  try{
    const [c1Res, c2Res, c3Res] = await Promise.all([
      fetch(CORREL_BLOCK1_URL, {cache:"no-store"}),
      fetch(CORREL_BLOCK2_URL, {cache:"no-store"}),
      fetch(CORREL_BLOCK3_URL, {cache:"no-store"}),
    ]);
    finCorrel1Data = c1Res.ok ? await c1Res.json() : null;
    finCorrel2Data = c2Res.ok ? await c2Res.json() : null;
    finCorrel3Data = c3Res.ok ? await c3Res.json() : null;
  }catch(err){
    finCorrel1Data = finCorrel2Data = finCorrel3Data = null;
  }

  renderQuantCaption();
  renderFinCorrel1Tables();
  renderFinCorrel2Tables();
  renderFinCorrel3Tables();
  attachQuantEventListeners();
}
window.renderQuantStrategy = renderQuantStrategy;

function renderQuantCaption(){
  const el = document.getElementById("quantAsOfCaption");
  if(!el) return;
  if(!finCorrel1Data){ el.textContent = ""; return; }
  const asOf = finCorrel1Data.as_of || "—";
  const thresh = finCorrel1Data.flag_threshold;
  el.textContent = thresh !== null && thresh !== undefined
    ? `As of ${asOf} · flagged when Corr Δ ≤ ${thresh.toFixed(2)} (bottom ${(finCorrel1Data.flag_percentile*100).toFixed(0)}% today) · Windows: ${finCorrel1Data.window_short}D / ${finCorrel1Data.window_long}D`
    : `As of ${asOf}`;
}

// ---- Shared row/card renderers for Block 1 (Up / Down) ----
function renderStockRows(rows){
  return rows.map(r => `
    <tr class="fin-table-row-clickable" data-ticker="${r.Ticker}">
      <td class="ticker">${cleanTicker(r.Ticker)}</td>
      <td>${r.Theme}</td>
      <td class="num">${fmt(r.Corr_20D,2)}</td>
      <td class="num">${fmt(r.Corr_60D,2)}</td>
      <td class="num ${r.Corr_Delta<0?'fin-val-neg':'fin-val-pos'}">${fmt(r.Corr_Delta,2)}</td>
      <td class="num">${(r.Stock_Ret_20D>=0?'+':'')+fmt(r.Stock_Ret_20D*100,1)}%</td>
      <td class="num">${(r.Basket_Ret_20D>=0?'+':'')+fmt(r.Basket_Ret_20D*100,1)}%</td>
    </tr>`).join("");
}
function renderStockCards(rows){
  return rows.map(r => `
    <div class="card fin-table-row-clickable" data-ticker="${r.Ticker}">
      <div class="card-top">
        <div>
          <div class="card-ticker">${cleanTicker(r.Ticker)}</div>
          <div class="card-name">${r.Theme}</div>
        </div>
        <div>
          <div class="card-score ${r.Corr_Delta<0?'fin-val-neg':'fin-val-pos'}">${fmt(r.Corr_Delta,2)}</div>
          <div class="card-score-label">Corr Δ</div>
        </div>
      </div>
      <div class="card-meta">
        <span>Corr 20D <b>${fmt(r.Corr_20D,2)}</b></span>
        <span>Corr 60D <b>${fmt(r.Corr_60D,2)}</b></span>
        <span>Stock Ret 20D <b>${(r.Stock_Ret_20D>=0?'+':'')+fmt(r.Stock_Ret_20D*100,1)}%</b></span>
        <span>Basket Ret 20D <b>${(r.Basket_Ret_20D>=0?'+':'')+fmt(r.Basket_Ret_20D*100,1)}%</b></span>
      </div>
    </div>`).join("");
}

function renderFinCorrel1Tables(){
  const upBody = document.getElementById("finCorrel1UpBody");
  const upCards = document.getElementById("finCorrel1UpCards");
  const downBody = document.getElementById("finCorrel1DownBody");
  const downCards = document.getElementById("finCorrel1DownCards");
  if(!upBody || !downBody) return;

  const full = (finCorrel1Data && finCorrel1Data.full) ? finCorrel1Data.full : [];
  // Exclude "Other Financials" from ranked views (miscellaneous bucket,
  // same exclusion the backend already applies to finCorrel1Data.ranked --
  // filtering full here too since we need Up/Down split which ranked
  // doesn't provide pre-split).
  const eligible = full.filter(r => r.Theme !== "Other Financials");

  const upAll = eligible.filter(r => r.Corr_Delta < 0 && r.Stock_Ret_20D > r.Basket_Ret_20D)
    .sort((a,b) => a.Corr_Delta - b.Corr_Delta)
    .slice(0, QUANT_STOCK_TOP_N);
  const downAll = eligible.filter(r => r.Corr_Delta < 0 && r.Stock_Ret_20D <= r.Basket_Ret_20D)
    .sort((a,b) => a.Corr_Delta - b.Corr_Delta)
    .slice(0, QUANT_STOCK_TOP_N);

  if(!upAll.length){
    upBody.innerHTML = "";
    upCards.innerHTML = `<div class="empty-state">No decoupling-up stocks today.</div>`;
  } else {
    const rows = sortFinRows(upAll, finCorrel1UpSort);
    upBody.innerHTML = renderStockRows(rows);
    upCards.innerHTML = renderStockCards(rows);
  }

  if(!downAll.length){
    downBody.innerHTML = "";
    downCards.innerHTML = `<div class="empty-state">No decoupling-down stocks today.</div>`;
  } else {
    const rows = sortFinRows(downAll, finCorrel1DownSort);
    downBody.innerHTML = renderStockRows(rows);
    downCards.innerHTML = renderStockCards(rows);
  }
}

// ---- Block 2: Basket Cohesion (Fragmenting / Converging) ----
function renderCohesionRows(rows){
  return rows.map(r => `
    <tr>
      <td class="ticker">${r.Theme}${r.Low_N ? '<span class="quant-lown">LOW-N</span>' : ''}</td>
      <td class="num">${r.N_Stocks}</td>
      <td class="num">${fmt(r.Cohesion_20D,2)}</td>
      <td class="num">${fmt(r.Cohesion_60D,2)}</td>
      <td class="num ${r.Cohesion_Delta<0?'fin-val-neg':'fin-val-pos'}">${fmt(r.Cohesion_Delta,2)}</td>
    </tr>`).join("");
}
function renderCohesionCards(rows){
  return rows.map(r => `
    <div class="card">
      <div class="card-top">
        <div>
          <div class="card-ticker">${r.Theme}${r.Low_N ? '<span class="quant-lown">LOW-N</span>' : ''}</div>
          <div class="card-name">${r.N_Stocks} stocks</div>
        </div>
        <div>
          <div class="card-score ${r.Cohesion_Delta<0?'fin-val-neg':'fin-val-pos'}">${fmt(r.Cohesion_Delta,2)}</div>
          <div class="card-score-label">Cohesion Δ</div>
        </div>
      </div>
      <div class="card-meta">
        <span>Cohesion 20D <b>${fmt(r.Cohesion_20D,2)}</b></span>
        <span>Cohesion 60D <b>${fmt(r.Cohesion_60D,2)}</b></span>
      </div>
    </div>`).join("");
}

function renderFinCorrel2Tables(){
  const fragBody = document.getElementById("finCorrel2FragBody");
  const fragCards = document.getElementById("finCorrel2FragCards");
  const convBody = document.getElementById("finCorrel2ConvBody");
  const convCards = document.getElementById("finCorrel2ConvCards");
  if(!fragBody || !convBody) return;

  const ranked = (finCorrel2Data && finCorrel2Data.ranked) ? finCorrel2Data.ranked : [];

  const fragAll = [...ranked].sort((a,b) => a.Cohesion_Delta - b.Cohesion_Delta).slice(0, QUANT_COHESION_TOP_N);
  const convAll = [...ranked].sort((a,b) => b.Cohesion_Delta - a.Cohesion_Delta).slice(0, QUANT_COHESION_TOP_N);

  if(!fragAll.length){
    fragBody.innerHTML = "";
    fragCards.innerHTML = `<div class="empty-state">No cohesion data available.</div>`;
  } else {
    const rows = sortFinRows(fragAll, finCorrel2FragSort);
    fragBody.innerHTML = renderCohesionRows(rows);
    fragCards.innerHTML = renderCohesionCards(rows);
  }

  if(!convAll.length){
    convBody.innerHTML = "";
    convCards.innerHTML = `<div class="empty-state">No cohesion data available.</div>`;
  } else {
    const rows = sortFinRows(convAll, finCorrel2ConvSort);
    convBody.innerHTML = renderCohesionRows(rows);
    convCards.innerHTML = renderCohesionCards(rows);
  }
}

// ---- Block 3: Cross-Basket Pairs (top 3 rising / top 3 falling) ----
function renderPairRows(rows){
  return rows.map(r => `
    <tr>
      <td class="quant-pair-cell">${r.Theme_A}</td>
      <td class="quant-pair-cell">${r.Theme_B}</td>
      <td class="num">${fmt(r.Corr_20D,2)}</td>
      <td class="num">${fmt(r.Corr_60D,2)}</td>
      <td class="num ${r.Corr_Delta<0?'fin-val-neg':'fin-val-pos'}">${fmt(r.Corr_Delta,2)}</td>
    </tr>`).join("");
}
function renderPairCards(rows){
  return rows.map(r => `
    <div class="card">
      <div class="card-top">
        <div>
          <div class="card-ticker" style="font-size:14px;">${r.Theme_A}</div>
          <div class="card-name">vs ${r.Theme_B}</div>
        </div>
        <div>
          <div class="card-score ${r.Corr_Delta<0?'fin-val-neg':'fin-val-pos'}">${fmt(r.Corr_Delta,2)}</div>
          <div class="card-score-label">Corr Δ</div>
        </div>
      </div>
      <div class="card-meta">
        <span>Corr 20D <b>${fmt(r.Corr_20D,2)}</b></span>
        <span>Corr 60D <b>${fmt(r.Corr_60D,2)}</b></span>
      </div>
    </div>`).join("");
}

function renderFinCorrel3Tables(){
  const risingBody = document.getElementById("finCorrel3RisingBody");
  const risingCards = document.getElementById("finCorrel3RisingCards");
  const fallingBody = document.getElementById("finCorrel3FallingBody");
  const fallingCards = document.getElementById("finCorrel3FallingCards");
  if(!risingBody || !fallingBody) return;

  if(!finCorrel3Data){
    risingBody.innerHTML = ""; risingCards.innerHTML = `<div class="empty-state">No pair data available.</div>`;
    fallingBody.innerHTML = ""; fallingCards.innerHTML = `<div class="empty-state">No pair data available.</div>`;
    return;
  }

  const risingRows = sortFinRows(finCorrel3Data.rising || [], finCorrel3RisingSort).slice(0, QUANT_PAIR_TOP_N);
  const fallingRows = sortFinRows(finCorrel3Data.falling || [], finCorrel3FallingSort).slice(0, QUANT_PAIR_TOP_N);

  risingBody.innerHTML = risingRows.length ? renderPairRows(risingRows) : "";
  risingCards.innerHTML = risingRows.length ? renderPairCards(risingRows) : `<div class="empty-state">No rising pairs today.</div>`;
  fallingBody.innerHTML = fallingRows.length ? renderPairRows(fallingRows) : "";
  fallingCards.innerHTML = fallingRows.length ? renderPairCards(fallingRows) : `<div class="empty-state">No falling pairs today.</div>`;
}

// ---- Event listeners (guarded so a later re-render doesn't double-attach) ----
let quantListenersAttached = false;
function attachQuantEventListeners(){
  if(quantListenersAttached) return;
  quantListenersAttached = true;

  function wireSortableTable(tableId, sortStateGetter, sortStateSetter, renderFn){
    document.querySelectorAll(`#${tableId} thead th`).forEach(th => {
      th.addEventListener("click", () => {
        const key = th.dataset.key;
        const cur = sortStateGetter();
        const dir = (cur.key === key) ? -cur.dir : -1;
        sortStateSetter({ key, dir });
        renderFn();
      });
    });
  }

  wireSortableTable("finCorrel1UpTable", () => finCorrel1UpSort, (s) => finCorrel1UpSort = s, renderFinCorrel1Tables);
  wireSortableTable("finCorrel1DownTable", () => finCorrel1DownSort, (s) => finCorrel1DownSort = s, renderFinCorrel1Tables);
  wireSortableTable("finCorrel2FragTable", () => finCorrel2FragSort, (s) => finCorrel2FragSort = s, renderFinCorrel2Tables);
  wireSortableTable("finCorrel2ConvTable", () => finCorrel2ConvSort, (s) => finCorrel2ConvSort = s, renderFinCorrel2Tables);
  wireSortableTable("finCorrel3RisingTable", () => finCorrel3RisingSort, (s) => finCorrel3RisingSort = s, renderFinCorrel3Tables);
  wireSortableTable("finCorrel3FallingTable", () => finCorrel3FallingSort, (s) => finCorrel3FallingSort = s, renderFinCorrel3Tables);

  ["finCorrel1UpBody", "finCorrel1DownBody"].forEach(id => {
    document.getElementById(id).addEventListener("click", (e) => {
      const row = e.target.closest("tr[data-ticker]");
      if(!row) return;
      openTickerChart(row.dataset.ticker);
    });
  });
  ["finCorrel1UpCards", "finCorrel1DownCards"].forEach(id => {
    document.getElementById(id).addEventListener("click", (e) => {
      const card = e.target.closest(".card[data-ticker]");
      if(!card) return;
      openTickerChart(card.dataset.ticker);
    });
  });
}
