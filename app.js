/* PLMECO - Inventario de Vehículos de Manutención
   PWA offline para GitHub Pages. Datos locales en IndexedDB. */

const DB_NAME = 'plmeco_inventario_vm';
const DB_VERSION = 1;
const STORES = ['toyota', 'aranco', 'chargers', 'inventorySessions', 'reviews', 'settings'];
const STATES = ['Operativa','Operativa con incidencias','No operativa','En reparación','No localizada'];
const ACTIONS = ['Revisar','Reparar','Solicitar recambio','Dar de baja'];
const VEHICLE_INCIDENTS = ['No arranca','No carga','Batería defectuosa','Horquillas dañadas','Fuga hidráulica','Pantalla averiada','Golpes o daños estructurales','Ruedas desgastadas','Luces averiadas','Bocina averiada','Otro'];
const CHARGER_INCIDENTS = ['Cargador OK','No carga','Conector roto','Cable deteriorado','Sin soporte','No localizado','Otro'];

let db;
let currentView = 'inicio';
let deferredPrompt = null;
let currentInventory = null;
let currentReviews = [];

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const today = () => new Date().toISOString().slice(0, 10);
const uid = () => crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = event => {
      const database = event.target.result;
      STORES.forEach(store => {
        if (!database.objectStoreNames.contains(store)) database.createObjectStore(store, { keyPath: 'id' });
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(store, mode = 'readonly') { return db.transaction(store, mode).objectStore(store); }
function getAll(store) { return new Promise((res, rej) => { const r = tx(store).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
function put(store, value) { return new Promise((res, rej) => { const r = tx(store, 'readwrite').put(value); r.onsuccess = () => res(value); r.onerror = () => rej(r.error); }); }
function del(store, id) { return new Promise((res, rej) => { const r = tx(store, 'readwrite').delete(id); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }); }
function clearStore(store) { return new Promise((res, rej) => { const r = tx(store, 'readwrite').clear(); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }); }

async function seedData() {
  const existing = await getAll('toyota');
  if (existing.length) return;
  const toyota = [
    ['T-001','Transpaleta eléctrica','8FBET15-001','Toyota 8FBET15','Expedición'],
    ['T-002','Carretilla elevadora','8FBMT25-087','Toyota 8FBMT25','Paquetería'],
    ['T-003','Recogepedidos','OME100-453','Toyota OME100','Confección'],
    ['T-004','Apilador','SWE120-112','Toyota SWE120','RFID']
  ].map(v => ({ id: uid(), numeracion: v[0], tipo: v[1], serie: v[2], modelo: v[3], seccion: v[4], active: true, createdAt: today() }));
  const aranco = [
    ['AR-01','ARC-2024-771','Expedición'],['AR-02','ARC-2024-810','Confección'],['AR-03','ARC-2025-102','RFID']
  ].map(v => ({ id: uid(), maquina: v[0], serie: v[1], seccion: v[2], active: true, createdAt: today() }));
  const chargers = [
    ['C-001','Muelle 1','T-001','Cargador pared zona expedición'],['C-002','Muelle 3','T-002',''],['C-003','RFID','T-004','Compartido']
  ].map(v => ({ id: uid(), codigo: v[0], zona: v[1], maquinaAsociada: v[2], observaciones: v[3], active: true, createdAt: today() }));
  for (const x of toyota) await put('toyota', x);
  for (const x of aranco) await put('aranco', x);
  for (const x of chargers) await put('chargers', x);
}

function setTitle(title, subtitle) { $('#pageTitle').textContent = title; $('#pageSubtitle').textContent = subtitle; }
function badge(state) {
  const cls = state === 'Operativa' || state === 'Cargador OK' ? 'b-ok' : state === 'Operativa con incidencias' || state === 'En reparación' ? 'b-warn' : state === 'No localizada' || state === 'No localizado' ? 'b-bad' : 'b-info';
  return `<span class="badge ${cls}">${state || 'Pendiente'}</span>`;
}
function escapeHtml(v='') { return String(v).replace(/[&<>"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s])); }

async function getEquipmentFlat() {
  const [toyota, aranco, chargers] = await Promise.all([getAll('toyota'), getAll('aranco'), getAll('chargers')]);
  return [
    ...toyota.filter(x=>x.active).map(x => ({ id: x.id, kind:'toyota', code:x.numeracion, name:x.tipo, serie:x.serie, section:x.seccion, model:x.modelo })),
    ...aranco.filter(x=>x.active).map(x => ({ id: x.id, kind:'aranco', code:x.maquina, name:'Maquinaria Aranco', serie:x.serie, section:x.seccion, model:'' })),
    ...chargers.filter(x=>x.active).map(x => ({ id: x.id, kind:'charger', code:x.codigo, name:'Cargador', serie:'', section:x.zona, model:x.maquinaAsociada }))
  ];
}

async function computeStats() {
  const equipment = await getEquipmentFlat();
  const reviews = await getAll('reviews');
  const latest = new Map();
  reviews.sort((a,b) => String(a.date).localeCompare(String(b.date))).forEach(r => latest.set(r.equipmentId, r));
  const counts = { total: equipment.length, ok:0, incidents:0, repair:0, missing:0, noOp:0 };
  equipment.forEach(e => {
    const r = latest.get(e.id);
    if (!r) return;
    if (r.state === 'Operativa') counts.ok++;
    if (r.state === 'Operativa con incidencias') counts.incidents++;
    if (r.state === 'En reparación') counts.repair++;
    if (r.state === 'No localizada') counts.missing++;
    if (r.state === 'No operativa') counts.noOp++;
  });
  return { equipment, reviews, latest, counts };
}

async function renderAlerts() {
  const { equipment, reviews } = await computeStats();
  const now = new Date();
  const alerts = [];
  for (const e of equipment) {
    const related = reviews.filter(r => r.equipmentId === e.id);
    const recentInc = related.filter(r => (now - new Date(r.date)) / 86400000 <= 90 && r.state !== 'Operativa');
    const last = related.sort((a,b)=> new Date(b.date)-new Date(a.date))[0];
    if (recentInc.length > 3) alerts.push(`⚠️ ${e.code}: más de 3 incidencias en 90 días.`);
    if (!last || (now - new Date(last.date)) / 86400000 > 30) alerts.push(`⏱️ ${e.code}: sin revisar más de 30 días.`);
    if (last?.state === 'No localizada') alerts.push(`🚨 ${e.code}: marcado como no localizado.`);
  }
  $('#alertsBar').innerHTML = alerts.slice(0,6).map(a => `<div class="alert">${escapeHtml(a)}</div>`).join('');
}

async function renderInicio() {
  setTitle('Inicio', 'Panel de control del inventario de vehículos de manutención.');
  const { counts, reviews } = await computeStats();
  const incidentsByType = {};
  reviews.filter(r => r.incident).forEach(r => incidentsByType[r.incident] = (incidentsByType[r.incident] || 0) + 1);
  const ranking = Object.entries(incidentsByType).sort((a,b)=>b[1]-a[1]).slice(0,6);
  $('#content').innerHTML = `
    <div class="cards">
      ${metric('Total máquinas', counts.total, '🚜')}
      ${metric('Operativas', counts.ok, '✅')}
      ${metric('Con incidencias', counts.incidents + counts.noOp, '⚠️')}
      ${metric('En reparación', counts.repair, '🛠️')}
      ${metric('No localizadas', counts.missing, '🚨')}
    </div>
    <div class="cards">
      <div class="card"><h2>Ranking de averías</h2>${renderBarChart(ranking)}</div>
      <div class="card"><h2>Accesos rápidos</h2><div class="quick-buttons"><button onclick="startInventory()">Nuevo inventario</button><button onclick="navigate('informes')">Generar informe</button><button onclick="exportAllExcel()">Exportar todo Excel</button></div></div>
    </div>`;
}
function metric(label, value, icon) { return `<div class="card metric"><div><span>${label}</span><strong>${value}</strong></div><div style="font-size:34px">${icon}</div></div>`; }
function renderBarChart(rows) {
  if (!rows.length) return '<p>Sin incidencias registradas todavía.</p>';
  const max = Math.max(...rows.map(x=>x[1]));
  return `<div class="chart">${rows.map(([k,v]) => `<div class="bar-row"><span>${escapeHtml(k)}</span><div class="bar"><i style="width:${(v/max)*100}%"></i></div><b>${v}</b></div>`).join('')}</div>`;
}

async function renderMaster(store, title, subtitle, fields) {
  setTitle(title, subtitle);
  const rows = await getAll(store);
  $('#content').innerHTML = `
    <div class="toolbar"><div class="toolbar-left"><input id="searchBox" placeholder="Buscar..." style="width:280px"></div><div class="toolbar-right"><button class="secondary" onclick="exportStoreExcel('${store}')">Exportar Excel</button><button class="primary" onclick='openItemDialog("${store}")'>Añadir</button></div></div>
    <div class="table-wrap"><table><thead><tr>${fields.map(f=>`<th>${f.label}</th>`).join('')}<th>Activo</th><th>Acciones</th></tr></thead><tbody id="masterBody"></tbody></table></div>`;
  const draw = () => {
    const q = ($('#searchBox').value || '').toLowerCase();
    $('#masterBody').innerHTML = rows.filter(r => JSON.stringify(r).toLowerCase().includes(q)).map(r => `
      <tr>${fields.map(f=>`<td>${escapeHtml(r[f.key] || '')}</td>`).join('')}<td>${r.active ? 'Sí' : 'No'}</td><td><button class="secondary" onclick='openItemDialog("${store}", ${JSON.stringify(r)})'>Editar</button> <button class="danger" onclick='removeItem("${store}", "${r.id}")'>Baja</button></td></tr>`).join('');
  };
  $('#searchBox').addEventListener('input', draw); draw();
}

window.openItemDialog = function(store, item = null) {
  const cfg = masterConfig[store];
  $('#dialogTitle').textContent = item ? `Editar ${cfg.singular}` : `Nuevo ${cfg.singular}`;
  $('#dialogFields').innerHTML = cfg.fields.map(f => fieldHtml(f, item?.[f.key] || '')).join('') + `<label><span>Activo</span><select name="active"><option value="true" ${item?.active!==false?'selected':''}>Sí</option><option value="false" ${item?.active===false?'selected':''}>No</option></select></label>`;
  const dialog = $('#itemDialog'); dialog.showModal();
  $('#itemForm').onsubmit = async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    data.active = data.active === 'true';
    await put(store, { ...(item || { id: uid(), createdAt: today() }), ...data, updatedAt: new Date().toISOString() });
    dialog.close(); renderCurrent();
  };
};
function fieldHtml(f, value) {
  if (f.type === 'textarea') return `<label class="full"><span>${f.label}</span><textarea name="${f.key}">${escapeHtml(value)}</textarea></label>`;
  return `<label><span>${f.label}</span><input name="${f.key}" value="${escapeHtml(value)}" required></label>`;
}
window.removeItem = async function(store, id) { if (confirm('¿Dar de baja este elemento?')) { const rows = await getAll(store); const item = rows.find(x=>x.id===id); await put(store, {...item, active:false, updatedAt:new Date().toISOString()}); renderCurrent(); } };

const masterConfig = {
  toyota: { singular:'vehículo Toyota', fields:[{key:'numeracion',label:'Numeración interna'},{key:'tipo',label:'Tipo de máquina'},{key:'serie',label:'Nº Serie'},{key:'modelo',label:'Modelo'},{key:'seccion',label:'Sección'}] },
  aranco: { singular:'máquina Aranco', fields:[{key:'maquina',label:'Máquina'},{key:'serie',label:'Nº Serie'},{key:'seccion',label:'Sección'}] },
  chargers: { singular:'cargador', fields:[{key:'codigo',label:'Código cargador'},{key:'zona',label:'Zona'},{key:'maquinaAsociada',label:'Máquina asociada'},{key:'observaciones',label:'Observaciones',type:'textarea'}] }
};

async function renderInventario() {
  setTitle('Inventario semanal', 'Revisión rápida de cada equipo mediante estados, incidencias y acciones.');
  if (!currentInventory) {
    $('#content').innerHTML = `<div class="card"><h2>Iniciar inventario</h2><div class="inventory-header"><label>Encargado<input id="encargado" placeholder="Nombre del encargado"></label><label>Operario<input id="operario" placeholder="Nombre del operario"></label><label>Fecha<input id="fechaInv" type="date" value="${today()}"></label></div><br><button class="primary" onclick="startInventoryFromForm()">Comenzar revisión</button></div>`;
    return;
  }
  const equipment = await getEquipmentFlat();
  $('#content').innerHTML = `<div class="toolbar"><div><b>Encargado:</b> ${escapeHtml(currentInventory.manager)} · <b>Operario:</b> ${escapeHtml(currentInventory.operator)} · <b>Fecha:</b> ${currentInventory.date}</div><div class="toolbar-right"><button class="secondary" onclick="saveInventoryDraft()">Guardar</button><button class="primary" onclick="finishInventory()">Finalizar y guardar histórico</button></div></div><div class="review-grid">${equipment.map(e => renderReviewCard(e)).join('')}</div>`;
}
window.startInventory = function(){ currentView='inventario'; currentInventory=null; activateMenu(); renderCurrent(); };
window.startInventoryFromForm = async function(){
  currentInventory = { id: uid(), manager: $('#encargado').value || 'Sin indicar', operator: $('#operario').value || 'Sin indicar', date: $('#fechaInv').value || today(), createdAt: new Date().toISOString() };
  const equipment = await getEquipmentFlat();
  currentReviews = equipment.map(e => ({ id: uid(), sessionId: currentInventory.id, equipmentId:e.id, equipmentKind:e.kind, code:e.code, name:e.name, serie:e.serie, section:e.section, model:e.model, date: currentInventory.date, state:'Operativa', incident:e.kind==='charger'?'Cargador OK':'', action:'Revisar', notes:'' }));
  renderInventario();
};
function renderReviewCard(e) {
  const r = currentReviews.find(x=>x.equipmentId===e.id) || {};
  const incidents = e.kind === 'charger' ? CHARGER_INCIDENTS : VEHICLE_INCIDENTS;
  return `<article class="review-card"><h3>${escapeHtml(e.code)} · ${escapeHtml(e.name)}</h3><p>${escapeHtml(e.section)} ${e.serie ? '· Serie ' + escapeHtml(e.serie) : ''}</p><div class="quick-buttons">${STATES.map(s=>`<button class="${r.state===s?'selected':''}" onclick="setReview('${e.id}','state','${s}')">${s}</button>`).join('')}</div><label>Incidencia<select onchange="setReview('${e.id}','incident',this.value)">${incidents.map(i=>`<option ${r.incident===i?'selected':''}>${i}</option>`).join('')}</select></label><label>Acción<select onchange="setReview('${e.id}','action',this.value)">${ACTIONS.map(a=>`<option ${r.action===a?'selected':''}>${a}</option>`).join('')}</select></label><label>Observaciones<textarea onchange="setReview('${e.id}','notes',this.value)">${escapeHtml(r.notes||'')}</textarea></label></article>`;
}
window.setReview = function(id, key, value) { const r = currentReviews.find(x=>x.equipmentId===id); if (!r) return; r[key] = value; if (key === 'incident' && value && value !== 'Cargador OK') r.state = 'Operativa con incidencias'; renderInventario(); };
window.saveInventoryDraft = async function(){ alert('Borrador mantenido localmente en esta sesión. Al finalizar se guarda en histórico.'); };
window.finishInventory = async function(){
  if (!currentInventory) return;
  await put('inventorySessions', currentInventory);
  for (const r of currentReviews) await put('reviews', {...r, savedAt: new Date().toISOString()});
  alert('Inventario guardado en histórico.');
  currentInventory = null; currentReviews = []; navigate('historico');
};

async function renderHistorico() {
  setTitle('Histórico', 'Consulta de revisiones por máquina, cargador, fecha o sección.');
  const reviews = (await getAll('reviews')).sort((a,b)=> new Date(b.savedAt||b.date)-new Date(a.savedAt||a.date));
  $('#content').innerHTML = `<div class="toolbar"><input id="histSearch" placeholder="Buscar por equipo, serie, sección, fecha..." style="max-width:420px"><button class="secondary" onclick="exportReviewsExcel()">Exportar histórico Excel</button></div><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Equipo</th><th>Serie</th><th>Sección</th><th>Estado</th><th>Incidencia</th><th>Acción</th><th>Notas</th></tr></thead><tbody id="histBody"></tbody></table></div>`;
  const draw = () => { const q = ($('#histSearch').value||'').toLowerCase(); $('#histBody').innerHTML = reviews.filter(r=>JSON.stringify(r).toLowerCase().includes(q)).map(r=>`<tr><td>${r.date}</td><td>${escapeHtml(r.code)}</td><td>${escapeHtml(r.serie)}</td><td>${escapeHtml(r.section)}</td><td>${badge(r.state)}</td><td>${escapeHtml(r.incident)}</td><td>${escapeHtml(r.action)}</td><td>${escapeHtml(r.notes)}</td></tr>`).join(''); };
  $('#histSearch').addEventListener('input', draw); draw();
}

async function renderInformes() {
  setTitle('Informes', 'Generación de PDF profesional y exportación Excel.');
  const sessions = (await getAll('inventorySessions')).sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
  $('#content').innerHTML = `<div class="card"><h2>Informes de inventario</h2><p>Selecciona una revisión guardada para emitir PDF o Excel.</p><br><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Encargado</th><th>Operario</th><th>Acciones</th></tr></thead><tbody>${sessions.map(s=>`<tr><td>${s.date}</td><td>${escapeHtml(s.manager)}</td><td>${escapeHtml(s.operator)}</td><td><button class="primary" onclick="generatePdf('${s.id}')">PDF</button> <button class="secondary" onclick="generateSessionExcel('${s.id}')">Excel</button></td></tr>`).join('') || '<tr><td colspan="4">Todavía no hay inventarios finalizados.</td></tr>'}</tbody></table></div></div>`;
}

async function renderConfiguracion() {
  setTitle('Configuración', 'Opciones locales de la aplicación y mantenimiento de datos.');
  $('#content').innerHTML = `<div class="cards"><div class="card"><h2>Instalación</h2><p>Publica estos archivos en GitHub Pages y abre la URL desde Chrome. Aparecerá el botón de instalar si el navegador lo permite.</p></div><div class="card"><h2>Datos locales</h2><p>La información se guarda en IndexedDB del navegador de cada PC.</p><br><button class="danger" onclick="resetData()">Borrar todos los datos locales</button></div></div>`;
}
window.resetData = async function(){ if(confirm('Esto borra inventarios y maestros de este ordenador. ¿Continuar?')){ for(const s of STORES) await clearStore(s); await seedData(); renderCurrent(); } };

async function generatePdf(sessionId) {
  const { jsPDF } = window.jspdf;
  const session = (await getAll('inventorySessions')).find(s=>s.id===sessionId);
  const reviews = (await getAll('reviews')).filter(r=>r.sessionId===sessionId);
  const doc = new jsPDF({ orientation:'landscape' });
  doc.setFontSize(18); doc.text('PLMECO - Inventario de Vehículos de Manutención', 14, 18);
  doc.setFontSize(10); doc.text(`Fecha: ${session.date} | Encargado: ${session.manager} | Operario: ${session.operator}`, 14, 27);
  const total = reviews.length, ok = reviews.filter(r=>r.state==='Operativa').length, inc = reviews.filter(r=>r.state!=='Operativa').length;
  doc.text(`Resumen: Total revisados ${total} · Operativos ${ok} · Incidencias ${inc}`, 14, 36);
  doc.autoTable({ startY: 44, head: [['Equipo','Serie','Sección','Estado','Incidencia','Acción requerida','Observaciones']], body: reviews.map(r=>[r.code,r.serie,r.section,r.state,r.incident,r.action,r.notes]), styles:{fontSize:8}, headStyles:{fillColor:[17,24,39]} });
  doc.save(`PLMECO_Inventario_${session.date}.pdf`);
}
window.generatePdf = generatePdf;

function downloadExcel(rows, filename) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Datos'); XLSX.writeFile(wb, filename);
}
window.exportStoreExcel = async store => downloadExcel(await getAll(store), `PLMECO_${store}.xlsx`);
window.exportReviewsExcel = async () => downloadExcel(await getAll('reviews'), 'PLMECO_Historico.xlsx');
window.generateSessionExcel = async id => downloadExcel((await getAll('reviews')).filter(r=>r.sessionId===id), `PLMECO_Inventario_${id.slice(0,8)}.xlsx`);
window.exportAllExcel = async function(){
  const wb = XLSX.utils.book_new();
  for (const s of ['toyota','aranco','chargers','inventorySessions','reviews']) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(await getAll(s)), s);
  XLSX.writeFile(wb, 'PLMECO_Backup_Completo.xlsx');
};

function navigate(view) { currentView = view; activateMenu(); renderCurrent(); }
function activateMenu() { $$('#menu button').forEach(b => b.classList.toggle('active', b.dataset.view === currentView)); }
async function renderCurrent() {
  await renderAlerts();
  if (currentView === 'inicio') return renderInicio();
  if (currentView === 'inventario') return renderInventario();
  if (currentView === 'toyota') return renderMaster('toyota','Vehículos Toyota','Alta, baja y mantenimiento de vehículos Toyota.', masterConfig.toyota.fields);
  if (currentView === 'aranco') return renderMaster('aranco','Maquinaria Aranco','Control de maquinaria Aranco por serie y sección.', masterConfig.aranco.fields);
  if (currentView === 'cargadores') return renderMaster('chargers','Cargadores','Control de cargadores, zona y máquina asociada.', masterConfig.chargers.fields);
  if (currentView === 'historico') return renderHistorico();
  if (currentView === 'informes') return renderInformes();
  if (currentView === 'configuracion') return renderConfiguracion();
}
window.navigate = navigate;

function showAppError(error) {
  console.error(error);
  const msg = error?.message || String(error);
  const bar = $('#alertsBar');
  if (bar) bar.innerHTML = `<div class="alert">⚠️ Error de aplicación: ${escapeHtml(msg)}. Si acabas de actualizar GitHub Pages, pulsa Ctrl+F5 o borra datos del sitio para limpiar la caché anterior.</div>`;
}

async function safeRender() {
  try { await renderCurrent(); }
  catch (error) { showAppError(error); }
}

function wireEvents() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    $('#installBtn')?.classList.remove('hidden');
  });

  $('#installBtn')?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $('#installBtn')?.classList.add('hidden');
  });

  $('#themeToggle')?.addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme !== 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('plmeco_theme', dark ? 'dark' : 'light');
    $('#themeToggle').textContent = dark ? '☀️ Modo claro' : '🌙 Modo oscuro';
  });

  $('#newInventoryBtn')?.addEventListener('click', () => startInventory());

  // Delegación robusta: aunque el navegador recargue partes del DOM o GitHub Pages sirva caché,
  // cualquier botón con data-view navega correctamente.
  $('#menu')?.addEventListener('click', event => {
    const btn = event.target.closest('button[data-view]');
    if (!btn) return;
    event.preventDefault();
    navigate(btn.dataset.view);
  });
}

async function init() {
  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js?v=20260618-2').catch(console.warn);
    }
    document.documentElement.dataset.theme = localStorage.getItem('plmeco_theme') || 'light';
    $('#themeToggle').textContent = document.documentElement.dataset.theme === 'dark' ? '☀️ Modo claro' : '🌙 Modo oscuro';
    wireEvents();
    db = await openDb();
    await seedData();
    await safeRender();
  } catch (error) {
    showAppError(error);
  }
}

document.addEventListener('DOMContentLoaded', init);
