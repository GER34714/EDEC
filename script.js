/* =========================
   CONFIG
   ========================= */
const STORE_NAME = "Tu Emprendimiento";
const WHATSAPP_NUMBER = "5491112345678"; // sin +, sin espacios
const CURRENCY = "ARS";
const LOCALE = "es-AR";

const DATA_INDEX_URL = "./data/index.json";
const PAGES_BASE = "./data/pages";
const PLACEHOLDER_IMG = "./assets/placeholder.svg";

const WA_SOFT_LIMIT = 1400;
const CART_KEY = "boutique_cart_v1";

/* =========================
   HELPERS
   ========================= */
const $ = (id) => document.getElementById(id);
const on = (id, evt, fn) => {
  const el = $(id);
  if (el) el.addEventListener(evt, fn);
};

function slug(s) {
  return (s || "").toString().toLowerCase().trim();
}
function safeId(s) {
  return slug(s).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
function randId() {
  return "P" + Math.random().toString(16).slice(2, 10).toUpperCase();
}
function money(n) {
  if (n === null) return "Consultar";
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: "currency",
      currency: CURRENCY,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `$${n}`;
  }
}
function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}
function groupBy(arr, keyFn) {
  return arr.reduce((acc, item) => {
    const k = keyFn(item);
    (acc[k] ||= []).push(item);
    return acc;
  }, {});
}

/* =========================
   PAGE DETECTION (Opción A)
   ========================= */
const HAS_FEATURED = !!$("gridFeatured");      // Home (index.html) y/o catálogo si lo dejás
const HAS_CATALOG = !!$("catalogGroups");      // catalogo.html
const HAS_TOOLBOX = !!$("qSearch");            // catalogo.html
const HAS_LEAD_FORM = !!$("qName");            // si existe el panel de datos opcionales

/* =========================
   STATE
   ========================= */
let all = [];                 // productos cargados (páginas)
let view = [];                // productos filtrados
let cart = loadCart();

let storeIndex = null;
let paging = {
  catSlug: "",
  subSlug: "",
  page: 0,
  pageSize: 48,
  total: 0,
  hasMore: false,
};

let activeCat = "";
let activeSub = "Todas";
let q = "";
let sortBy = "relevancia";

/* Para resolver carrito aunque el producto no esté en la página actual */
let productMap = new Map(); // id -> producto normalizado

init();

/* =========================
   INIT
   ========================= */
async function init() {
  setBrand();
  wireEvents();

  // Cargar índice (si existe) y decidir qué cargar según página
  storeIndex = await loadIndex();
  paging.pageSize = storeIndex?.page_size ? Number(storeIndex.page_size) : paging.pageSize;

  const firstCat = storeIndex?.categories?.[0] || null;
  if (firstCat) {
    activeCat = firstCat.name;
    activeSub = "Todas";
  }

  // Catalogo.html: carga páginas + toolbox + nav + grupos
  if (HAS_CATALOG || HAS_TOOLBOX) {
    buildIndexes();                 // chips + catnav
    await resetAndLoadFirstPage();  // trae 1ra página de la categoría activa
    applyFilters();
    renderAll();
    updatePagingUI();
  } else {
    // index.html (Home): no cargar catálogo infinito.
    // Cargamos solo 1 página para tener destacados (si existe data).
    if (firstCat) {
      try {
        await resetAndLoadFirstPage();
      } catch {
        all = demoData().map(normalize);
        indexProducts(all);
      }
    } else {
      all = demoData().map(normalize);
      indexProducts(all);
    }

    // En Home no aplica toolbox/catnav/grupos; solo featured y carrito.
    applyFilters();
    renderHomeOnly();
  }

  updateCounters();
  updateQuickWA();
}

/* =========================
   BRAND / TITLE
   ========================= */
function setBrand() {
  if ($("brandName")) $("brandName").textContent = STORE_NAME;
  if ($("footName")) $("footName").textContent = STORE_NAME;

  // Opción A: títulos distintos si querés
  if (document.title) {
    if (HAS_CATALOG) document.title = `${STORE_NAME} | Catálogo`;
    else document.title = `${STORE_NAME} | Inicio`;
  }
}

/* =========================
   EVENTS
   ========================= */
function wireEvents() {
  on("btnOpenCart", "click", openCart);
  on("btnOpenCart2", "click", openCart);
  on("btnCloseCart", "click", closeCart);
  on("overlay", "click", closeCart);

  // Sticky bar (solo si existe)
  on("btnStickyCart", "click", openCart);
  on("btnStickyCatalog", "click", () => {
    const target = document.querySelector("#catalogo") || $("catalogGroups") || $("top");
    if (target?.scrollIntoView) target.scrollIntoView({ behavior: "smooth" });
  });

  on("btnSendWA", "click", sendWhatsApp);

  on("btnClearCart", "click", () => {
    if (!confirm("¿Vaciar carrito?")) return;
    cart = {};
    saveCart();
    renderAllSafe();
    updateQuickWA();
  });

  // Toolbox (solo si existe)
  on("btnClear", "click", () => {
    const qs = $("qSearch");
    if (qs) qs.value = "";
    q = "";
    applyFilters();
    renderAllSafe();
  });

  const qs = $("qSearch");
  if (qs) {
    qs.addEventListener("input", (e) => {
      q = (e.target.value || "").trim();
      applyFilters();
      renderAllSafe();
    });
  }

  const sb = $("sortBy");
  if (sb) {
    sb.addEventListener("change", (e) => {
      sortBy = e.target.value;
      applyFilters();
      renderAllSafe();
    });
  }

  // Lead form inputs (si existen)
  ["qName", "qZone", "qDelivery", "qPay"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", updateQuickWA);
    el.addEventListener("change", updateQuickWA);
  });

  // Load more (solo catálogo)
  const lm = $("btnLoadMore");
  if (lm) {
    lm.addEventListener("click", async () => {
      await loadMore();
      applyFilters();
      renderAllSafe();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCart();
  });

  // Opcional: mostrar/ocultar sticky en móvil (si existe)
  const sticky = $("stickyBar");
  if (sticky) {
    window.addEventListener("scroll", () => {
      // aparece después de cierto scroll
      const show = window.scrollY > 420;
      sticky.style.display = show ? "block" : "";
    });
  }
}

/* =========================
   DATA LOADING
   ========================= */
async function loadIndex() {
  try {
    const r = await fetch(DATA_INDEX_URL, { cache: "no-store" });
    if (!r.ok) throw new Error("No se pudo cargar data/index.json");
    const data = await r.json();
    if (!data || !Array.isArray(data.categories)) throw new Error("index.json inválido");
    return data;
  } catch {
    // fallback demo
    const demo = demoData().map(normalize);
    indexProducts(demo);

    const cats = uniq(demo.map((x) => x.categoria)).sort((a, b) => a.localeCompare(b, "es"));
    return {
      page_size: 48,
      categories: cats.map((c) => ({
        name: c,
        slug: safeId(c),
        count: demo.filter((x) => x.categoria === c).length,
        subcategories: uniq(demo.filter((x) => x.categoria === c).map((x) => x.subcategoria)).map((s) => ({
          name: s,
          slug: safeId(s),
        })),
      })),
    };
  }
}

function getCategoryByName(name) {
  if (!storeIndex?.categories) return null;
  return storeIndex.categories.find((c) => c.name === name) || null;
}
function getActiveCatSlug() {
  const c = getCategoryByName(activeCat);
  return c ? c.slug : safeId(activeCat);
}
function getActiveSubSlug() {
  if (activeSub === "Todas") return "__all__";
  const s = safeId(activeSub);
  return s || "general";
}
function makePageUrl(catSlug, subSlug, page) {
  const p = String(page).padStart(3, "0");
  return `${PAGES_BASE}/${catSlug}/${subSlug}/page-${p}.json`;
}

async function fetchPage(page) {
  const catSlug = getActiveCatSlug();
  const subSlug = getActiveSubSlug();
  const url = makePageUrl(catSlug, subSlug, page);

  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("No se pudo cargar página del catálogo");
  const data = await r.json();
  const items = (data.items || []).map(normalize);

  indexProducts(items);
  return { meta: data, items };
}

async function resetAndLoadFirstPage() {
  paging.catSlug = getActiveCatSlug();
  paging.subSlug = getActiveSubSlug();
  paging.page = 0;
  paging.total = 0;
  paging.hasMore = false;

  all = [];
  view = [];

  const first = await fetchPage(1);
  all = first.items;

  paging.page = 1;
  paging.total = Number(first.meta.total || all.length);
  paging.pageSize = Number(first.meta.page_size || paging.pageSize);
  paging.hasMore = all.length < paging.total;

  updatePagingUI();
}

async function loadMore() {
  if (!paging.hasMore) return;
  const nextPage = paging.page + 1;
  const next = await fetchPage(nextPage);

  all = [...all, ...next.items];
  paging.page = nextPage;
  paging.total = Number(next.meta.total || paging.total);
  paging.hasMore = all.length < paging.total;

  updatePagingUI();
}

function normalize(p) {
  return {
    id: String(p.id ?? p.sku ?? randId()),
    nombre: String(p.nombre ?? "Producto"),
    categoria: String(p.categoria ?? "Otros"),
    subcategoria: String(p.subcategoria ?? "General"),
    precio:
      p.precio === null || p.precio === undefined || p.precio === "" || Number.isNaN(Number(p.precio))
        ? null
        : Number(p.precio),
    destacado: Boolean(p.destacado ?? false),
    descripcion: String(p.descripcion ?? p.descripcion_corta ?? ""),
    imagen: String(p.imagen ?? p.imagen_url ?? ""),
    tags: Array.isArray(p.tags) ? p.tags.map(String) : [],
  };
}

function indexProducts(items) {
  items.forEach((p) => productMap.set(p.id, p));
}

/* =========================
   INDEXES (chips + nav)
   Solo catálogo.html
   ========================= */
function buildIndexes() {
  if (!HAS_TOOLBOX) return;

  const cats =
    storeIndex && Array.isArray(storeIndex.categories)
      ? storeIndex.categories.map((c) => c.name)
      : ["Todos"];

  const chipsCats = $("chipsCats");
  if (chipsCats) {
    chipsCats.innerHTML = "";
    cats.forEach((c) => {
      const b = document.createElement("button");
      b.className = "chip" + (c === activeCat ? " active" : "");
      b.type = "button";
      b.textContent = c;
      b.addEventListener("click", async () => {
        if (c === activeCat) return;
        activeCat = c;
        activeSub = "Todas";
        buildSubChips();
        await resetAndLoadFirstPage();
        applyFilters();
        renderAllSafe();
        updatePagingUI();
      });
      chipsCats.appendChild(b);
    });
  }

  buildSubChips();
  buildCatNav(cats.filter((x) => x !== "Todos"));
}

function buildSubChips() {
  if (!HAS_TOOLBOX) return;

  const catObj = getCategoryByName(activeCat);
  const subs = [
    "Todas",
    ...(catObj && Array.isArray(catObj.subcategories) ? catObj.subcategories.map((s) => s.name) : []),
  ];

  const chipsSubs = $("chipsSubs");
  if (chipsSubs) {
    chipsSubs.innerHTML = "";
    subs.forEach((s) => {
      const b = document.createElement("button");
      b.className = "chip" + (s === activeSub ? " active" : "");
      b.type = "button";
      b.textContent = s;
      b.addEventListener("click", async () => {
        if (s === activeSub) return;
        activeSub = s;
        await resetAndLoadFirstPage();
        applyFilters();
        renderAllSafe();
        updatePagingUI();
      });
      chipsSubs.appendChild(b);
    });
  }

  syncChipActive();
}

function syncChipActive() {
  if (!HAS_TOOLBOX) return;

  const cc = $("chipsCats");
  const cs = $("chipsSubs");
  if (cc) [...cc.children].forEach((el) => el.classList.toggle("active", el.textContent === activeCat));
  if (cs) [...cs.children].forEach((el) => el.classList.toggle("active", el.textContent === activeSub));
}

function buildCatNav(cats) {
  const nav = $("catNav");
  if (!nav) return;
  nav.innerHTML = "";
  cats.forEach((c) => {
    const a = document.createElement("a");
    a.href = `#cat_${safeId(c)}`;
    a.textContent = c;
    nav.appendChild(a);
  });
}

/* =========================
   FILTERS / SORT
   ========================= */
function applyFilters() {
  const query = slug(q);

  view = all.filter((p) => {
    const okCat = !activeCat ? true : p.categoria === activeCat;
    const okSub = activeSub === "Todas" ? true : p.subcategoria === activeSub;

    if (!okCat || !okSub) return false;
    if (!query) return true;

    const hay = slug(`${p.nombre} ${p.id} ${p.categoria} ${p.subcategoria} ${p.descripcion} ${p.tags.join(" ")}`);
    return hay.includes(query);
  });

  view = sortProducts(view, sortBy);

  const info = $("resultsInfo");
  if (info) {
    info.textContent =
      `${view.length} producto(s)` +
      (activeCat ? ` · ${activeCat}` : "") +
      (activeSub && activeSub !== "Todas" ? ` · ${activeSub}` : "") +
      (q ? ` · búsqueda: "${q}"` : "") +
      (paging?.total ? ` · cargados ${all.length}/${paging.total}` : "");
  }
}

function sortProducts(list, mode) {
  const arr = [...list];

  if (mode === "az") {
    arr.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    return arr;
  }

  if (mode === "precio_asc") {
    arr.sort((a, b) => numPrice(a) - numPrice(b));
    return arr;
  }

  if (mode === "precio_desc") {
    arr.sort((a, b) => numPrice(b) - numPrice(a));
    return arr;
  }

  // relevancia: destacados primero, luego en carrito, luego A-Z
  arr.sort((a, b) => {
    const da = a.destacado ? 1 : 0;
    const db = b.destacado ? 1 : 0;
    if (db !== da) return db - da;

    const ca = (cart[a.id] || 0) > 0 ? 1 : 0;
    const cb = (cart[b.id] || 0) > 0 ? 1 : 0;
    if (cb !== ca) return cb - ca;

    return a.nombre.localeCompare(b.nombre, "es");
  });

  return arr;
}
function numPrice(p) {
  return p.precio === null ? Number.POSITIVE_INFINITY : p.precio;
}

/* =========================
   RENDER (A)
   ========================= */
function renderAllSafe() {
  if (HAS_CATALOG || HAS_FEATURED) renderAll();
  else renderHomeOnly();

  renderCart();
  updateCounters();
  updateQuickWA();
}

function renderAll() {
  if (HAS_FEATURED) renderFeatured();
  if (HAS_CATALOG) renderCatalogGroups();
  renderCart();
  updateCounters();
  updateQuickWA();
}

function renderHomeOnly() {
  // En Home: solo destacados + carrito (sin catálogo completo)
  if (HAS_FEATURED) renderFeatured();
  renderCart();
  updateCounters();
  updateQuickWA();
}

function renderFeatured() {
  const grid = $("gridFeatured");
  const empty = $("emptyFeatured");
  if (!grid || !empty) return;

  grid.innerHTML = "";

  // En home: destacados desde "all" (que solo trae 1 página)
  // En catálogo: destacados desde filtros actuales (view)
  const source = HAS_CATALOG ? view : all;
  const featured = source.filter((p) => p.destacado);

  if (!featured.length) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  featured.slice(0, 9).forEach((p) => grid.appendChild(productCard(p)));
}

function renderCatalogGroups() {
  const root = $("catalogGroups");
  const empty = $("emptyAll");
  if (!root || !empty) return;

  root.innerHTML = "";

  if (!view.length) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  const byCat = groupBy(view, (p) => p.categoria);
  const cats = Object.keys(byCat).sort((a, b) => a.localeCompare(b, "es"));

  cats.forEach((cat) => {
    const catId = `cat_${safeId(cat)}`;

    const wrap = document.createElement("div");
    wrap.className = "group";
    wrap.id = catId;

    const head = document.createElement("div");
    head.className = "group-head";
    const h = document.createElement("h3");
    h.textContent = cat;
    const s = document.createElement("span");
    s.textContent = `${byCat[cat].length} producto(s)`;
    head.appendChild(h);
    head.appendChild(s);
    wrap.appendChild(head);

    const bySub = groupBy(byCat[cat], (p) => p.subcategoria);
    const subs = Object.keys(bySub).sort((a, b) => a.localeCompare(b, "es"));

    subs.forEach((sub) => {
      const subWrap = document.createElement("div");
      subWrap.className = "subgroup";

      const sh = document.createElement("h4");
      sh.textContent = sub;
      subWrap.appendChild(sh);

      const subGrid = document.createElement("div");
      subGrid.className = "subgrid";
      bySub[sub].forEach((p) => subGrid.appendChild(productCard(p)));
      subWrap.appendChild(subGrid);

      wrap.appendChild(subWrap);
    });

    root.appendChild(wrap);
  });
}

function productCard(p) {
  const qty = cart[p.id] || 0;

  const card = document.createElement("article");
  card.className = "card";

  const imgWrap = document.createElement("div");
  imgWrap.className = "img";

  const img = document.createElement("img");
  img.loading = "lazy";
  img.src = p.imagen || PLACEHOLDER_IMG;
  img.onerror = () => {
    img.onerror = null;
    img.src = PLACEHOLDER_IMG;
  };
  img.alt = p.nombre;
  imgWrap.appendChild(img);

  const body = document.createElement("div");
  body.className = "body";

  const top = document.createElement("div");
  top.className = "top";

  const title = document.createElement("h3");
  title.textContent = p.nombre;

  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = p.subcategoria;

  top.appendChild(title);
  top.appendChild(tag);

  const desc = document.createElement("p");
  desc.className = "desc";
  const _d = (p.descripcion ?? "").toString().trim();
  desc.textContent = _d;
  if (!_d) desc.style.display = "none";

  const row = document.createElement("div");
  row.className = "row";

  const left = document.createElement("div");
  const price = document.createElement("div");
  price.className = "price";
  price.textContent = money(p.precio);

  const sku = document.createElement("div");
  sku.className = "sku";
  sku.textContent = `Código: ${p.id}`;

  left.appendChild(price);
  left.appendChild(sku);

  const actions = document.createElement("div");
  actions.className = "actions";

  const step = document.createElement("div");
  step.className = "step";

  const dec = document.createElement("button");
  dec.type = "button";
  dec.textContent = "−";
  dec.addEventListener("click", () => changeQty(p.id, -1));

  const mid = document.createElement("span");
  mid.id = `qty_${safeId(p.id)}`;
  mid.textContent = String(qty);

  const inc = document.createElement("button");
  inc.type = "button";
  inc.textContent = "+";
  inc.addEventListener("click", () => changeQty(p.id, +1));

  step.appendChild(dec);
  step.appendChild(mid);
  step.appendChild(inc);

  const add = document.createElement("button");
  add.className = "add";
  add.type = "button";
  add.textContent = "Agregar";
  add.addEventListener("click", () => {
    changeQty(p.id, +1);
    openCart();
  });

  actions.appendChild(step);
  actions.appendChild(add);

  row.appendChild(left);
  row.appendChild(actions);

  body.appendChild(top);
  body.appendChild(desc);
  body.appendChild(row);

  card.appendChild(imgWrap);
  card.appendChild(body);

  return card;
}

/* =========================
   CART
   ========================= */
function loadCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}
function saveCart() {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart || {}));
  } catch {}
}

function changeQty(id, delta) {
  const next = Math.max(0, (cart[id] || 0) + delta);
  if (next === 0) delete cart[id];
  else cart[id] = next;

  saveCart();
  updateCounters();
  syncQtyBadge(id);
  renderCart();
  updateQuickWA();

  // En catálogo recalcula filtros/destacados por el "en carrito"
  if (HAS_CATALOG || HAS_TOOLBOX) {
    applyFilters();
    if (HAS_FEATURED) renderFeatured();
  } else {
    if (HAS_FEATURED) renderFeatured();
  }
}

function syncQtyBadge(id) {
  const el = document.getElementById(`qty_${safeId(id)}`);
  if (el) el.textContent = String(cart[id] || 0);
}

function openCart() {
  if ($("overlay")) $("overlay").classList.add("show");
  if ($("drawer")) $("drawer").classList.add("show");
  renderCart();
}
function closeCart() {
  if ($("overlay")) $("overlay").classList.remove("show");
  if ($("drawer")) $("drawer").classList.remove("show");
}

function cartItemsDetailed() {
  const items = [];
  for (const [id, qty] of Object.entries(cart)) {
    // Primero intentamos resolver con lo cargado / map
    const p = productMap.get(id) || all.find((x) => x.id === id) || null;

    // Si no existe (ej: carrito desde otra página), mostramos “fallback”
    const safeP =
      p ||
      normalize({
        id,
        nombre: `Producto ${id}`,
        categoria: "—",
        subcategoria: "—",
        precio: null,
        destacado: false,
        descripcion: "",
        imagen: "",
        tags: [],
      });

    items.push({ p: safeP, qty });
  }
  return items;
}

function cartCount() {
  return Object.values(cart).reduce((a, b) => a + b, 0);
}

function cartTotal() {
  let t = 0;
  for (const { p, qty } of cartItemsDetailed()) {
    if (p.precio !== null) t += p.precio * qty;
  }
  return t;
}

function updateCounters() {
  if ($("cartCount")) $("cartCount").textContent = String(cartCount());
  if ($("sumItems")) $("sumItems").textContent = String(cartCount());
  if ($("sumTotal")) $("sumTotal").textContent = money(cartTotal());
}

function renderCart() {
  const list = $("cartList");
  if (!list) return;

  list.innerHTML = "";
  const items = cartItemsDetailed();

  if (!items.length) {
    const d = document.createElement("div");
    d.className = "empty";
    d.style.marginTop = "0";
    d.textContent = "Tu carrito está vacío. Elegí productos y armá el pedido.";
    list.appendChild(d);

    if ($("sumItems")) $("sumItems").textContent = "0";
    if ($("sumTotal")) $("sumTotal").textContent = money(0);
    return;
  }

  items.forEach(({ p, qty }) => {
    const row = document.createElement("div");
    row.className = "citem";

    const img = document.createElement("img");
    img.src = p.imagen || PLACEHOLDER_IMG;
    img.onerror = () => {
      img.onerror = null;
      img.src = PLACEHOLDER_IMG;
    };
    img.alt = p.nombre;

    const meta = document.createElement("div");
    meta.className = "cmeta";

    const top = document.createElement("div");
    top.className = "ctop";
    const b = document.createElement("b");
    b.textContent = p.nombre;
    const qn = document.createElement("span");
    qn.textContent = `x${qty}`;
    top.appendChild(b);
    top.appendChild(qn);

    const mid = document.createElement("div");
    mid.className = "ctop";
    const left = document.createElement("span");
    left.textContent = `Código: ${p.id}`;
    const right = document.createElement("span");
    right.textContent = money(p.precio);
    mid.appendChild(left);
    mid.appendChild(right);

    const acts = document.createElement("div");
    acts.className = "cactions";

    const step = document.createElement("div");
    step.className = "step";

    const dec = document.createElement("button");
    dec.type = "button";
    dec.textContent = "−";
    dec.addEventListener("click", () => changeQty(p.id, -1));

    const span = document.createElement("span");
    span.textContent = String(qty);

    const inc = document.createElement("button");
    inc.type = "button";
    inc.textContent = "+";
    inc.addEventListener("click", () => changeQty(p.id, +1));

    step.appendChild(dec);
    step.appendChild(span);
    step.appendChild(inc);

    const rm = document.createElement("button");
    rm.className = "rm";
    rm.type = "button";
    rm.textContent = "Quitar";
    rm.addEventListener("click", () => {
      delete cart[p.id];
      saveCart();
      renderAllSafe();
      updateQuickWA();
    });

    acts.appendChild(step);
    acts.appendChild(rm);

    meta.appendChild(top);
    meta.appendChild(mid);
    meta.appendChild(acts);

    row.appendChild(img);
    row.appendChild(meta);

    list.appendChild(row);
  });

  if ($("sumItems")) $("sumItems").textContent = String(cartCount());
  if ($("sumTotal")) $("sumTotal").textContent = money(cartTotal());
}

/* =========================
   WHATSAPP
   ========================= */
function buildWhatsAppMessage() {
  const items = cartItemsDetailed();

  const name = HAS_LEAD_FORM && $("qName") ? $("qName").value.trim() : "";
  const zone = HAS_LEAD_FORM && $("qZone") ? $("qZone").value.trim() : "";
  const delivery = HAS_LEAD_FORM && $("qDelivery") ? $("qDelivery").value.trim() : "";
  const pay = HAS_LEAD_FORM && $("qPay") ? $("qPay").value.trim() : "";

  const lines = [];
  lines.push(name ? `Hola! Soy ${name}. Quiero hacer un pedido:` : "Hola! Quiero hacer un pedido:");
  if (zone) lines.push(`Zona: ${zone}`);
  if (delivery) lines.push(`Entrega: ${delivery}`);
  if (pay) lines.push(`Pago: ${pay}`);
  lines.push("");
  lines.push("Pedido:");

  let total = 0;
  let hasPrice = false;

  items.forEach(({ p, qty }) => {
    const prTxt = p.precio === null ? "Consultar" : money(p.precio);
    lines.push(`• ${p.nombre} (${p.id}) x${qty} — ${prTxt}`);
    if (p.precio !== null) {
      total += p.precio * qty;
      hasPrice = true;
    }
  });

  if (hasPrice) {
    lines.push("");
    lines.push(`Total estimado: ${money(total)}`);
  }

  lines.push("");
  lines.push("¿Me confirmás stock/variantes y envío? Gracias.");
  return lines.join("\n");
}

function sendWhatsApp() {
  const items = cartItemsDetailed();
  if (!items.length) {
    alert("Tu carrito está vacío.");
    return;
  }

  let msg = buildWhatsAppMessage();

  // Soft limit: compactar si se pasa
  if (msg.length > WA_SOFT_LIMIT) {
    const compact = [];
    compact.push("Hola! Quiero hacer un pedido:");
    items.slice(0, 24).forEach(({ p, qty }) => compact.push(`• ${p.nombre} (${p.id}) x${qty}`));
    if (items.length > 24) compact.push(`(y ${items.length - 24} item(s) más)`);
    compact.push("");
    compact.push("¿Me confirmás stock/variantes y envío? Gracias.");
    msg = compact.join("\n");
  }

  const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function updateQuickWA() {
  const a = $("waQuick");
  if (!a) return;

  // si no hay items, igual llevá a WhatsApp con saludo corto
  const hasItems = cartCount() > 0;
  const msg = hasItems ? buildWhatsAppMessage() : "Hola! Quiero consultar por productos del catálogo.";
  a.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`;
}

/* =========================
   PAGING UI (solo catálogo)
   ========================= */
function updatePagingUI() {
  const wrap = $("loadMoreWrap");
  const btn = $("btnLoadMore");
  if (!wrap || !btn) return;

  wrap.style.display = paging.hasMore ? "block" : "none";
  btn.disabled = !paging.hasMore;
}

/* =========================
   DEMO DATA (fallback)
   ========================= */
function demoData() {
  return [
    {
      id: "A100",
      nombre: "Remera básica premium",
      categoria: "Indumentaria",
      subcategoria: "Remeras",
      precio: 8900,
      destacado: true,
      descripcion: "Algodón suave, calce cómodo. Varios talles.",
      imagen: "",
      tags: ["ropa", "básicos"],
    },
    {
      id: "A101",
      nombre: "Buzo oversize",
      categoria: "Indumentaria",
      subcategoria: "Buzos",
      precio: 21900,
      destacado: true,
      descripcion: "Oversize, abrigado, ideal invierno.",
      imagen: "",
      tags: ["buzo", "invierno"],
    },
    {
      id: "B200",
      nombre: "Cartera mini",
      categoria: "Accesorios",
      subcategoria: "Carteras",
      precio: 15900,
      destacado: false,
      descripcion: "Compacta, cómoda, con cierre.",
      imagen: "",
      tags: ["cartera"],
    },
    {
      id: "B201",
      nombre: "Aros dorados",
      categoria: "Accesorios",
      subcategoria: "Bijou",
      precio: 4500,
      destacado: true,
      descripcion: "Livianos y combinables.",
      imagen: "",
      tags: ["aros", "bijou"],
    },
  ];
}