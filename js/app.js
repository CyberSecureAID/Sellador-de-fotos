/* ═══════════════════════════════════════════════════════════
   1. LECTOR DE EXIF
   Lee, del propio archivo JPG, la fecha y hora en que se tomó la
   foto (DateTimeOriginal) y su orientación. Nada se inventa: si el
   archivo no trae el dato, se avisa en pantalla.
═══════════════════════════════════════════════════════════ */
function readExif(buf){
  const dv = new DataView(buf);
  if (dv.getUint16(0) !== 0xFFD8) return null;          // no es JPEG
  let off = 2;
  while (off + 4 < dv.byteLength) {
    const marker = dv.getUint16(off);
    if ((marker & 0xFF00) !== 0xFF00) break;
    const size = dv.getUint16(off + 2);
    if (marker === 0xFFE1 && dv.getUint32(off + 4) === 0x45786966) { // "Exif"
      return readTiff(dv, off + 10);
    }
    off += 2 + size;
  }
  return null;
}

function readTiff(dv, start){
  const le = dv.getUint16(start) === 0x4949;            // II = little endian
  const u16 = o => dv.getUint16(o, le);
  const u32 = o => dv.getUint32(o, le);
  const i16 = o => dv.getInt16(o, le);
  const i32 = o => dv.getInt32(o, le);
  if (u16(start + 2) !== 0x002A) return null;

  /* `all` guarda TODOS los campos que traiga el archivo, para el
     inspector de metadatos. `date` y `orientation` se mantienen tal
     cual: el resto del programa depende de ellos. */
  const out = { date:null, orientation:1, all:{ Imagen:[], Cámara:[], GPS:[] } };
  const SIZES = {1:1, 2:1, 3:2, 4:4, 5:8, 7:1, 9:4, 10:8};

  const ascii = (o, n) => {
    let s = '';
    for (let i = 0; i < n - 1; i++) {
      const c = dv.getUint8(o + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  };

  /* Convierte un campo EXIF a texto legible, sea del tipo que sea. */
  const readVal = (vo, type, count) => {
    try {
      if (type === 2) return ascii(vo, count);                    // texto
      if (type === 7) return `(${count} bytes)`;                  // binario
      const vals = [];
      for (let k = 0; k < Math.min(count, 8); k++) {
        if (type === 1)       vals.push(dv.getUint8(vo + k));
        else if (type === 3)  vals.push(u16(vo + k * 2));
        else if (type === 4)  vals.push(u32(vo + k * 4));
        else if (type === 9)  vals.push(i32(vo + k * 4));
        else if (type === 5) {                                    // fracción
          const a = u32(vo + k * 8), b = u32(vo + k * 8 + 4);
          vals.push(b ? (a / b) : 0);
        } else if (type === 10) {
          const a = i32(vo + k * 8), b = i32(vo + k * 8 + 4);
          vals.push(b ? (a / b) : 0);
        }
      }
      let t = vals.map(v => typeof v === 'number' ? +v.toFixed(6) : v).join(', ');
      if (count > 8) t += ', …';
      return t;
    } catch (e) { return '—'; }
  };

  const walk = (ifd, tags, collect) => {
    if (ifd + 2 > dv.byteLength) return;
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > dv.byteLength) return;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      let vo = e + 8;
      if ((SIZES[type] || 1) * count > 4) vo = start + u32(e + 8);
      if (tags[tag]) tags[tag](vo, count);

      // Recolección para el inspector (solo lectura)
      if (collect) {
        const name = TAGS[tag];
        if (name && tag !== 0x8769 && tag !== 0x8825) {
          out.all[collect].push([name, readVal(vo, type, count)]);
        }
      }
    }
  };

  let exifIFD = 0, gpsIFD = 0;
  walk(start + u32(start + 4), {
    0x0112: vo => { out.orientation = u16(vo); },         // Orientation
    0x8769: vo => { exifIFD = start + u32(vo); },         // puntero al sub-IFD
    0x8825: vo => { gpsIFD  = start + u32(vo); }          // puntero al IFD de GPS
  }, 'Imagen');

  if (exifIFD) {
    walk(exifIFD, {
      0x9003: (vo, n) => { out.date = ascii(vo, n); }     // DateTimeOriginal
    }, 'Cámara');
  }
  if (gpsIFD) walk(gpsIFD, {}, 'GPS');

  return out;
}

/* Nombres legibles de los campos EXIF más habituales. Lo que no esté
   aquí simplemente no se muestra (evita llenar el panel de ruido). */
const TAGS = {
  0x010F:'Fabricante',        0x0110:'Modelo de cámara',
  0x0112:'Orientación',       0x0131:'Software',
  0x0132:'Fecha de archivo',  0x013B:'Autor',
  0x8298:'Copyright',         0x011A:'Resolución X',
  0x011B:'Resolución Y',      0x0128:'Unidad de resolución',
  0x010E:'Descripción',
  0x9003:'Fecha de captura',  0x9004:'Fecha de digitalización',
  0x829A:'Tiempo de exposición', 0x829D:'Apertura (f)',
  0x8827:'ISO',               0x920A:'Distancia focal',
  0x9209:'Flash',             0xA002:'Ancho (px)',
  0xA003:'Alto (px)',         0xA405:'Focal equiv. 35mm',
  0x9286:'Comentario',        0xA430:'Propietario',
  0xA433:'Marca del objetivo',0xA434:'Modelo del objetivo',
  0x0001:'Ref. latitud',      0x0002:'Latitud',
  0x0003:'Ref. longitud',     0x0004:'Longitud',
  0x0005:'Ref. altitud',      0x0006:'Altitud',
  0x0007:'Hora GPS (UTC)',    0x001D:'Fecha GPS'
};

/* "2025:12:03 18:52:52"  →  Date */
function exifToDate(s){
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s || '');
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return isNaN(d) ? null : d;
}

/* ═══════════════════════════════════════════════════════════
   2. FORMATO DEL SELLO
   Mismo formato de la referencia: "Dec 3, 2025 at 6:52:52 PM"
═══════════════════════════════════════════════════════════ */
const MES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function stampDate(d){
  let h = d.getHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const p = n => String(n).padStart(2, '0');
  return `${MES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} at ${h}:${p(d.getMinutes())}:${p(d.getSeconds())} ${ap}`;
}

/* ═══════════════════════════════════════════════════════════
   3. ESTADO
═══════════════════════════════════════════════════════════ */
const photos = [];      // {file, url, bmp, exifDate, mtime, orientation, lines[]}
let current = -1;

const $ = id => document.getElementById(id);
const listEl = $('list'), stage = $('stage'), statusEl = $('status');

/* Referencias FIJAS. Antes se buscaban con getElementById cada vez,
   pero draw() hace stage.innerHTML='' — eso los desconecta del
   documento y getElementById devuelve null. Guardarlos aquí evita
   que draw() se rompa a mitad y deje la interfaz a medias. */
const zoomBar = $('zoombar');
/* El texto de ayuda se quitó del área de trabajo. hintEl es un objeto
   inerte para que las llamadas existentes no fallen, sin mostrar nada. */
const hintEl = { style:{}, classList:{add(){},remove(){}} };
const _noop = () => {};
const cropUI = $('cropUI'), cropBox = $('cropBox'), cropSizeEl = $('cropSize');

/* ═══════════════════════════════════════════════════════════
   4. CARGA
═══════════════════════════════════════════════════════════ */
$('drop').onclick = () => $('file').click();
$('file').onchange = e => addFiles([...e.target.files]);

['dragenter','dragover'].forEach(ev =>
  $('drop').addEventListener(ev, e => { e.preventDefault(); $('drop').classList.add('over'); })
);
['dragleave','drop'].forEach(ev =>
  $('drop').addEventListener(ev, e => { e.preventDefault(); $('drop').classList.remove('over'); })
);
$('drop').addEventListener('drop', e => {
  addFiles([...e.dataTransfer.files].filter(f => /\.(jpe?g|png|webp)$/i.test(f.name)));
});

async function addFiles(files){
  if (!files.length) return;
  statusEl.textContent = 'Leyendo fechas…';

  for (const f of files) {
    const buf = await f.arrayBuffer();
    const ex = readExif(buf);
    const d  = ex ? exifToDate(ex.date) : null;

    const p = {
      file: f,
      url: URL.createObjectURL(f),
      exifDate: d,
      mtime: new Date(f.lastModified),
      orientation: ex ? (ex.orientation || 1) : 1,
      lines: null,
      usedMtime: false,
      rename: '',         // nombre elegido por ti para la exportación
      crop: null,         // {x,y,w,h} en píxeles — null = imagen entera
      resize: 100,        // % del tamaño de salida (100 = original)
      meta: ex ? ex.all : null,   // metadatos completos (solo lectura)
      bytes: f.size
    };
    p.lines = buildLines(p);
    photos.push(p);
  }

  renderList();
  if (current < 0 && photos.length) select(0);
  statusEl.textContent = '';
  refreshHeader();
  exported = false;
}

/* Líneas por defecto: fecha real + pie fijo */
function buildLines(p){
  const extra = $('extra').value.split('\n').map(s => s.trim()).filter(Boolean);
  const head  = p.exifDate ? stampDate(p.exifDate) : '';
  return [head, ...extra].filter((l, i) => i === 0 ? true : true);
}

/* ═══════════════════════════════════════════════════════════
   5. LISTA
═══════════════════════════════════════════════════════════ */
function renderList(){
  listEl.innerHTML = '';
  photos.forEach((p, i) => {
    const has = !!p.exifDate;
    const el = document.createElement('div');
    el.className = 'item' + (i === current ? ' sel' : '');
    el.innerHTML = `
      <span class="dot ${has ? 'ok' : 'bad'}"></span>
      <img src="${p.url}" alt="">
      <span class="meta">
        <span class="nm">${p.rename || p.file.name}${
          p.crop ? '<span class="cropped-tag">recortada</span>' : ''
        }</span>
        <span class="dt ${has ? '' : 'bad'}">${
          has ? stampDate(p.exifDate) : 'sin fecha EXIF'
        }</span>
      </span>
      <button class="del" title="Eliminar de la lista">&times;</button>`;
    el.onclick = () => select(i);
    el.querySelector('.del').onclick = ev => { ev.stopPropagation(); removePhoto(i); };
    listEl.appendChild(el);
  });
}

/* Elimina una foto de la lista (la borrosa, la repetida...).
   No toca tu archivo original en el disco: solo la saca de aquí. */
function removePhoto(i){
  const p = photos[i];
  if (!p) return;

  URL.revokeObjectURL(p.url);
  if (p.bmp && p.bmp.close) { try { p.bmp.close(); } catch (e) {} }
  photos.splice(i, 1);

  // Reubicar la selección tras el hueco que dejó la foto borrada
  if (photos.length === 0) {
    current = -1;
    cv = null;
  } else if (current === i) {
    current = Math.min(i, photos.length - 1);
  } else if (current > i) {
    current -= 1;
  }

  // La lista y el contador se refrescan SIEMPRE, pase lo que pase
  renderList();
  refreshHeader();

  if (photos.length === 0) {
    stage.innerHTML = '<div class="empty">Sin fotos cargadas.</div>';
    /* hint eliminado */
    stage.appendChild(cropUI);
    cropUI.classList.remove('on');
    cropMode = false;
    zoomBar.style.display = 'none';
    hintEl.style.display  = 'none';
    $('editor').style.display = 'none';
    $('noSel').style.display  = 'block';
    $('resizeCtl').style.display = 'none';
  } else {
    select(current);
  }

  statusEl.textContent = `Eliminada. Quedan ${photos.length}.`;
  setTimeout(() => statusEl.textContent = '', 1800);
}

function refreshHeader(){
  const n = photos.length;
  const bad = photos.filter(p => !p.exifDate).length;
  const crop = photos.filter(p => p.crop).length;
  $('hdrCount').textContent = n
    ? `${n} foto${n > 1 ? 's' : ''}${bad ? ` · ${bad} sin fecha` : ''}`
    : 'Sin fotos';
  $('btnExport').disabled = !n;
  const fx = $('fmt') ? $('fmt').value.toUpperCase().replace('JPEG','JPG') : '';
  const zip = ($('asZip') && $('asZip').checked) || n > 1;
  $('btnExport').textContent = n
    ? `Exportar ${n} · ${fx}${zip ? ' · ZIP' : ''}`
    : 'Exportar todas';

  $('batchBar').style.display = n ? 'block' : 'none';
  if (n) {
    $('miniStat').textContent =
      `${n - bad} con fecha · ${bad} sin fecha${crop ? ` · ${crop} recortada${crop>1?'s':''}` : ''}`;
  }
}

/* ═══════════════════════════════════════════════════════════
   6. SELECCIÓN Y VISTA PREVIA
═══════════════════════════════════════════════════════════ */
async function select(i){
  if (cropMode) exitCrop();
  const keep = $('keepView').checked && cv && zoom > fitZoom * 1.05;
  const prevZoom = zoom;

  current = i;
  const p = photos[i];
  renderList();

  $('noSel').style.display = 'none';
  $('editor').style.display = 'block';
  $('lines').value = p.lines.join('\n');
  $('rename').value = p.rename || '';
  showMeta(p);

  // Control de tamaño: refleja el valor de esta foto y muestra sus px
  $('resizeCtl').style.display = 'flex';
  $('resizePct').value = p.resize != null ? p.resize : 100;
  updateResizeLabel(p);

  if (!p.bmp) p.bmp = await createImageBitmap(p.file);

  if (keep) {
    /* Venías acercado al sello: la foto nueva se abre al MISMO zoom y
       anclada a la esquina superior derecha, donde vive el sello. Así
       revisas 75 fotos seguidas sin reencuadrar ni una vez.
       Se pasa `true` a draw() para que NO vuelva a encajar la foto. */
    draw(true);
    zoom = prevZoom;
    const r = stage.getBoundingClientRect();
    panX = r.width - cv.width * zoom - 12;
    panY = 12;
    applyView();
  } else {
    /* Caso normal: la foto se abre ENTERA y centrada en el marco. */
    draw();
  }
}

/* ═══════════════════════════════════════════════════════════
   INSPECTOR DE METADATOS — SOLO LECTURA
   Muestra lo que el archivo contiene realmente. No escribe nada:
   los metadatos son el registro de origen de la foto, y esta
   herramienta los lee, no los altera.
═══════════════════════════════════════════════════════════ */
function showMeta(p){
  const box = $('metaBody');
  const kb = (p.bytes / 1024).toFixed(0);

  // Datos que siempre podemos mostrar, vengan o no en el EXIF
  const basicos = [
    ['Archivo', p.file.name],
    ['Tamaño', kb + ' KB'],
    ['Tipo', p.file.type || 'image/jpeg'],
    ['Modificado', p.mtime.toLocaleString()]
  ];
  if (p.bmp) basicos.push(['Resolución', `${p.bmp.width} × ${p.bmp.height} px`]);

  let html = '<div class="meta-sec">Archivo</div>';
  html += basicos.map(([k, v]) =>
    `<div class="meta-row"><span class="k">${k}</span><span class="v">${v}</span></div>`
  ).join('');

  const m = p.meta;
  const total = m ? (m.Imagen.length + m['Cámara'].length + m.GPS.length) : 0;

  if (!total) {
    html += `<div class="meta-sec">EXIF</div>
      <div class="meta-none">
        <b>Esta imagen no contiene metadatos EXIF.</b><br>
        Es lo normal en fotos que pasaron por WhatsApp, Telegram o
        capturas de pantalla: esas apps los eliminan al comprimir.
        El original de la cámara sí los conserva.
      </div>`;
  } else {
    for (const sec of ['Imagen', 'Cámara', 'GPS']) {
      const rows = m[sec];
      if (!rows.length) continue;
      html += `<div class="meta-sec">${sec}</div>`;
      html += rows.map(([k, v]) =>
        `<div class="meta-row"><span class="k">${k}</span><span class="v">${
          String(v).slice(0, 60) || '—'
        }</span></div>`
      ).join('');
    }
  }
  box.innerHTML = html;
  $('metaBox').querySelector('summary').textContent =
    total ? `Metadatos del archivo · ${total} campos` : 'Metadatos del archivo · ninguno';
}

/* Muestra el % y el tamaño resultante en píxeles, para que sepas
   exactamente a qué resolución vas a exportar. */
function updateResizeLabel(p){
  const pct = +$('resizePct').value;
  let base = '';
  if (p && p.bmp) {
    const o = p.orientation, swap = o >= 5 && o <= 8;
    let w = swap ? p.bmp.height : p.bmp.width;
    let h = swap ? p.bmp.width  : p.bmp.height;
    if (p.crop) { w = Math.round(p.crop.w); h = Math.round(p.crop.h); }
    base = ` · ${Math.round(w*pct/100)}×${Math.round(h*pct/100)} px`;
  }
  $('resizeVal').textContent = pct + '%' + base;
}

$('resizePct').oninput = () => {
  if (current < 0) return;
  photos[current].resize = +$('resizePct').value;
  updateResizeLabel(photos[current]);
  draw(true);
};

$('lines').oninput = () => {
  if (current < 0) return;
  photos[current].lines = $('lines').value.split('\n');
  draw(true);        // mantiene el zoom mientras editas
};

/* Renombrar: se guarda por foto y la lista lo refleja al momento.
   Solo afecta al archivo EXPORTADO — el original no se toca. */
$('rename').oninput = () => {
  if (current < 0) return;
  photos[current].rename = $('rename').value;
  renderList();
};

/* ─── Acciones por lote ─── */

// Vacía toda la lista (con confirmación)
$('btnClearAll').onclick = () => {
  if (!photos.length) return;
  if (!confirm(`Se vaciará la lista (${photos.length} fotos).\nTus archivos originales no se tocan. ¿Continuar?`)) return;
  photos.forEach(p => URL.revokeObjectURL(p.url));
  photos.length = 0; current = -1; cv = null;
  renderList(); refreshHeader();
  stage.innerHTML = '<div class="empty">Sin fotos cargadas.</div>';
  stage.appendChild(cropUI);
  zoomBar.style.display = 'none'; hintEl.style.display = 'none';
  $('editor').style.display = 'none'; $('noSel').style.display = 'block';
};

$('btnDelete').onclick = () => { if (current >= 0) removePhoto(current); };

/* Aplica el pie fijo a TODAS, conservando la fecha propia de cada una */
$('btnApplyExtra').onclick = () => {
  const extra = $('extra').value.split('\n').map(s => s.trim()).filter(Boolean);
  photos.forEach(p => { p.lines = [p.lines[0] || '', ...extra]; });
  if (current >= 0) $('lines').value = photos[current].lines.join('\n');
  draw();
  statusEl.textContent = `Pie aplicado a ${photos.length} foto(s).`;
  setTimeout(() => statusEl.textContent = '', 2200);
};

['size','pad','quality'].forEach(id => {
  $(id).oninput = () => {
    $('sizeVal').textContent    = ($('size').value / 10).toFixed(1) + '%';
    $('padVal').textContent     = ($('pad').value / 10).toFixed(1) + '%';
    $('qualityVal').textContent = $('quality').value;
    if (id !== 'quality') draw();
  };
});

/* ═══════════════════════════════════════════════════════════
   7. DIBUJO
   Se pinta a resolución COMPLETA (no se reescala la foto), así no
   se pierde detalle. Se respeta la orientación EXIF para que las
   fotos verticales no salgan tumbadas.
═══════════════════════════════════════════════════════════ */
/* Dibuja la imagen ORIENTADA a tamaño completo en un lienzo aparte.
   Es la base tanto para la vista normal como para el modo recorte. */
function orientedCanvas(p){
  const bmp = p.bmp;
  const o = p.orientation;
  const swap = o >= 5 && o <= 8;
  const W = swap ? bmp.height : bmp.width;
  const H = swap ? bmp.width  : bmp.height;

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.save();
  switch (o) {
    case 2: g.translate(W, 0); g.scale(-1, 1); break;
    case 3: g.translate(W, H); g.rotate(Math.PI); break;
    case 4: g.translate(0, H); g.scale(1, -1); break;
    case 5: g.rotate(.5 * Math.PI); g.scale(1, -1); break;
    case 6: g.rotate(.5 * Math.PI); g.translate(0, -H); break;
    case 7: g.rotate(.5 * Math.PI); g.translate(W, -H); g.scale(-1, 1); break;
    case 8: g.rotate(-.5 * Math.PI); g.translate(-W, 0); break;
  }
  g.drawImage(bmp, 0, 0);
  g.restore();
  return c;
}

/* Pinta la foto (recortada si procede) y le estampa el sello.
   Se trabaja a resolución COMPLETA: nada se reescala, así que no se
   pierde detalle. `ignoreCrop` sirve al modo recorte, que necesita
   ver la imagen entera para poder reencuadrarla. */
function renderTo(canvas, p, ignoreCrop){
  const full = orientedCanvas(p);

  const cr = (!ignoreCrop && p.crop)
    ? p.crop
    : { x:0, y:0, w:full.width, h:full.height };

  let W = Math.max(1, Math.round(cr.w));
  let H = Math.max(1, Math.round(cr.h));

  /* REDIMENSIONADO: reduce el tamaño real de salida. Por foto (p.resize)
     o global si no se ha fijado. Se aplica sobre las dimensiones ya
     recortadas, así el sello se recalcula a la nueva escala. */
  const pct = (ignoreCrop ? 100 : (p.resize != null ? p.resize : 100)) / 100;
  W = Math.max(1, Math.round(W * pct));
  H = Math.max(1, Math.round(H * pct));

  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';

  // RECORTE + ESCALADO REAL: se copia la región elegida al tamaño final.
  g.drawImage(full, Math.round(cr.x), Math.round(cr.y),
              Math.round(cr.w), Math.round(cr.h), 0, 0, W, H);

  // El sello se recoloca en la esquina de la imagen YA RECORTADA.
  const lines = (p.lines || []).filter(l => l.trim() !== '');
  if (!lines.length) return;

  const base = Math.min(W, H);
  const fs   = base * ($('size').value / 1000);
  const pad  = base * ($('pad').value  / 1000);
  const lh   = fs * 1.28;

  g.font = `${$('weight').value} ${fs}px ${$('font').value}`;
  g.textAlign = 'right';
  g.textBaseline = 'top';

  const dark = inkColor === '#1A1A1A';
  g.shadowColor = dark ? 'rgba(255,255,255,.65)' : 'rgba(0,0,0,.72)';
  g.shadowBlur = fs * 0.22;
  g.shadowOffsetY = fs * 0.04;
  g.fillStyle = inkColor;

  lines.forEach((t, i) => g.fillText(t, W - pad, pad + i * lh));
  g.shadowColor = 'transparent';
}

/* ═══════════════════════════════════════════════════════════
   7b. ZOOM Y PANEO
   La foto se pinta a resolución completa en el lienzo; lo que se
   mueve es la VISTA (transform CSS), así el zoom no degrada nada
   ni obliga a redibujar. Rueda = zoom hacia el cursor, arrastrar =
   mover, doble clic = ajustar. El botón "Sello" salta directo a la
   esquina del sello al 100%, que es lo que hay que revisar.
═══════════════════════════════════════════════════════════ */
let cv = null;                 // lienzo visible
let zoom = 1, panX = 0, panY = 0, fitZoom = 1;

function applyView(){
  if (!cv) return;
  cv.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  $('zLvl').textContent = Math.round(zoom * 100) + '%';
}

/* Encaja la foto ENTERA dentro del marco y la centra. Es el estado
   con el que se abre siempre una foto nueva: se ve completa, sin zoom
   y sin tener que buscarla. */
function fitToStage(){
  if (!cv) return;
  const r = stage.getBoundingClientRect();
  if (!r.width || !r.height) return;                 // aún sin medidas
  const M = 24;                                      // margen respirable
  fitZoom = Math.min(
    (r.width  - M) / cv.width,
    (r.height - M) / cv.height
  );
  if (!isFinite(fitZoom) || fitZoom <= 0) fitZoom = 1;
  zoom = fitZoom;
  panX = (r.width  - cv.width  * zoom) / 2;
  panY = (r.height - cv.height * zoom) / 2;
  applyView();
}

/* Salta a la esquina del sello, al 100%: el punto que hay que revisar */
function gotoStamp(){
  if (!cv) return;
  const r = stage.getBoundingClientRect();
  zoom = 1;                                    // tamaño real
  panX = r.width - cv.width * zoom - 12;       // esquina superior derecha
  panY = 12;
  applyView();
}

function zoomAt(factor, cx, cy){
  if (!cv) return;
  const next = Math.min(8, Math.max(fitZoom * 0.5, zoom * factor));
  // Mantiene fijo el punto bajo el cursor
  panX = cx - (cx - panX) * (next / zoom);
  panY = cy - (cy - panY) * (next / zoom);
  zoom = next;
  applyView();
}

stage.addEventListener('wheel', e => {
  if (!cv) return;
  e.preventDefault();
  const r = stage.getBoundingClientRect();
  zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
}, { passive:false });

let dragging = false, lastX = 0, lastY = 0;
stage.addEventListener('pointerdown', e => {
  if (!cv) return;

  /* BUG QUE ESTO CORRIGE — importante:
     La barra de zoom y la capa de recorte viven DENTRO del escenario.
     Al pulsar uno de sus botones, el pointerdown burbujeaba hasta aquí
     y el escenario capturaba el puntero (setPointerCapture). A partir
     de ese momento el navegador redirige el `click` al elemento que
     capturó — es decir, al escenario — y el onclick del BOTÓN nunca se
     dispara. Los botones parecían decorativos.
     Solución: si el gesto nace en la interfaz, no se captura nada. */
  if (e.target.closest && e.target.closest('.zoombar, .crop-ui, .crop-actions')) return;

  dragging = true; lastX = e.clientX; lastY = e.clientY;
  stage.classList.add('drag');
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener('pointermove', e => {
  if (!dragging) return;
  panX += e.clientX - lastX;
  panY += e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  applyView();
});
['pointerup','pointercancel'].forEach(ev =>
  stage.addEventListener(ev, () => { dragging = false; stage.classList.remove('drag'); })
);
stage.addEventListener('dblclick', fitToStage);

$('zIn').onclick  = () => { const r = stage.getBoundingClientRect(); zoomAt(1.3, r.width/2, r.height/2); };
$('zOut').onclick = () => { const r = stage.getBoundingClientRect(); zoomAt(1/1.3, r.width/2, r.height/2); };
$('zFit').onclick = fitToStage;
$('zStamp').onclick = gotoStamp;

function draw(keepView){
  if (current < 0) return;
  const p = photos[current];
  if (!p.bmp) return;

  const c = document.createElement('canvas');
  renderTo(c, p, cropMode);      // en modo recorte se ve la foto entera

  stage.innerHTML = '';
  stage.appendChild(c);
  cv = c;

  zoomBar.style.display = 'flex';   // vive en el encabezado, no se mueve
  stage.appendChild(cropUI);        // solo la capa de recorte va dentro      // sin esto, stage.innerHTML='' la destruiría

  /* keepView solo lo pide la edición de texto (para no reencuadrar a
     cada tecla). En cualquier otro caso la foto se abre ENCAJADA. */
  if (keepView && zoom > 0) applyView();
  else fitToStage();

  // El navegador puede no tener aún las medidas del marco: se reintenta
  // en el siguiente fotograma para asegurar el encuadre.
  if (!keepView) requestAnimationFrame(fitToStage);
}

window.addEventListener('resize', () => { if (cv) fitToStage(); });

/* ─── Atajos de teclado (agilizan la revisión por lotes) ───
   ↑/↓  → foto anterior/siguiente     Supr → eliminar la actual
   Ctrl/⌘+S → exportar
   No actúan si estás escribiendo en un campo de texto. */
document.addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if ((e.key === 's') && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (!$('btnExport').disabled) $('btnExport').click();
    return;
  }
  if (typing || current < 0) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
    e.preventDefault();
    if (current < photos.length - 1) select(current + 1);
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
    e.preventDefault();
    if (current > 0) select(current - 1);
  } else if (e.key === 'Delete') {
    removePhoto(current);
  }
});

/* Aviso al cerrar si hay fotos cargadas sin exportar (evita perder
   el trabajo de una sesión larga por un cierre accidental). */
let exported = false;
window.addEventListener('beforeunload', e => {
  if (photos.length && !exported) { e.preventDefault(); e.returnValue = ''; }
});

/* ═══════════════════════════════════════════════════════════
   7c. RECORTE (estilo Photoshop)
   ───────────────────────────────────────────────────────────
   El recuadro vive en COORDENADAS DE IMAGEN (píxeles reales), no de
   pantalla: así el recorte es exacto sea cual sea el zoom. Ocho
   tiradores, arrastre para mover, rejilla de tercios y exterior
   oscurecido. Nunca se sale de los bordes: solo recorta, no expande.
   El recorte es REAL — los píxeles se descartan en la exportación.
═══════════════════════════════════════════════════════════ */
let cropMode = false;
let cr = null;            // {x,y,w,h} en píxeles de la imagen
let imgW = 0, imgH = 0;   // tamaño de la imagen orientada completa

const MINC = 24;          // lado mínimo del recorte, en píxeles

function enterCrop(){
  const p = photos[current];
  if (!p || !p.bmp) return;

  cropMode = true;
  $('cropActions').style.display = 'flex';   // botones en la barra, no sobre la foto
  const full = orientedCanvas(p);
  imgW = full.width; imgH = full.height;

  // Parte del recorte que ya tuviera, o de la imagen entera
  cr = p.crop ? { ...p.crop } : { x:0, y:0, w:imgW, h:imgH };

  draw();                       // redibuja SIN recorte (imagen entera)
  cropUI.classList.add('on');
  $('zCrop').style.color = 'var(--amber)';
  paintCrop();
}

function exitCrop(){
  cropMode = false;
  $('cropActions').style.display = 'none';
  cropUI.classList.remove('on');
  $('zCrop').style.color = '';
  draw();
}

/* Traduce el rectángulo (píxeles de imagen) a la pantalla, usando el
   mismo zoom y paneo del lienzo: el recuadro sigue a la imagen. */
function paintCrop(){
  if (!cr || !cv) return;
  cropBox.style.left   = (panX + cr.x * zoom) + 'px';
  cropBox.style.top    = (panY + cr.y * zoom) + 'px';
  cropBox.style.width  = (cr.w * zoom) + 'px';
  cropBox.style.height = (cr.h * zoom) + 'px';

  cropSizeEl.style.left = (panX + cr.x * zoom) + 'px';
  cropSizeEl.style.top  = (panY + cr.y * zoom - 20) + 'px';
  cropSizeEl.textContent = `${Math.round(cr.w)} × ${Math.round(cr.h)} px`;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* Arrastre: mover el recuadro entero o estirar desde un tirador */
let cDrag = null;
cropUI.addEventListener('pointerdown', e => {
  if (!cropMode || !cr) return;
  const h = e.target.dataset ? e.target.dataset.h : null;
  const onBox = e.target === cropBox || h;
  if (!onBox) return;

  e.preventDefault(); e.stopPropagation();
  cDrag = { h: h || 'move', x: e.clientX, y: e.clientY, s: { ...cr } };
  cropUI.setPointerCapture(e.pointerId);
});

cropUI.addEventListener('pointermove', e => {
  if (!cDrag) return;
  const dx = (e.clientX - cDrag.x) / zoom;   // pantalla → píxeles de imagen
  const dy = (e.clientY - cDrag.y) / zoom;
  const s = cDrag.s, h = cDrag.h;

  if (h === 'move') {
    cr.x = clamp(s.x + dx, 0, imgW - s.w);
    cr.y = clamp(s.y + dy, 0, imgH - s.h);
  } else {
    let x1 = s.x, y1 = s.y, x2 = s.x + s.w, y2 = s.y + s.h;
    if (h.includes('w')) x1 = clamp(s.x + dx, 0, x2 - MINC);
    if (h.includes('e')) x2 = clamp(s.x + s.w + dx, x1 + MINC, imgW);
    if (h.includes('n')) y1 = clamp(s.y + dy, 0, y2 - MINC);
    if (h.includes('s')) y2 = clamp(s.y + s.h + dy, y1 + MINC, imgH);
    cr = { x:x1, y:y1, w:x2 - x1, h:y2 - y1 };
  }
  paintCrop();
});

['pointerup','pointercancel'].forEach(ev =>
  cropUI.addEventListener(ev, () => { cDrag = null; })
);

$('zCrop').onclick   = () => cropMode ? exitCrop() : enterCrop();
$('cropCancel').onclick = exitCrop;

$('cropReset').onclick = () => {
  cr = { x:0, y:0, w:imgW, h:imgH };
  paintCrop();
};

$('cropApply').onclick = () => {
  const p = photos[current];
  if (!p || !cr) return;

  // Si abarca la imagen entera, se guarda como "sin recorte"
  const entera = cr.x < 1 && cr.y < 1 && cr.w > imgW - 2 && cr.h > imgH - 2;
  p.crop = entera ? null : { ...cr };

  exitCrop();
  renderList();
  statusEl.textContent = p.crop
    ? `Recortada a ${Math.round(cr.w)} × ${Math.round(cr.h)} px.`
    : 'Recorte quitado.';
  setTimeout(() => statusEl.textContent = '', 2200);
};

/* El recuadro sigue al zoom y al paneo */
const _applyView = applyView;
applyView = function(){
  _applyView();
  if (cropMode) paintCrop();
};

/* ═══════════════════════════════════════════════════════════
   8. EXPORTACIÓN — ZIP sin librerías (método "store")
   Los JPG ya vienen comprimidos: no comprimir de nuevo es más
   rápido y no cuesta tamaño.
═══════════════════════════════════════════════════════════ */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(u8){
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function makeZip(entries){
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;

  const dosTime = () => {
    const d = new Date();
    const t = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dt = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return [t, dt];
  };
  const [tm, dt] = dosTime();

  for (const { name, data } of entries) {
    const nb = enc.encode(name);
    const crc = crc32(data);

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034B50, true);
    lh.setUint16(4, 20, true); lh.setUint16(6, 0, true);
    lh.setUint16(8, 0, true);                       // store
    lh.setUint16(10, tm, true); lh.setUint16(12, dt, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, nb.length, true); lh.setUint16(28, 0, true);

    chunks.push(new Uint8Array(lh.buffer), nb, data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014B50, true);
    ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(8, 0, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, tm, true); ch.setUint16(14, dt, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, nb.length, true);
    ch.setUint16(30, 0, true); ch.setUint16(32, 0, true);
    ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
    ch.setUint32(38, 0, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nb);

    offset += 30 + nb.length + data.length;
  }

  const cSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054B50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type:'application/zip' });
}

/* ═══════════════════════════════════════════════════════════
   EXPORTACIÓN MULTIFORMATO
   ───────────────────────────────────────────────────────────
   Cada formato tiene su tipo MIME, extensión y si admite calidad o
   transparencia. Solo se ofrecen formatos que el NAVEGADOR genera de
   verdad (PNG, JPG, WebP, AVIF, PDF). No hay SVG/AI/EPS: convertir un
   raster a vector real exige un programa de escritorio, y prometerlo
   sería engañoso.
═══════════════════════════════════════════════════════════ */
const FORMATS = {
  jpeg: { ext:'jpg',  mime:'image/jpeg', quality:true,  alpha:false },
  png:  { ext:'png',  mime:'image/png',  quality:false, alpha:true  },
  webp: { ext:'webp', mime:'image/webp', quality:true,  alpha:true  },
  avif: { ext:'avif', mime:'image/avif', quality:true,  alpha:true  },
  pdf:  { ext:'pdf',  mime:'application/pdf', quality:true, alpha:false }
};

async function canEncode(mime){
  try {
    const c = document.createElement('canvas'); c.width = c.height = 2;
    const b = await new Promise(r => c.toBlob(r, mime, 0.8));
    return !!b && b.type === mime;
  } catch (e) { return false; }
}

/* PDF mínimo válido con una imagen JPEG incrustada a página completa.
   Se escribe el PDF "a mano" (5 objetos): así no hace falta librería. */
function makePdf(jpegBytes, w, h){
  const enc = s => new TextEncoder().encode(s);
  const parts = [];
  const push = u8 => parts.push(u8);
  let len = 0; const off = [];
  const put = (str) => { const u = enc(str); off.push(len); len += u.length; push(u); };
  const putRaw = (u8) => { len += u8.length; push(u8); };

  // El tamaño de página sigue la proporción de la imagen (72 dpi → puntos)
  const pw = 595.28, ph = pw * h / w;   // ancho A4, alto proporcional

  const xref = [];
  const track = () => xref.push(len);

  put('%PDF-1.4\n');
  track(); put('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  track(); put('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  track(); put(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`);
  track(); put(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`);
  putRaw(jpegBytes); put('\nendstream\nendobj\n');
  const content = `q\n${pw.toFixed(2)} 0 0 ${ph.toFixed(2)} 0 0 cm\n/Im0 Do\nQ\n`;
  track(); put(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);

  const xrefPos = len;
  let x = 'xref\n0 6\n0000000000 65535 f \n';
  for (const o of xref) x += String(o).padStart(10,'0') + ' 00000 n \n';
  put(x);
  put(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`);

  const total = parts.reduce((s,u)=>s+u.length,0);
  const out = new Uint8Array(total); let p = 0;
  for (const u of parts){ out.set(u,p); p += u.length; }
  return out;
}

$('btnExport').onclick = async () => {
  const btn = $('btnExport');
  const fmtKey = $('fmt').value;
  const F = FORMATS[fmtKey];

  if (!(await canEncode((fmtKey === 'pdf') ? 'image/jpeg' : F.mime))) {
    alert(`Tu navegador no puede exportar en ${F.ext.toUpperCase()}.\n` +
          `Prueba con Chrome o Edge actualizados, o elige otro formato (JPG y PNG funcionan en todos).`);
    return;
  }

  btn.disabled = true;
  $('bar').classList.add('on');

  const q = $('quality').value / 100;
  const entries = [];
  const used = new Set();

  try {

  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    statusEl.textContent = `Exportando ${i + 1} de ${photos.length}… (${F.ext.toUpperCase()})`;
    $('barFill').style.width = ((i / photos.length) * 100) + '%';

    if (!p.bmp) p.bmp = await createImageBitmap(p.file);
    const c = document.createElement('canvas');
    renderTo(c, p);

    /* JPG y PDF no tienen transparencia: se rellena el fondo de blanco
       para que las zonas transparentes no salgan negras. */
    if (!F.alpha) {
      const flat = document.createElement('canvas');
      flat.width = c.width; flat.height = c.height;
      const fg = flat.getContext('2d');
      fg.fillStyle = '#FFFFFF';
      fg.fillRect(0, 0, flat.width, flat.height);
      fg.drawImage(c, 0, 0);
      c.width = flat.width; c.height = flat.height;
      c.getContext('2d').drawImage(flat, 0, 0);
    }

    let data, ext = F.ext;
    if (fmtKey === 'pdf') {
      const jpg = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
      data = makePdf(new Uint8Array(await jpg.arrayBuffer()), c.width, c.height);
    } else {
      const blob = await new Promise(r =>
        c.toBlob(r, F.mime, F.quality ? q : undefined));
      data = new Uint8Array(await blob.arrayBuffer());
    }

    // Nombre de salida (tuyo o el original), único, con la extensión del formato
    const custom = (p.rename || '').trim();
    const stem = custom
      ? custom.replace(/[\\/:*?"<>|]/g, '-').slice(0, 90)
      : p.file.name.replace(/\.(jpe?g|png|webp|avif)$/i, '') + '-sellada';

    let name = `${stem}.${ext}`;
    let n = 2;
    while (used.has(name)) name = `${stem} (${n++}).${ext}`;
    used.add(name);

    entries.push({ name, data });
    await new Promise(r => setTimeout(r));
  }

  $('barFill').style.width = '100%';

  const base = ($('zipName').value.trim() || 'export')
               .replace(/[\\/:*?"<>|]/g, '-').replace(/\.(zip|jpg|png|webp|avif|pdf)$/i, '');

  const a = document.createElement('a');

  /* La casilla "Comprimir en .zip" manda: si está marcada, TODO va en un
     .zip — aunque sea una sola imagen. Si está desmarcada y hay una sola
     foto, se descarga suelta; si hay varias, se agrupan igualmente (el
     navegador no puede lanzar 30 descargas sueltas de forma fiable). */
  const wantZip = $('asZip').checked || entries.length > 1;

  if (wantZip) {
    statusEl.textContent = 'Comprimiendo…';
    const zip = makeZip(entries);
    a.href = URL.createObjectURL(zip);
    a.download = `${base}.zip`;
  } else {
    statusEl.textContent = 'Descargando…';
    const blob = new Blob([entries[0].data], { type: F.mime });
    a.href = URL.createObjectURL(blob);
    a.download = `${base}.${F.ext}`;
  }
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);

  exported = true;
  statusEl.textContent = wantZip
    ? `Listo: ${entries.length} archivo(s) en ${F.ext.toUpperCase()}, dentro de ${base}.zip`
    : `Listo: ${base}.${F.ext}`;

  } catch (err) {
    /* Cualquier fallo (vectorización, memoria, formato…) se muestra en vez
       de romper la promesa en silencio, que era lo que hacía parecer que el
       botón no hacía nada. */
    console.error(err);
    statusEl.textContent = 'Error al exportar: ' + (err.message || err);
    alert('No se pudo completar la exportación.\n\n' + (err.message || err));
  } finally {
    $('bar').classList.remove('on');
    $('barFill').style.width = '0';
    btn.disabled = false;      // el botón SIEMPRE vuelve a funcionar
  }
};

/* ═══ Colores del sello (blanco por defecto) ═══ */
const COLORS = [
  ['#FFFFFF','Blanco'], ['#F2E8CF','Crema'],  ['#FFD84D','Amarillo'],
  ['#FF5C5C','Rojo'],   ['#5CE07A','Verde'],  ['#4FD8FF','Cian'],
  ['#FF7FC4','Rosa'],   ['#1A1A1A','Negro']
];
let inkColor = '#FFFFFF';

const swBox = $('swatches');
COLORS.forEach(([hex, name]) => {
  const b = document.createElement('button');
  b.className = 'sw' + (hex === inkColor ? ' on' : '');
  b.style.background = hex;
  b.title = name;
  b.onclick = () => {
    inkColor = hex;
    [...swBox.children].forEach(c => c.classList.remove('on'));
    b.classList.add('on');
    draw(true);
  };
  swBox.appendChild(b);
});

['font','weight'].forEach(id => $(id).onchange = () => draw(true));
$('fmt').onchange   = () => refreshHeader();
$('asZip').onchange = () => refreshHeader();

/* Pie por defecto (edítalo a tu gusto) */
$('extra').value = '';
