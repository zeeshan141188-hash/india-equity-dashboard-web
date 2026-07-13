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
let finCorrel1Sort = { key: "Corr_Delta", dir: 1 };   // ascending -- most negative (decoupling) first
let finCorrel2Sort = { key: "Cohesion_Delta", dir: 1 };
let finCorrel3RisingSort = { key: "Corr_Delta", dir: -1 };
let finCorrel3FallingSort = { key: "Corr_Delta", dir: 1 };

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
  renderFinCorrel1Table();
  renderFinCorrel2Table();
  renderFinCorrel3Tables();
  attachQuantEventListeners();
}
window.renderQuantStrategy = renderQuantStrategy;

function quantFlagTagClass(flag){
  if(flag === "Decoupling Up") return "DecouplingUp";
  if(flag === "Decoupling Down") return "DecouplingDown";
  return "Stable";
}

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

// ---- Block 1: Stock vs Basket ----
function renderFinCorrel1Table(){
  const body = document.getElementById("finCorrel1Body");
  const cardsEl = document.getElementById("finCorrel1Cards");
  if(!body || !cardsEl) return;

  if(!finCorrel1Data || !finCorrel1Data.ranked || !finCorrel1Data.ranked.length){
    body.innerHTML = "";
    cardsEl.innerHTML = `<div class="empty-state">No correlation data available.</div>`;
    return;
  }
  const rows = sortFinRows(finCorrel1Data.ranked, finCorrel1Sort);

  body.innerHTML = rows.map(r => `
    <tr class="fin-table-row-clickable" data-ticker="${r.Ticker}">
      <td class="ticker">${cleanTicker(r.Ticker)}</td>
      <td>${r.Theme}</td>
      <td class="num">${fmt(r.Corr_20D,2)}</td>
      <td class="num">${fmt(r.Corr_60D,2)}</td>
      <td class="num ${r.Corr_Delta<0?'fin-val-neg':'fin-val-pos'}">${fmt(r.Corr_Delta,2)}</td>
      <td class="num">${(r.Stock_Ret_20D>=0?'+':'')+fmt(r.Stock_Ret_20D*100,1)}%</td>
      <td class="num">${(r.Basket_Ret_20D>=0?'+':'')+fmt(r.Basket_Ret_20D*100,1)}%</td>
      <td><span class="tag ${quantFlagTagClass(r.Flag)}">${r.Flag}</span></td>
    </tr>`).join("");

  cardsEl.innerHTML = rows.map(r => `
    <div class="card fin-table-row-clickable" data-ticker="${r.Ticker}">
      <div class="card-top">
        <div>
          <div class="card-ticker">${cleanTicker(r.Ticker)}</div>
          <div class="card-name">${r.Theme} · <span class="tag ${quantFlagTagClass(r.Flag)}">${r.Flag}</span></div>
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

// ---- Block 2: Basket Cohesion ----
function renderFinCorrel2Table(){
  const body = document.getElementById("finCorrel2Body");
  const cardsEl = document.getElementById("finCorrel2Cards");
  if(!body || !cardsEl) return;

  if(!finCorrel2Data || !finCorrel2Data.ranked || !finCorrel2Data.ranked.length){
    body.innerHTML = "";
    cardsEl.innerHTML = `<div class="empty-state">No cohesion data available.</div>`;
    return;
  }
  const rows = sortFinRows(finCorrel2Data.ranked, finCorrel2Sort);

  body.innerHTML = rows.map(r => `
    <tr>
      <td class="ticker">${r.Theme}${r.Low_N ? '<span class="quant-lown">LOW-N</span>' : ''}</td>
      <td class="num">${r.N_Stocks}</td>
      <td class="num">${fmt(r.Cohesion_20D,2)}</td>
      <td class="num">${fmt(r.Cohesion_60D,2)}</td>
      <td class="num ${r.Cohesion_Delta<0?'fin-val-neg':'fin-val-pos'}">${fmt(r.Cohesion_Delta,2)}</td>
    </tr>`).join("");

  cardsEl.innerHTML = rows.map(r => `
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

// ---- Block 3: Cross-Basket Pairs ----
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

  const risingRows = sortFinRows(finCorrel3Data.rising || [], finCorrel3RisingSort);
  const fallingRows = sortFinRows(finCorrel3Data.falling || [], finCorrel3FallingSort);

  risingBody.innerHTML = risingRows.length ? renderPairRows(risingRows) : "";
  risingCards.innerHTML = risingRows.length ? renderPairCards(risingRows) : `<div class="empty-state">No rising pairs today.</div>`;
  fallingBody.innerHTML = fallingRows.length ? renderPairRows(fallingRows) : "";
  fallingCards.innerHTML = fallingRows.length ? renderPairCards(fallingRows) : `<div class="empty-state">No falling pairs today.</div>`;
}

// ---- Event listeners (guarded so re-invoking renderQuantStrategy on an
// "Update" refresh doesn't attach duplicate handlers) ----
let quantListenersAttached = false;
function attachQuantEventListeners(){
  if(quantListenersAttached) return;
  quantListenersAttached = true;

  document.querySelectorAll("#finCorrel1Table thead th").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      finCorrel1Sort.dir = (finCorrel1Sort.key === key) ? -finCorrel1Sort.dir : -1;
      finCorrel1Sort.key = key;
      renderFinCorrel1Table();
    });
  });

  document.getElementById("finCorrel1Body").addEventListener("click", (e) => {
    const row = e.target.closest("tr[data-ticker]");
    if(!row) return;
    openTickerChart(row.dataset.ticker);
  });

  document.getElementById("finCorrel1Cards").addEventListener("click", (e) => {
    const card = e.target.closest(".card[data-ticker]");
    if(!card) return;
    openTickerChart(card.dataset.ticker);
  });

  document.querySelectorAll("#finCorrel2Table thead th").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      finCorrel2Sort.dir = (finCorrel2Sort.key === key) ? -finCorrel2Sort.dir : -1;
      finCorrel2Sort.key = key;
      renderFinCorrel2Table();
    });
  });

  document.querySelectorAll("#finCorrel3RisingTable thead th").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      finCorrel3RisingSort.dir = (finCorrel3RisingSort.key === key) ? -finCorrel3RisingSort.dir : -1;
      finCorrel3RisingSort.key = key;
      renderFinCorrel3Tables();
    });
  });
  document.querySelectorAll("#finCorrel3FallingTable thead th").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      finCorrel3FallingSort.dir = (finCorrel3FallingSort.key === key) ? -finCorrel3FallingSort.dir : -1;
      finCorrel3FallingSort.key = key;
      renderFinCorrel3Tables();
    });
  });
}
