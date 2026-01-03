const STORE_NAME = "Tu Emprendimiento";
const WHATSAPP_NUMBER = "5491112345678";
const CURRENCY = "ARS";
const LOCALE = "es-AR";
const DATA_INDEX_URL = "./data/index.json";
const PAGES_BASE = "./data/pages";
const SEARCH_BASE = "./data/search";
const PLACEHOLDER_IMG = "./assets/placeholder.svg";
const WA_SOFT_LIMIT = 1400;

const $ = (id) => document.getElementById(id);

let all = [];
let view = [];
let cart = loadCart();

let storeIndex = null;
let paging = { catSlug: "", subSlug: "", page: 0, pageSize: 48, total: 0, hasMore: false };
let searchCache = new Map();

let activeCat = "";
let activeSub = "Todas";
let q = "";
let sortBy = "relevancia";

init();

async function init(){
  setBrand();
  wireEvents();

  storeIndex = await loadIndex();
  paging.pageSize = (storeIndex && storeIndex.page_size) ? storeIndex.page_size : paging.pageSize;

  const firstCat = (storeIndex && storeIndex.categories && storeIndex.categories[0]) ? storeIndex.categories[0] : null;

  if(firstCat){
    activeCat = firstCat.name;
    activeSub = "Todas";
    buildIndexes();
    await resetAndLoadFirstPage();
  }else{
    all = demoData().map(normalize);
    buildIndexes();
  }

  applyFilters();
  renderAll();
  updateCounters();
  updateQuickWA();
  updatePagingUI();
}


function setBrand(){
  $("brandName").textContent = STORE_NAME;
  $("footName").textContent = STORE_NAME;
  document.title = `${STORE_NAME} | Catálogo Boutique`;
}

function wireEvents(){
  $("btnOpenCart").addEventListener("click", openCart);
  $("btnOpenCart2").addEventListener("click", openCart);
  $("btnCloseCart").addEventListener("click", closeCart);
  $("overlay").addEventListener("click", closeCart);

  $("btnStickyCart").addEventListener("click", openCart);
  $("btnStickyCatalog").addEventListener("click", () => document.querySelector("#catalogo")?.scrollIntoView({behavior:"smooth"}));

  $("btnSendWA").addEventListener("click", sendWhatsApp);

  $("btnClearCart").addEventListener("click", () => {
    if(!confirm("¿Vaciar carrito?")) return;
    cart = {};
    saveCart();
    renderAll();
    updateQuickWA();
  });

  $("btnClear").addEventListener("click", () => {
    $("qSearch").value = "";
    q = "";
    applyFilters();
    renderAll();
  });

  $("qSearch").addEventListener("input", (e) => {
    q = (e.target.value || "").trim();
    applyFilters();
    renderAll();
  });

  $("sortBy").addEventListener("change", (e) => {
    sortBy = e.target.value;
    applyFilters();
    renderAll();
  });

  ["qName","qZone","qDelivery","qPay"].forEach(id=>{
    $(id).addEventListener("input", updateQuickWA);
    $(id).addEventListener("change", updateQuickWA);
  });

  $("btnLoadMore")?.addEventListener("click", async () => {
    await loadMore();
    applyFilters();
    renderAll();
  });

  document.addEventListener("keydown", (e) => {
    if(e.key === "Escape") closeCart();
  });
}

async function loadIndex(){
  try{
    const r = await fetch(DATA_INDEX_URL, { cache: "no-store" });
    if(!r.ok) throw new Error("No se pudo cargar data/index.json");
    const data = await r.json();
    if(!data || !Array.isArray(data.categories)) throw new Error("index.json inválido");
    return data;
  }catch{
    // fallback demo
    const demo = demoData().map(normalize);
    const cats = uniq(demo.map(x=>x.categoria)).sort((a,b)=>a.localeCompare(b,"es"));
    return {
      page_size: 48,
      categories: cats.map(c=>({ name:c, slug:safeId(c), count: demo.filter(x=>x.categoria===c).length, subcategories: [] }))
    };
  }
}

function getCategoryByName(name){
  if(!storeIndex || !storeIndex.categories) return null;
  return storeIndex.categories.find(c=>c.name===name) || null;
}

function getActiveCatSlug(){
  const c = getCategoryByName(activeCat);
  return c ? c.slug : safeId(activeCat);
}

function getActiveSubSlug(){
  if(activeSub === "Todas") return "__all__";
  const s = safeId(activeSub);
  return s || "general";
}

function makePageUrl(catSlug, subSlug, page){
  const p = String(page).padStart(3,"0");
  return `${PAGES_BASE}/${catSlug}/${subSlug}/page-${p}.json`;
}

async function fetchPage(page){
  const catSlug = getActiveCatSlug();
  const subSlug = getActiveSubSlug();

  const url = makePageUrl(catSlug, subSlug, page);
  const r = await fetch(url, { cache: "no-store" });
  if(!r.ok) throw new Error("No se pudo cargar página del catálogo");
  const data = await r.json();
  const items = (data.items || []).map(normalize);
  return { meta: data, items };
}

async function resetAndLoadFirstPage(){
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

async function loadMore(){
  if(!paging.hasMore) return;
  const nextPage = paging.page + 1;
  const next = await fetchPage(nextPage);
  all = [...all, ...next.items];
  paging.page = nextPage;
  paging.total = Number(next.meta.total || paging.total);
  paging.hasMore = all.length < paging.total;
  updatePagingUI();
}

function normalize(p){
  return {
    id: String(p.id ?? p.sku ?? randId()),
    nombre: String(p.nombre ?? "Producto"),
    categoria: String(p.categoria ?? "Otros"),
    subcategoria: String(p.subcategoria ?? "General"),
    precio: (p.precio === null || p.precio === undefined || p.precio === "" || Number.isNaN(Number(p.precio))) ? null : Number(p.precio),
    destacado: Boolean(p.destacado ?? false),
    descripcion: String(p.descripcion ?? p.descripcion_corta ?? ""),
    imagen: String(p.imagen ?? p.imagen_url ?? ""),
    tags: Array.isArray(p.tags) ? p.tags.map(String) : []
  };
}

function randId(){
  return "P" + Math.random().toString(16).slice(2,10).toUpperCase();
}

function money(n){
  if(n === null) return "Consultar";
  try{
    return new Intl.NumberFormat(LOCALE, { style:"currency", currency:CURRENCY, maximumFractionDigits:0 }).format(n);
  }catch{
    return `$${n}`;
  }
}

function slug(s){
  return (s || "").toString().toLowerCase().trim();
}

function safeId(s){
  return slug(s).replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");
}

function uniq(arr){
  return Array.from(new Set(arr.filter(Boolean)));
}

function buildIndexes(){
  const cats = (storeIndex && Array.isArray(storeIndex.categories))
    ? storeIndex.categories.map(c=>c.name)
    : ["Todos"];

  const chipsCats = $("chipsCats");
  chipsCats.innerHTML = "";
  cats.forEach(c=>{
    const b = document.createElement("button");
    b.className = "chip" + (c === activeCat ? " active" : "");
    b.type = "button";
    b.textContent = c;
    b.addEventListener("click", async ()=>{
      if(c === activeCat) return;
      activeCat = c;
      activeSub = "Todas";
      buildSubChips();
      await resetAndLoadFirstPage();
      applyFilters();
      renderAll();
      updatePagingUI();
    });
    chipsCats.appendChild(b);
  });

  buildSubChips();
  buildCatNav(cats.filter(x=>x!=="Todos"));
}

function buildSubChips(){
  const catObj = getCategoryByName(activeCat);
  const subs = ["Todas", ...(catObj && Array.isArray(catObj.subcategories) ? catObj.subcategories.map(s=>s.name) : [])];

  const chipsSubs = $("chipsSubs");
  chipsSubs.innerHTML = "";
  subs.forEach(s=>{
    const b = document.createElement("button");
    b.className = "chip" + (s === activeSub ? " active" : "");
    b.type = "button";
    b.textContent = s;
    b.addEventListener("click", async ()=>{
      if(s === activeSub) return;
      activeSub = s;
      await resetAndLoadFirstPage();
      applyFilters();
      renderAll();
      updatePagingUI();
    });
    chipsSubs.appendChild(b);
  });

  syncChipActive();
}

function syncChipActive(){
  [...$("chipsCats").children].forEach(el=>{
    el.classList.toggle("active", el.textContent === activeCat);
  });
  [...$("chipsSubs").children].forEach(el=>{
    el.classList.toggle("active", el.textContent === activeSub);
  });
}

function buildCatNav(cats){
  const nav = $("catNav");
  nav.innerHTML = "";
  cats.forEach(c=>{
    const a = document.createElement("a");
    a.href = `#cat_${safeId(c)}`;
    a.textContent = c;
    nav.appendChild(a);
  });
}

function applyFilters(){
  const query = slug(q);

  view = all.filter(p=>{
    const okCat = !activeCat ? true : p.categoria === activeCat;
    const okSub = activeSub === "Todas" ? true : p.subcategoria === activeSub;

    if(!okCat || !okSub) return false;
    if(!query) return true;

    const hay = slug(`${p.nombre} ${p.id} ${p.categoria} ${p.subcategoria} ${p.descripcion} ${p.tags.join(" ")}`);
    return hay.includes(query);
  });

  view = sortProducts(view, sortBy);

  $("resultsInfo").textContent =
    `${view.length} producto(s)`
    + (activeCat ? ` · ${activeCat}` : "")
    + (activeSub && activeSub !== "Todas" ? ` · ${activeSub}` : "")
    + (q ? ` · búsqueda: "${q}"` : "")
    + (paging && paging.total ? ` · cargados ${all.length}/${paging.total}` : "");
}function sortProducts(list, mode){
  const arr = [...list];

  if(mode === "az"){
    arr.sort((a,b)=>a.nombre.localeCompare(b.nombre,"es"));
    return arr;
  }

  if(mode === "precio_asc"){
    arr.sort((a,b)=>numPrice(a)-numPrice(b));
    return arr;
  }

  if(mode === "precio_desc"){
    arr.sort((a,b)=>numPrice(b)-numPrice(a));
    return arr;
  }

  arr.sort((a,b)=>{
    const da = a.destacado ? 1 : 0;
    const db = b.destacado ? 1 : 0;
    if(db !== da) return db - da;

    const ca = (cart[a.id] || 0) > 0 ? 1 : 0;
    const cb = (cart[b.id] || 0) > 0 ? 1 : 0;
    if(cb !== ca) return cb - ca;

    return a.nombre.localeCompare(b.nombre,"es");
  });

  return arr;
}

function numPrice(p){
  return p.precio === null ? Number.POSITIVE_INFINITY : p.precio;
}

function renderAll(){
  renderFeatured();
  renderCatalogGroups();
  renderCart();
  updateCounters();
  updateQuickWA();
}

function renderFeatured(){
  const grid = $("gridFeatured");
  const empty = $("emptyFeatured");
  grid.innerHTML = "";

  const featured = view.filter(p=>p.destacado);
  if(!featured.length){
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  featured.slice(0, 9).forEach(p=>{
    grid.appendChild(productCard(p));
  });
}

function renderCatalogGroups(){
  const root = $("catalogGroups");
  const empty = $("emptyAll");
  root.innerHTML = "";

  if(!view.length){
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  const byCat = groupBy(view, p=>p.categoria);
  const cats = Object.keys(byCat).sort((a,b)=>a.localeCompare(b,"es"));

  cats.forEach(cat=>{
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

    const bySub = groupBy(byCat[cat], p=>p.subcategoria);
    const subs = Object.keys(bySub).sort((a,b)=>a.localeCompare(b,"es"));

    subs.forEach(sub=>{
      const subWrap = document.createElement("div");
      subWrap.className = "subgroup";

      const sh = document.createElement("h4");
      sh.textContent = sub;
      subWrap.appendChild(sh);

      const subGrid = document.createElement("div");
      subGrid.className = "subgrid";
      bySub[sub].forEach(p=>subGrid.appendChild(productCard(p)));
      subWrap.appendChild(subGrid);

      wrap.appendChild(subWrap);
    });

    root.appendChild(wrap);
  });
}

function groupBy(arr, keyFn){
  return arr.reduce((acc, item)=>{
    const k = keyFn(item);
    (acc[k] ||= []).push(item);
    return acc;
  }, {});
}

function placeholderImg(seed){
  return PLACEHOLDER_IMG;
}

function productCard(p){
  const qty = cart[p.id] || 0;

  const card = document.createElement("article");
  card.className = "card";

  const imgWrap = document.createElement("div");
  imgWrap.className = "img";
  const img = document.createElement("img");
  img.loading = "lazy";
  img.src = p.imagen || placeholderImg(p.id);
  img.onerror = () => { img.onerror = null; img.src = PLACEHOLDER_IMG; };
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
  desc.textContent = p.descripcion || "Descripción breve del producto.";

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
  dec.addEventListener("click", ()=>changeQty(p.id, -1));

  const mid = document.createElement("span");
  mid.id = `qty_${safeId(p.id)}`;
  mid.textContent = String(qty);

  const inc = document.createElement("button");
  inc.type = "button";
  inc.textContent = "+";
  inc.addEventListener("click", ()=>changeQty(p.id, +1));

  step.appendChild(dec);
  step.appendChild(mid);
  step.appendChild(inc);

  const add = document.createElement("button");
  add.className = "add";
  add.type = "button";
  add.textContent = "Agregar";
  add.addEventListener("click", ()=>{
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

function changeQty(id, delta){
  const next = Math.max(0, (cart[id] || 0) + delta);
  if(next === 0) delete cart[id];
  else cart[id] = next;

  saveCart();
  updateCounters();
  syncQtyBadge(id);
  renderCart();
  updateQuickWA();
  applyFilters();
  renderFeatured();
}

function syncQtyBadge(id){
  const el = document.getElementById(`qty_${safeId(id)}`);
  if(el) el.textContent = String(cart[id] || 0);
}

function openCart(){
  $("overlay").classList.add("show");
  $("drawer").classList.add("show");
  renderCart();
}

function closeCart(){
  $("overlay").classList.remove("show");
  $("drawer").classList.remove("show");
}

function cartItemsDetailed(){
  const items = [];
  for(const [id, qty] of Object.entries(cart)){
    const p = all.find(x=>x.id === id);
    if(!p) continue;
    items.push({p, qty});
  }
  return items;
}

function cartCount(){
  return Object.values(cart).reduce((a,b)=>a+b,0);
}

function cartTotal(){
  let t = 0;
  for(const {p, qty} of cartItemsDetailed()){
    if(p.precio !== null) t += p.precio * qty;
  }
  return t;
}

function updateCounters(){
  $("cartCount").textContent = String(cartCount());
  $("sumItems").textContent = String(cartCount());
  $("sumTotal").textContent = money(cartTotal());
}

function renderCart(){
  const list = $("cartList");
  list.innerHTML = "";

  const items = cartItemsDetailed();
  if(!items.length){
    const d = document.createElement("div");
    d.className = "empty";
    d.style.marginTop = "0";
    d.textContent = "Tu carrito está vacío. Elegí productos y armá el pedido.";
    list.appendChild(d);
    $("sumItems").textContent = "0";
    $("sumTotal").textContent = money(0);
    return;
  }

  items.forEach(({p, qty})=>{
    const row = document.createElement("div");
    row.className = "citem";

    const img = document.createElement("img");
    img.src = p.imagen || placeholderImg(p.id);
  img.onerror = () => { img.onerror = null; img.src = PLACEHOLDER_IMG; };
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
    dec.addEventListener("click", ()=>changeQty(p.id, -1));

    const span = document.createElement("span");
    span.textContent = String(qty);

    const inc = document.createElement("button");
    inc.type = "button";
    inc.textContent = "+";
    inc.addEventListener("click", ()=>changeQty(p.id, +1));

    step.appendChild(dec);
    step.appendChild(span);
    step.appendChild(inc);

    const rm = document.createElement("button");
    rm.className = "rm";
    rm.type = "button";
    rm.textContent = "Quitar";
    rm.addEventListener("click", ()=>{
      delete cart[p.id];
      saveCart();
      renderAll();
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

  $("sumItems").textContent = String(cartCount());
  $("sumTotal").textContent = money(cartTotal());
}

function buildWhatsAppMessage(){
  const items = cartItemsDetailed();
  const name = $("qName").value.trim();
  const zone = $("qZone").value.trim();
  const delivery = $("qDelivery").value.trim();
  const pay = $("qPay").value.trim();

  const lines = [];
  lines.push(name ? `Hola! Soy ${name}. Quiero hacer un pedido:` : "Hola! Quiero hacer un pedido:");
  if(zone) lines.push(`Zona: ${zone}`);
  if(delivery) lines.push(`Entrega: ${delivery}`);
  if(pay) lines.push(`Pago: ${pay}`);
  lines.push("");
  lines.push("Pedido:");

  let total = 0;
  let hasPrice = false;

  items.forEach(({p, qty})=>{
    const prTxt = p.precio === null ? "Consultar" : money(p.precio);
    lines.push(`• ${p.nombre} (${p.id}) x${qty} — ${prTxt}`);
    if(p.precio !== null){
      total += p.precio * qty;
      hasPrice = true;
    }
  });

  if(hasPrice){
    lines.push("");
    lines.push(`Total estimado: ${money(total)}`);
  }

  lines.push("");
  lines.push("¿Me confirmás stock/variantes y envío? Gracias.");
  return lines.join("\n");
}

function sendWhatsApp(){
  const items = cartItemsDetailed();
  if(!items.length){
    alert("Tu carrito está vacío.");
    return;
  }

  let msg = buildWhatsAppMessage();
  if(msg.length > WA_SOFT_LIMIT){
    const compact = [];
    compact.push("Hola! Quiero hacer un pedido:");
    items.slice(0, 18).forEach(({p, qty})=>compact.push(`• ${p.id} x${qty}`));
    if(items.length > 18) compact.push(`(y ${items.length - 18} ítems más)`);
    compact.push(`Total estimado: ${money(cartTotal())}`);
    compact.push("¿Me confirmás stock y envío? Gracias.");
    msg = compact.join("\n");
  }

  const url = `https://wa.me/${encodeURIComponent(WHATSAPP_NUMBER)}?text=${encodeURIComponent(msg)}`;
  window.open(url, "_blank", "noopener");
}

function updateQuickWA(){
  const hasItems = cartCount() > 0;
  let msg = hasItems ? buildWhatsAppMessage() : "Hola! Quiero consultar por productos y disponibilidad. ¿Me pasás info?";
  if(msg.length > WA_SOFT_LIMIT){
    msg = "Hola! Quiero hacer un pedido. ¿Me confirmás stock y envío? (Te paso el detalle por el chat).";
  }
  $("waQuick").href = `https://wa.me/${encodeURIComponent(WHATSAPP_NUMBER)}?text=${encodeURIComponent(msg)}`;
}

function loadCart(){
  try{
    const raw = localStorage.getItem("cart_boutique_v1");
    return raw ? JSON.parse(raw) : {};
  }catch{
    return {};
  }
}

function saveCart(){
  localStorage.setItem("cart_boutique_v1", JSON.stringify(cart));
}

function demoData(){
  return [
    {id:"LIB-CUA-001", nombre:"Cuaderno A5 Tapa Dura", categoria:"Librería", subcategoria:"Cuadernos", precio:5200, destacado:true, descripcion:"80 hojas, tapa dura. Ideal estudio/trabajo.", imagen:"https://picsum.photos/seed/cuaderno_a5/900/700"},
    {id:"LIB-CUA-002", nombre:"Cuaderno A4 Rayado", categoria:"Librería", subcategoria:"Cuadernos", precio:6900, destacado:false, descripcion:"A4, rayado, encuadernado reforzado.", imagen:"https://picsum.photos/seed/cuaderno_a4/900/700"},
    {id:"LIB-LAP-001", nombre:"Lápiz Negro HB (x12)", categoria:"Librería", subcategoria:"Lápices", precio:4100, destacado:true, descripcion:"Pack x12, trazo suave, buena mina.", imagen:"https://picsum.photos/seed/lapiz_hb/900/700"},
    {id:"LIB-LAP-002", nombre:"Lapicera Gel Negra", categoria:"Librería", subcategoria:"Lápices", precio:900, destacado:false, descripcion:"Secado rápido, trazo parejo.", imagen:"https://picsum.photos/seed/lapicera_gel/900/700"},
    {id:"LIB-ART-001", nombre:"Set Marcadores 12u", categoria:"Librería", subcategoria:"Arte", precio:8900, destacado:true, descripcion:"Colores vivos para lettering y dibujo.", imagen:"https://picsum.photos/seed/marcadores_12/900/700"},
    {id:"LIB-ART-002", nombre:"Acuarelas 12 colores", categoria:"Librería", subcategoria:"Arte", precio:7600, destacado:false, descripcion:"Pastillas con pincel incluido.", imagen:"https://picsum.photos/seed/acuarelas/900/700"},

    {id:"JUG-MUN-001", nombre:"Muñeca Clásica 30cm", categoria:"Juguetería", subcategoria:"Muñecas/os", precio:18900, destacado:true, descripcion:"Muñeca 30cm, ropa intercambiable.", imagen:"https://picsum.photos/seed/muneca_30/900/700"},
    {id:"JUG-MUN-002", nombre:"Muñeco Articulado", categoria:"Juguetería", subcategoria:"Muñecas/os", precio:15900, destacado:false, descripcion:"Articulaciones móviles, ideal colección.", imagen:"https://picsum.photos/seed/muneco_art/900/700"},
    {id:"JUG-PEL-001", nombre:"Pelota Fútbol N°5", categoria:"Juguetería", subcategoria:"Pelotas", precio:12500, destacado:true, descripcion:"N°5, costura reforzada.", imagen:"https://picsum.photos/seed/pelota_futbol/900/700"},
    {id:"JUG-PEL-002", nombre:"Pelota Playa Inflable", categoria:"Juguetería", subcategoria:"Pelotas", precio:6200, destacado:false, descripcion:"Liviana, ideal verano.", imagen:"https://picsum.photos/seed/pelota_playa/900/700"},
    {id:"JUG-AUT-001", nombre:"Auto a Fricción", categoria:"Juguetería", subcategoria:"Autos", precio:7900, destacado:true, descripcion:"Tira y corre, resistente.", imagen:"https://picsum.photos/seed/auto_friccion/900/700"},
    {id:"JUG-AUT-002", nombre:"Camioncito Constructor", categoria:"Juguetería", subcategoria:"Autos", precio:9900, destacado:false, descripcion:"Volqueta móvil, plástico duro.", imagen:"https://picsum.photos/seed/camioncito/900/700"}
  ];
}

function updatePagingUI(){
  const wrap = $("loadMoreWrap");
  if(!wrap) return;
  wrap.style.display = (paging && paging.hasMore) ? "" : "none";
}
