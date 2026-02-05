
(function () {
  // ==============================
  // CONFIG
  // ==============================
  const API_BASE = 'https://pi-api-264542425514.us-central1.run.app';
  const MAP_STYLE = 'mapbox://styles/urlstudio/cmfplm2as00ez01ry7rla1mfl';
  const COUNTY_GEOJSON_URL = 'https://raw.githubusercontent.com/url-studio/map-data/main/county-data.geojson';

  // Color ramps (tweak freely)
  // 5-bin Energy (MW) ramp — indigo family
  const COLORS_MW_5 = ['#eef2ff','#c7d2fe','#a5b4fc','#818cf8','#6366f1'];
  // 5-bin Ordinance ramp — requested colors, low→high
  const COLORS_ORD_5 = ['#eea6b4', '#f8c9d2', '#f3d097', '#cbf1db', '#a5d6ab'];
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

  // Used for Govt. & Media records (State Abbreviation -> full state name)
const STATE_ABBR_TO_NAME = {
  AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California',
  CO:'Colorado', CT:'Connecticut', DE:'Delaware', FL:'Florida', GA:'Georgia',
  HI:'Hawaii', ID:'Idaho', IL:'Illinois', IN:'Indiana', IA:'Iowa',
  KS:'Kansas', KY:'Kentucky', LA:'Louisiana', ME:'Maine', MD:'Maryland',
  MA:'Massachusetts', MI:'Michigan', MN:'Minnesota', MS:'Mississippi', MO:'Missouri',
  MT:'Montana', NE:'Nebraska', NV:'Nevada', NH:'New Hampshire', NJ:'New Jersey',
  NM:'New Mexico', NY:'New York', NC:'North Carolina', ND:'North Dakota', OH:'Ohio',
  OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina',
  SD:'South Dakota', TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont',
  VA:'Virginia', WA:'Washington', WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming',
  DC:'District of Columbia'
};

  // ==============================
  // STATE
  // ==============================
  let map;
  let countiesGeoJSON = null;

  // ==============================
  // HOVER + FOCUS STATE
  // ==============================
  let countyIdProp = 'id';             // which property is the county ID (GEOID/FIPS/etc)
  let countyFeatureById = new Map();   // fips -> GeoJSON feature
  let hoveredCountyId = null;          // fips
  let focusedCountyId = null;          // fips (locked selection)
  // ==============================
  // PRIMARY SELECTION (Phase 3)
  // ==============================
  let focusedStateName = null;   // stateTitle (selected)
  let focusedProjectIdx = null;  // index in allProjects (selected)
  let savedStateCheckboxSnapshot = null; // Set<string> of checked states before state-click filter
  
  let focusedStateCountyIds = new Set();    // fips (for map outline)
  let focusedProjectCountyIds = new Set();  // fips (for map outline)
  
  let lastPrimaryModeBeforeFocus = null;    // remembers which first-layer tab user was on
  
  // Secondary dropdown tabs
  let stateDropdownTab = 'projects';
  let countyDropdownTab = 'projects';
  let projectDropdownTab = 'media';
  
  // Primary segmented UI refs
  let primarySegEl = null;
  let primaryResetBtn = null;
  let hoverPopup = null;

  // Base expressions cached from paintCounties()
  let countyBaseColorExpr = null;
  let countyBaseOpacityExpr = null;

  let allProjects = [];
  let allCounties = [];
  let countyById = new Map(); // key: FIPS

  // Govt. & Media dataset (secondary-tab only; does NOT affect map)
  let allGovMedia = [];                 // normalized records from /govMedia
  let govMediaByCounty = new Map();     // fips -> Set<idx in allGovMedia>
  let govMediaByState  = new Map();     // stateTitle -> Set<idx in allGovMedia>
  let govMediaLoadState = { loaded:false, loading:false, error:null };

    // NEW: State siting classifications (Airtable 📍 States table)
  let stateSitingByState = new Map(); 
  let stateSitingByAbbr  = new Map(); 
  let stateSitingLoadState = { loaded:false, loading:false, error:null };

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

  // NEW: Icon tertile cut caches (computed from ACTIVE items with ACTIVE scores)
  let tertileCuts = {
    county:  { wind: [], solar: [], storage: [] },
    state:   { wind: [], solar: [], storage: [] }
  };

  // Templates + cursors
  let savedProjectTemplate = null;
  let savedCountyTemplate = null;
  let savedStateTemplate = null;
  let savedGovMediaTemplate = null; // NEW
  let savedOrdinanceTemplate = null;       // NEW (Regulatory)
  let savedJurisdictionalTemplate = null;  // NEW (Regulatory)
  let savedBanMoratoriumTemplate = null;   // NEW (Regulatory)

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
    ensurePhase3Styles();
    initPrimarySegmentedUI();
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


    // Initial viewport (or apply county selection from URL)
    if (focusedCountyId) {
      const f = focusedCountyId;
      focusedCountyId = null; // let setFocusedCounty re-apply it cleanly
      setFocusedCounty(f, { zoom: true });
    } else {
      recomputeVisibleSets();
      updateVisibleCounters();
      renderCurrentList(true);
    }

wireUI();

// Start Govt. & Media fetch in the background (does NOT block initial load)
loadGovMediaDataInBackground();

    // NEW: fetch state siting classifications (does NOT block initial load)
loadStateSitingDataInBackground();

// Enable the Federal Lands overlay toggle (no impact on your other logic)
setupFederalLandsOverlay();

// NEW: fade + remove loading UI (min 2 seconds after page load)
dismissLoadingUI();

    }

  function captureTemplates() {
    const tProj = document.getElementById('project-card-template');
    if (tProj) { savedProjectTemplate = tProj.cloneNode(true); savedProjectTemplate.id=''; savedProjectTemplate.style.display=''; tProj.remove(); }
    const tCounty = document.getElementById('county-card-template');
    if (tCounty) { savedCountyTemplate = tCounty.cloneNode(true); savedCountyTemplate.id=''; savedCountyTemplate.style.display=''; tCounty.remove(); }
    const tState = document.getElementById('state-card-template');
    if (tState) { savedStateTemplate = tState.cloneNode(true); savedStateTemplate.id=''; savedStateTemplate.style.display=''; tState.remove(); }
      const tGov = document.getElementById('gov-media-card-template');
      if (tGov) {
        savedGovMediaTemplate = tGov.cloneNode(true);
        savedGovMediaTemplate.id = '';
        savedGovMediaTemplate.style.display = '';
        tGov.remove();
      }
        // NEW: Regulatory templates
    const tOrd = document.getElementById('ordinance-card-template');
    if (tOrd) {
      savedOrdinanceTemplate = tOrd.cloneNode(true);
      savedOrdinanceTemplate.id = '';
      savedOrdinanceTemplate.style.display = '';
      tOrd.remove();
    }

    const tJur = document.getElementById('jurisdictional-card-template');

    // NEW: Ban / Moratorium template
    const tBan = document.getElementById('ban-moratorium-card-template');
    if (tBan) {
      savedBanMoratoriumTemplate = tBan.cloneNode(true);
      savedBanMoratoriumTemplate.id = '';
      savedBanMoratoriumTemplate.style.display = '';
      tBan.remove();
    }
    
    if (tJur) {
      savedJurisdictionalTemplate = tJur.cloneNode(true);
      savedJurisdictionalTemplate.id = '';
      savedJurisdictionalTemplate.style.display = '';
      tJur.remove();
    }
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

    // Determine the county ID property once and keep a quick lookup map
    countyIdProp = inferCountyIdProp(countiesGeoJSON) || 'id';
    countyFeatureById = new Map(
      (countiesGeoJSON.features || [])
        .map(f => [extractCountyIdFromFeature(f), f])
        .filter(([id]) => id)
    );

    // Promote the ID so we can use feature-state (fast hover/selection styling)
    map.addSource('counties', {
      type: 'geojson',
      data: countiesGeoJSON,
      promoteId: countyIdProp
    });

    map.addLayer({
      id: 'county-fills',
      type: 'fill',
      source: 'counties',
      paint: { 'fill-color': '#000000', 'fill-opacity': 0.0 }
    }, firstSymbolLayerId());

    // Overlay: draws ONLY the hovered/selected county at high opacity
       map.addLayer({
      id: 'county-focus-fill',
      type: 'fill',
      source: 'counties',
      paint: {
        'fill-color': '#000000',
        'fill-opacity': 0 // disabled: highlight is outline-only now
      }
    });

    map.addLayer({
      id: 'county-borders',
      type: 'line',
      source: 'counties',
      paint: { 'line-color': '#ffffff', 'line-width': 0.5, 'line-opacity': 0.4 }
    });

  // Outline: crisp border for hover/selected
    map.addLayer({
      id: 'county-focus-line',
      type: 'line',
      source: 'counties',
      paint: {
        'line-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false], '#0b1b3f',
          ['boolean', ['feature-state', 'hover'], false], '#0b1b3f',
          'rgba(0,0,0,0)'
        ],
        'line-width': [
          'case',
          ['boolean', ['feature-state', 'selected'], false], 2.6,
          ['boolean', ['feature-state', 'hover'], false], 2.0,
          0
        ],
        'line-opacity': 1
      }
    });

    map.on('moveend', () => {
      recomputeVisibleSets();
      updateVisibleCounters();
      renderCurrentList(true);
    });

    hoverPopup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      maxWidth: '340px'
    });

    wireMapInteractions();
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
  // ----- Projects (single fetch, cached server-side) -----
  const resAll = await fetch(API_BASE + '/developmentsAll');
  if (!resAll.ok) throw new Error('/developmentsAll failed: ' + resAll.status);
  const dataAll = await resAll.json();

  // keep your normalizer (safe)
  allProjects = (dataAll.records || []).map(normalizeProject).filter(Boolean);

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
    storageScore: parseScore(r.storageScore ?? r.Storage_Score),

    // NEW: Regulatory URLs coming from Cloud Run /counties payload
    jurisdictionalUrl: normalizeUrl(r.jurisdictionalUrl || ''),
    zoningOrdinanceUrl: normalizeUrl(r.zoningOrdinanceUrl || ''),
    // NEW: Ban / Moratorium flags (raw text: "0" | "2" | "")
    solarBan:        String(r.solarBan ?? '').trim(),
    windBan:         String(r.windBan ?? '').trim(),
    bessBan:         String(r.bessBan ?? '').trim(),
    solarMoratorium: String(r.solarMoratorium ?? '').trim(),
    windMoratorium:  String(r.windMoratorium ?? '').trim(),
    bessMoratorium:  String(r.bessMoratorium ?? '').trim(),
  })).filter(c => c.fips && c.title);

  countyById = new Map(allCounties.map(c => [c.fips, c]));
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

  // ==============================
// GOVT. & MEDIA (secondary tab)
// ==============================

function loadGovMediaDataInBackground() {
  if (govMediaLoadState.loading || govMediaLoadState.loaded) return;

  govMediaLoadState.loading = true;
  govMediaLoadState.error = null;

  fetch(API_BASE + '/govMedia')
    .then(res => {
      if (!res.ok) throw new Error('/govMedia failed: ' + res.status);
      return res.json();
    })
    .then(data => {
      allGovMedia = (data.records || []).map(normalizeGovMediaRecord).filter(Boolean);
      buildGovMediaIndexes();
    })
    .catch(err => {
      console.error('Govt. & Media fetch failed', err);
      govMediaLoadState.error = err;
    })
    .finally(() => {
      govMediaLoadState.loading = false;
      govMediaLoadState.loaded = true;

      // If user is already on Govt. & Media tab, rerender so list appears
      if (isGovMediaTabActiveForCurrentSelection()) {
        renderCurrentList(false);
      }
    });
}

function isGovMediaTabActiveForCurrentSelection() {
  if (focusedStateName && stateDropdownTab === 'media') return true;
  if (focusedCountyId && countyDropdownTab === 'media') return true;
  if (focusedProjectIdx != null && projectDropdownTab === 'media') return true;
  return false;
}

function normalizeGovMediaRecord(r) {
  if (!r) return null;

  const title = String(r.title || '').trim();
  const source = String(r.source || '').trim();
  const webpageUrl = normalizeUrl(r.webpageUrl);
  const type = String(r.type || '').trim();

  const stateAbbr = String(r.stateAbbr || '').trim().toUpperCase();
  const stateTitle = STATE_ABBR_TO_NAME[stateAbbr] || '';

  const countyFips = parseCountyFipsList(r.countyFips);
  const publishedDate = parseDateOnlyUTC(r.publishedDate);

  return {
    id: r.id,
    title,
    source,
    webpageUrl,
    countyFips,
    stateAbbr,
    stateTitle,
    publishedDate,
    type
  };
}

function normalizeUrl(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('//')) return 'https:' + s;
  return 'https://' + s;
}

// Accept comma/space/semicolon separated county FIPS; normalize to 5 digits
function parseCountyFipsList(raw) {
  const s = Array.isArray(raw) ? raw.join(',') : String(raw || '');
  return s
    .split(/[\s,;]+/g)
    .map(normalizeCountyFips)
    .filter(Boolean);
}

function normalizeCountyFips(tok) {
  let t = String(tok || '').trim();
  if (!t) return '';
  t = t.replace(/[^\d]/g, '');
  if (!t) return '';
  if (t.length < 5) t = t.padStart(5, '0');
  return t;
}

// Parse either `YYYY-MM-DD` or full ISO; returns a Date aligned to UTC date
function parseDateOnlyUTC(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const d = s.includes('T') ? new Date(s) : new Date(s + 'T00:00:00Z');
  return isNaN(d.getTime()) ? null : d;
}

function buildGovMediaIndexes() {
  govMediaByCounty.clear();
  govMediaByState.clear();

  allGovMedia.forEach((gm, idx) => {
    // Always link to state (even if also linked to counties)
    if (gm.stateTitle) {
      if (!govMediaByState.has(gm.stateTitle)) govMediaByState.set(gm.stateTitle, new Set());
      govMediaByState.get(gm.stateTitle).add(idx);
    }

    // Link to each county (if any)
    (gm.countyFips || []).forEach(fips => {
      if (!fips) return;
      if (!govMediaByCounty.has(fips)) govMediaByCounty.set(fips, new Set());
      govMediaByCounty.get(fips).add(idx);
    });
  });
}

function govMediaIdxsForState(stateTitle) {
  return Array.from(govMediaByState.get(stateTitle) || []);
}

function govMediaIdxsForCounty(fips) {
  return Array.from(govMediaByCounty.get(fips) || []);
}

// Project -> associated county -> show records linked to that county
function govMediaIdxsForProject(projectIdx) {
  const p = allProjects[projectIdx];
  const primaryFips = (p && Array.isArray(p.countyIds) && p.countyIds[0]) ? String(p.countyIds[0]) : '';
  return primaryFips ? govMediaIdxsForCounty(primaryFips) : [];
}

function renderGovMediaCardsInContainer(container, idxArr, emptySubject) {
  if (!container) return;
  clear(container);

  // Ensure fetch is started (but never awaited)
  loadGovMediaDataInBackground();

  // Loading / error states
  if (!govMediaLoadState.loaded) {
    const msg = document.createElement('div');
    msg.className = 'dropdown-empty';
    msg.textContent = 'Loading Government and Media assets…';
    container.appendChild(msg);
    return;
  }
  if (govMediaLoadState.error) {
    const msg = document.createElement('div');
    msg.className = 'dropdown-empty';
    msg.textContent = 'Unable to load Government and Media assets.';
    container.appendChild(msg);
    return;
  }

  const arr = (idxArr || []).filter(i => allGovMedia[i]);

  // Sort newest first
  arr.sort((a, b) => {
    const A = allGovMedia[a];
    const B = allGovMedia[b];
    const ta = A?.publishedDate ? A.publishedDate.getTime() : 0;
    const tb = B?.publishedDate ? B.publishedDate.getTime() : 0;
    if (tb !== ta) return tb - ta;
    return String(A?.title || '').localeCompare(String(B?.title || ''));
  });

  if (!arr.length) {
    const msg = document.createElement('div');
    msg.className = 'dropdown-empty';
    msg.textContent = `The selected ${emptySubject} does not currently have any Government or Media assets.`;
    container.appendChild(msg);
    return;
  }

  let cursor = 0;
  const renderMore = () => {
    removeLoadMore(container);
    const next = arr.slice(cursor, cursor + LIST_PAGE_SIZE);
    next.forEach(i => container.appendChild(makeGovMediaCard(allGovMedia[i])));
    cursor += next.length;
    if (cursor < arr.length) addLoadMore(container, renderMore);
  };
  renderMore();
}

function makeGovMediaCard(rec) {
  if (!rec) return document.createElement('div');

  if (savedGovMediaTemplate) {
    const node = savedGovMediaTemplate.cloneNode(true);

    // Link the card to Webpage URL (open in new tab)
    attachGovMediaLink(node, rec.webpageUrl);

    // data-field mappings (remove elements if missing)
    setFieldOrRemove(node, 'title', rec.title);
    setFieldOrRemove(node, 'media-source', rec.source);

    // Location label:
    // - If county-linked: "Dallas County, TX" (from your county title)
    // - Else: "New York" (state name)
    const loc = computeGovMediaLocationLabel(rec);
    setFieldOrRemove(node, 'location', loc);

    // Published Date -> "November 10, 2025"
    const dateText = rec.publishedDate ? formatLongUSDate(rec.publishedDate) : '';
    setFieldOrRemove(node, 'published-date', dateText);

    // Type chips
    const type = String(rec.type || '').trim();
    const mediaEl = node.querySelector('[data-element="type-media"]');
    const govEl   = node.querySelector('[data-element="type-government"]');

    if (type === 'Media') {
      if (mediaEl) mediaEl.style.display = 'flex';
    } else if (mediaEl) {
      mediaEl.remove();
    }

    if (type === 'Government') {
      if (govEl) govEl.style.display = 'flex';
    } else if (govEl) {
      govEl.remove();
    }

    return node;
  }

  // Fallback (if template missing)
  const div = document.createElement('div');
  div.style.cssText = 'border:1px solid #eee; padding:10px;';
  div.textContent = rec.title || '(Untitled)';
  attachGovMediaLink(div, rec.webpageUrl);
  return div;
}

function attachGovMediaLink(node, url) {
  const u = String(url || '').trim();
  if (!u) return;

  const tag = (node.tagName || '').toLowerCase();

  // If template root is an <a>, set href/target/rel
  if (tag === 'a') {
    node.href = u;
    node.target = '_blank';
    node.rel = 'noopener noreferrer';
    return;
  }

  // Otherwise, make div act like a link
  node.style.cursor = 'pointer';
  node.setAttribute('role', 'link');
  node.setAttribute('tabindex', '0');

  const open = () => window.open(u, '_blank', 'noopener,noreferrer');

  node.addEventListener('click', (e) => {
    e.preventDefault();
    open();
  });

  node.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  });
}

function computeGovMediaLocationLabel(rec) {
  const fipsArr = Array.isArray(rec.countyFips) ? rec.countyFips : [];
  if (fipsArr.length) {
    const names = fipsArr.map(f => countyById.get(f)?.title || '').filter(Boolean);
    return names.length ? names.join(' • ') : fipsArr.join(' • ');
  }
  return rec.stateTitle || '';
}

function formatLongUSDate(dateObj) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC'
    }).format(dateObj);
  } catch {
    return '';
  }
}

function setFieldOrRemove(root, field, value) {
  const el = root.querySelector('[data-field="' + field + '"]');
  if (!el) return;
  const v = value == null ? '' : String(value).trim();
  if (!v) { el.remove(); return; }
  el.textContent = v;
}

  // ==============================
// STATES: Siting classification blocks (state-card-template)
// ==============================

function setStateSitingBlock(root, elementName, textFieldName, value) {
  const wrap = root?.querySelector?.(`[data-element="${elementName}"]`);
  if (!wrap) return;

  const v = value == null ? '' : String(value).trim();

  if (!v) {
    // Hide entirely when empty (matches your “removed/hidden altogether” requirement)
    wrap.style.display = 'none';
    const t = wrap.querySelector(`[data-field="${textFieldName}"]`);
    if (t) t.textContent = '';
    return;
  }

  wrap.style.display = 'flex';
  const textEl =
    wrap.querySelector(`[data-field="${textFieldName}"]`) ||
    root.querySelector(`[data-field="${textFieldName}"]`);

  if (textEl) textEl.textContent = v;
}

function applyStateSitingBlocks(root, stateNameOrAbbr) {
  const key = String(stateNameOrAbbr || '').trim();
  const meta =
    stateSitingByState.get(key) ||
    stateSitingByAbbr.get(key.toUpperCase()) ||
    null;

  // If we don't have data yet (or no record), hide all 5 blocks
  setStateSitingBlock(root, 'predominantly-state-siting', 'predominantly-state-siting-text', meta?.predominantlyStateSiting);
  setStateSitingBlock(root, 'state-local-hybrid',         'state-local-hybrid-text',         meta?.stateLocalHybrid);
  setStateSitingBlock(root, 'state-guardrails',           'state-guardrails-text',           meta?.stateGuardrails);
  setStateSitingBlock(root, 'local-siting',               'local-siting-text',               meta?.localSiting);
  setStateSitingBlock(root, 'minimal-siting',             'minimal-siting-text',             meta?.minimalSiting);
}

// Update any state cards already rendered into #states-list
function refreshVisibleStateSitingUI() {
  if (!listStatesEl) return;
  Array.from(listStatesEl.children).forEach(node => {
    const st = node?.dataset?.state;
    if (!st) return;
    applyStateSitingBlocks(node, st);
  });
}

// Background fetch (mirrors your Govt/Media pattern; never blocks initial load)
function loadStateSitingDataInBackground() {
  if (stateSitingLoadState.loading || stateSitingLoadState.loaded) return;

  stateSitingLoadState.loading = true;
  stateSitingLoadState.error = null;

  fetch(API_BASE + '/states')
    .then(res => {
      if (!res.ok) throw new Error('/states failed: ' + res.status);
      return res.json();
    })
    .then(data => {
      stateSitingByState.clear();
      stateSitingByAbbr.clear();

      (data.records || []).forEach(r => {
        const abbr = String(r.abbr || r.abbreviation || '').trim().toUpperCase();
        if (!abbr) return;

        const meta = {
          predominantlyStateSiting: String(r.predominantlyStateSiting || '').trim(),
          stateLocalHybrid:         String(r.stateLocalHybrid || '').trim(),
          stateGuardrails:          String(r.stateGuardrails || '').trim(),
          localSiting:              String(r.localSiting || '').trim(),
          minimalSiting:            String(r.minimalSiting || '').trim()
        };

        // Store by abbr (for robustness)
        stateSitingByAbbr.set(abbr, meta);

        // Store by full state name (matches your state cards)
        const full = STATE_ABBR_TO_NAME[abbr] || '';
        if (full) stateSitingByState.set(full, meta);
      });

      // Update any already-rendered state cards (no rerender needed)
      refreshVisibleStateSitingUI();
    })
    .catch(err => {
      console.error('State siting fetch failed', err);
      stateSitingLoadState.error = err;
    })
    .finally(() => {
      stateSitingLoadState.loading = false;
      stateSitingLoadState.loaded = true;
    });
}

  // ==============================
// REGULATORY (secondary tab)
// ==============================

// For Regulatory cards, templates use: [data-title="county-name"]
function setDataTitle(root, key, value) {
  const el = root?.querySelector?.(`[data-title="${key}"]`);
  if (!el) return;
  el.textContent = value == null ? '' : String(value);
}

  // NEW: helper for ban/moratorium fields ("2" => ✅ No ..., "0" => ⚠️ ...)
function addBanMoratoriumSummary(out, rawValue, textWhen2, textWhen0) {
  const v = rawValue == null ? '' : String(rawValue).trim();
  if (v === '2') out.push(textWhen2);
  else if (v === '0') out.push(textWhen0);
}

// NEW: build a Ban/Moratorium card from the template
function makeBanMoratoriumRegCard(summaryText) {
  if (savedBanMoratoriumTemplate) {
    const node = savedBanMoratoriumTemplate.cloneNode(true);
    setField(node, 'summary', summaryText); // template has [data-field="summary"]
    return node;
  }

  // Fallback if template missing
  const div = document.createElement('div');
  div.style.cssText = 'border:1px solid #eee; padding:10px;';
  div.textContent = summaryText;
  return div;
}

// Render 0–2 cards (jurisdictional + ordinance) or the empty message
// Render 0–8 cards (0–6 ban/moratorium + optional jurisdictional + ordinance) or the empty message
function renderRegulatoryCardsInContainer(container, countyFips) {
  if (!container) return;
  clear(container);

  const fips = String(countyFips || '').trim();
  const c = fips ? countyById.get(fips) : null;

  const countyName = String(c?.title || '').trim() || (fips || 'Unknown county');

  const jurUrl = normalizeUrl(c?.jurisdictionalUrl || '');
  const ordUrl = normalizeUrl(c?.zoningOrdinanceUrl || '');

  const hasJur = !!jurUrl;
  const hasOrd = !!ordUrl;

  // NEW: Ban/Moratorium summary cards driven by Airtable raw text fields
  const bm = [];
  addBanMoratoriumSummary(bm, c?.solarBan,        '✅ No Solar Ban',        '⚠️ Solar Ban');
  addBanMoratoriumSummary(bm, c?.windBan,         '✅ No Wind Ban',         '⚠️ Wind Ban');
  addBanMoratoriumSummary(bm, c?.bessBan,         '✅ No BESS Ban',         '⚠️ BESS Ban');
  addBanMoratoriumSummary(bm, c?.solarMoratorium, '✅ No Solar Moratorium', '⚠️ Solar Moratorium');
  addBanMoratoriumSummary(bm, c?.windMoratorium,  '✅ No Wind Moratorium',  '⚠️ Wind Moratorium');
  addBanMoratoriumSummary(bm, c?.bessMoratorium,  '✅ No BESS Moratorium',  '⚠️ BESS Moratorium');

  const hasBM = bm.length > 0;

  // IMPORTANT: previously this only considered URLs; now it also considers ban/moratorium cards
  if (!hasJur && !hasOrd && !hasBM) {
    const msg = document.createElement('div');
    msg.className = 'dropdown-empty';
    msg.textContent = 'The selected county does not currently have any regulatory information.';
    container.appendChild(msg);
    return;
  }


  if (hasJur) container.appendChild(makeJurisdictionalRegCard(countyName, jurUrl));
  if (hasOrd) container.appendChild(makeOrdinanceRegCard(countyName, ordUrl));

  // Order: show ban/moratorium cards last (easy to scan), then link cards
  bm.forEach(text => container.appendChild(makeBanMoratoriumRegCard(text)));

}

function makeJurisdictionalRegCard(countyName, url) {
  if (savedJurisdictionalTemplate) {
    const node = savedJurisdictionalTemplate.cloneNode(true);

    // Link entire card to URL (reusing your existing link helper)
    attachGovMediaLink(node, url);

    // Set the [data-title="county-name"] text
    setDataTitle(node, 'county-name', countyName);

    return node;
  }

  // Fallback if template is missing
  const div = document.createElement('div');
  div.style.cssText = 'border:1px solid #eee; padding:10px;';
  div.textContent = `${countyName}`;
  attachGovMediaLink(div, url);
  return div;
}

function makeOrdinanceRegCard(countyName, url) {
  if (savedOrdinanceTemplate) {
    const node = savedOrdinanceTemplate.cloneNode(true);

    attachGovMediaLink(node, url);
    setDataTitle(node, 'county-name', countyName);

    return node;
  }

  const div = document.createElement('div');
  div.style.cssText = 'border:1px solid #eee; padding:10px;';
  div.textContent = `${countyName}`;
  attachGovMediaLink(div, url);
  return div;
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

  // 1) Original project-based matching (unchanged)
  const hay = [
    p.title, p.stage, p.developerText, p.locationText, p.tech1, p.tech2, p.tech3, p.stateTitle
  ].join(' ').toLowerCase();

  if (hay.includes(q)) return true;

  // 2) NEW: County + State record name matching (via the counties linked to this project)
  const ids = Array.isArray(p.countyIds) ? p.countyIds : [];
  for (const fips of ids) {
    const c = countyById.get(fips);
    if (!c) continue;

    const countyHay = `${c.title || ''} ${c.stateTitle || ''}`.toLowerCase();
    if (countyHay.includes(q)) return true;
  }

  return false;
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

    // NEW: Recompute icon tertile thresholds for counties & states
      computeIconTertiles();
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

    const keyProp = countyIdProp || inferCountyIdProp(countiesGeoJSON) || 'id';
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

    // Cache base expressions so we can dim/undim without recomputing bins
    countyBaseColorExpr = colorExpr;
    countyBaseOpacityExpr = opacityExpr;

    // Base fill colors
    map.setPaintProperty('county-fills', 'fill-color', countyBaseColorExpr);

    // Hover/selected overlay uses same fill colors as base
    if (map.getLayer('county-focus-fill')) {
      map.setPaintProperty('county-focus-fill', 'fill-color', countyBaseColorExpr);
    }

    // Always use the computed base opacity expression (no dimming)
    map.setPaintProperty('county-fills', 'fill-opacity', countyBaseOpacityExpr);

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
  // PHASE 2: MAP HOVER + COUNTY FOCUS
  // ==============================

  function wireMapInteractions() {
    if (!map || !map.getLayer('county-fills')) return;

    map.on('mouseenter', 'county-fills', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'county-fills', () => {
      map.getCanvas().style.cursor = '';
      setHoveredCounty(null);
      hideHoverPopup();
    });

    map.on('mousemove', 'county-fills', (e) => {
      const f = e.features && e.features[0];
      const id = f ? extractCountyIdFromFeature(f) : null;
      setHoveredCounty(id, e.lngLat);
    });

    map.on('click', 'county-fills', (e) => {
      const f = e.features && e.features[0];
      const id = f ? extractCountyIdFromFeature(f) : null;
      if (!id) return;
      toggleFocusedCounty(id);
    });
  }

  // ==============================
// PRIMARY SELECTION + SEGMENT COLLAPSE + DROPDOWNS
// ==============================

  function snapshotStateCheckboxes() {
  if (!stateBoxWrap) return null;
  return new Set(
    Array.from(stateBoxWrap.querySelectorAll('input.state-box'))
      .filter(cb => cb.checked)
      .map(cb => cb.value)
  );
}

function applyOnlyThisStateCheckbox(stateName) {
  if (!stateBoxWrap) return;
  Array.from(stateBoxWrap.querySelectorAll('input.state-box'))
    .forEach(cb => { cb.checked = (cb.value === stateName); });
}

function restoreStateCheckboxes(snapshot) {
  if (!stateBoxWrap || !snapshot) return;
  Array.from(stateBoxWrap.querySelectorAll('input.state-box'))
    .forEach(cb => { cb.checked = snapshot.has(cb.value); });
}

function hasSelection() {
  return (focusedProjectIdx != null) || !!focusedCountyId || !!focusedStateName;
}

function selectionPrimaryMode() {
  if (focusedProjectIdx != null) return 'projects';
  if (focusedCountyId) return 'counties';
  if (focusedStateName) return 'states';
  return null;
}

function currentPrimaryMode() {
  const r = document.querySelector('input[name="which-list"]:checked');
  return r ? r.value : 'projects';
}

function setPrimaryMode(mode) {
  const r = document.querySelector(`input[name="which-list"][value="${mode}"]`);
  if (r) r.checked = true;
}

function initPrimarySegmentedUI() {
  // Find the TOP segmented control (the one with name="which-list")
  const any = document.querySelector('input[name="which-list"]');
  if (!any) return;
  primarySegEl = any.closest('.segmented');
  if (!primarySegEl) return;

  if (!primaryResetBtn) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'seg-reset';
    btn.innerHTML = `<span class="seg-reset-icon" title="Reset selection">↩</span>`;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearFocusedSelection();
    });
    primaryResetBtn = btn;
    primarySegEl.insertBefore(btn, primarySegEl.firstChild);
  }

  updatePrimarySegmentedUI();
}

function setPrimaryPillHidden(mode, hidden) {
  if (!primarySegEl) return;
  const input = primarySegEl.querySelector(`input[name="which-list"][value="${mode}"]`);
  const label = input ? primarySegEl.querySelector(`label[for="${input.id}"]`) : null;
  if (input) input.classList.toggle('is-hidden', !!hidden);
  if (label) label.classList.toggle('is-hidden', !!hidden);
}

function updatePrimarySegmentedUI() {
  const mode = selectionPrimaryMode();
  const inSelection = !!mode;

  if (primaryResetBtn) primaryResetBtn.classList.toggle('is-visible', inSelection);

  // Unhide everything first
  ['projects','counties','states'].forEach(m => setPrimaryPillHidden(m, false));

  if (inSelection) {
    // Ensure the primary tab matches the selected record type
    setPrimaryMode(mode);

    // Hide the other two pills
    ['projects','counties','states'].forEach(m => setPrimaryPillHidden(m, m !== mode));
  }
}

function safeSetCountySelected(fips, selected) {
  if (!map || !fips) return;
  try {
    if (map.getSource('counties')) {
      map.setFeatureState({ source: 'counties', id: fips }, { selected: !!selected });
    }
  } catch {}
}

function clearSelectionStatesOnly() {
  // Only a directly-clicked COUNTY should ever be "selected" on the map.
  if (focusedCountyId) safeSetCountySelected(focusedCountyId, false);

  focusedStateCountyIds.clear();
  focusedProjectCountyIds.clear();

  focusedCountyId = null;
  focusedStateName = null;
  focusedProjectIdx = null;
}

function clearFocusedSelection({ restoreMode = true, rerender = true } = {}) {
  const hadSelection = hasSelection();

  // If a state-click forced the state checkbox filter, restore it on undo.
  const hadStateSnapshot = !!savedStateCheckboxSnapshot;

  clearSelectionStatesOnly();

  // Reset dropdown tabs
  stateDropdownTab = 'projects';
  countyDropdownTab = 'projects';
  projectDropdownTab = 'media';

  // Restore original primary mode
  if (restoreMode && lastPrimaryModeBeforeFocus) {
    setPrimaryMode(lastPrimaryModeBeforeFocus);
  }
  if (restoreMode) lastPrimaryModeBeforeFocus = null;

  updatePrimarySegmentedUI();

  // Restore state checkbox filter if it was forced by a state-record click
  if (hadStateSnapshot) {
    restoreStateCheckboxes(savedStateCheckboxSnapshot);
    savedStateCheckboxSnapshot = null;

    // Recompute everything because filters changed
    recomputeActiveSets();
    recomputeOrdinanceCaches();
    updateGlobalCounters();
    paintCountiesByActiveMW();
  }

  if (rerender && hadSelection) {
    recomputeVisibleSets();
    updateVisibleCounters();
    renderCurrentList(true);
    updateURLFromFilters();
  }
}

// ----- County selection -----
function canSelectCounty(fips) {
  return !!fips && countyById.has(fips) && activeCountyIds.has(fips);
}

function toggleFocusedCounty(fips) {
  if (!canSelectCounty(fips)) return;
  if (focusedCountyId === fips) {
    clearFocusedSelection();
    return;
  }
  setFocusedCounty(fips, { zoom: true });
}

function setFocusedCounty(fips, { zoom = true } = {}) {
  if (!canSelectCounty(fips)) return;

  if (!hasSelection()) lastPrimaryModeBeforeFocus = currentPrimaryMode();

  clearSelectionStatesOnly();

  focusedCountyId = fips;
  countyDropdownTab = 'projects';

  safeSetCountySelected(fips, true);

  // Collapse primary bar to "Counties"
  setPrimaryMode('counties');
  updatePrimarySegmentedUI();

  if (zoom) zoomToCounty(fips);

  recomputeVisibleSets();
  updateVisibleCounters();
  renderCurrentList(true);
  updateURLFromFilters();
}

// ----- State selection -----
function canSelectState(stateName) {
  return !!stateName && activeStates.has(stateName);
}

function toggleFocusedState(stateName) {
  if (!canSelectState(stateName)) return;
  if (focusedStateName === stateName) {
    clearFocusedSelection();
    return;
  }
  setFocusedState(stateName, { zoom: true });
}

function setFocusedState(stateName, { zoom = true } = {}) {
  if (!canSelectState(stateName)) return;

  if (!hasSelection()) lastPrimaryModeBeforeFocus = currentPrimaryMode();

  clearSelectionStatesOnly();

  focusedStateName = stateName;
  stateDropdownTab = 'projects';

  // Snapshot the current state checkbox selection once so undo can restore it
  if (!savedStateCheckboxSnapshot) {
    savedStateCheckboxSnapshot = snapshotStateCheckboxes();
  }

  // Force the state checkbox filter to ONLY this state (exactly like user filtering)
  applyOnlyThisStateCheckbox(stateName);

  setPrimaryMode('states');
  updatePrimarySegmentedUI();

  // Run the normal filter pipeline so totals + map update exactly like the filter UI
  onAnyFilterChanged();

  // IMPORTANT: Do NOT outline all counties in a state (no feature-state selected here)

  // Optional zoom
  if (zoom) {
    const entry = stateIndex.get(stateName);
    const fipsForZoom = entry ? Array.from(entry.countyIds).filter(f => countyFeatureById.has(f)) : [];
    zoomToCountySet(fipsForZoom, 6);
  }
}

// ----- Project selection -----
function canSelectProject(idx) {
  const i = Number(idx);
  return Number.isFinite(i) && activeProjectIdxs.has(i);
}

function toggleFocusedProject(idx) {
  if (!canSelectProject(idx)) return;
  const i = Number(idx);
  if (focusedProjectIdx === i) {
    clearFocusedSelection();
    return;
  }
  setFocusedProject(i, { zoom: true });
}

function setFocusedProject(idx, { zoom = true } = {}) {
  if (!canSelectProject(idx)) return;
  const i = Number(idx);

  if (!hasSelection()) lastPrimaryModeBeforeFocus = currentPrimaryMode();

  clearSelectionStatesOnly();

  focusedProjectIdx = i;
  projectDropdownTab = 'media';

  const p = allProjects[i];
  focusedProjectCountyIds.clear();
  (p?.countyIds || []).forEach(fips => {
    if (!fips) return;
    if (countyFeatureById.has(fips)) focusedProjectCountyIds.add(fips);
  });
  
  setPrimaryMode('projects');
  updatePrimarySegmentedUI();

  if (zoom) zoomToCountySet(Array.from(focusedProjectCountyIds), 8);

  recomputeVisibleSets();
  updateVisibleCounters();
  renderCurrentList(true);
  updateURLFromFilters();
}

// Zoom to a set of counties
function fitBoundsPaddingPx(rem = 5) {
  try {
    const fs = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const base = Number.isFinite(fs) ? fs : 16;
    return Math.round(base * rem);
  } catch {
    return Math.round(16 * rem);
  }
}
    
function zoomToCountySet(fipsArr, maxZoom = 8) {
  if (!map || !Array.isArray(fipsArr) || fipsArr.length === 0) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let any = false;

  fipsArr.forEach(fips => {
    const feat = countyFeatureById.get(fips);
    if (!feat) return;
    try {
      const b = turf.bbox(feat);
      minX = Math.min(minX, b[0]);
      minY = Math.min(minY, b[1]);
      maxX = Math.max(maxX, b[2]);
      maxY = Math.max(maxY, b[3]);
      any = true;
    } catch {}
  });

  if (!any) return;

    const pad = fitBoundsPaddingPx(5);
    
    map.fitBounds([[minX, minY], [maxX, maxY]], {
      padding: pad,
      duration: 650,
      maxZoom
    });
}

// ----- Dropdown builders -----
function buildDropdownTabs({ groupName, options, selectedValue, onChange }) {
  const seg = document.createElement('div');
  seg.className = 'segmented';

  options.forEach(opt => {
    const id = `${groupName}_${opt.value}`;
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = groupName;
    input.id = id;
    input.value = opt.value;
    input.checked = opt.value === selectedValue;

    input.addEventListener('change', () => {
      if (input.checked) onChange(opt.value);
    });

    const label = document.createElement('label');
    label.className = 'seg-pill';
    label.setAttribute('for', id);
    label.textContent = opt.label;

    seg.appendChild(input);
    seg.appendChild(label);
  });

  return seg;
}

function buildStateDropdown(stateName) {
  const wrap = document.createElement('div');
  wrap.className = 'dropdown-list';
  wrap.addEventListener('click', (e) => e.stopPropagation());

  const tabsWrap = document.createElement('div');
  tabsWrap.className = 'dropdown-tab-container';

  const group = `dd_state_${slug(stateName)}`;
  const seg = buildDropdownTabs({
    groupName: group,
    selectedValue: stateDropdownTab,
    options: [
      { value: 'projects', label: 'Projects' },
      { value: 'counties', label: 'Counties' },
      { value: 'media', label: 'Govt. & Media' }
    ],
    onChange: (val) => { stateDropdownTab = val; renderCurrentList(true); }
  });

  tabsWrap.appendChild(seg);
  wrap.appendChild(tabsWrap);

  if (stateDropdownTab === 'projects') {
    const list = document.createElement('div');
    list.className = 'project-list';
    wrap.appendChild(list);
    renderProjectCardsInContainer(list, Array.from(visibleProjectIdxs));
  } else if (stateDropdownTab === 'counties') {
    const list = document.createElement('div');
    list.className = 'counties-list';
    wrap.appendChild(list);
    renderCountyCardsInContainer(list, Array.from(visibleCountyIds));
  } else if (stateDropdownTab === 'media') {
  const list = document.createElement('div');
  list.className = 'gov-media-list';
  wrap.appendChild(list);

    // State -> show all records in that state (county-linked + state-only)
    renderGovMediaCardsInContainer(list, govMediaIdxsForState(stateName), 'state');
  } else {
    const msg = document.createElement('div');
    msg.className = 'dropdown-empty';
    msg.textContent = 'Coming soon.';
    wrap.appendChild(msg);
  }

  return wrap;
}

function buildCountyDropdown(fips) {
  const wrap = document.createElement('div');
  wrap.className = 'dropdown-list';
  wrap.addEventListener('click', (e) => e.stopPropagation());

  const tabsWrap = document.createElement('div');
  tabsWrap.className = 'dropdown-tab-container';

  const group = `dd_county_${slug(fips)}`;
  const seg = buildDropdownTabs({
    groupName: group,
    selectedValue: countyDropdownTab,
    options: [
      { value: 'projects', label: 'Projects' },
      { value: 'media', label: 'Govt. & Media' },
      { value: 'regulatory', label: 'Regulatory' }
    ],
    onChange: (val) => { countyDropdownTab = val; renderCurrentList(true); }
  });

  tabsWrap.appendChild(seg);
  wrap.appendChild(tabsWrap);

 if (countyDropdownTab === 'projects') {
  const list = document.createElement('div');
  list.className = 'project-list';
  wrap.appendChild(list);
  renderProjectCardsInContainer(list, Array.from(visibleProjectIdxs));

} else if (countyDropdownTab === 'media') {
  const list = document.createElement('div');
  list.className = 'gov-media-list';
  wrap.appendChild(list);

  // County -> only records linked to this county
  renderGovMediaCardsInContainer(list, govMediaIdxsForCounty(fips), 'county');

} else if (countyDropdownTab === 'regulatory') {
  const list = document.createElement('div');
  list.className = 'regulatory-list';
  wrap.appendChild(list);

  // County -> show 0–2 regulatory cards based on county fields
  renderRegulatoryCardsInContainer(list, fips);

} else {
  const msg = document.createElement('div');
  msg.className = 'dropdown-empty';
  msg.textContent = 'Coming soon.';
  wrap.appendChild(msg);
}

  return wrap;
}

function buildProjectDropdown(idx) {
  const wrap = document.createElement('div');
  wrap.className = 'dropdown-list';
  wrap.addEventListener('click', (e) => e.stopPropagation());

  const tabsWrap = document.createElement('div');
  tabsWrap.className = 'dropdown-tab-container';

  const group = `dd_project_${idx}`;
  const seg = buildDropdownTabs({
    groupName: group,
    selectedValue: projectDropdownTab,
    options: [
      { value: 'media', label: 'Govt. & Media' },
      { value: 'regulatory', label: 'Regulatory' } 
    ],
    onChange: (val) => { projectDropdownTab = val; renderCurrentList(true); }
  });

  tabsWrap.appendChild(seg);
  wrap.appendChild(tabsWrap);

  if (projectDropdownTab === 'media') {
    const list = document.createElement('div');
    list.className = 'gov-media-list';
    wrap.appendChild(list);

    // Project -> records linked to the project's associated county (primary countyIds[0])
    renderGovMediaCardsInContainer(list, govMediaIdxsForProject(idx), 'project');

  } else if (projectDropdownTab === 'regulatory') {
    const list = document.createElement('div');
    list.className = 'regulatory-list';
    wrap.appendChild(list);

    // Project -> regulatory cards for the project's primary county
    const p = allProjects[idx];
    const primaryFips = (p && Array.isArray(p.countyIds) && p.countyIds[0]) ? String(p.countyIds[0]) : '';
    renderRegulatoryCardsInContainer(list, primaryFips);

  } else {
    const msg = document.createElement('div');
    msg.className = 'dropdown-empty';
    msg.textContent = 'Coming soon.';
    wrap.appendChild(msg);
  }

  return wrap;
}

function renderProjectCardsInContainer(container, idxArr) {
  if (!container) return;
  clear(container);

  const sort = document.getElementById('sort-by')?.value || 'mw-desc';
  const arr = (idxArr || []).filter(i => activeProjectIdxs.has(i));
  arr.sort((a, b) => projectSort(allProjects[a], allProjects[b], sort));

  if (arr.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'dropdown-empty';
    msg.textContent = 'No projects found.';
    container.appendChild(msg);
    return;
  }

  let cursor = 0;
  const renderMore = () => {
    removeLoadMore(container);
    const next = arr.slice(cursor, cursor + LIST_PAGE_SIZE);
    next.forEach(i => container.appendChild(makeProjectCard(allProjects[i], i)));
    cursor += next.length;
    if (cursor < arr.length) addLoadMore(container, renderMore);
  };
  renderMore();
}

function renderCountyCardsInContainer(container, fipsArr) {
  if (!container) return;
  clear(container);

  const sort = document.getElementById('sort-by')?.value || 'mw-desc';
  const arr = (fipsArr || []).filter(f => activeCountyIds.has(f) && countyTotals.has(f));

  arr.sort((a, b) => {
    if (sort === 'title-az') {
      const ta = countyById.get(a)?.title || a;
      const tb = countyById.get(b)?.title || b;
      return String(ta).localeCompare(String(tb));
    }
    const A = countyTotals.get(a)?.totalMW || 0;
    const B = countyTotals.get(b)?.totalMW || 0;
    return B - A;
  });

  if (arr.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'dropdown-empty';
    msg.textContent = 'No counties found.';
    container.appendChild(msg);
    return;
  }

  let cursor = 0;
  const renderMore = () => {
    removeLoadMore(container);
    const next = arr.slice(cursor, cursor + LIST_PAGE_SIZE);
    next.forEach(f => container.appendChild(makeCountyCard(f)));
    cursor += next.length;
    if (cursor < arr.length) addLoadMore(container, renderMore);
  };
  renderMore();
}



    function setHoveredCounty(fips, lngLat = null) {
      // Only allow hover/popup on counties that have a county record AND active projects
      if (fips && !countyHasHoverInfo(fips)) fips = null;
    
      if (fips === hoveredCountyId) {
        if (fips && lngLat) showHoverPopup(fips, lngLat);
        return;
      }
    
      // Clear old hover state
      if (hoveredCountyId) {
        try { map.setFeatureState({ source: 'counties', id: hoveredCountyId }, { hover: false }); } catch {}
      }
    
      hoveredCountyId = fips || null;
    
      // Set new hover state
      if (hoveredCountyId) {
        try { map.setFeatureState({ source: 'counties', id: hoveredCountyId }, { hover: true }); } catch {}
        if (!lngLat) lngLat = getCountyCenterLngLat(hoveredCountyId);
        if (lngLat) showHoverPopup(hoveredCountyId, lngLat);
      } else {
        hideHoverPopup();
      }
    
      applyListHighlights();
    }




  function clearFocusedCounty() {
    if (focusedCountyId) {
      try { map.setFeatureState({ source: 'counties', id: focusedCountyId }, { selected: false }); } catch {}
    }
    focusedCountyId = null;

    recomputeVisibleSets();
    updateVisibleCounters();
    renderCurrentList(true);
    updateURLFromFilters();
  }

  function zoomToCounty(fips) {
    if (!map || !countiesGeoJSON || !fips) return;
    const feat = countyFeatureById.get(fips);
    if (!feat) return;

    const bbox = turf.bbox(feat); // [minX, minY, maxX, maxY]
    const pad = fitBoundsPaddingPx(5);
    
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
      padding: pad,
      duration: 650,
      maxZoom: 8
    });
  }

  function getCountyCenterLngLat(fips) {
    const feat = countyFeatureById.get(fips);
    if (!feat) return null;
    try {
      const center = turf.center(feat);
      const c = center?.geometry?.coordinates;
      if (Array.isArray(c) && c.length === 2) return { lng: c[0], lat: c[1] };
    } catch {}
    return null;
  }

  function hoverPopupHTML(fips) {
    const c = countyById.get(fips);
    const totals = countyTotals.get(fips) || { totalMW: 0, totalProjects: 0 };
    const ord = countyOrdScores.get(fips);

    // IMPORTANT: do NOT append stateTitle (prevents "TX, Texas")
    const name = (c?.title || fips);

    const ordAvg = (ord && ord.totalAvg != null) ? round1(ord.totalAvg) : '—';

    return `
      <div style="font:12px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; min-width:200px;">
        <div style="font-weight:800; color:#0b1b3f; margin-bottom:8px;">
          ${escapeHtml(name)}
        </div>

        <div><strong>${formatNumber(totals.totalProjects || 0)}</strong> projects</div>
        <div><strong>${formatNumber(totals.totalMW || 0)}</strong> MW</div>
        <div>Ordinance avg: <strong>${escapeHtml(ordAvg)}</strong></div>
      </div>
    `;
  }
    function showHoverPopup(fips, lngLat) {
      if (!hoverPopup || !map || !fips || !lngLat) return;
      if (!countyHasHoverInfo(fips)) return; // critical: suppress popup for empty counties
      hoverPopup.setLngLat(lngLat).setHTML(hoverPopupHTML(fips)).addTo(map);
    }

  function hideHoverPopup() {
    try { hoverPopup && hoverPopup.remove(); } catch {}
  }


  // ==============================
// ICON TERTILES (green / yellow / red)
// ==============================

// Build tertile cuts from ACTIVE items that also have ACTIVE tech scores.
function computeIconTertiles() {
  // --- Counties ---
  const cWind = [], cSolar = [], cStorage = [];
  activeCountyIds.forEach(fips => {
    const ord = countyOrdScores.get(fips);
    if (!ord) return;
    if (ord.incWind && ord.wind != null)         cWind.push(ord.wind);
    if (ord.incSolar && ord.solar != null)       cSolar.push(ord.solar);
    if (ord.incStorage && ord.storage != null)   cStorage.push(ord.storage);
  });
  tertileCuts.county.wind    = computeCuts(cWind, 3);
  tertileCuts.county.solar   = computeCuts(cSolar, 3);
  tertileCuts.county.storage = computeCuts(cStorage, 3);

  // --- States ---
  const sWind = [], sSolar = [], sStorage = [];
  activeStates.forEach(st => {
    const ord = stateOrdScores.get(st);
    if (!ord) return;
    if (ord.windAvg != null)    sWind.push(ord.windAvg);
    if (ord.solarAvg != null)   sSolar.push(ord.solarAvg);
    if (ord.storageAvg != null) sStorage.push(ord.storageAvg);
  });
  tertileCuts.state.wind    = computeCuts(sWind, 3);
  tertileCuts.state.solar   = computeCuts(sSolar, 3);
  tertileCuts.state.storage = computeCuts(sStorage, 3);
}

// Return 'red' | 'yellow' | 'green' given a value and 33/66% cuts
function tertileClassForValue(v, cuts) {
  if (v == null || !Array.isArray(cuts) || cuts.length === 0) return null;
  const bin = binByCuts(v, cuts, 3); // 1..3
  if (bin === 1) return 'red';
  if (bin === 2) return 'yellow';
  return 'green';
}

// Apply + keep tidy: remove any previous classes, then (if active) add new one.
// NEW: supports forceBase to use the "base" class when no meaningful comparison exists.
function setIconTertileClass(
  root,
  wrapperName,
  iconName,
  isActive,
  value,
  cuts,
  { forceBase = false } = {}
) {
  const wrapper = root.querySelector(`[data-wrapper="${wrapperName}"]`);
  if (!wrapper) return;

  const icon = wrapper.querySelector(`[data-icon="${iconName}"]`);
  if (!icon) return;

  // Always clear previous state
  icon.classList.remove('green', 'yellow', 'red', 'base');

  if (!isActive) return;

  // NEW: when comparison is meaningless (e.g., only 1 state), force "base"
  if (forceBase) {
    icon.classList.add('base');
    return;
  }

  const cls = tertileClassForValue(value, cuts);
  if (cls) icon.classList.add(cls);
}

  // ==============================
  // VISIBLE (Viewport-limited)
  // ==============================
  function recomputeVisibleSets() {
  if (!map || !countiesGeoJSON || !map.getSource('counties')) return;

  // If a PROJECT is focused: visible = that project (and its counties/state)
  if (focusedProjectIdx != null) {
    visibleProjectIdxs = new Set();
    visibleCountyIds = new Set();
    visibleStates = new Set();

    if (activeProjectIdxs.has(focusedProjectIdx)) {
      visibleProjectIdxs.add(focusedProjectIdx);
      const p = allProjects[focusedProjectIdx];
      (p.countyIds || []).forEach(f => { if (activeCountyIds.has(f)) visibleCountyIds.add(f); });
      if (p.stateTitle) visibleStates.add(p.stateTitle);
    }
    return;
  }

  // If a COUNTY is focused: visible = that county
  if (focusedCountyId) {
    visibleProjectIdxs = new Set();
    visibleCountyIds = new Set();
    visibleStates = new Set();

    if (activeCountyIds.has(focusedCountyId)) {
      visibleCountyIds.add(focusedCountyId);

      const projSet = projectsByCounty.get(focusedCountyId) || new Set();
      projSet.forEach(idx => { if (activeProjectIdxs.has(idx)) visibleProjectIdxs.add(idx); });

      const st = countyById.get(focusedCountyId)?.stateTitle || '';
      if (st) visibleStates.add(st);
    }
    return;
  }

  // If a STATE is focused: visible = that state (and its active counties/projects)
  if (focusedStateName) {
    visibleProjectIdxs = new Set();
    visibleCountyIds = new Set();
    visibleStates = new Set();

    if (activeStates.has(focusedStateName)) {
      visibleStates.add(focusedStateName);

      const entry = stateIndex.get(focusedStateName);
      if (entry) {
        entry.countyIds.forEach(f => { if (activeCountyIds.has(f)) visibleCountyIds.add(f); });
        entry.projectIdxs.forEach(idx => { if (activeProjectIdxs.has(idx)) visibleProjectIdxs.add(idx); });
      }
    }
    return;
  }

  // Normal mode: viewport-limited
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
     applyListHighlights();
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
    slice.forEach(idx => {
        const card = makeProjectCard(allProjects[idx], idx);
        listProjectsEl.appendChild(card);
      
        if (focusedProjectIdx === idx) {
          listProjectsEl.appendChild(buildProjectDropdown(idx));
        }
      });
    listCursorProjects = slice.length;
    if (slice.length < arr.length) addLoadMore(listProjectsEl, () => renderProjectsListNext(arr));
  }
    function renderProjectsListNext(arr) {
      removeLoadMore(listProjectsEl);
    
      const next = arr.slice(listCursorProjects, listCursorProjects + LIST_PAGE_SIZE);
      next.forEach(idx => {
        const card = makeProjectCard(allProjects[idx], idx);
        listProjectsEl.appendChild(card);
    
        if (focusedProjectIdx === idx) {
          listProjectsEl.appendChild(buildProjectDropdown(idx));
        }
      });
    
      listCursorProjects += next.length;
      if (listCursorProjects < arr.length) addLoadMore(listProjectsEl, () => renderProjectsListNext(arr));
      applyListHighlights();
    }
  function projectSort(a, b, sort) {
    if (sort === 'mw-desc') return (b.mwSize||0) - (a.mwSize||0);
    if (sort === 'title-az') return a.title.localeCompare(b.title);
    if (sort === 'opdate-asc') return (a.opDate?.getTime() || 0) - (b.opDate?.getTime() || 0);
    if (sort === 'opdate-desc') return (b.opDate?.getTime() || 0) - (a.opDate?.getTime() || 0);
    return 0;
  }
  function makeProjectCard(rec, idx) {
  const projectIdx = Number.isFinite(Number(idx)) ? Number(idx) : null;

  if (savedProjectTemplate) {
    const node = savedProjectTemplate.cloneNode(true);
    setField(node, 'title', rec.title);
    syncProjectTechnologyBadges(node, rec);
    setField(node, 'stage', rec.stage);
    setField(node, 'location-text', rec.locationText);
    setField(node, 'developer-text', rec.developerText);
    setField(node, 'total-mw', formatNumber(rec.mwSize || 0));
    setField(node, 'operation-date', rec.opDate ? rec.opDate.toISOString().substring(0,10) : '');

    node.dataset.countyIds = (rec.countyIds || []).join(',');
    node.dataset.primaryCounty = (rec.countyIds && rec.countyIds[0]) ? rec.countyIds[0] : '';
    if (projectIdx != null) node.dataset.projectIdx = String(projectIdx);

    node.style.cursor = 'pointer';

    node.addEventListener('mouseenter', () => {
      const fips = node.dataset.primaryCounty;
      if (fips) setHoveredCounty(fips, getCountyCenterLngLat(fips));
    });
    node.addEventListener('mouseleave', () => setHoveredCounty(null));

    node.addEventListener('click', (e) => {
      if (projectIdx != null) toggleFocusedProject(projectIdx);
    });


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

    div.dataset.countyIds = (rec.countyIds || []).join(',');
    div.dataset.primaryCounty = (rec.countyIds && rec.countyIds[0]) ? rec.countyIds[0] : '';
    if (projectIdx != null) div.dataset.projectIdx = String(projectIdx);

    div.style.cursor = 'pointer';

    div.addEventListener('mouseenter', () => {
      const fips = div.dataset.primaryCounty;
      if (fips) setHoveredCounty(fips, getCountyCenterLngLat(fips));
    });
    div.addEventListener('mouseleave', () => setHoveredCounty(null));

    div.addEventListener('click', (e) => {
      if (projectIdx != null) toggleFocusedProject(projectIdx);
    });
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
    slice.forEach(fips => {
      const card = makeCountyCard(fips);
      listCountiesEl.appendChild(card);
    
      if (focusedCountyId === fips) {
        listCountiesEl.appendChild(buildCountyDropdown(fips));
      }
    });
    listCursorCounties = slice.length;
    if (slice.length < arr.length) addLoadMore(listCountiesEl, () => renderCountiesListNext(arr));
  }
  function renderCountiesListNext(arr) {
    removeLoadMore(listCountiesEl);
    const next = arr.slice(listCursorCounties, listCursorCounties + LIST_PAGE_SIZE);
    next.forEach(fips => {
      const card = makeCountyCard(fips);
      listCountiesEl.appendChild(card);
    
      if (focusedCountyId === fips) {
        listCountiesEl.appendChild(buildCountyDropdown(fips));
      }
    });
    listCursorCounties += next.length;
    if (listCursorCounties < arr.length) addLoadMore(listCountiesEl, () => renderCountiesListNext(arr));
    applyListHighlights();
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

      // NEW: Color the tech icons by tertile among ACTIVE counties with ACTIVE scores
      setIconTertileClass(
        node,
        'solar-ordinance-score', 'solar-ordinance-icon',
        (ord.incSolar && ord.solar != null),
        ord.solar,
        tertileCuts.county.solar
      );
      setIconTertileClass(
        node,
        'wind-ordinance-score', 'wind-ordinance-icon',
        (ord.incWind && ord.wind != null),
        ord.wind,
        tertileCuts.county.wind
      );
      setIconTertileClass(
        node,
        'storage-ordinance-score', 'storage-ordinance-icon',
        (ord.incStorage && ord.storage != null),
        ord.storage,
        tertileCuts.county.storage
      );

            node.dataset.fips = fips;
      node.style.cursor = 'pointer';

      node.addEventListener('mouseenter', () => {
        // hover from list -> highlight map + popup at county center
        setHoveredCounty(fips, getCountyCenterLngLat(fips));
      });
      node.addEventListener('mouseleave', () => {
        setHoveredCounty(null);
        hideHoverPopup();
      });
      node.addEventListener('click', (e) => {
      toggleFocusedCounty(fips);
    });

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

      div.dataset.fips = fips;
      div.style.cursor = 'pointer';
      div.addEventListener('mouseenter', () => setHoveredCounty(fips, getCountyCenterLngLat(fips)));
      div.addEventListener('mouseleave', () => { setHoveredCounty(null); hideHoverPopup(); });
      div.addEventListener('click', (e) => {
          toggleFocusedCounty(fips);
        });
      
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
    slice.forEach(st => {
      const card = makeStateCard(st);
      listStatesEl.appendChild(card);
    
      // Dropdown should be BELOW the card (sibling), not inside it
      if (focusedStateName === st) {
        listStatesEl.appendChild(buildStateDropdown(st));
      }
    });
    listCursorStates = slice.length;
    if (slice.length < arr.length) addLoadMore(listStatesEl, () => renderStatesListNext(arr));
  }
  function renderStatesListNext(arr) {
    removeLoadMore(listStatesEl);
    const next = arr.slice(listCursorStates, listCursorStates + LIST_PAGE_SIZE);
    next.forEach(st => {
      const card = makeStateCard(st);
      listStatesEl.appendChild(card);
    
      if (focusedStateName === st) {
        listStatesEl.appendChild(buildStateDropdown(st));
      }
    });
    listCursorStates += next.length;
    if (listCursorStates < arr.length) addLoadMore(listStatesEl, () => renderStatesListNext(arr));
    applyListHighlights();
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

      node.style.cursor = 'pointer';
      node.addEventListener('click', (e) => {
        if (e.target && e.target.closest && e.target.closest('.dropdown-list')) return;
        toggleFocusedState(stateName);
      });
      

      // NEW: Color the tech icons by tertile among ACTIVE states with ACTIVE scores
      // NEW: If there's only one active state, don't compute tertiles (no comparison)
      const forceBase = (activeStates.size <= 1);
      
      setIconTertileClass(
        node,
        'solar-ordinance-score', 'solar-ordinance-icon',
        (ord.solarAvg != null),
        ord.solarAvg,
        tertileCuts.state.solar,
        { forceBase }
      );

      setIconTertileClass(
        node,
        'wind-ordinance-score', 'wind-ordinance-icon',
        (ord.windAvg != null),
        ord.windAvg,
        tertileCuts.state.wind,
        { forceBase }
      );

      setIconTertileClass(
        node,
        'storage-ordinance-score', 'storage-ordinance-icon',
        (ord.storageAvg != null),
        ord.storageAvg,
        tertileCuts.state.storage,
        { forceBase }
      );

      // NEW: show/hide siting blocks + set text based on Airtable 📍 States fields
      applyStateSitingBlocks(node, stateName);
      
      node.dataset.state = stateName;
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

      div.style.cursor = 'pointer';
      div.addEventListener('click', (e) => {
        if (e.target && e.target.closest && e.target.closest('.dropdown-list')) return;
        toggleFocusedState(stateName);
      });
      
      div.dataset.state = stateName;
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

    // Esc clears focused county
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && hasSelection()) clearFocusedSelection();
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
    // If selection becomes invalid under new filters, clear it (no double-render)
    if (focusedCountyId && !activeCountyIds.has(focusedCountyId)) {
      clearFocusedSelection({ rerender: false });
    } else if (focusedStateName && !activeStates.has(focusedStateName)) {
      clearFocusedSelection({ rerender: false });
    } else if (focusedProjectIdx != null && !activeProjectIdxs.has(focusedProjectIdx)) {
      clearFocusedSelection({ rerender: false });
    }
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

    // Focused county
    if (focusedCountyId) params.set('county', focusedCountyId);

    const qs = params.toString();
    const newUrl = `${location.pathname}${qs ? '?' + qs : ''}${location.hash}`;
    history.replaceState(null, '', newUrl);
  }

  function applyFiltersFromURL() {
    
    const urlParams = new URLSearchParams(location.search);
    if (!urlParams || [...urlParams.keys()].length === 0) return;

    const county = urlParams.get('county');
    if (county) focusedCountyId = county;

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

      /* Scope the sizing vars to the legend so we don't touch global :root */
      .legend { --cell:18px; --gap:3px; }

     /* === Bivariate legend: make the legend itself horizontal when used as bivariate === */
     .legend.legend-bi{
       display:flex;
       flex-direction:row;
       align-items:flex-start; /* top-align with grid */
       gap:12px;
     }

      /* === Bivariate legend layout (fixed alignment) === */
      .legend .bi { display:flex; gap:10px; align-items:flex-start; }

     /* Left-side bivariate title (stacked + vertically centered to grid height) */
     .legend .ytitle{
       height: calc(var(--cell)*3 + var(--gap)*2);
       display:flex;
       flex-direction:column;
      justify-content:center;  /* centers Ordinance/Workability vs grid */
       align-items:center;
       margin-right:2px;
     }

      .legend .yticks{
        height: calc(var(--cell)*3 + var(--gap)*2);
        display:flex;
        flex-direction:column;
        justify-content:space-between;
        color:#6b7280;
      }
      .legend .yticks span { line-height: 1; }

      /* Lock grid column width so x labels align with the grid edges */
      .legend .grid-col{
        width: calc(var(--cell)*3 + var(--gap)*2);
      }

      .legend .grid{
        display:grid;
        grid-template-columns: repeat(3, var(--cell));
        grid-template-rows: repeat(3, var(--cell));
        gap: var(--gap);
      }
      .legend .cell{
        width:var(--cell);
        height:var(--cell);
        border-radius:3px;
        box-shadow: inset 0 0 0 1px rgba(0,0,0,.08);
      }

      .legend .xlabel{
        width: 100%;
        display:flex;
        justify-content:space-between;
        color:#6b7280;
        margin-top:6px;
      }
      .legend .xlabel span { line-height: 1; }

      .legend .xtitle{
        text-align:center;
        font-weight:600;
        color:#0b1b3f;
        margin-top:2px;
       /* tighter spacing between stacked words */
       line-height:1.05;
       display:flex;
       flex-direction:column;
      gap:0;
      }
     .legend .xtitle span{ display:block; } /* ensures stacked lines */

     /* ytitle uses xtitle styling but shouldn't have the x margin-top */
     .legend .ytitle.xtitle{ margin-top:0; }

      /* === Univariate bars === */
      .legend .bar { display:flex; gap:2px; }
      .legend .bar .swatch { width:24px; height:14px; border-radius:3px; box-shadow:inset 0 0 0 1px rgba(0,0,0,.08); }
      .legend .axis { display:flex; align-items:center; justify-content:space-between; color:#6b7280; margin-top:4px; }
    </style>
  `;

  if (showMW && showOrd) {
    // top row = ordinance HIGH
    const rowsForLegend = [BIV9[2], BIV9[1], BIV9[0]];
    const gridCells = rowsForLegend.map(
      row => row.map(c => `<div class="cell" style="background:${c}"></div>`).join('')
    ).join('');

    mapKeyEl.innerHTML = css + `
     <div class="legend legend-bi">
       <!-- Left title: centered vs the 3x3 grid -->
       <div class="ytitle xtitle">
         <span>Ordinance</span>
         <span>Workability</span>
       </div>

       <div class="bi">
         <div class="yticks" aria-hidden="true">
           <span>High</span>
           <span>Low</span>
         </div>

         <div class="grid-col">
           <div class="grid" aria-label="Bivariate legend grid">${gridCells}</div>
           <div class="xlabel"><span>Low</span><span>High</span></div>
           <div class="xtitle">
             <span>Energy</span>
             <span>Capacity</span>
           </div>
         </div>
       </div>
     </div>
    `;
    return;
  }

  if (showMW) {
    mapKeyEl.innerHTML = css + `
      <div class="legend">
        <div class="title">Potential Energy Capacity</div>
        <div class="subtitle">Active MW (quintiles)</div>
        <div class="bar">${COLORS_MW_5.map(c=>`<div class="swatch" style="background:${c}"></div>`).join('')}</div>
        <div class="axis"><span>Low</span><span>High</span></div>
      </div>
    `;
    return;
  }

  if (showOrd) {
    mapKeyEl.innerHTML = css + `
      <div class="legend">
        <div class="title">Ordinance Workability</div>
        <div class="subtitle">Average of enabled tech scores (quintiles)</div>
        <div class="bar">${COLORS_ORD_5.map(c=>`<div class="swatch" style="background:${c}"></div>`).join('')}</div>
        <div class="axis"><span>Low</span><span>High</span></div>
      </div>
    `;
    return;
  }

  mapKeyEl.innerHTML = css + `
    <div class="legend">
      <div class="title">No color layers active</div>
      <div class="subtitle">Enable Energy and/or Ordinance in “Map Coloring”.</div>
    </div>
  `;
}
    
  // ==============================
  // HELPERS
  // ==============================
  function setField(root, field, value) {
    const el = root.querySelector('[data-field="' + field + '"]');
    if (el) el.textContent = value == null ? '' : String(value);
  }
  function syncProjectTechnologyBadges(root, rec) {
  // Convert tech text -> one of: 'solar' | 'wind' | 'storage'
  const toKey = (v) => {
    const s = String(v || '').toLowerCase();
    if (!s) return '';
    if (s.includes('wind')) return 'wind';
    if (s.includes('solar')) return 'solar';
    if (s.includes('storage') || s.includes('battery') || s.includes('bess')) return 'storage';
    return '';
  };

  // Desired order comes from technology-1,2,3 (rec.tech1/2/3)
  const desired = [];
  [rec.tech1, rec.tech2, rec.tech3].forEach(v => {
    const k = toKey(v);
    if (k && !desired.includes(k)) desired.push(k);
  });

  const els = {
    solar:   root.querySelector('[data-element="technology-solar"]'),
    wind:    root.querySelector('[data-element="technology-wind"]'),
    storage: root.querySelector('[data-element="technology-storage"]')
  };

  const allKeys = ['solar', 'wind', 'storage'];
  const presentEls = allKeys.map(k => els[k]).filter(Boolean);
  if (!presentEls.length) return; // template doesn't have these chips

  // Hide everything first
  allKeys.forEach(k => { if (els[k]) els[k].style.display = 'none'; });

  // Show only the technologies that exist on this project
  desired.forEach(k => { if (els[k]) els[k].style.display = ''; });

  // Reorder chips within their current parent, keeping their block location stable
  const parent = presentEls[0].parentNode;
  if (!parent) return;
  if (!presentEls.every(n => n.parentNode === parent)) return; // safety

  // Preserve where the chip-group sits by reinserting before the node after the last chip
  const kids = Array.from(parent.childNodes);
  const domSorted = presentEls.slice().sort((a, b) => kids.indexOf(a) - kids.indexOf(b));
  const after = domSorted[domSorted.length - 1].nextSibling;

  // Pull out all chip elements (so we can insert in the right order)
  domSorted.forEach(n => {
    try { parent.removeChild(n); } catch {}
  });

  // Insert back: visible ones in desired order, then the hidden ones (order doesn't matter)
  const inserted = [];
  desired.forEach(k => {
    const el = els[k];
    if (el) { parent.insertBefore(el, after); inserted.push(k); }
  });
  allKeys.forEach(k => {
    if (inserted.includes(k)) return;
    const el = els[k];
    if (el) parent.insertBefore(el, after);
  });
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

    // ==============================
    // PHASE 3: NON-OPACITY HIGHLIGHTS
    // ==============================
  function ensurePhase3Styles() {
    if (document.getElementById('phase3-styles')) return;
    const style = document.createElement('style');
    style.id = 'phase3-styles';
    style.textContent = `
      .is-hovered  { outline: 2px solid rgba(99,102,241,0.55); outline-offset: 2px; }
      /* Selected items should NOT have a dark outline */
      .is-selected { outline: none !important; }
  
      /* Primary segmented: collapse + reset button */
      .seg-reset {
        width: 0;
        opacity: 0;
        padding: 0;
        margin: 0;
        border: 0;
        background: transparent;
        overflow: hidden;
        cursor: pointer;
        transition: width 180ms ease, opacity 180ms ease, margin 180ms ease;
      }
      .seg-reset.is-visible {
        width: 34px;
        opacity: 1;
        margin-right: 8px;
      }
      .seg-reset-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 999px;
        background: rgba(11,27,63,0.08);
        color: #0b1b3f;
        font-weight: 800;
        user-select: none;
      }
  
      .segmented label.seg-pill,
      .segmented input[type="radio"] {
        transition: width 180ms ease, opacity 180ms ease, padding 180ms ease, margin 180ms ease;
      }
      .segmented label.seg-pill.is-hidden {
        width: 0 !important;
        opacity: 0 !important;
        padding: 0 !important;
        margin: 0 !important;
        border: 0 !important;
        pointer-events: none !important;
        overflow: hidden !important;
        white-space: nowrap !important;
      }
      .segmented input[type="radio"].is-hidden {
        position: absolute !important;
        opacity: 0 !important;
        pointer-events: none !important;
        width: 0 !important;
        height: 0 !important;
      }
  
      /* Dropdown (secondary layer) */
      .dropdown-list {
        margin-top: 10px;
        padding: 10px;
        border: 1px solid rgba(0,0,0,0.08);
        border-radius: 12px;
        background: rgba(255,255,255,0.92);
      }
      .dropdown-tab-container { margin-bottom: 10px; }
      .dropdown-list .project-list,
      .dropdown-list .counties-list,
      .dropdown-list .gov-media-list,
      .dropdown-list .regulatory-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .dropdown-empty {
        color: #6b7280;
        font-size: 12px;
        padding: 6px 2px;
      }
    `;
    document.head.appendChild(style);
  }

  function applyListHighlights() {
    const hoverFips = hoveredCountyId;
    const focusFips = focusedCountyId;

    const hoverState = hoverFips ? (countyById.get(hoverFips)?.stateTitle || '') : '';
    const focusState = focusFips ? (countyById.get(focusFips)?.stateTitle || '') : '';

    // Projects list
    if (listProjectsEl) {
      Array.from(listProjectsEl.children).forEach(node => {
        const ids = String(node.dataset.countyIds || '')
          .split(',').map(s => s.trim()).filter(Boolean);

        const isHover = !!hoverFips && ids.includes(hoverFips);
        const isSel   = !!focusFips && ids.includes(focusFips);

        node.classList.toggle('is-hovered', isHover);
        node.classList.toggle('is-selected', isSel);
        
        // NEW: focused class on the selected card in secondary-tab mode
        const isFocusedProject = (focusedProjectIdx != null) &&
          (String(node.dataset.projectIdx || '') === String(focusedProjectIdx));
        node.classList.toggle('focused', isFocusedProject);
      });
    }

    // Counties list
    if (listCountiesEl) {
      Array.from(listCountiesEl.children).forEach(node => {
        const fips = String(node.dataset.fips || '');
        node.classList.toggle('is-hovered', !!hoverFips && fips === hoverFips);
        node.classList.toggle('is-selected', !!focusFips && fips === focusFips);
        
        // NEW
        node.classList.toggle('focused', !!focusedCountyId && fips === focusedCountyId);
      });
    }

    // States list
    if (listStatesEl) {
      Array.from(listStatesEl.children).forEach(node => {
        const st = String(node.dataset.state || '');
        node.classList.toggle('is-hovered', !!hoverState && st === hoverState);
        node.classList.toggle('is-selected', !!focusState && st === focusState);
        
        // NEW
        node.classList.toggle('focused', !!focusedStateName && st === focusedStateName);
      });
    }
  }

  function countyHasHoverInfo(fips) {
  // Must have a county record AND currently have active projects
  return !!fips && countyById.has(fips) && activeCountyIds.has(fips);
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
const FED_SOURCE_LAYER  = 'us_fed_lands__usa_federal_lands'; // exact "source layer" name from the tileset page

// Internal IDs (unique, do not clash with your existing layers/sources)
const FED_SRC_ID  = 'federal-lands-src';
const FED_FILL_ID = 'federal-lands-fill';

// Call once, after the map is created & UI is present.
function setupFederalLandsOverlay() {
  const cb = document.querySelector(FED_TOGGLE_SELECTOR);
  if (!cb || !map) return;

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
  


  function dismissLoadingUI() {
  const a = document.getElementById('loading-progress-1');
  const b = document.getElementById('loading-progress-2');

  // Keep legacy support if it still exists in the DOM
  const legacy = document.getElementById('loading-screen');

  const els = [a, b, legacy].filter(Boolean);
  if (!els.length) return;

  // Must wait at least 2s after navigation start (page load)
  const minMs = 2000;
  let delay = minMs;

  try {
    if (window.performance && typeof performance.now === 'function') {
      delay = Math.max(0, minMs - performance.now());
    }
  } catch {
    delay = minMs;
  }

  setTimeout(() => {
    // Ensure a smooth fade even if your CSS doesn't define it
    els.forEach(el => {
      if (!el) return;
      if (!el.style.transition) el.style.transition = 'opacity 450ms ease';
      el.style.willChange = 'opacity';
    });

    // Next frame -> trigger opacity transition
    requestAnimationFrame(() => {
      els.forEach(el => { if (el) el.style.opacity = '0'; });
    });

    // Remove from DOM after the fade
    setTimeout(() => {
      els.forEach(el => {
        if (!el) return;
        try { el.remove(); }
        catch { el.parentNode && el.parentNode.removeChild(el); }
      });
    }, 520);
  }, delay);
}

})();
