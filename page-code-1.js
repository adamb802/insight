
(function () {
  // ==============================
  // CONFIG
  // ==============================
  const API_BASE = 'https://pi-api-264542425514.us-central1.run.app';
  const MAP_STYLE = 'mapbox://styles/urlstudio/cmek4dtim00cx01s4gkovdh1d';
  const COUNTY_GEOJSON_URL = 'https://raw.githubusercontent.com/url-studio/map-data/main/county-data.geojson';

  // Color ramps (tweak freely)
  // 5-bin Energy (MW) ramp — indigo family
  const COLORS_MW_5 = ['#eef2ff','#c7d2fe','#a5b4fc','#818cf8','#6366f1'];
  // 5-bin Ordinance ramp — green family (high = good)
  const COLORS_ORD_5 = ['#e6f4ea','#c9e8d1','#a1dbb8','#6fcb98','#2eb872'];
  // 3x3 Bivariate (rows = Ordinance low→high, cols = MW low→high)
  // Rd→Yl→Gn inspired; high–high = green, low–low = red
  const BIV9 = [
    ['#d73027','#f46d43','#fdae61'],  // Ord LOW, MW low→high
    ['#fdae61','#fee08b','#a6d96a'],  // Ord MID, MW low→high
    ['#a6d96a','#66bd63','#1a9850']   // Ord HIGH, MW low→high
  ];
  const INACTIVE_GRAY = '#dddddd';

  const STAGE_VALUES = ['Early','Mid','Late','Approved','Inactive'];
  const LIST_PAGE_SIZE = 50;

  // ==============================
  // STATE
  // ==============================
  let map;
  let countiesGeoJSON = null;

  let allProjects = [];
  let allCounties = [];
  let countyById = new Map(); // key: FIPS

  const projectsByCounty = new Map();
  const stateIndex = new Map(); // stateTitle -> { countyIds:Set, projectIdxs:Set }

  // ACTIVE (global, not viewport-limited)
  let activeProjectIdxs = new Set();
  let activeCountyIds = new Set(); // FIPS
  let activeStates = new Set();

  // VISIBLE (viewport-limited)
  let visibleProjectIdxs = new Set();
  let visibleCountyIds = new Set();
  let visibleStates = new Set();

  // Totals caches
  let countyTotals = new Map(); // fips -> { totalMW, totalProjects }
  let stateTotals = new Map();  // state -> { totalMW, totalProjects, totalCounties }

  // Ordinance caches (respect filters)
  let countyOrdScores = new Map(); // fips -> { wind, solar, storage, totalAvg, incWind, incSolar, incStorage }
  let stateOrdScores  = new Map(); // state -> { windAvg, solarAvg, storageAvg, totalAvg }

  // Templates + cursors
  let savedProjectTemplate = null;
  let savedCountyTemplate = null;
  let savedStateTemplate = null;

  let listCursorProjects = 0;
  let listCursorCounties = 0;
  let listCursorStates = 0;

  // UI els (lists)
  const listProjectsEl = document.getElementById('projects-list');
  const listCountiesEl = document.getElementById('counties-list');
  const listStatesEl   = document.getElementById('states-list');

  // Counters (global)
  const totalProjectsEl   = document.getElementById('total-projects');
  const totalCountiesEl   = document.getElementById('total-counties');
  const totalStatesEl     = document.getElementById('total-states');
  const totalMWEl         = document.getElementById('total-mw');
  const totalSolarMWEl    = document.getElementById('total-solar-mw');
  const totalWindMWEl     = document.getElementById('total-wind-mw');
  const totalStorageMWEl  = document.getElementById('total-storage-mw');   // NEW

  // Counters (visible)
  const visStatesEl       = document.getElementById('visible-states');
  const visCountiesEl     = document.getElementById('visible-counties');
  const visProjectsEl     = document.getElementById('visible-projects');
  const visMWEl           = document.getElementById('visible-mw');
  const visSolarMWEl      = document.getElementById('visible-solar-mw');
  const visWindMWEl       = document.getElementById('visible-wind-mw');
  const visStorageMWEl    = document.getElementById('visible-storage-mw'); // NEW

  // Checkbox containers
  const stateBoxWrap     = document.getElementById('state-checkboxes');
  const devBoxWrap       = document.getElementById('developer-checkboxes');

  // Legend container
  const mapKeyEl         = document.getElementById('map-key');

  // ==============================
  // INIT
  // ==============================
  window.addEventListener('DOMContentLoaded', init);

  async function init() {
    captureTemplates();
    await initMap();
    await loadData();
    buildIndexes();

    // Build static state & developer filters from full dataset (all checked)
    renderStateCheckboxes();
    renderDeveloperCheckboxes();

    // Apply any filters from URL (after checkboxes exist)
    applyFiltersFromURL();

    // Initial compute & paint
    recomputeActiveSets();
    recomputeOrdinanceCaches();          // NEW
    updateGlobalCounters();
    paintCountiesByActiveMW();           // (now calls the new painter)
    updateMapKey();                      // legend

    // Initial viewport
    recomputeVisibleSets();
    updateVisibleCounters();
    renderCurrentList(true);

    wireUI();

    // Enable the Federal Lands overlay toggle (no impact on your other logic)
  setupFederalLandsOverlay();

    // Hide any older "loading-screen" overlay
    const loader = document.getElementById('loading-screen');
    if (loader) {
      loader.classList.add('hidden');
      setTimeout(() => { loader.style.display = 'none'; }, 400);
    }
  }

  function captureTemplates() {
    const tProj = document.getElementById('project-card-template');
    if (tProj) { savedProjectTemplate = tProj.cloneNode(true); savedProjectTemplate.id=''; savedProjectTemplate.style.display=''; tProj.remove(); }
    const tCounty = document.getElementById('county-card-template');
    if (tCounty) { savedCountyTemplate = tCounty.cloneNode(true); savedCountyTemplate.id=''; savedCountyTemplate.style.display=''; tCounty.remove(); }
    const tState = document.getElementById('state-card-template');
    if (tState) { savedStateTemplate = tState.cloneNode(true); savedStateTemplate.id=''; savedStateTemplate.style.display=''; tState.remove(); }
  }

  async function initMap() {
    if (!window.mapboxgl) { console.error('Mapbox GL JS not found.'); return; }
    mapboxgl.accessToken = 'pk.eyJ1IjoidXJsc3R1ZGlvIiwiYSI6ImNtMzR5ZjAybjA0dzAya3EzMGFuNmVpM2MifQ.Q9OxZasWDZmUQVnL0mLuQA';

    map = new mapboxgl.Map({
      container: 'map',
      style: MAP_STYLE,
      center: [-98.5795, 39.8283],
      zoom: 3
    });

    map.on('style.load', () => map.setProjection('globe'));
    await new Promise(res => map.on('load', res));

    const resp = await fetch(COUNTY_GEOJSON_URL);
    countiesGeoJSON = await resp.json();

    map.addSource('counties', { type: 'geojson', data: countiesGeoJSON });

    map.addLayer({
      id: 'county-fills',
      type: 'fill',
      source: 'counties',
      paint: { 'fill-color': '#000000', 'fill-opacity': 0.0 }
    }, firstSymbolLayerId());

    map.addLayer({
      id: 'county-borders',
      type: 'line',
      source: 'counties',
      paint: { 'line-color': '#ffffff', 'line-width': 0.5, 'line-opacity': 0.4 }
    });

    map.on('moveend', () => {
      recomputeVisibleSets();
      updateVisibleCounters();
      renderCurrentList(true);
    });
  }

  function firstSymbolLayerId() {
    const layers = (map.getStyle() && map.getStyle().layers) || [];
    const symbol = layers.find(l => l.type === 'symbol');
    return symbol ? symbol.id : undefined;
  }

  // ==============================
  // DATA LOADING
  // ==============================
  async function loadData() {
    const overlay   = document.getElementById('loading-progress');
    const counterEl = document.getElementById('loading-counter');

    const showProgress = (n) => {
      if (counterEl) counterEl.textContent = `${n.toLocaleString()} loaded`;
      if (overlay) { overlay.style.display = 'block'; overlay.style.opacity = '1'; }
    };

    // ----- Projects (paged) -----
    let all = [], offset = null;
    do {
      const url = API_BASE + '/developments' + (offset ? ('?offset=' + encodeURIComponent(offset)) : '');
      const res = await fetch(url);
      if (!res.ok) throw new Error('/developments failed: ' + res.status);
      const data  = await res.json();
      all = all.concat(data.records || []);
      offset = data.offset || null;
      showProgress(all.length);
      await new Promise(r => setTimeout(r, 0));
    } while (offset);

    allProjects = all.map(normalizeProject).filter(Boolean);

    // ----- Counties (+ ordinance scores) -----
    const resCounties = await fetch(API_BASE + '/counties');
    if (!resCounties.ok) throw new Error('/counties failed');
    const dataCounties = await resCounties.json();

    // Safe parse numbers, treat "NaN" as null
    const parseScore = (v) => {
      if (v === 'NaN' || v === '' || v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    allCounties = (dataCounties.records || []).map(r => ({
      fips: String(r.fips || '').trim(),
      title: String(r.title || '').trim(),
      stateTitle: String(r.stateTitle || '').trim(),
      windScore:    parseScore(r.windScore ?? r.Wind_Score),
      solarScore:   parseScore(r.solarScore ?? r.Solar_Score),
      storageScore: parseScore(r.storageScore ?? r.Storage_Score)
    })).filter(c => c.fips && c.title);

    countyById = new Map(allCounties.map(c => [c.fips, c]));

    if (overlay) { overlay.style.opacity = '0'; setTimeout(() => { overlay.style.display = 'none'; }, 250); }
  }

  function normalizeProject(r) {
    const pick = (keys) => { for (const k of keys) { const v = r[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return v; } return ''; };
    const title         = pick(['title','Title','Name','Project','Project Name']);
    const stageRaw      = pick(['stage','Stage','Status']);
    const developerText = pick(['Developer Title','developer-text','Developer','developer','Proponent']);
    const locationText  = pick(['Location Text','location-text','Location','City/County','County']);
    const tech1         = pick(['technology-1','Technology 1','Tech 1','Primary Technology']);
    const tech2         = pick(['technology-2','Technology 2','Tech 2','Secondary Technology']);
    const tech3         = pick(['technology-3','Technology 3','Tech 3']);
    const stateTitle    = pick(['State','state','State Title']);
    const mwSizeRaw     = pick(['MW Size','mw','Total MW']);
    const mwSize        = mwSizeRaw !== '' && mwSizeRaw != null ? parseFloat(mwSizeRaw) : 0;
    const opDateRaw     = pick(['Planned Operational Date','Operation Date','operation-date']);
    const opDate        = parseDateSafe(opDateRaw);
    const countyIdRaw   = pick(['County IDs','County FIPS','FIPS','county-ids']);
    const countyIds     = String(countyIdRaw || '').split(',').map(s => s.trim()).filter(Boolean);
    const stage = normalizeStage(stageRaw);
    return {
      id: r.id,
      title: String(title || ''),
      stage,
      developerText: String(developerText || ''),
      locationText: String(locationText || ''),
      tech1: String(tech1 || ''), tech2: String(tech2 || ''), tech3: String(tech3 || ''),
      stateTitle: String(stateTitle || ''),
      countyIds,
      mwSize: isFinite(mwSize) ? mwSize : 0,
      opDate
    };
  }

  function normalizeStage(raw) {
    const s = String(raw || '').trim().toLowerCase();
    if (!s) return '';
    if (/inactive|on hold|paused|deferred/.test(s)) return 'Inactive';
    if (/approved|permit|consent/.test(s)) return 'Approved';
    if (/late|final|construction/.test(s)) return 'Late';
    if (/mid|middle|development/.test(s)) return 'Mid';
    if (/early|pre|concept|proposal/.test(s)) return 'Early';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function parseDateSafe(v) { try { const d = new Date(v); return isNaN(d) ? null : d; } catch { return null; } }

  // ==============================
  // INDEXES
  // ==============================
  function buildIndexes() {
    projectsByCounty.clear();
    stateIndex.clear();
    allProjects.forEach((p, idx) => {
      p.countyIds.forEach(fips => {
        if (!projectsByCounty.has(fips)) projectsByCounty.set(fips, new Set());
        projectsByCounty.get(fips).add(idx);
      });
      const st = p.stateTitle || '';
      if (!stateIndex.has(st)) stateIndex.set(st, { countyIds: new Set(), projectIdxs: new Set() });
      const entry = stateIndex.get(st);
      p.countyIds.forEach(fips => entry.countyIds.add(fips));
      entry.projectIdxs.add(idx);
    });
  }

  // --- County ID helpers (normalize to string) ---
  function inferCountyIdProp(geo) {
    const f = geo && geo.features && geo.features[0];
    if (!f) return 'id';
    const candidates = ['id','GEOID','geoid','coty_fp_code','FIPS','fips'];
    for (const k of candidates) { if (f.properties && Object.prototype.hasOwnProperty.call(f.properties, k)) return k; }
    return 'id';
  }
  function extractCountyIdFromFeature(f) {
    let id =
      (f.properties && (f.properties.id || f.properties.GEOID || f.properties.geoid ||
                         f.properties.coty_fp_code || f.properties.FIPS || f.properties.fips)) ||
      f.id || null;
    if (id == null) return null;
    id = String(id).trim();
    return id || null;
  }

  // ==============================
  // STATIC FILTER UIs (built once)
  // ==============================
  function renderStateCheckboxes() {
    if (!stateBoxWrap) return;
    stateBoxWrap.innerHTML = '';
    const states = Array.from(new Set(allProjects.map(p => (p.stateTitle || '').trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b));
    states.forEach(st => {
      const id = `state_${slug(st)}`;
      const label = document.createElement('label');
      label.style.display = 'block';
      label.style.margin = '2px 0';
      label.innerHTML = `<input type="checkbox" class="state-box" id="${id}" value="${escapeHtml(st)}" checked> ${escapeHtml(st)}`;
      stateBoxWrap.appendChild(label);
    });
  }

  function renderDeveloperCheckboxes() {
    if (!devBoxWrap) return;
    devBoxWrap.innerHTML = '';
    const set = new Set(allProjects.map(p => (p.developerText || '').trim()).map(v => v || '(Unspecified)'));
    const devs = Array.from(set).sort((a,b)=>a.localeCompare(b));
    devs.forEach(name => {
      const id = `dev_${slug(name)}`;
      const label = document.createElement('label');
      label.style.display = 'block';
      label.style.margin = '2px 0';
      label.innerHTML = `<input type="checkbox" class="dev-box" id="${id}" value="${escapeHtml(name)}" checked> ${escapeHtml(name)}`;
      devBoxWrap.appendChild(label);
    });
  }

  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-'); }

  // ==============================
  // FILTER READERS
  // ==============================
  function techFiltersOn() {
    return Array.from(document.querySelectorAll('input[type="checkbox"][data-role="heat-toggle"]'))
      .filter(cb => cb.checked).map(cb => cb.value);
  }
  function stagesOn() {
    return Array.from(document.querySelectorAll('input[type="checkbox"][data-role="stage-filter"]'))
      .filter(cb => cb.checked).map(cb => cb.value);
  }
  function currentSearch() {
    const el = document.getElementById('project-search');
    return (el && el.value ? el.value : '').trim().toLowerCase();
  }
  function selectedStates() {
    if (!stateBoxWrap) return new Set();
    const vals = Array.from(stateBoxWrap.querySelectorAll('input.state-box'))
      .filter(cb => cb.checked).map(cb => cb.value);
    return new Set(vals);
  }
  function selectedDevelopers() {
    if (!devBoxWrap) return new Set();
    const vals = Array.from(devBoxWrap.querySelectorAll('input.dev-box'))
      .filter(cb => cb.checked).map(cb => cb.value);
    return new Set(vals);
  }
  function mwRange() {
    const minEl = document.getElementById('mw-min');
    const maxEl = document.getElementById('mw-max');
    const min = minEl && minEl.value !== '' ? parseFloat(minEl.value) : null;
    const max = maxEl && maxEl.value !== '' ? parseFloat(maxEl.value) : null;
    return { min: isFinite(min) ? min : null, max: isFinite(max) ? max : null };
  }
  function opDateFilter() {
    const mode = (document.getElementById('opdate-mode') || {}).value || 'any';
    const aEl = document.getElementById('opdate-a');
    const bEl = document.getElementById('opdate-b');
    const a = aEl && aEl.value ? new Date(aEl.value) : null;
    const b = bEl && bEl.value ? new Date(bEl.value) : null;
    return { mode, a, b };
  }
  function colorToggles() {
    const boxes = Array.from(document.querySelectorAll('input[type="checkbox"][data-role="color-toggle"]'));
    if (!boxes.length) return { mw: true, ord: true }; // default
    const on = new Set(boxes.filter(b => b.checked).map(b => b.value));
    return { mw: on.has('mw'), ord: on.has('ord') };
  }

  // ==============================
  // ACTIVE (GLOBAL) RECOMPUTE
  // ==============================
  function recomputeActiveSets() {
    const techs = techFiltersOn();
    const stages = stagesOn();
    const q = currentSearch();
    const statesSel = selectedStates();
    const devsSel   = selectedDevelopers();
    const { min: mwMin, max: mwMax } = mwRange();
    const { mode: opMode, a: opA, b: opB } = opDateFilter();

    activeProjectIdxs = new Set();

    allProjects.forEach((p, idx) => {
      if (!matchTech(p, techs)) return;
      if (!matchStage(p, stages)) return;
      if (!matchSearch(p, q)) return;
      if (!matchStateCheckbox(p, statesSel)) return;
      if (!matchDeveloper(p, devsSel)) return;
      if (!matchMW(p, mwMin, mwMax)) return;
      if (!matchOpDate(p, opMode, opA, opB)) return;
      activeProjectIdxs.add(idx);
    });

    countyTotals = new Map();
    activeCountyIds = new Set();
    projectsByCounty.forEach((projSet, fips) => {
      let count = 0, mwSum = 0;
      projSet.forEach(idx => {
        if (activeProjectIdxs.has(idx)) {
          const p = allProjects[idx];
          mwSum += p.mwSize || 0;
          count += 1;
        }
      });
      if (count > 0) {
        activeCountyIds.add(fips);
        countyTotals.set(fips, { totalMW: mwSum, totalProjects: count });
      }
    });

    stateTotals = new Map();
    activeStates = new Set();
    stateIndex.forEach((entry, stateName) => {
      let projCount = 0, mwSum = 0, countyCount = 0;
      entry.projectIdxs.forEach(idx => {
        if (activeProjectIdxs.has(idx)) {
          projCount++;
          mwSum += (allProjects[idx].mwSize || 0);
        }
      });
      entry.countyIds.forEach(fips => { if (activeCountyIds.has(fips)) countyCount++; });
      if ((projCount > 0 || countyCount > 0) && (stateName && stateName.trim() !== '')) {
        activeStates.add(stateName);
        stateTotals.set(stateName, { totalMW: mwSum, totalProjects: projCount, totalCounties: countyCount });
      }
    });

    // Expose active set for CSV export (canonical source)
    window.__ALL_PROJECTS    = allProjects;
    window.__ACTIVE_IDX      = Array.from(activeProjectIdxs);
    window.__ACTIVE_PROJECTS = window.__ACTIVE_IDX.map(i => allProjects[i]);
  }

  function matchTech(p, techs) {
    if (!techs.length) return true;
    const hay = (p.tech1 + ' ' + p.tech2 + ' ' + p.tech3).toLowerCase();
    const wantsWind    = techs.includes('Wind');
    const wantsSolar   = techs.includes('Solar');
    const wantsStorage = techs.includes('Storage');
    const hasWind    = /wind/.test(hay);
    const hasSolar   = /solar/.test(hay);
    const hasStorage = /storage|battery/.test(hay);
    return (wantsWind && hasWind) || (wantsSolar && hasSolar) || (wantsStorage && hasStorage);
  }
  function matchStage(p, stages) {
    if (!stages.length || stages.length === STAGE_VALUES.length) return true;
    return stages.includes(p.stage);
  }
  function matchSearch(p, q) {
    if (!q) return true;
    const hay = [
      p.title, p.stage, p.developerText, p.locationText, p.tech1, p.tech2, p.tech3, p.stateTitle
    ].join(' ').toLowerCase();
    return hay.includes(q);
  }
  function matchStateCheckbox(p, statesSet) {
    if (!statesSet || statesSet.size === 0) return true;
    return statesSet.has(p.stateTitle);
  }
  function matchDeveloper(p, devsSet) {
    if (!devsSet || devsSet.size === 0) return true;
    const dev = (p.developerText || '').trim() || '(Unspecified)';
    return devsSet.has(dev);
  }
  function matchMW(p, min, max) {
    const v = p.mwSize || 0;
    if (min !== null && v < min) return false;
    if (max !== null && v > max) return false;
    return true;
  }
  function matchOpDate(p, mode, a, b) {
    if (mode === 'any') return true;
    const d = p.opDate; if (!d) return false;
    const t = d.getTime();
    if (mode === 'on-or-after') return a ? (t >= a.getTime()) : true;
    if (mode === 'on-or-before') return a ? (t <= a.getTime()) : true;
    if (mode === 'between') {
      if (!a || !b) return true;
      const lo = Math.min(a.getTime(), b.getTime());
      const hi = Math.max(a.getTime(), b.getTime());
      return t >= lo && t <= hi;
    }
    return true;
  }

  // ==============================
  // ORDINANCE CACHES (respect tech toggles & NaN)
  // ==============================
  function recomputeOrdinanceCaches() {
    countyOrdScores.clear();
    stateOrdScores.clear();

    const techs = techFiltersOn();
    const wantsWind    = techs.includes('Wind');
    const wantsSolar   = techs.includes('Solar');
    const wantsStorage = techs.includes('Storage');

    // Counties (only ACTIVE counties)
    activeCountyIds.forEach(fips => {
      const c = countyById.get(fips);
      if (!c) return;

      const wind    = isFiniteNum(c.windScore)    ? c.windScore    : null;
      const solar   = isFiniteNum(c.solarScore)   ? c.solarScore   : null;
      const storage = isFiniteNum(c.storageScore) ? c.storageScore : null;

      const incWind    = wantsWind    && wind    != null;
      const incSolar   = wantsSolar   && solar   != null;
      const incStorage = wantsStorage && storage != null;

      const count = (incWind?1:0) + (incSolar?1:0) + (incStorage?1:0);
      const sum   = (incWind?wind:0) + (incSolar?solar:0) + (incStorage?storage:0);
      const totalAvg = count > 0 ? (sum / count) : null;

      countyOrdScores.set(fips, { wind, solar, storage, totalAvg, incWind, incSolar, incStorage });
    });

    // States: averages across ACTIVE counties (use county totals for totalAvg)
    stateIndex.forEach((entry, stateName) => {
      if (!activeStates.has(stateName)) return;

      let wSum = 0, wCnt = 0;
      let sSum = 0, sCnt = 0;
      let tSum = 0, tCnt = 0;
      let stSum = 0, stCnt = 0;

      entry.countyIds.forEach(fips => {
        if (!activeCountyIds.has(fips)) return;
        const ord = countyOrdScores.get(fips);
        if (!ord) return;

        if (ord.incWind && ord.wind != null)   { wSum += ord.wind;     wCnt++; }
        if (ord.incSolar && ord.solar != null) { sSum += ord.solar;    sCnt++; }
        if (ord.incStorage && ord.storage != null) { stSum += ord.storage; stCnt++; }
        if (ord.totalAvg != null) { tSum += ord.totalAvg; tCnt++; }
      });

      const windAvg    = wCnt ? (wSum/wCnt) : null;
      const solarAvg   = sCnt ? (sSum/sCnt) : null;
      const storageAvg = stCnt ? (stSum/stCnt) : null;
      const totalAvg   = tCnt ? (tSum/tCnt) : null;

      stateOrdScores.set(stateName, { windAvg, solarAvg, storageAvg, totalAvg });
    });
  }

  function isFiniteNum(v){ return typeof v === 'number' && isFinite(v); }

  // ==============================
  // COUNTERS (GLOBAL + VISIBLE)
  // ==============================
  function updateGlobalCounters() {
    setText(totalProjectsEl, formatNumber(activeProjectIdxs.size));
    setText(totalCountiesEl, formatNumber(activeCountyIds.size));
    const activeNamedStates = Array.from(activeStates).filter(s => s && s.trim() !== '');
    setText(totalStatesEl, activeNamedStates.length);

    // total MW -> display as GW
    let sumMW = 0;
    activeProjectIdxs.forEach(idx => { sumMW += (allProjects[idx].mwSize || 0); });
    setText(totalMWEl, formatNumberMWtoGW(sumMW));

    const { solarMW, windMW } = computeSolarWindMW(activeProjectIdxs);
    setText(totalSolarMWEl,  formatNumberMWtoGW(solarMW));
    setText(totalWindMWEl,   formatNumberMWtoGW(windMW));

    const storageOnlyMW = computeStorageOnlyMW(activeProjectIdxs);
    setText(totalStorageMWEl, formatNumberMWtoGW(storageOnlyMW));
  }

  function updateVisibleCounters() {
    setText(visProjectsEl, formatNumber(visibleProjectIdxs.size));
    setText(visCountiesEl, formatNumber(visibleCountyIds.size));
    setText(visStatesEl,   formatNumber(visibleStates.size));

    let sumMW = 0;
    visibleProjectIdxs.forEach(idx => { sumMW += (allProjects[idx].mwSize || 0); });
    setText(visMWEl,         formatNumberMWtoGW(sumMW));

    const { solarMW, windMW } = computeSolarWindMW(visibleProjectIdxs);
    setText(visSolarMWEl,    formatNumberMWtoGW(solarMW));
    setText(visWindMWEl,     formatNumberMWtoGW(windMW));

    const storageOnlyVisMW = computeStorageOnlyMW(visibleProjectIdxs);
    setText(visStorageMWEl,  formatNumberMWtoGW(storageOnlyVisMW));
  }

  function computeSolarWindMW(indexSet) {
    let solarMW = 0, windMW = 0;
    indexSet.forEach(idx => {
      const p = allProjects[idx];
      const techHay = (p.tech1 + ' ' + p.tech2 + ' ' + p.tech3).toLowerCase();
      const hasSolar = /solar/.test(techHay);
      const hasWind  = /wind/.test(techHay);
      const mw = p.mwSize || 0;
      if (hasSolar && hasWind) { solarMW += mw / 2; windMW += mw / 2; }
      else if (hasSolar) { solarMW += mw; }
      else if (hasWind)  { windMW  += mw; }
    });
    return { solarMW, windMW };
  }

  function computeStorageOnlyMW(indexSet) {
    let storageMW = 0;
    indexSet.forEach(idx => {
      const p = allProjects[idx];
      const hay = (p.tech1 + ' ' + p.tech2 + ' ' + p.tech3).toLowerCase();
      const hasSolar   = /solar/.test(hay);
      const hasWind    = /wind/.test(hay);
      const hasStorage = /storage|battery/.test(hay);
      if (hasStorage && !hasWind && !hasSolar) storageMW += (p.mwSize || 0);
    });
    return storageMW;
  }

  // ==============================
  // MAP PAINTING (UNIVARIATE + BIVARIATE)
  // ==============================
  function paintCountiesByActiveMW() { paintCounties(); } // keep old name for compatibility

  function paintCounties() {
    if (!countiesGeoJSON || !map.getLayer('county-fills')) return;

    const keyProp = inferCountyIdProp(countiesGeoJSON) || 'id';
    const { mw: showMW, ord: showOrd } = colorToggles();

    // Collect active county values
    const arrMW  = [];
    const arrORD = [];
    activeCountyIds.forEach(fips => {
      const mw = countyTotals.get(fips)?.totalMW ?? 0;
      const ord = countyOrdScores.get(fips)?.totalAvg ?? null;
      arrMW.push({ fips, v: mw });
      if (ord != null) arrORD.push({ fips, v: ord });
    });

    const colorByFips = new Map();
    const opacityByFips = new Map();

    if (!showMW && !showOrd) {
      // Nothing to paint
      activeCountyIds.forEach(fips => { colorByFips.set(fips, INACTIVE_GRAY); opacityByFips.set(fips, 0.0); });
    } else if (showMW && !showOrd) {
      // Univariate: Energy (5 bins)
      const cuts = computeCuts(arrMW.map(o=>o.v), 5);
      arrMW.forEach(({fips,v}) => {
        const b = binByCuts(v, cuts, 5);        // 1..5
        colorByFips.set(fips, COLORS_MW_5[b-1]);
        opacityByFips.set(fips, 0.85);
      });
    } else if (!showMW && showOrd) {
      // Univariate: Ordinance (5 bins)
      const cuts = computeCuts(arrORD.map(o=>o.v), 5);
      arrORD.forEach(({fips,v}) => {
        const b = binByCuts(v, cuts, 5);
        colorByFips.set(fips, COLORS_ORD_5[b-1]);
        opacityByFips.set(fips, 0.85);
      });
      // Active counties without any valid ord: gray & light
      activeCountyIds.forEach(fips => {
        if (!colorByFips.has(fips)) { colorByFips.set(fips, INACTIVE_GRAY); opacityByFips.set(fips, 0.25); }
      });
    } else {
      // Bivariate: 3x3 (Energy vs Ordinance)
      const cutsMW  = computeCuts(arrMW.map(o=>o.v), 3);
      const cutsORD = computeCuts(arrORD.map(o=>o.v), 3);

      // Paint only counties that have both metrics; fallbacks otherwise
      activeCountyIds.forEach(fips => {
        const mw  = countyTotals.get(fips)?.totalMW ?? 0;
        const ord = countyOrdScores.get(fips)?.totalAvg ?? null;

        if (ord != null) {
          const bx = binByCuts(mw,  cutsMW,  3); // 1..3
          const by = binByCuts(ord, cutsORD, 3); // 1..3
          colorByFips.set(fips, BIV9[by-1][bx-1]);
          opacityByFips.set(fips, 0.9);
        } else {
          // Missing ordinance: show MW color, light opacity (so user can tell it's MW-only)
          const bx = binByCuts(mw, cutsMW, 3);
          colorByFips.set(fips, BIV9[1][bx-1]); // neutral row (mid-ord tone)
          opacityByFips.set(fips, 0.35);
        }
      });
    }

    // Build match expressions
    const colorExpr   = ['match', ['get', keyProp]];
    const opacityExpr = ['match', ['get', keyProp]];

    (countiesGeoJSON.features || []).forEach(f => {
      const id = extractCountyIdFromFeature(f);
      if (!id || !activeCountyIds.has(id)) {
        colorExpr.push(id, '#000000');
        opacityExpr.push(id, 0.0);
        return;
      }
      colorExpr.push(id, colorByFips.get(id) || INACTIVE_GRAY);
      opacityExpr.push(id, opacityByFips.get(id) ?? 0.0);
    });
    colorExpr.push('#000000');  // default color
    opacityExpr.push(0.0);      // default opacity

    map.setPaintProperty('county-fills', 'fill-color', colorExpr);
    map.setPaintProperty('county-fills', 'fill-opacity', opacityExpr);

    // Update legend
    updateMapKey();
  }

  // Quantile helpers
  function computeCuts(values, parts) {
    const arr = (values || []).filter(v => v != null && isFinite(v)).sort((a,b)=>a-b);
    if (arr.length === 0) return [];
    const cuts = [];
    for (let i=1;i<parts;i++){
      const p = (i/(parts))*(arr.length-1);
      const lo = Math.floor(p), hi = Math.ceil(p);
      const frac = p - lo;
      const v = (lo===hi) ? arr[lo] : arr[lo]*(1-frac) + arr[hi]*frac;
      cuts.push(v);
    }
    return cuts; // ascending length = parts-1
  }
  function binByCuts(v, cuts, parts){
    if (!cuts.length) return 1;
    for (let i=0;i<cuts.length;i++){ if (v <= cuts[i]) return i+1; }
    return parts;
  }

  // ==============================
  // VISIBLE (Viewport-limited)
  // ==============================
  function recomputeVisibleSets() {
    if (!map || !countiesGeoJSON || !map.getSource('counties')) return;

    const bounds = map.getBounds();
    visibleProjectIdxs = new Set();
    visibleCountyIds = new Set();
    visibleStates = new Set();

    const bboxPoly = turf.bboxPolygon([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]);

    (countiesGeoJSON.features || []).forEach(f => {
      const id = extractCountyIdFromFeature(f);
      if (!id || !activeCountyIds.has(id)) return;
      if (turf.booleanIntersects(f, bboxPoly)) visibleCountyIds.add(id);
    });

    activeProjectIdxs.forEach(idx => {
      const p = allProjects[idx];
      if (p.countyIds.some(fips => visibleCountyIds.has(fips))) visibleProjectIdxs.add(idx);
    });

    stateIndex.forEach((entry, stateName) => {
      let hasVisible = false;
      entry.countyIds.forEach(fips => { if (visibleCountyIds.has(fips)) hasVisible = true; });
      if (!hasVisible) entry.projectIdxs.forEach(idx => { if (visibleProjectIdxs.has(idx)) hasVisible = true; });
      if (hasVisible && (stateName && stateName.trim() !== '')) visibleStates.add(stateName);
    });
  }

  // ==============================
  // LIST RENDERING (paged)
  // ==============================
  function currentListMode() {
    const r = document.querySelector('input[name="which-list"]:checked');
    return r ? r.value : 'projects';
  }
  function renderCurrentList(resetCursor=false) {
    const mode = currentListMode();
    toggleListVisibility(mode);

    if (mode === 'projects') {
      if (resetCursor) listCursorProjects = 0;
      renderProjectsList();
    } else if (mode === 'counties') {
      if (resetCursor) listCursorCounties = 0;
      renderCountiesList();
    } else {
      if (resetCursor) listCursorStates = 0;
      renderStatesList();
    }
  }
  function toggleListVisibility(mode) {
    if (!listProjectsEl || !listCountiesEl || !listStatesEl) return;
    listProjectsEl.style.display = (mode === 'projects') ? 'flex' : 'none';
    listCountiesEl.style.display = (mode === 'counties') ? 'flex' : 'none';
    listStatesEl.style.display   = (mode === 'states')   ? 'flex' : 'none';
  }

  // ----- Projects -----
  function renderProjectsList() {
    clear(listProjectsEl);
    const sort = document.getElementById('sort-by')?.value || 'mw-desc';
    let arr = Array.from(visibleProjectIdxs);
    arr.sort((a,b)=>projectSort(allProjects[a], allProjects[b], sort));
    const slice = arr.slice(0, listCursorProjects + LIST_PAGE_SIZE);
    slice.forEach(idx => listProjectsEl.appendChild(makeProjectCard(allProjects[idx])));
    listCursorProjects = slice.length;
    if (slice.length < arr.length) addLoadMore(listProjectsEl, () => renderProjectsListNext(arr));
  }
  function renderProjectsListNext(arr) {
    removeLoadMore(listProjectsEl);
    const next = arr.slice(listCursorProjects, listCursorProjects + LIST_PAGE_SIZE);
    next.forEach(idx => listProjectsEl.appendChild(makeProjectCard(allProjects[idx])));
    listCursorProjects += next.length;
    if (listCursorProjects < arr.length) addLoadMore(listProjectsEl, () => renderProjectsListNext(arr));
  }
  function projectSort(a, b, sort) {
    if (sort === 'mw-desc') return (b.mwSize||0) - (a.mwSize||0);
    if (sort === 'title-az') return a.title.localeCompare(b.title);
    if (sort === 'opdate-asc') return (a.opDate?.getTime() || 0) - (b.opDate?.getTime() || 0);
    if (sort === 'opdate-desc') return (b.opDate?.getTime() || 0) - (a.opDate?.getTime() || 0);
    return 0;
  }
  function makeProjectCard(rec) {
    if (savedProjectTemplate) {
      const node = savedProjectTemplate.cloneNode(true);
      setField(node, 'title', rec.title);
      setField(node, 'technology-1', rec.tech1);
      setField(node, 'technology-2', rec.tech2);
      setField(node, 'technology-3', rec.tech3);
      setField(node, 'stage', rec.stage);
      setField(node, 'location-text', rec.locationText);
      setField(node, 'developer-text', rec.developerText);
      setField(node, 'total-mw', formatNumber(rec.mwSize || 0));
      setField(node, 'operation-date', rec.opDate ? rec.opDate.toISOString().substring(0,10) : '');
      return node;
    } else {
      const div = document.createElement('div');
      div.className = 'project-card';
      div.style.cssText = 'border:1px solid #eee; padding:10px;';
      div.innerHTML = `
        <div><strong>${escapeHtml(rec.title)}</strong></div>
        <div>${escapeHtml(rec.locationText)}</div>
        <div>${escapeHtml([rec.tech1, rec.tech2, rec.tech3].filter(Boolean).join(' • '))}</div>
        <div>Stage: ${escapeHtml(rec.stage)}</div>
        <div>MW: ${formatNumber(rec.mwSize || 0)}</div>
        <div>Operation: ${rec.opDate ? rec.opDate.toISOString().substring(0,10) : ''}</div>
      `;
      return div;
    }
  }

  // ----- Counties -----
  function renderCountiesList() {
    clear(listCountiesEl);
    const sort = document.getElementById('sort-by')?.value || 'mw-desc';
    let arr = Array.from(visibleCountyIds).filter(fips => countyTotals.has(fips));
    arr.sort((a,b) => {
      const A = countyTotals.get(a)?.totalMW || 0;
      const B = countyTotals.get(b)?.totalMW || 0;
      if (sort === 'mw-desc') return B - A;
      if (sort === 'title-az') {
        const ta = (countyById.get(a)?.title || a);
        const tb = (countyById.get(b)?.title || b);
        return String(ta).localeCompare(String(tb));
      }
      return B - A;
    });
    const slice = arr.slice(0, listCursorCounties + LIST_PAGE_SIZE);
    slice.forEach(fips => listCountiesEl.appendChild(makeCountyCard(fips)));
    listCursorCounties = slice.length;
    if (slice.length < arr.length) addLoadMore(listCountiesEl, () => renderCountiesListNext(arr));
  }
  function renderCountiesListNext(arr) {
    removeLoadMore(listCountiesEl);
    const next = arr.slice(listCursorCounties, listCursorCounties + LIST_PAGE_SIZE);
    next.forEach(fips => listCountiesEl.appendChild(makeCountyCard(fips)));
    listCursorCounties += next.length;
    if (listCursorCounties < arr.length) addLoadMore(listCountiesEl, () => renderCountiesListNext(arr));
  }
  function makeCountyCard(fips) {
    const cInfo = countyById.get(fips);
    const totals = countyTotals.get(fips) || { totalMW: 0, totalProjects: 0 };
    const ord   = countyOrdScores.get(fips) || { wind:null, solar:null, storage:null, totalAvg:null, incWind:false, incSolar:false, incStorage:false };

    if (savedCountyTemplate) {
      const node = savedCountyTemplate.cloneNode(true);
      setField(node, 'title', cInfo?.title || fips);
      setField(node, 'total-projects', totals.totalProjects);
      setField(node, 'total-mw', formatNumber(totals.totalMW || 0));

      // Ordinance fields
      setField(node, 'wind-ordinance-score',    ord.wind    != null ? round1(ord.wind)    : '');
      setField(node, 'solar-ordinance-score',   ord.solar   != null ? round1(ord.solar)   : '');
      setField(node, 'storage-ordinance-score', ord.storage != null ? round1(ord.storage) : '');
      setField(node, 'total-ordinance-score',   ord.totalAvg!= null ? round1(ord.totalAvg): '');

      // Wrappers: add/remove 'inactive'
      setWrapper(node, 'wind-ordinance-score',    ord.incWind    && ord.wind    != null);
      setWrapper(node, 'solar-ordinance-score',   ord.incSolar   && ord.solar   != null);
      setWrapper(node, 'storage-ordinance-score', ord.incStorage && ord.storage != null);
      setWrapper(node, 'total-ordinance-score',   ord.totalAvg   != null);

      return node;
    } else {
      const div = document.createElement('div');
      div.className = 'county-card';
      div.style.cssText = 'border:1px solid #eee; padding:10px;';
      div.innerHTML = `
        <div><strong>${escapeHtml(cInfo?.title || fips)}</strong></div>
        <div>Projects: ${totals.totalProjects}</div>
        <div>Total MW: ${formatNumber(totals.totalMW || 0)}</div>
        <div>Ord (W/S/St/Total): ${[
          ord.wind!=null?round1(ord.wind):'—',
          ord.solar!=null?round1(ord.solar):'—',
          ord.storage!=null?round1(ord.storage):'—',
          ord.totalAvg!=null?round1(ord.totalAvg):'—'
        ].join(' / ')}</div>
      `;
      return div;
    }
  }

  // ----- States -----
  function renderStatesList() {
    clear(listStatesEl);
    const sort = document.getElementById('sort-by')?.value || 'mw-desc';
    let arr = Array.from(visibleStates);
    arr.sort((sa, sb) => {
      const A = stateTotals.get(sa)?.totalMW || 0;
      const B = stateTotals.get(sb)?.totalMW || 0;
      if (sort === 'mw-desc') return B - A;
      if (sort === 'title-az') return sa.localeCompare(sb);
      return B - A;
    });
    const slice = arr.slice(0, listCursorStates + LIST_PAGE_SIZE);
    slice.forEach(st => listStatesEl.appendChild(makeStateCard(st)));
    listCursorStates = slice.length;
    if (slice.length < arr.length) addLoadMore(listStatesEl, () => renderStatesListNext(arr));
  }
  function renderStatesListNext(arr) {
    removeLoadMore(listStatesEl);
    const next = arr.slice(listCursorStates, listCursorStates + LIST_PAGE_SIZE);
    next.forEach(st => listStatesEl.appendChild(makeStateCard(st)));
    listCursorStates += next.length;
    if (listCursorStates < arr.length) addLoadMore(listStatesEl, () => renderStatesListNext(arr));
  }
  function makeStateCard(stateName) {
    const totals = stateTotals.get(stateName) || { totalMW:0, totalProjects:0, totalCounties:0 };
    const ord    = stateOrdScores.get(stateName) || { windAvg:null, solarAvg:null, storageAvg:null, totalAvg:null };

    if (savedStateTemplate) {
      const node = savedStateTemplate.cloneNode(true);
      setField(node, 'title', stateName);
      setField(node, 'total-projects', totals.totalProjects);
      setField(node, 'total-counties', totals.totalCounties);
      setField(node, 'total-mw', formatNumber(totals.totalMW || 0));

      setField(node, 'wind-ordinance-score',    ord.windAvg    != null ? round1(ord.windAvg)    : '');
      setField(node, 'solar-ordinance-score',   ord.solarAvg   != null ? round1(ord.solarAvg)   : '');
      setField(node, 'storage-ordinance-score', ord.storageAvg != null ? round1(ord.storageAvg) : '');
      setField(node, 'total-ordinance-score',   ord.totalAvg   != null ? round1(ord.totalAvg)   : '');

      setWrapper(node, 'wind-ordinance-score',    ord.windAvg    != null);
      setWrapper(node, 'solar-ordinance-score',   ord.solarAvg   != null);
      setWrapper(node, 'storage-ordinance-score', ord.storageAvg != null);
      setWrapper(node, 'total-ordinance-score',   ord.totalAvg   != null);

      return node;
    } else {
      const div = document.createElement('div');
      div.className = 'state-card';
      div.style.cssText = 'border:1px solid #eee; padding:10px;';
      div.innerHTML = `
        <div><strong>${escapeHtml(stateName)}</strong></div>
        <div>Projects: ${totals.totalProjects}</div>
        <div>Counties: ${totals.totalCounties}</div>
        <div>Total MW: ${formatNumber(totals.totalMW || 0)}</div>
        <div>Ord (W/S/St/Total): ${[
          ord.windAvg!=null?round1(ord.windAvg):'—',
          ord.solarAvg!=null?round1(ord.solarAvg):'—',
          ord.storageAvg!=null?round1(ord.storageAvg):'—',
          ord.totalAvg!=null?round1(ord.totalAvg):'—'
        ].join(' / ')}</div>
      `;
      return div;
    }
  }

  // ==============================
  // UI WIRING
  // ==============================
  function wireUI() {
    // Search
    const search = document.getElementById('project-search');
    if (search) {
      let t;
      search.addEventListener('input', function () {
        clearTimeout(t);
        t = setTimeout(onAnyFilterChanged, 200);
      });
    }

    // Tech + Stage
    Array.from(document.querySelectorAll('input[type="checkbox"][data-role="heat-toggle"]'))
      .forEach(cb => cb.addEventListener('change', onAnyFilterChanged));
    Array.from(document.querySelectorAll('input[type="checkbox"][data-role="stage-filter"]'))
      .forEach(cb => cb.addEventListener('change', onAnyFilterChanged));

    // NEW: Map color toggles
    Array.from(document.querySelectorAll('input[type="checkbox"][data-role="color-toggle"]'))
      .forEach(cb => cb.addEventListener('change', onAnyFilterChanged));

    // State checkbox group
    document.getElementById('state-select-all')?.addEventListener('click', () => { setAllChecks(stateBoxWrap, true); onAnyFilterChanged(); });
    document.getElementById('state-deselect-all')?.addEventListener('click', () => { setAllChecks(stateBoxWrap, false); onAnyFilterChanged(); });
    stateBoxWrap?.addEventListener('change', (e) => { if (e.target && e.target.matches('input.state-box')) onAnyFilterChanged(); });

    // Developer checkbox group
    document.getElementById('developer-select-all')?.addEventListener('click', () => { setAllChecks(devBoxWrap, true); onAnyFilterChanged(); });
    document.getElementById('developer-deselect-all')?.addEventListener('click', () => { setAllChecks(devBoxWrap, false); onAnyFilterChanged(); });
    devBoxWrap?.addEventListener('change', (e) => { if (e.target && e.target.matches('input.dev-box')) onAnyFilterChanged(); });

    // MW apply
    document.getElementById('mw-apply')?.addEventListener('click', onAnyFilterChanged);

    // Operation date mode toggle
    const modeSel = document.getElementById('opdate-mode');
    const dateB = document.getElementById('opdate-b');
    modeSel?.addEventListener('change', () => { dateB.style.display = (modeSel.value === 'between') ? '' : 'none'; });
    document.getElementById('opdate-apply')?.addEventListener('click', onAnyFilterChanged);

    // List switcher + sort
    Array.from(document.querySelectorAll('input[name="which-list"]')).forEach(r => r.addEventListener('change', () => { renderCurrentList(true); }));
    document.getElementById('sort-by')?.addEventListener('change', () => renderCurrentList(true));

    // Clear all filters (select all / reset ranges & dates)
    document.getElementById('clear-all-filters')?.addEventListener('click', () => {
      Array.from(document.querySelectorAll('input[type="checkbox"][data-role="heat-toggle"]')).forEach(cb => cb.checked = true);
      Array.from(document.querySelectorAll('input[type="checkbox"][data-role="stage-filter"]')).forEach(cb => cb.checked = true);
      Array.from(document.querySelectorAll('input[type="checkbox"][data-role="color-toggle"]')).forEach(cb => cb.checked = true);
      setAllChecks(stateBoxWrap, true);
      setAllChecks(devBoxWrap, true);
      const minEl = document.getElementById('mw-min'); if (minEl) minEl.value = '';
      const maxEl = document.getElementById('mw-max'); if (maxEl) maxEl.value = '';
      const aEl = document.getElementById('opdate-a'); if (aEl) aEl.value = '';
      const bEl = document.getElementById('opdate-b'); if (bEl) { bEl.value = ''; bEl.style.display = 'none'; }
      const modeSel = document.getElementById('opdate-mode'); if (modeSel) modeSel.value = 'any';
      const search = document.getElementById('project-search'); if (search) search.value = '';
      onAnyFilterChanged();
    });
  }

  function setAllChecks(wrapper, checked) {
    if (!wrapper) return;
    Array.from(wrapper.querySelectorAll('input[type="checkbox"]')).forEach(cb => cb.checked = !!checked);
  }

  function onAnyFilterChanged() {
    recomputeActiveSets();
    recomputeOrdinanceCaches();       // NEW
    updateGlobalCounters();
    paintCountiesByActiveMW();        // now paints univariate/bivariate
    recomputeVisibleSets();
    updateVisibleCounters();
    renderCurrentList(true);
    updateURLFromFilters();
  }

  // ==============================
  // URL SYNC (save/restore)
  // ==============================
  function updateURLFromFilters() {
    const params = new URLSearchParams();

    // Tech (only store if not all)
    const techBoxes = Array.from(document.querySelectorAll('input[type="checkbox"][data-role="heat-toggle"]'));
    const techs = techBoxes.filter(cb => cb.checked).map(cb => cb.value);
    const allTechs = ['Wind','Solar','Storage'];
    if (techs.length && techs.length < allTechs.length) params.set('tech', techs.map(encodeURIComponent).join(','));

    // Stage (only store if not all)
    const stageBoxes = Array.from(document.querySelectorAll('input[type="checkbox"][data-role="stage-filter"]'));
    const stages = stageBoxes.filter(cb => cb.checked).map(cb => cb.value);
    if (stages.length && stages.length < STAGE_VALUES.length) params.set('stage', stages.map(encodeURIComponent).join(','));

    // Map color toggles
    const colorBoxes = Array.from(document.querySelectorAll('input[type="checkbox"][data-role="color-toggle"]'));
    const colorsOn = colorBoxes.filter(cb => cb.checked).map(cb => cb.value);
    if (colorsOn.length && colorsOn.length < 2) params.set('color', colorsOn.join(','));

    // States / Developers: store deselected lists
    const stateOff = Array.from(stateBoxWrap?.querySelectorAll('input.state-box') || []).filter(cb => !cb.checked).map(cb => cb.value);
    if (stateOff.length) params.set('states_off', stateOff.map(encodeURIComponent).join(','));

    const devOff = Array.from(devBoxWrap?.querySelectorAll('input.dev-box') || []).filter(cb => !cb.checked).map(cb => cb.value);
    if (devOff.length) params.set('dev_off', devOff.map(encodeURIComponent).join(','));

    // MW
    const minVal = document.getElementById('mw-min')?.value || '';
    const maxVal = document.getElementById('mw-max')?.value || '';
    if (minVal || maxVal) params.set('mw', `${minVal}-${maxVal}`);

    // Operation date
    const mode = document.getElementById('opdate-mode')?.value || 'any';
    const a = document.getElementById('opdate-a')?.value || '';
    const b = document.getElementById('opdate-b')?.value || '';
    if (mode !== 'any' || a || b) {
      const parts = [mode];
      if (a) parts.push(a);
      if (b) parts.push(b);
      params.set('op', parts.map(encodeURIComponent).join('|'));
    }

    // Search
    const q = (document.getElementById('project-search')?.value || '').trim();
    if (q) params.set('q', encodeURIComponent(q));

    const qs = params.toString();
    const newUrl = `${location.pathname}${qs ? '?' + qs : ''}${location.hash}`;
    history.replaceState(null, '', newUrl);
  }

  function applyFiltersFromURL() {
    const urlParams = new URLSearchParams(location.search);
    if (!urlParams || [...urlParams.keys()].length === 0) return;

    const techParam = urlParams.get('tech');
    if (techParam != null) {
      const want = new Set(techParam.split(',').map(decodeURIComponent));
      Array.from(document.querySelectorAll('input[type="checkbox"][data-role="heat-toggle"]'))
        .forEach(cb => cb.checked = want.has(cb.value));
    }

    const stageParam = urlParams.get('stage');
    if (stageParam != null) {
      const want = new Set(stageParam.split(',').map(decodeURIComponent));
      Array.from(document.querySelectorAll('input[type="checkbox"][data-role="stage-filter"]'))
        .forEach(cb => cb.checked = want.has(cb.value));
    }

    // Map color toggles
    const colorParam = urlParams.get('color');
    if (colorParam != null) {
      const want = new Set(colorParam.split(','));
      Array.from(document.querySelectorAll('input[type="checkbox"][data-role="color-toggle"]'))
        .forEach(cb => cb.checked = want.has(cb.value));
    }

    // States/Developers off
    const statesOff = urlParams.get('states_off');
    if (statesOff != null && stateBoxWrap) {
      const off = new Set(statesOff.split(',').map(decodeURIComponent));
      Array.from(stateBoxWrap.querySelectorAll('input.state-box'))
        .forEach(cb => { cb.checked = !off.has(cb.value); });
    }

    const devsOff = urlParams.get('dev_off');
    if (devsOff != null && devBoxWrap) {
      const off = new Set(devsOff.split(',').map(decodeURIComponent));
      Array.from(devBoxWrap.querySelectorAll('input.dev-box'))
        .forEach(cb => { cb.checked = !off.has(cb.value); });
    }

    // MW
    const mw = urlParams.get('mw');
    if (mw) {
      const [minVal, maxVal] = mw.split('-');
      if (document.getElementById('mw-min')) document.getElementById('mw-min').value = minVal || '';
      if (document.getElementById('mw-max')) document.getElementById('mw-max').value = maxVal || '';
    }

    // Operation date
    const op = urlParams.get('op');
    if (op) {
      const parts = op.split('|').map(decodeURIComponent);
      const mode = parts[0] || 'any';
      const a = parts[1] || '';
      const b = parts[2] || '';
      const modeSel = document.getElementById('opdate-mode');
      const aEl = document.getElementById('opdate-a');
      const bEl = document.getElementById('opdate-b');
      if (modeSel) modeSel.value = mode;
      if (aEl) aEl.value = a;
      if (bEl) { bEl.value = b; bEl.style.display = (mode === 'between') ? '' : 'none'; }
    }

    // Search
    const q = urlParams.get('q');
    if (q && document.getElementById('project-search')) {
      document.getElementById('project-search').value = decodeURIComponent(q);
    }
  }

  // ==============================
  // LEGEND
  // ==============================
  function updateMapKey() {
  if (!mapKeyEl) return;
  const { mw: showMW, ord: showOrd } = colorToggles();

  const css = `
    <style>
      .legend { font: 12px/1.35 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding:10px; }
      .legend .title { font-weight: 800; margin-bottom: 6px; color:#0b1b3f; }
      .legend .subtitle { color:#6b7280; margin-bottom: 10px; }

      :root { --cell:18px; --gap:3px; }

      .legend .bi { display:flex; gap:10px; align-items:flex-start; }
      .legend .ycol { display:flex; flex-direction:column; align-items:flex-start; }
      .legend .ytitle { font-weight:600; color:#0b1b3f; margin-bottom:6px; } /* moved to top */
      .legend .yticks {
        display:flex; flex-direction:column; justify-content:space-between;
        height: calc(var(--cell)*3 + var(--gap)*2);
        color:#6b7280;
      }

      .legend .grid { display:grid;
        grid-template-columns: repeat(3, var(--cell));
        grid-template-rows: repeat(3, var(--cell));
        gap: var(--gap);
      }
      .legend .cell { width:var(--cell); height:var(--cell); border-radius:3px; box-shadow:inset 0 0 0 1px rgba(0,0,0,.08); }

      .legend .xlabel { display:flex; justify-content:space-between; color:#6b7280; margin-top:6px; }
      .legend .xtitle { text-align:center; font-weight:600; color:#0b1b3f; margin-top:2px; }

      .legend .bar { display:flex; gap:2px; }
      .legend .bar .swatch { width:24px; height:14px; border-radius:3px; box-shadow:inset 0 0 0 1px rgba(0,0,0,.08); }
      .legend .axis { display:flex; align-items:center; justify-content:space-between; color:#6b7280; margin-top:4px; }
    </style>
  `;

  if (showMW && showOrd) {
    const rowsForLegend = [BIV9[2], BIV9[1], BIV9[0]]; // top row = ordinance HIGH
    const gridCells = rowsForLegend.map(
      row => row.map(c => `<div class="cell" style="background:${c}"></div>`).join('')
    ).join('');

    mapKeyEl.innerHTML = css + `
      <div class="legend">
        <div class="bi">
          <div class="ycol">
            <div class="ytitle">Ordinance Workability</div>
            <div class="yticks" aria-hidden="true">
              <span>High</span>
              <span>Low</span>
            </div>
          </div>

          <div>
            <div class="grid" aria-label="Bivariate legend grid">${gridCells}</div>
            <div class="xlabel"><span>Low</span><span>High</span></div>
            <div class="xtitle">Energy Capacity</div>
          </div>
        </div>
      </div>
    `;
  } else if (showMW) {
    mapKeyEl.innerHTML = css + `
      <div class="legend">
        <div class="title">Energy Capacity</div>
        <div class="subtitle">Active MW (quintiles)</div>
        <div class="bar">${COLORS_MW_5.map(c=>`<div class="swatch" style="background:${c}"></div>`).join('')}</div>
        <div class="axis"><span>Low</span><span>High</span></div>
      </div>
    `;
  } else if (showOrd) {
    mapKeyEl.innerHTML = css + `
      <div class="legend">
        <div class="title">Ordinance Workability</div>
        <div class="subtitle">Average of enabled tech scores (quintiles)</div>
        <div class="bar">${COLORS_ORD_5.map(c=>`<div class="swatch" style="background:${c}"></div>`).join('')}</div>
        <div class="axis"><span>Low</span><span>High</span></div>
      </div>
    `;
  } else {
    mapKeyEl.innerHTML = css + `
      <div class="legend">
        <div class="title">No color layers active</div>
        <div class="subtitle">Enable Energy and/or Ordinance in “Map Coloring”.</div>
      </div>
    `;
  }
}
  // ==============================
  // HELPERS
  // ==============================
  function setField(root, field, value) {
    const el = root.querySelector('[data-field="' + field + '"]');
    if (el) el.textContent = value == null ? '' : String(value);
  }
  function setWrapper(root, wrapper, isActive) {
    const w = root.querySelector('[data-wrapper="' + wrapper + '"]');
    if (w) w.classList.toggle('inactive', !isActive);
  }
  function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); }
  function addLoadMore(parent, cb) {
    const btn = document.createElement('button');
    btn.textContent = 'Load more';
    btn.classList.add('button-load-more');
    btn.style.margin = '12px 0';
    btn.addEventListener('click', cb);
    btn.dataset.role = 'load-more';
    parent.appendChild(btn);
  }
  function removeLoadMore(parent) {
    const btn = parent?.querySelector('button[data-role="load-more"]');
    if (btn) btn.remove();
  }
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  }
  function setText(el, v) { if (el) el.textContent = String(v); }
  function formatNumber(n) { try { return new Intl.NumberFormat().format(n); } catch { return String(n); } }
  function formatNumberMWtoGW(mw) { const gw = (mw || 0) / 1000; return (Math.round(gw * 10) / 10).toFixed(1); }
  function round1(n){ return (Math.round(n*10)/10).toFixed(1); }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-'); }

// ==============================
// FEDERAL LANDS OVERLAY (toggle)
// ==============================
// Replace the two constants below once your tileset is live:
const FED_TOGGLE_SELECTOR = 'input[type="checkbox"][data-role="overlay-toggle"][value="federal-lands"]';

// If you used Mapbox Tilesets (Option A), set these:
const FED_TILESET_URL   = 'mapbox://urlstudio.461y96x1'; // e.g., mapbox://urlstudio.abc123
const FED_SOURCE_LAYER  = 'US_Fed_Lands_ESRI-6f7g6h'; // exact "source layer" name from the tileset page

// Internal IDs (unique, do not clash with your existing layers/sources)
const FED_SRC_ID  = 'federal-lands-src';
const FED_FILL_ID = 'federal-lands-fill';

// Call once, after the map is created & UI is present.
function setupFederalLandsOverlay() {
  const cb = document.querySelector(FED_TOGGLE_SELECTOR);
  if (!cb || !window.map) return;

  // Ensure layer exists when turned on
  function ensureLayer() {
    if (!map.getSource(FED_SRC_ID)) {
      map.addSource(FED_SRC_ID, { type: 'vector', url: FED_TILESET_URL });
    }
    if (!map.getLayer(FED_FILL_ID)) {
      // Add on top of everything (no "before" argument) so it is truly super‑imposed.
      map.addLayer({
        id: FED_FILL_ID,
        type: 'fill',
        source: FED_SRC_ID,
        'source-layer': FED_SOURCE_LAYER, // <-- must match tileset layer name exactly
        minzoom: 0,
        paint: {
          'fill-color': '#7c0e23',
          'fill-opacity': 0.7
        }
      });
    }
  }

  function setVisibility(show) {
    if (!map.getLayer(FED_FILL_ID)) return;
    map.setLayoutProperty(FED_FILL_ID, 'visibility', show ? 'visible' : 'none');
  }

  // Wire the checkbox (independent from your existing listeners)
  cb.addEventListener('change', () => {
    if (cb.checked) { ensureLayer(); setVisibility(true); }
    else { setVisibility(false); }
  });

  // If the page loads with the box pre‑checked, render the layer immediately.
  if (cb.checked) { ensureLayer(); setVisibility(true); }

  // If your style ever reloads, re-add the overlay when the toggle is on.
  map.on('styledata', () => {
    if (cb.checked && !map.getLayer(FED_FILL_ID)) {
      ensureLayer(); setVisibility(true);
    }
  });
}
  
})();
