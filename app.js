/* ============================================================================
  Precios FESICOL · Musicala (Frontend) — vTABLA PRO+ (Light UI)
  ----------------------------------------------------------------------------
  - Lee ./fesicol.json (meta, note, services[], prices[])
  - Render principal: tabla tipo Excel
      Servicio | Paquete/Cantidad | Valor | Descripción
  - UX: buscador, filtros (chips), reset, contador, imprimir/PDF
  - Mejoras:
      ✅ Compatible con el NUEVO index (sin empty state, sin btnReset2)
      ✅ Búsqueda "inteligente": sin tildes + por tokens
      ✅ Render en el orden de columnas solicitado
      ✅ Texto de nota más formal (sin “si alguien se pierde…”)
============================================================================ */

const qs  = (s, root=document) => root.querySelector(s);
const qsa = (s, root=document) => Array.from(root.querySelectorAll(s));

/* =========================
   DOM refs (nuevo index)
========================= */
const $q          = qs('#q');
const $btnClear   = qs('#btnClear');
const $btnPrint   = qs('#btnPrint');

const $filters    = qs('#filters');
const $noteText   = qs('#noteText');
const $updatedAt  = qs('#updatedAt');
const $countBadge = qs('#countBadge');

const $tblBody    = qs('#tblBody');
const $miniStatus = qs('#miniStatus');

const $btnReset   = qs('#btnReset');   // debajo de la tabla (puede estar hidden)

/* =========================
   Estado
========================= */
let RAW = null;

let SERVICES = [];   // [{id,title,desc,match:RegExp}, ...]
let PRICES   = [];   // [{service_label, price_label, price_cop}, ...]
let ROWS     = [];   // filas "planas" para tabla (derivadas)

let activeChip = 'all';

/* Cache de búsqueda (evita recalcular strings cada tecleo) */
let ROW_INDEX = [];  // [{row, haystackNorm, ...}]

/* =========================
   Init
========================= */
init();

async function init(){
  wireUI();
  await loadData();
  buildChips();
  buildRowIndex();
  renderTable();
}

/* =========================
   Eventos UI
========================= */
function wireUI(){
  // Imprimir
  $btnPrint?.addEventListener('click', () => window.print());

  // Limpiar búsqueda
  $btnClear?.addEventListener('click', () => {
    if(!$q) return;
    $q.value = '';
    $q.focus();
    renderTable();
  });

  // Reset (tabla)
  $btnReset?.addEventListener('click', () => hardReset());

  // Buscar (debounced)
  $q?.addEventListener('input', debounce(renderTable, 70));

  // Atajo: ESC limpia búsqueda (modo Excel)
  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape' && document.activeElement === $q){
      $q.value = '';
      renderTable();
    }
  });
}

function hardReset(){
  if($q) $q.value = '';
  activeChip = 'all';
  syncChips();
  renderTable();
  if($q) $q.focus();
}

/* =========================
   Carga de datos
========================= */
async function loadData(){
  try{
    const res = await fetch('./fesicol.json', { cache: 'no-store' });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    RAW = await res.json();

    // Meta + note
    const meta = RAW?.meta || {};
    const note = String(RAW?.note || '').trim();

    if($noteText){
      // Si el note viene informal, lo “traduce” a institucional
      $noteText.textContent = formalizeNote(note) || (
        "Tarifas vigentes según el archivo oficial de la alianza."
      );
    }

    if($updatedAt){
      // tu JSON usa last_updated en meta (según lo que compartiste antes)
      const upd = meta.last_updated || meta.updated_at || meta.updatedAt || '';
      $updatedAt.textContent = upd ? `Última actualización: ${upd}` : '';
    }

    // Services: regex en string -> RegExp
    SERVICES = (RAW?.services || []).map(s => ({
      id: String(s?.id || '').trim(),
      title: String(s?.title || '').trim(),
      desc: String(s?.desc || '').trim(),
      match: safeRegExp(String(s?.match || ''))
    })).filter(s => s.id && s.title && s.match);

    // Prices
    PRICES = (RAW?.prices || []).map(p => ({
      service_label: String(p?.service_label || '').trim(),
      price_label: String(p?.price_label || '').trim(),
      price_cop: (typeof p?.price_cop === 'number' ? p.price_cop : parseCOP(p?.price_label))
    })).filter(p => p.service_label && (p.price_label || p.price_cop != null));

    // Derivar filas planas
    ROWS = buildFlatRows(SERVICES, PRICES);

    // Badge
    if($countBadge){
      $countBadge.textContent = `${PRICES.length} tarifas · ${SERVICES.length} servicios`;
    }

  }catch(err){
    console.error(err);
    if($noteText){
      $noteText.textContent =
        "No fue posible cargar el archivo fesicol.json. Verifica que esté en la misma carpeta que index.html.";
    }
    if($countBadge) $countBadge.textContent = 'Error cargando datos';
    SERVICES = [];
    PRICES = [];
    ROWS = [];
    ROW_INDEX = [];
  }
}

function formalizeNote(note){
  if(!note) return '';
  const t = note.trim();

  // Si el JSON trae el texto viejo (“si alguien se enreda…”), lo reemplazamos
  if(/si alguien se pierde|si alguien se enreda/i.test(t)){
    return (
      "Estas tarifas aplican para cursos de Música, Danza, Teatro y Artes Plásticas (según modalidad y paquete). " +
      "Para consultar: 1) selecciona el servicio (Sede/Hogar/Virtual/Online), 2) identifica el paquete o programa, " +
      "3) utiliza el valor correspondiente."
    );
  }

  // Si ya viene bien, solo “limpieza” ligera
  return t.replace(/\s+/g, ' ');
}

/* =========================
   Construcción de filas
========================= */
function buildFlatRows(services, prices){
  const out = [];

  for(const p of prices){
    const svc = findServiceForLabel(p.service_label, services) || {
      id: 'otros',
      title: 'Otros',
      desc: 'Servicios no clasificados (verificar nombre exacto).',
      match: /.^/
    };

    const option = stripServicePrefix(p.service_label, svc.match);
    const priceLabel = p.price_label || formatCOP(p.price_cop);

    out.push({
      service_id: svc.id,
      service_title: svc.title,
      service_desc: svc.desc,
      option: option || 'Tarifa',
      price_label: priceLabel,
      price_cop: p.price_cop ?? parseCOP(priceLabel),
      full_label: p.service_label
    });
  }

  // Orden: por orden de SERVICES + dentro por lógica de opción
  const order = new Map(services.map((s,i)=>[s.id, i]));
  out.sort((a,b) => {
    const oa = order.get(a.service_id) ?? 9999;
    const ob = order.get(b.service_id) ?? 9999;
    if(oa !== ob) return oa - ob;
    return smartOptionSort(a.option, b.option);
  });

  return out;
}

function findServiceForLabel(label, services){
  for(const s of services){
    if(s.match && s.match.test(label)) return s;
  }
  return null;
}

function stripServicePrefix(fullLabel, matchRegex){
  const cleaned = String(fullLabel).replace(matchRegex, '').trim();
  return cleaned ? cleaned.replace(/\s+/g,' ') : '';
}

function smartOptionSort(a, b){
  const A = String(a).toLowerCase();
  const B = String(b).toLowerCase();

  const pri = (s) => {
    // "individual" primero
    if(s.includes('individual')) return 0;
    // "paquete" luego
    if(s.includes('paquete')) return 1;
    // números sueltos o “programa”
    if(/\d/.test(s)) return 2;
    return 3;
  };

  const p = pri(A) - pri(B);
  if(p !== 0) return p;

  const na = extractNumber(A);
  const nb = extractNumber(B);
  if(na !== null && nb !== null) return na - nb;

  return A.localeCompare(B, 'es');
}

function extractNumber(s){
  const m = String(s).match(/(\d{1,3})/);
  return m ? parseInt(m[1], 10) : null;
}

/* =========================
   Chips de filtro
========================= */
function buildChips(){
  if(!$filters) return;
  $filters.innerHTML = '';

  const make = (id, text) => {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.type = 'button';
    btn.dataset.id = id;
    btn.setAttribute('aria-pressed', id === activeChip ? 'true' : 'false');
    btn.textContent = text;

    btn.addEventListener('click', () => {
      activeChip = id;
      syncChips();
      renderTable();
    });

    return btn;
  };

  $filters.appendChild(make('all', 'Todos'));

  // Solo chips con servicios que realmente aparecen
  const present = new Set(ROWS.map(r => r.service_id));
  for(const s of SERVICES){
    if(present.has(s.id)){
      $filters.appendChild(make(s.id, s.title));
    }
  }
}

function syncChips(){
  if(!$filters) return;
  qsa('.chip', $filters).forEach(ch => {
    const on = ch.dataset.id === activeChip;
    ch.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

/* =========================
   Índice de búsqueda
========================= */
function buildRowIndex(){
  ROW_INDEX = ROWS.map(r => {
    // “Haystack” normalizado sin tildes para búsqueda flexible
    const hay = [
      r.service_title,
      r.option,
      r.price_label,
      r.service_desc,
      r.full_label
    ].join(' | ');

    return {
      row: r,
      haystackNorm: norm(hay),
      // también guardo versión original para highlight
      _service: r.service_title,
      _option: r.option,
      _price : r.price_label,
      _desc  : r.service_desc,
      _full  : r.full_label
    };
  });
}

/* =========================
   Render Tabla (principal)
========================= */
function renderTable(){
  if(!$tblBody) return;

  const queryRaw = ($q?.value || '').trim();
  const queryNorm = norm(queryRaw);

  // Tokens: si ponen "sede 24", buscamos que estén ambos
  const tokens = queryNorm ? queryNorm.split(/\s+/).filter(Boolean) : [];

  let items = ROW_INDEX.slice();

  // filtro por chip
  if(activeChip !== 'all'){
    items = items.filter(x => x.row.service_id === activeChip);
  }

  // filtro por búsqueda (token-based)
  if(tokens.length){
    items = items.filter(x => tokens.every(tk => x.haystackNorm.includes(tk)));
  }

  // Botón reset: mostrar solo cuando haya filtro/búsqueda
  if($btnReset){
    const hasFilter = (activeChip !== 'all') || Boolean(tokens.length);
    $btnReset.hidden = !hasFilter;
  }

  // miniStatus + badge
  const total = ROW_INDEX.length;
  const shown = items.length;

  if($miniStatus){
    $miniStatus.textContent =
      (tokens.length || activeChip !== 'all')
        ? `Mostrando ${shown} de ${total}`
        : `Mostrando ${total}`;
  }

  if($countBadge){
    $countBadge.textContent =
      (tokens.length || activeChip !== 'all')
        ? `${shown} resultado(s)`
        : `${PRICES.length} tarifas · ${SERVICES.length} servicios`;
  }

  // Render
  $tblBody.innerHTML = '';

  if(shown === 0){
    // Sin empty-state. Tabla vacía, pero no “regaño” al usuario.
    // Dejamos una fila sutil para que no parezca roto.
    const tr = document.createElement('tr');
    tr.className = 'row';
    tr.innerHTML = `
      <td class="cell service" colspan="4" style="opacity:.75; padding:16px;">
        No hay resultados para la búsqueda actual.
      </td>
    `;
    $tblBody.appendChild(tr);
    return;
  }

  const frag = document.createDocumentFragment();

  for(const x of items){
    const r = x.row;

    const tr = document.createElement('tr');
    tr.className = 'row';
    tr.dataset.service = r.service_id;

    // Orden solicitado:
    // Servicio | Paquete/Cantidad (option) | Valor | Descripción
    tr.innerHTML = `
      <td class="cell service">${highlight(escapeHtml(x._service), queryRaw)}</td>
      <td class="cell option">${highlight(escapeHtml(x._option), queryRaw)}</td>
      <td class="cell price" style="text-align:right">${highlight(escapeHtml(x._price), queryRaw)}</td>
      <td class="cell desc">${highlight(escapeHtml(x._desc), queryRaw)}</td>
    `;

    frag.appendChild(tr);
  }

  $tblBody.appendChild(frag);
}

/* =========================
   Utils
========================= */
function debounce(fn, ms){
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function norm(s){
  // lower + sin tildes + colapsa espacios
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g,' ')
    .trim();
}

function escapeHtml(s){
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#039;");
}

function safeRegExp(pattern){
  try{
    const p = String(pattern || '').trim();
    if(!p) return /.^/;
    return new RegExp(p, 'i');
  }catch(_){
    return /.^/;
  }
}

function parseCOP(label){
  if(label == null) return null;
  const s = String(label).replace(/[^\d]/g,'');
  if(!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function formatCOP(n){
  if(typeof n !== 'number' || !Number.isFinite(n)) return '';
  try{
    const formatted = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);
    return `$ ${formatted}`;
  }catch(_){
    return `$ ${String(n)}`;
  }
}

function highlight(htmlSafeText, needleRaw){
  const needle = String(needleRaw || '').trim();
  if(!needle) return htmlSafeText;

  // Para que sirva con tildes: hacemos highlight simple por el raw, sin romper HTML
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(esc, 'ig');
  return htmlSafeText.replace(re, (m) => `<mark>${m}</mark>`);
}
