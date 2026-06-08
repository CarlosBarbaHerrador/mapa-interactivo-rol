(function () {
    const data = MAP_DATA;

    // ─── SUPABASE ───
    const sb = window.sb;
    const _sbId = 'u' + Math.random().toString(36).slice(2, 7);
    const _sbColor = ['#e94560','#0f3460','#16c79a','#f5a623','#7c3aed','#ec4899'][
        Math.floor(Math.random() * 6)
    ];
    let sbReady = false;

    async function sbUpsert(table, row, conflict) {
        if (!sb) return;
        const { error } = await sb.from(table).upsert(row, { onConflict: conflict, ignoreDuplicates: false });
        if (error) throw error;
    }

    async function sbDelete(table, col, val) {
        if (!sb) return;
        const { error } = await sb.from(table).delete().eq(col, val);
        if (error) console.warn('sb delete error:', table, error);
    }

    async function sbSavePaint() {
        if (!sb) return;
        const strokes = data.paint.map(s => {
            if (s.tool === 'fill') return { tool: 'fill', color: s.color, region: s.region };
            return { tool: s.tool, color: s.color, size: s.size || 8, points: s.points || [] };
        });
        const { error } = await sb.from('paint').upsert(
            { id: 0, tool: '_state', points: strokes },
            { onConflict: 'id', ignoreDuplicates: false }
        );
        if (error) console.warn('sbSavePaint error:', error);
    }

    function hexAlpha(hex, a) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    }

    // ─── MAPA ───
    const map = L.map('map', {
        crs: L.CRS.Simple,
        minZoom: data.minZoom,
        maxZoom: data.maxZoom,
        zoomControl: true,
        attributionControl: false
    });

    const imageBounds = data.bounds;
    L.imageOverlay(data.mapImage, imageBounds).addTo(map);
    map.setView(data.center, data.zoom);

    // ─── REGIONES (SVG overlay) ───
    let svgOverlayRef = null;

    const BOUNDARY_STROKE = 'none';
    const BOUNDARY_WIDTH = '0';

    function createRegionSvg(svgNS, region) {
        const outerG = document.createElementNS(svgNS, 'g');
        outerG.setAttribute('data-region', region.name);
        const rc = region.color || '#e94560';
        const allPaths = [{ d: region.path, transform: region.transform, type: 'main' }];
        if (region.extraPaths) allPaths.push(...region.extraPaths);

        // ── Land group (masked) ──
        const landG = document.createElementNS(svgNS, 'g');
        const landPaths = allPaths.filter(p => p.type !== 'lake');
        const lakes = allPaths.filter(p => p.type === 'lake');

        if (lakes.length > 0) {
            const maskId = 'mask-' + region.name.replace(/\s+/g, '_');
            const mask = document.createElementNS(svgNS, 'mask');
            mask.setAttribute('id', maskId);
            const rect = document.createElementNS(svgNS, 'rect');
            rect.setAttribute('width', '100%');
            rect.setAttribute('height', '100%');
            rect.setAttribute('fill', 'white');
            mask.appendChild(rect);
            lakes.forEach(lp => {
                const lpEl = document.createElementNS(svgNS, 'path');
                lpEl.setAttribute('d', lp.d);
                if (lp.transform) lpEl.setAttribute('transform', lp.transform);
                lpEl.setAttribute('fill', 'black');
                mask.appendChild(lpEl);
            });
            landG.setAttribute('mask', 'url(#' + maskId + ')');
            (outerG._defs || (outerG._defs = [])).push(mask);
        }

        landPaths.forEach(ap => {
            const path = document.createElementNS(svgNS, 'path');
            path.setAttribute('d', ap.d);
            if (ap.transform) path.setAttribute('transform', ap.transform);
            path.setAttribute('data-region', region.name);
            path.setAttribute('fill', hexAlpha(rc, 0.1));
            path.setAttribute('stroke', BOUNDARY_STROKE);
            path.setAttribute('stroke-width', BOUNDARY_WIDTH);
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('stroke-linejoin', 'round');
            path.style.pointerEvents = 'auto';
            path.style.cursor = 'pointer';
            path.style.transition = 'all 0.2s ease';
            landG.appendChild(path);
        });
        outerG.appendChild(landG);

        // ── Lake‑edge group (unmasked, visible only on hover) ──
        const lakeEdgeG = document.createElementNS(svgNS, 'g');
        lakes.forEach(lp => {
            const path = document.createElementNS(svgNS, 'path');
            path.setAttribute('d', lp.d);
            if (lp.transform) path.setAttribute('transform', lp.transform);
            path.setAttribute('data-lake-edge', '1');
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', 'transparent');
            path.setAttribute('stroke-width', '2');
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('stroke-linejoin', 'round');
            path.style.pointerEvents = 'none';
            lakeEdgeG.appendChild(path);
        });
        outerG.appendChild(lakeEdgeG);

        // ── Highlight ──
        let _gHighlighted = false;
        const highlightGroup = (on) => {
            landG.querySelectorAll('path').forEach(p => {
                if (on) {
                    p.setAttribute('stroke', rc);
                    p.setAttribute('stroke-width', '4');
                    p.setAttribute('fill', hexAlpha(rc, 0.38));
                    p.setAttribute('filter', 'url(#region-glow)');
                } else {
                    p.setAttribute('fill', hexAlpha(rc, 0.1));
                    p.setAttribute('stroke', BOUNDARY_STROKE);
                    p.setAttribute('stroke-width', BOUNDARY_WIDTH);
                    p.removeAttribute('filter');
                }
            });
            lakeEdgeG.querySelectorAll('path').forEach(p => {
                if (on) {
                    p.setAttribute('stroke', rc);
                    p.setAttribute('stroke-width', '2');
                } else {
                    p.setAttribute('stroke', 'transparent');
                    p.setAttribute('stroke-width', '2');
                }
            });
        };

        outerG.addEventListener('mouseover', () => {
            if (!hoverEnabled || _gHighlighted) return;
            _gHighlighted = true;
            highlightGroup(true);
        });
        outerG.addEventListener('mouseout', (e) => {
            if (!_gHighlighted) return;
            if (e.relatedTarget && outerG.contains(e.relatedTarget)) return;
            _gHighlighted = false;
            if (activeRegion !== region.name) highlightGroup(false);
        });
        outerG.addEventListener('click', (e) => {
            if (!clickEnabled) return;
            e.stopPropagation();
            openRegionPanel(region);
        });

        return outerG;
    }

    function initRegions() {
        if (!data.regions || data.regions.length === 0) return;

        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('viewBox', '0 0 4096 2389');
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        svg.style.pointerEvents = 'none';

        const defs = document.createElementNS(svgNS, 'defs');
        defs.innerHTML = `
            <filter id="region-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur in="SourceAlpha" stdDeviation="4" result="blur"/>
                <feFlood flood-color="#ffffff" flood-opacity="0.8" result="color"/>
                <feComposite in="color" in2="blur" operator="in" result="shadow"/>
                <feMerge>
                    <feMergeNode in="shadow"/>
                    <feMergeNode in="SourceGraphic"/>
                </feMerge>
            </filter>
        `;
        svg.appendChild(defs);

        data.regions.forEach(region => {
            const g = createRegionSvg(svgNS, region);
            if (g._defs) g._defs.forEach(d => defs.appendChild(d));
            svg.appendChild(g);
        });

        const overlay = L.svgOverlay(svg, data.bounds, { interactive: false });
        overlay.addTo(map);
        svgOverlayRef = overlay;
    }

    initRegions();

    // ─── SUPABASE DATA LOAD ───
    async function loadFromSupabase() {
        if (!sb) return;
        try {
            const [regRes, poiRes, ptRes] = await Promise.all([
                sb.from('regions').select('*'),
                sb.from('pois').select('*').order('id'),
                sb.from('paint').select('*').order('id')
            ]);

            if (regRes.data && regRes.data.length > 0) {
                data.regions = regRes.data.map(r => ({
                    name: r.name, path: r.path, transform: r.transform,
                    color: r.color || '#e94560', description: r.description || '',
                    extraPaths: r.extrapaths && r.extrapaths.length > 0 ? r.extrapaths : undefined
                }));
                rebuildSvgOverlay();
            }

            if (poiRes.data && poiRes.data.length > 0) {
                data.pois = poiRes.data.map(r => ({
                    id: String(r.id), name: r.name, type: r.category,
                    color: r.color || '#e94560', region: r.region || '',
                    coords: r.coords, description: r.description || '',
                    links: r.links || []
                }));
                // Reload POI markers
                Object.keys(markers).forEach(k => layerGroup.removeLayer(markers[k].marker));
                Object.keys(markers).forEach(k => delete markers[k]);
                data.pois.forEach(poi => addMarkerFromData(poi));
                updateCounter();
            }

            if (ptRes.data && ptRes.data.length > 0) {
                // paint stored as a single row with points containing the full array
                const stateRow = ptRes.data.find(r => r.tool === '_state');
                if (stateRow && stateRow.points && Array.isArray(stateRow.points)) {
                    data.paint = stateRow.points;
                }
                if (data.paint.length > 0 && !offscreenCtx) initPaintSystem();
                if (offscreenCtx) {
                    offscreenCtx.globalCompositeOperation = 'source-over';
                    offscreenCtx.clearRect(0, 0, 4096, 2389);
                    if (data.paint.length > 0) replayPaintStrokes(data.paint);
                    updatePaintOverlay();
                }
            }
        } catch (e) { console.warn('Supabase load error:', e); }
        sbReady = true;
    }

    // ─── SUPABASE REALTIME ───
    function setupRealtime() {
        if (!sb) return;

        sb.channel('regions-sync')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'regions' }, () => {
                if (!sbReady) return;
                loadFromSupabase();
            })
            .subscribe();

        sb.channel('pois-sync')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'pois' }, () => {
                if (!sbReady) return;
                loadFromSupabase();
            })
            .subscribe();

        sb.channel('paint-sync')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'paint' }, () => {
                if (!sbReady) return;
                loadFromSupabase();
            })
            .subscribe();

        // ── Cursors ──
        const cursorLayer = L.layerGroup().addTo(map);
        const otherCursors = {};

        sb.channel('cursors-sync')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'cursors' }, payload => {
                const row = payload.new;
                if (!row || row.id === _sbId) return;
                if (payload.eventType === 'DELETE') {
                    if (otherCursors[row.id]) {
                        cursorLayer.removeLayer(otherCursors[row.id]);
                        delete otherCursors[row.id];
                    }
                    return;
                }
                const lat = row.y, lng = row.x; // x=lng, y=lat in image coords → swap
                if (!otherCursors[row.id]) {
                    const el = L.circleMarker([lat, lng], {
                        radius: 6, color: row.color || '#e94560', fillOpacity: 0.8, weight: 2,
                        opacity: 1
                    });
                    el.bindTooltip(row.user_name || '?', { permanent: true, direction: 'top', offset: [0, -10] });
                    otherCursors[row.id] = el;
                    cursorLayer.addLayer(el);
                } else {
                    otherCursors[row.id].setLatLng([lat, lng]);
                }
            })
            .subscribe();

        // Send own cursor
        let cursorInterval;
        function startCursorTracking() {
            let lastSent = 0;
            const send = (lat, lng) => {
                const now = Date.now();
                if (now - lastSent < 80) return;
                lastSent = now;
                sbUpsert('cursors', {
                    id: _sbId, x: lng, y: lat, user_name: _sbId, color: _sbColor, updated_at: new Date().toISOString()
                }, 'id');
            };
            map.on('mousemove', e => send(e.latlng.lat, e.latlng.lng));
            cursorInterval = setInterval(() => {
                sb.from('cursors').delete().lt('updated_at', new Date(Date.now() - 5000).toISOString()).then();
            }, 3000);
        }

        function stopCursorTracking() {
            map.off('mousemove');
            clearInterval(cursorInterval);
            sb.from('cursors').delete().eq('id', _sbId).then();
            Object.values(otherCursors).forEach(m => cursorLayer.removeLayer(m));
            Object.keys(otherCursors).forEach(k => delete otherCursors[k]);
        }

        // Expose cursor control to toggleEditMode
        window.__cursorStart = startCursorTracking;
        window.__cursorStop = stopCursorTracking;
    }

    // ─── EDITOR DE FRONTERAS (crear y modificar regiones) ───
    const IMG_H = data.bounds[1][0];
    let regionEditMode = false;
    let regionVerts = [];
    let editingRegionName = '';
    let regionPolygon = null;
    let vertexMarkers = [];
    let _rbLastClick = 0;

    // Sub‑path support (islands, lakes)
    let _subPaths = [];        // [{ verts: [], type: 'island'|'lake' }]
    let _activeSubIdx = -1;    // -1 = main, 0+ = sub‑path
    let _subPolygons = [];     // Leaflet polygons for committed sub‑paths
    let _subPathHighlight = null;

    function getActiveVerts() {
        return _activeSubIdx < 0 ? regionVerts : _subPaths[_activeSubIdx].verts;
    }
    function setActiveVerts(v) {
        if (_activeSubIdx < 0) regionVerts = v;
        else _subPaths[_activeSubIdx].verts = v;
    }
    function getActivePathInfo() {
        return _activeSubIdx < 0 ? { type: 'main', label: 'Frontera principal' }
            : { type: _subPaths[_activeSubIdx].type, label: (_subPaths[_activeSubIdx].type === 'island' ? 'Isla' : 'Lago') + ' ' + (_activeSubIdx + 1) };
    }

    function highlightSubPath(idx, show) {
        if (_subPathHighlight) {
            try { map.removeLayer(_subPathHighlight); } catch (e) {}
            _subPathHighlight = null;
        }
        if (!show) return;
        if (idx < 0 || idx >= _subPaths.length) return;
        const sp = _subPaths[idx];
        if (sp.verts.length < 3) return;
        const coords = sp.verts.map(p => [p.y, p.x]);
        coords.push(coords[0]);
        const color = sp.type === 'lake' ? '#4488ff' : '#e94560';
        _subPathHighlight = L.polygon(coords, {
            color: '#fff',
            weight: 4,
            fillColor: color,
            fillOpacity: 0.5,
            interactive: false
        }).addTo(map);
    }

    function rebuildSubPolygons() {
        _subPolygons.forEach(p => map.removeLayer(p));
        _subPolygons = [];
        _subPaths.forEach((sp, idx) => {
            if (idx === _activeSubIdx || sp.verts.length < 3) return;
            const coords = sp.verts.map(p => [p.y, p.x]);
            coords.push(coords[0]);
            const color = sp.type === 'lake' ? '#4488ff' : '#e94560';
            const poly = L.polygon(coords, {
                color: color, weight: 2, fillColor: color, fillOpacity: sp.type === 'lake' ? 0 : 0.2,
                interactive: false, dashArray: sp.type === 'lake' ? '' : ''
            }).addTo(map);
            _subPolygons.push(poly);
        });
    }

    function updatePathNav() {
        highlightSubPath(-1, false);
        const nav = document.getElementById('rb-path-nav');
        const subpathSelect = document.getElementById('rb-subpath-select');
        nav.innerHTML = '';
        const pills = [];
        pills.push({ label: 'Main', idx: -1, active: _activeSubIdx === -1 });
        _subPaths.forEach((sp, idx) => {
            const icon = sp.type === 'lake' ? '🏞️' : '🏝️';
            const label = icon + ' ' + (idx + 1);
            pills.push({ label, idx, active: idx === _activeSubIdx });
        });
        if (pills.length <= 1) {
            nav.style.display = 'none';
            subpathSelect.style.display = 'none';
            return;
        }
        nav.style.display = 'inline-block';
        pills.forEach(p => {
            const btn = document.createElement('button');
            btn.className = 'path-pill' + (p.active ? ' path-pill-active' : '');
            btn.textContent = p.label;
            btn.addEventListener('mouseenter', () => { if (!p.active) highlightSubPath(p.idx, true); });
            btn.addEventListener('mouseleave', () => highlightSubPath(p.idx, false));
            btn.addEventListener('click', () => {
                if (p.idx === _activeSubIdx) return;
                if (_selectMode) toggleSelectMode();
                _activeSubIdx = p.idx;
                _regionUndoStack = [];
                rebuildVertexMarkers();
                rebuildRegionPreview();
                updateRegionUI();
                updatePathNav();
            });
            nav.appendChild(btn);
        });
        subpathSelect.innerHTML = '';
        _subPaths.forEach((sp, idx) => {
            const opt = document.createElement('option');
            opt.value = idx;
            const icon = sp.type === 'lake' ? '🏞️' : '🏝️';
            const label = (sp.type === 'lake' ? 'Lago ' : 'Isla ') + (idx + 1);
            opt.textContent = icon + ' ' + label + ' (' + sp.verts.length + ' v)';
            if (idx === _activeSubIdx) opt.selected = true;
            subpathSelect.appendChild(opt);
        });
        subpathSelect.style.display = 'inline-block';
    }

    function getImageCoords(containerPoint) {
        const ll = map.containerPointToLatLng(containerPoint);
        return { x: ll.lng, y: ll.lat };
    }

    function parseRegionPath(region) {
        const m = region.transform.match(/translate\(([\d.-]+),\s*([\d.-]+)\)/);
        const tx = m ? parseFloat(m[1]) : 0;
        const ty = m ? parseFloat(m[2]) : 0;
        console.log(`[parseRegionPath] "${region.name}" transform=(${tx}, ${ty})`);
        const pts = [];
        const str = region.path;
        let i = 0, curX = 0, curY = 0;
        const len = str.length;

        function readNum() {
            while (i < len && (str[i] === ' ' || str[i] === ',' || str[i] === '\t' || str[i] === '\n')) i++;
            if (i >= len) return NaN;
            let start = i, hasDot = false;
            if (str[i] === '-' || str[i] === '+') i++;
            while (i < len) {
                const c = str[i];
                if (c >= '0' && c <= '9') { i++; continue; }
                if (c === '.' && !hasDot) { hasDot = true; i++; continue; }
                break;
            }
            if (start === i) return NaN;
            return parseFloat(str.slice(start, i));
        }

        function addPt() {
            pts.push({ x: curX + tx, y: IMG_H - (curY + ty) });
        }

        while (i < len) {
            let cmd = str[i];
            if (cmd >= 'A' && cmd <= 'Z') { i++; }
            else if (cmd >= 'a' && cmd <= 'z') { i++; }
            else break;

            const isRel = cmd >= 'a' && cmd <= 'z';
            if (isRel) cmd = cmd.toUpperCase();

            if (cmd === 'Z') { break; }

            if (cmd === 'M' || cmd === 'L') {
                while (true) {
                    const x = readNum(); if (isNaN(x)) break;
                    const y = readNum(); if (isNaN(y)) break;
                    curX = isRel ? curX + x : x;
                    curY = isRel ? curY + y : y;
                    addPt();
                    if (cmd === 'M') cmd = 'L';
                }
            } else if (cmd === 'H') {
                while (true) {
                    const x = readNum(); if (isNaN(x)) break;
                    curX = isRel ? curX + x : x;
                    addPt();
                }
            } else if (cmd === 'V') {
                while (true) {
                    const y = readNum(); if (isNaN(y)) break;
                    curY = isRel ? curY + y : y;
                    addPt();
                }
            } else if (cmd === 'C') {
                while (true) {
                    const x1 = readNum(); if (isNaN(x1)) break;
                    const y1 = readNum(); if (isNaN(y1)) break;
                    const x2 = readNum(); if (isNaN(x2)) break;
                    const y2 = readNum(); if (isNaN(y2)) break;
                    const x = readNum(); if (isNaN(x)) break;
                    const y = readNum(); if (isNaN(y)) break;
                    curX = isRel ? curX + x : x;
                    curY = isRel ? curY + y : y;
                    addPt();
                }
            } else if (cmd === 'Q') {
                while (true) {
                    const x1 = readNum(); if (isNaN(x1)) break;
                    const y1 = readNum(); if (isNaN(y1)) break;
                    const x = readNum(); if (isNaN(x)) break;
                    const y = readNum(); if (isNaN(y)) break;
                    curX = isRel ? curX + x : x;
                    curY = isRel ? curY + y : y;
                    addPt();
                }
            } else { break; }
        }
        console.log(`[parseRegionPath] ${pts.length} pts, bounds: x=[${Math.min(...pts.map(p=>p.x)).toFixed(1)},${Math.max(...pts.map(p=>p.x)).toFixed(1)}] y=[${Math.min(...pts.map(p=>p.y)).toFixed(1)},${Math.max(...pts.map(p=>p.y)).toFixed(1)}]`);
        if (pts.length > 0) console.log(`[parseRegionPath] first=${JSON.stringify(pts[0])} last=${JSON.stringify(pts[pts.length-1])}`);
        return pts;
    }

    function parseSubPathVerts(pathD, transform) {
        const m = transform ? transform.match(/translate\(([\d.-]+),\s*([\d.-]+)\)/) : null;
        const tx = m ? parseFloat(m[1]) : 0;
        const ty = m ? parseFloat(m[2]) : 0;
        const pts = [];
        const str = pathD;
        let i = 0, curX = 0, curY = 0;
        const len = str.length;
        function readNum() {
            while (i < len && (str[i] === ' ' || str[i] === ',' || str[i] === '\t' || str[i] === '\n')) i++;
            if (i >= len) return NaN;
            let start = i, hasDot = false;
            if (str[i] === '-' || str[i] === '+') i++;
            while (i < len) {
                const c = str[i];
                if (c >= '0' && c <= '9') { i++; continue; }
                if (c === '.' && !hasDot) { hasDot = true; i++; continue; }
                break;
            }
            if (start === i) return NaN;
            return parseFloat(str.slice(start, i));
        }
        function addPt() {
            pts.push({ x: curX + tx, y: IMG_H - (curY + ty) });
        }
        while (i < len) {
            let cmd = str[i];
            if (cmd >= 'A' && cmd <= 'Z') { i++; }
            else if (cmd >= 'a' && cmd <= 'z') { i++; }
            else break;
            const isRel = cmd >= 'a' && cmd <= 'z';
            if (isRel) cmd = cmd.toUpperCase();
            if (cmd === 'Z') { break; }
            if (cmd === 'M' || cmd === 'L') {
                while (true) {
                    const x = readNum(); if (isNaN(x)) break;
                    const y = readNum(); if (isNaN(y)) break;
                    curX = isRel ? curX + x : x;
                    curY = isRel ? curY + y : y;
                    addPt();
                    if (cmd === 'M') cmd = 'L';
                }
            } else if (cmd === 'H') {
                while (true) {
                    const x = readNum(); if (isNaN(x)) break;
                    curX = isRel ? curX + x : x;
                    addPt();
                }
            } else if (cmd === 'V') {
                while (true) {
                    const y = readNum(); if (isNaN(y)) break;
                    curY = isRel ? curY + y : y;
                    addPt();
                }
            } else if (cmd === 'C') {
                while (true) {
                    const x1 = readNum(); if (isNaN(x1)) break;
                    const y1 = readNum(); if (isNaN(y1)) break;
                    const x2 = readNum(); if (isNaN(x2)) break;
                    const y2 = readNum(); if (isNaN(y2)) break;
                    const x = readNum(); if (isNaN(x)) break;
                    const y = readNum(); if (isNaN(y)) break;
                    curX = isRel ? curX + x : x;
                    curY = isRel ? curY + y : y;
                    addPt();
                }
            } else if (cmd === 'S') {
                while (true) {
                    const x2 = readNum(); if (isNaN(x2)) break;
                    const y2 = readNum(); if (isNaN(y2)) break;
                    const x = readNum(); if (isNaN(x)) break;
                    const y = readNum(); if (isNaN(y)) break;
                    curX = isRel ? curX + x : x;
                    curY = isRel ? curY + y : y;
                    addPt();
                }
            } else if (cmd === 'Q') {
                while (true) {
                    const x1 = readNum(); if (isNaN(x1)) break;
                    const y1 = readNum(); if (isNaN(y1)) break;
                    const x = readNum(); if (isNaN(x)) break;
                    const y = readNum(); if (isNaN(y)) break;
                    curX = isRel ? curX + x : x;
                    curY = isRel ? curY + y : y;
                    addPt();
                }
            } else if (cmd === 'T') {
                while (true) {
                    const x = readNum(); if (isNaN(x)) break;
                    const y = readNum(); if (isNaN(y)) break;
                    curX = isRel ? curX + x : x;
                    curY = isRel ? curY + y : y;
                    addPt();
                }
            } else { break; }
        }
        return pts;
    }

    function distToSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1, dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
        let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const px2 = x1 + t * dx, py2 = y1 + t * dy;
        return Math.sqrt((px - px2) * (px - px2) + (py - py2) * (py - py2));
    }

    function rebuildRegionPreview() {
        if (regionPolygon) map.removeLayer(regionPolygon);
        regionPolygon = null;
        rebuildSubPolygons();
        const verts = getActiveVerts();
        if (verts.length < 3) return;
        const coords = verts.map(p => [p.y, p.x]);
        coords.push(coords[0]);
        const info = getActivePathInfo();
        const color = info.type === 'lake' ? '#4488ff' : '#e94560';
        regionPolygon = L.polygon(coords, {
            color: color, weight: 3, fillOpacity: info.type === 'lake' ? 0 : 0,
            interactive: true
        }).addTo(map);
        regionPolygon.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            const n = verts.length;
            let best = -1, bestDist = Infinity;
            for (let i = 0; i < n; i++) {
                const j = (i + 1) % n;
                const d = distToSegment(e.latlng.lng, e.latlng.lat,
                    verts[i].x, verts[i].y,
                    verts[j].x, verts[j].y);
                if (d < bestDist) { bestDist = d; best = i; }
            }
            regionPushHistory();
            const current = getActiveVerts();
            current.splice(best + 1, 0, { x: e.latlng.lng, y: e.latlng.lat });
            setActiveVerts(current);
            rebuildVertexMarkers();
            rebuildRegionPreview();
            updateRegionUI();
        });
    }

    let _previewLine = null;
    let _selectMode = false;
    let _selectedVerts = new Set();
    let _regionUndoStack = [];
    const REGION_UNDO_MAX = 50;

    function regionPushHistory() {
        const verts = getActiveVerts();
        _regionUndoStack.push({ verts: verts.map(v => ({ x: v.x, y: v.y })), subIdx: _activeSubIdx });
        if (_regionUndoStack.length > REGION_UNDO_MAX) _regionUndoStack.shift();
    }

    function updatePreviewLine(ll) {
        if (_previewLine) { map.removeLayer(_previewLine); _previewLine = null; }
    }

    function rebuildVertexMarkers() {
        vertexMarkers.forEach(m => map.removeLayer(m));
        vertexMarkers = [];
        const verts = getActiveVerts();
        verts.forEach((p, i) => {
            const isLast = i === verts.length - 1;
            const isSel = _selectedVerts.has(i);
            const bg = isSel ? '#4488ff' : isLast ? '#ffdd44' : '#fff';
            const border = isSel ? '#2244cc' : '#e94560';
            const borderW = isSel ? 4 : isLast ? 4 : 3;
            const txtColor = isSel ? '#fff' : isLast ? '#c33' : '#e94560';
            const marker = L.marker([p.y, p.x], {
                icon: L.divIcon({
                    className: 'region-vertex',
                    html: `<div style="width:16px;height:16px;background:${bg};border-radius:50%;border:${borderW}px solid ${border};display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:${txtColor}">${i+1}</div>`,
                    iconSize: [16, 16], iconAnchor: [8, 8]
                }),
                draggable: !_selectMode
            });
            marker._vertIndex = i;
            marker._dragActive = false;
            marker._pathIdx = _activeSubIdx;
            marker.on('dragstart', () => { marker._dragActive = true; });
            marker.on('drag', (e) => {
                const pos = e.target.getLatLng();
                const current = getActiveVerts();
                current[i] = { x: pos.lng, y: pos.lat };
                setActiveVerts(current);
                rebuildRegionPreview();
            });
            marker.on('dragend', () => {
                setTimeout(() => { marker._dragActive = false; }, 200);
                updatePreviewLine(null);
            });
            marker.on('click', (e) => {
                if (marker._dragActive) return;
                if (e.originalEvent) e.originalEvent.stopPropagation();
                if (_selectMode) {
                    if (_selectedVerts.has(i)) _selectedVerts.delete(i);
                    else _selectedVerts.add(i);
                    rebuildVertexMarkers();
                    updateSelectUI();
                } else {
                    regionPushHistory();
                    const current = getActiveVerts();
                    current.splice(i + 1, 0, { x: current[i].x, y: current[i].y });
                    setActiveVerts(current);
                    rebuildVertexMarkers();
                    rebuildRegionPreview();
                    updateRegionUI();
                }
            });
            marker.on('mousedown', (e) => { if (e.originalEvent) e.originalEvent.stopPropagation(); });
            marker.on('dblclick', () => {
                if (marker._dragActive) return;
                if (_selectMode) return;
                const current = getActiveVerts();
                if (current.length <= 3) return;
                regionPushHistory();
                current.splice(i, 1);
                setActiveVerts(current);
                rebuildVertexMarkers();
                rebuildRegionPreview();
                updateRegionUI();
            });
            marker.addTo(map);
            vertexMarkers.push(marker);
        });
        document.querySelectorAll('.region-vertex').forEach(el => el.title = 'Arrastrar para mover · Doble clic para eliminar');
    }

    function updateRegionUI() {
        const activeLen = getActiveVerts().length;
        const mainLen = regionVerts.length;
        document.getElementById('rb-undo').style.display = _regionUndoStack.length > 0 ? 'inline-block' : 'none';
        document.getElementById('rb-clear').style.display = activeLen > 0 ? 'inline-block' : 'none';
        document.getElementById('rb-save').style.display = mainLen >= 3 ? 'inline-block' : 'none';
        document.getElementById('rb-select').style.display = mainLen > 0 ? 'inline-block' : 'none';
        document.getElementById('rb-add-island').style.display = (_activeSubIdx < 0 && mainLen >= 3) ? 'inline-block' : 'none';
        document.getElementById('rb-add-lake').style.display = (_activeSubIdx < 0 && mainLen >= 3) ? 'inline-block' : 'none';
        document.getElementById('rb-delete-region').style.display = editingRegionName ? 'inline-block' : 'none';
        document.getElementById('rb-delete-subpath').style.display = _activeSubIdx >= 0 ? 'inline-block' : 'none';
        const info = getActivePathInfo();
        if (_activeSubIdx >= 0) {
            document.getElementById('rb-status').textContent = `${info.label}: ${activeLen} vértices · [M]ain para volver`;
        } else if (mainLen === 0) {
            document.getElementById('rb-status').textContent = 'Haz clic en el mapa para añadir vértices';
        } else if (mainLen < 3) {
            document.getElementById('rb-status').textContent = `${mainLen} vértices — necesitas al menos 3`;
        } else {
            const subCount = _subPaths.length;
            const extra = subCount > 0 ? ` · ${subCount} sub‑path(s)` : '';
            document.getElementById('rb-status').textContent = `${mainLen} vértices${extra}`;
        }
    }

    function loadRegionVerts(region) {
        if (_selectMode) { _selectMode = false; _selectedVerts.clear(); document.getElementById('rb-select').textContent = '🟦 Seleccionar'; document.getElementById('rb-delete-selected').style.display = 'none'; }
        _regionUndoStack = [];
        _subPaths = [];
        _activeSubIdx = -1;
        _subPolygons.forEach(p => map.removeLayer(p));
        _subPolygons = [];
        regionVerts = parseRegionPath(region);
        editingRegionName = region.name;
        if (region.extraPaths) {
            _subPaths = region.extraPaths.map(ep => ({
                verts: parseSubPathVerts(ep.d, ep.transform),
                type: ep.type
            }));
        }
        updatePreviewLine(null);
        rebuildVertexMarkers();
        rebuildRegionPreview();
        updateRegionUI();
        updatePathNav();
        const total = regionVerts.length + _subPaths.reduce((s, sp) => s + sp.verts.length, 0);
        document.getElementById('rb-status').textContent =
            `Editando "${region.name}" — ${total} vértices` +
            (regionVerts.length >= 3 ? ' (arrastra, doble clic para borrar)' : '');
        if (regionVerts.length > 0) {
            const latlngs = regionVerts.map(p => [p.y, p.x]);
            const bounds = L.latLngBounds(latlngs);
            map.fitBounds(bounds.pad(0.3), { maxZoom: 1 });
        }
    }

    function onRegionMapClick(e) {
        if (!regionEditMode) return;
        if (_selectMode) { toggleSelectMode(); return; }
        if (e.originalEvent && e.originalEvent.button !== 0) return;
        const now = Date.now();
        if (now - _rbLastClick < 400) return;
        _rbLastClick = now;
        const c = getImageCoords(e.containerPoint);
        regionPushHistory();
        const verts = getActiveVerts();
        verts.push(c);
        setActiveVerts(verts);
        rebuildVertexMarkers();
        rebuildRegionPreview();
        updateRegionUI();
        const info = getActivePathInfo();
        const len = getActiveVerts().length;
        if (!editingRegionName && _activeSubIdx < 0 && len === 3)
            document.getElementById('rb-status').textContent = '3 vértices — puedes guardar o seguir añadiendo';
        else
            document.getElementById('rb-status').textContent = `${info.label}: ${len} vértices`;
        updatePreviewLine(null);
    }

    function onRegionMapMove(e) {
        if (!regionEditMode) return;
        if (_selectMode) { updatePreviewLine(null); return; }
        updatePreviewLine(e.latlng);
    }

    function regionUndo() {
        if (_regionUndoStack.length === 0) return;
        const entry = _regionUndoStack.pop();
        if (entry.subIdx !== _activeSubIdx) { _regionUndoStack = []; return; }
        const verts = entry.verts.map(v => ({ x: v.x, y: v.y }));
        setActiveVerts(verts);
        rebuildVertexMarkers();
        rebuildRegionPreview();
        updateRegionUI();
        updatePreviewLine(null);
    }

    function regionClear() {
        if (regionVerts.length === 0 && _subPaths.length === 0) return;
        _regionUndoStack = [];
        _subPaths = [];
        _activeSubIdx = -1;
        _subPolygons.forEach(p => map.removeLayer(p));
        _subPolygons = [];
        regionVerts = [];
        editingRegionName = '';
        document.getElementById('rb-region-select').value = '';
        rebuildVertexMarkers();
        rebuildRegionPreview();
        updatePreviewLine(null);
        if (_selectMode) {
            _selectMode = false;
            _selectedVerts.clear();
            const sb = document.getElementById('rb-select');
            sb.style.background = '';
            sb.style.color = '';
            sb.textContent = '🟦 Seleccionar';
            document.getElementById('rb-delete-selected').style.display = 'none';
        }
        updateRegionUI();
        updatePathNav();
        document.getElementById('rb-status').textContent = 'Haz clic en el mapa para añadir vértices';
    }

    function vertsToSvgPath(verts) {
        const svgPts = verts.map(p => ({
            x: Math.round(p.x * 100) / 100,
            y: Math.round((IMG_H - p.y) * 100) / 100
        }));
        let minX = Infinity, minY = Infinity;
        svgPts.forEach(p => { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; });
        const parts = svgPts.map(p => `L${(p.x - minX).toFixed(2)} ${(p.y - minY).toFixed(2)}`);
        parts[0] = 'M' + parts[0].slice(1);
        parts.push('Z');
        return { d: parts.join(''), transform: `translate(${minX.toFixed(2)}, ${minY.toFixed(2)})` };
    }

    async function regionSave() {
        if (regionVerts.length < 3) { alert('Se necesitan al menos 3 vértices'); return; }

        const isEdit = !!editingRegionName;
        const name = isEdit ? editingRegionName : prompt('Nombre de la nueva región:');
        if (!isEdit && (!name || !name.trim())) return;
        const nameTrim = isEdit ? editingRegionName : name.trim();

        const main = vertsToSvgPath(regionVerts);
        const extraPaths = _subPaths.filter(sp => sp.verts.length >= 3).map(sp => {
            const spData = vertsToSvgPath(sp.verts);
            return { d: spData.d, transform: spData.transform, type: sp.type };
        });

        if (isEdit) {
            const idx = data.regions.findIndex(r => r.name === editingRegionName);
            if (idx !== -1) {
                data.regions[idx].path = main.d;
                data.regions[idx].transform = main.transform;
                data.regions[idx].extraPaths = extraPaths.length > 0 ? extraPaths : undefined;
                try {
                    await sbUpsert('regions', {
                        name: editingRegionName, path: main.d, transform: main.transform,
                        color: data.regions[idx].color || '#e94560',
                        description: data.regions[idx].description || '',
                        extrapaths: extraPaths.length > 0 ? JSON.parse(JSON.stringify(extraPaths)) : []
                    }, 'name');
                } catch (e) { alert('Error al guardar en Supabase: ' + e.message); }
                alert(`Frontera de "${editingRegionName}" actualizada ✅`);
                rebuildSvgOverlay();
            }
            toggleRegionEditMode();
        } else {
            data.regions.push({
                name: nameTrim, path: main.d,
                color: '#e94560', transform: main.transform, description: '',
                extraPaths: extraPaths.length > 0 ? extraPaths : undefined
            });
            try {
                await sbUpsert('regions', {
                    name: nameTrim, path: main.d, transform: main.transform,
                    color: '#e94560', description: '',
                    extrapaths: extraPaths.length > 0 ? JSON.parse(JSON.stringify(extraPaths)) : []
                }, 'name');
            } catch (e) { alert('Error al guardar en Supabase: ' + e.message); }
            rebuildSvgOverlay();
            toggleRegionEditMode();
        }
    }

    function updateSelectUI() {
        const count = _selectedVerts.size;
        const btn = document.getElementById('rb-delete-selected');
        btn.style.display = count > 0 ? 'inline-block' : 'none';
        btn.textContent = `🗑️ Borrar (${count})`;
    }

    function toggleSelectMode() {
        _selectMode = !_selectMode;
        const btn = document.getElementById('rb-select');
        if (_selectMode) {
            btn.style.background = '#4488ff';
            btn.style.color = '#fff';
            btn.textContent = '❌ Salir selección';
            _selectedVerts.clear();
            map.getContainer().style.cursor = 'default';
            updateSelectUI();
        } else {
            btn.style.background = '';
            btn.style.color = '';
            btn.textContent = '🟦 Seleccionar';
            _selectedVerts.clear();
            map.getContainer().style.cursor = 'crosshair';
            document.getElementById('rb-delete-selected').style.display = 'none';
        }
        rebuildVertexMarkers();
    }

    function deleteSelected() {
        if (_selectedVerts.size === 0) return;
        regionPushHistory();
        const current = getActiveVerts();
        const sorted = [..._selectedVerts].sort((a, b) => b - a);
        for (const idx of sorted) current.splice(idx, 1);
        setActiveVerts(current);
        _selectedVerts.clear();
        if (current.length < 3) { regionClear(); return; }
        rebuildVertexMarkers();
        rebuildRegionPreview();
        updateRegionUI();
        toggleSelectMode();
    }

    function deleteActiveSubPath() {
        if (_activeSubIdx < 0 || _activeSubIdx >= _subPaths.length) return;
        const info = getActivePathInfo();
        const label = info.type === 'lake' ? 'lago' : 'isla';
        if (!confirm(`¿Eliminar este ${label}?`)) return;
        _subPaths.splice(_activeSubIdx, 1);
        _activeSubIdx = -1;
        _regionUndoStack = [];
        rebuildVertexMarkers();
        rebuildRegionPreview();
        updateRegionUI();
        updatePathNav();
    }

    function deleteRegion() {
        if (!editingRegionName) return;
        const name = editingRegionName;
        if (!confirm(`¿Eliminar la región "${name}" y todas sus fronteras?`)) return;
        const idx = data.regions.findIndex(r => r.name === name);
        if (idx === -1) return;
        data.regions.splice(idx, 1);
        sbDelete('regions', 'name', name);
        rebuildSvgOverlay();
        regionClear();
        const sel = document.getElementById('rb-region-select');
        sel.innerHTML = '<option value="">— Nueva región —</option>';
        data.regions.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r.name;
            opt.textContent = r.name;
            sel.appendChild(opt);
        });
        updateRegionUI();
        updatePathNav();
        document.getElementById('rb-status').textContent = `Región "${name}" eliminada ✅`;
    }

    function rebuildSvgOverlay() {
        if (svgOverlayRef) { map.removeLayer(svgOverlayRef); svgOverlayRef = null; }
        if (data.regions && data.regions.length > 0) {
            const svgNS = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(svgNS, 'svg');
            svg.setAttribute('viewBox', '0 0 4096 2389');
            svg.setAttribute('width', '100%');
            svg.setAttribute('height', '100%');
            svg.style.pointerEvents = 'none';

            const defs = document.createElementNS(svgNS, 'defs');
            defs.innerHTML = `<filter id="region-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur in="SourceAlpha" stdDeviation="4" result="blur"/>
                <feFlood flood-color="#ffffff" flood-opacity="0.8" result="color"/>
                <feComposite in="color" in2="blur" operator="in" result="shadow"/>
                <feMerge><feMergeNode in="shadow"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>`;
            svg.appendChild(defs);

            data.regions.forEach(region => {
                const g = createRegionSvg(svgNS, region);
                if (g._defs) g._defs.forEach(d => defs.appendChild(d));
                svg.appendChild(g);
            });

            svgOverlayRef = L.svgOverlay(svg, data.bounds, { interactive: false });
            svgOverlayRef.addTo(map);
        }
    }

    function setRegionVisibility(visible) {
        data.regions.forEach(r => {
            const g = document.querySelector(`g[data-region="${r.name}"]`);
            if (!g) return;
            if (visible) {
                g.style.display = 'none';
            } else {
                g.style.display = '';
                g.querySelectorAll('path:not([data-lake-edge])').forEach(p => {
                    const c = r.color || '#e94560';
                    p.setAttribute('fill', hexAlpha(c, 0.1));
                    p.setAttribute('stroke', BOUNDARY_STROKE);
                    p.setAttribute('stroke-width', BOUNDARY_WIDTH);
                    p.removeAttribute('filter');
                });
                g.querySelectorAll('path[data-lake-edge]').forEach(p => {
                    p.setAttribute('stroke', 'transparent');
                    p.setAttribute('stroke-width', '2');
                });
            }
        });
    }

    function toggleRegionEditMode() {
        regionEditMode = !regionEditMode;
        const bar = document.getElementById('region-bar');
        if (regionEditMode) {
            bar.style.display = 'flex';
            const sel = document.getElementById('rb-region-select');
            sel.innerHTML = '<option value="">— Nueva región —</option>';
            data.regions.forEach(r => {
                const opt = document.createElement('option');
                opt.value = r.name;
                opt.textContent = r.name;
                sel.appendChild(opt);
            });

            document.getElementById('rb-add-island').style.display = 'none';
            document.getElementById('rb-add-lake').style.display = 'none';
            document.getElementById('rb-main').style.display = 'none';
            _subPaths = [];
            _activeSubIdx = -1;
            _subPolygons.forEach(p => map.removeLayer(p));
            _subPolygons = [];
            regionClear();
            hoverEnabled = false;
            setRegionVisibility(true);
            setClickState(false);
            map.dragging.disable();
            map.touchZoom.disable();
            map.doubleClickZoom.disable();
            map.boxZoom.disable();
            map.keyboard.disable();
            map.getContainer().style.cursor = 'crosshair';
            map.on('click', onRegionMapClick);
            map.on('mousemove', onRegionMapMove);
        } else {
            bar.style.display = 'none';
            document.getElementById('rb-region-select').innerHTML = '<option value="">— Nueva región —</option>';
            document.getElementById('rb-add-island').style.display = 'none';
            document.getElementById('rb-add-lake').style.display = 'none';
            document.getElementById('rb-main').style.display = 'none';
            document.getElementById('rb-path-nav').style.display = 'none';
            document.getElementById('rb-subpath-select').style.display = 'none';
            highlightSubPath(-1, false);
            _subPaths = [];
            _activeSubIdx = -1;
            _subPolygons.forEach(p => map.removeLayer(p));
            _subPolygons = [];
            regionVerts = [];
            editingRegionName = '';
            rebuildVertexMarkers();
            rebuildRegionPreview();
            setRegionVisibility(false);
            hoverEnabled = true;
            setClickState(true);
            map.dragging.enable();
            map.touchZoom.enable();
            map.doubleClickZoom.enable();
            map.boxZoom.enable();
            map.keyboard.enable();
            map.getContainer().style.cursor = '';
            map.off('click', onRegionMapClick);
            map.off('mousemove', onRegionMapMove);
            updatePreviewLine(null);
            if (_selectMode) {
                _selectMode = false;
                _selectedVerts.clear();
                const sb = document.getElementById('rb-select');
                sb.style.background = '';
                sb.style.color = '';
                sb.textContent = '🟦 Seleccionar';
                document.getElementById('rb-delete-selected').style.display = 'none';
            }
        }
    }

    function startSubPath(type) {
        if (_activeSubIdx >= 0) return;
        if (_selectMode) toggleSelectMode();
        _subPaths.push({ verts: [], type: type });
        _activeSubIdx = _subPaths.length - 1;
        _regionUndoStack = [];
        document.getElementById('rb-add-island').style.display = 'none';
        document.getElementById('rb-add-lake').style.display = 'none';
        document.getElementById('rb-main').style.display = 'inline-block';
        rebuildVertexMarkers();
        rebuildRegionPreview();
        updateRegionUI();
        updatePathNav();
    }

    function switchToMainPath() {
        if (_activeSubIdx < 0) return;
        if (_selectMode) toggleSelectMode();
        _activeSubIdx = -1;
        _regionUndoStack = [];
        const mainOk = regionVerts.length >= 3;
        document.getElementById('rb-add-island').style.display = mainOk ? 'inline-block' : 'none';
        document.getElementById('rb-add-lake').style.display = mainOk ? 'inline-block' : 'none';
        document.getElementById('rb-main').style.display = 'none';
        rebuildVertexMarkers();
        rebuildRegionPreview();
        updateRegionUI();
        updatePathNav();
    }

    document.getElementById('btn-region-edit').addEventListener('click', toggleRegionEditMode);
    document.getElementById('rb-region-select').addEventListener('change', function () {
        if (!regionEditMode) return;
        const val = this.value;
        if (!val) { regionClear(); return; }
        const r = data.regions.find(rr => rr.name === val);
        if (r) loadRegionVerts(r);
    });
    document.getElementById('rb-undo').addEventListener('click', regionUndo);
    document.getElementById('rb-clear').addEventListener('click', regionClear);
    document.getElementById('rb-save').addEventListener('click', regionSave);
    document.getElementById('rb-select').addEventListener('click', toggleSelectMode);
    document.getElementById('rb-delete-selected').addEventListener('click', deleteSelected);
    document.getElementById('rb-add-island').addEventListener('click', () => startSubPath('island'));
    document.getElementById('rb-add-lake').addEventListener('click', () => startSubPath('lake'));
    document.getElementById('rb-main').addEventListener('click', switchToMainPath);
    document.getElementById('rb-delete-region').addEventListener('click', deleteRegion);
    document.getElementById('rb-delete-subpath').addEventListener('click', deleteActiveSubPath);
    document.getElementById('rb-subpath-select').addEventListener('change', function () {
        const val = this.value;
        if (val === '' || val === null) return;
        const idx = parseInt(val);
        if (isNaN(idx) || idx === _activeSubIdx) return;
        if (_selectMode) toggleSelectMode();
        _activeSubIdx = idx;
        _regionUndoStack = [];
        rebuildVertexMarkers();
        rebuildRegionPreview();
        updateRegionUI();
        updatePathNav();
    });

    // ─── SISTEMA DE PINTURA ───
    let paintSystemReady = false;
    let paintMode = false;
    let paintTool = 'brush';
    let paintColor = '#e94560';
    let paintSize = 8;
    let isPainting = false;
    let paintPoints = [];
    let paintImagePoints = [];
    let paintBlobUrl = null;
    let paintGen = 0;

    let offscreenCanvas = null;
    let offscreenCtx = null;
    let paintOverlay = null;
    let tempCanvas = null;
    let tempCtx = null;
    function initPaintSystem() {
        if (!data.paint) data.paint = [];

        offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = 4096;
        offscreenCanvas.height = 2389;
        offscreenCtx = offscreenCanvas.getContext('2d');

        if (data.paint.length > 0) replayPaintStrokes(data.paint);

        paintOverlay = L.imageOverlay(offscreenCanvas.toDataURL('image/png'), data.bounds, {
            opacity: 1, interactive: false
        }).addTo(map);

        const container = map.getContainer();
        tempCanvas = document.createElement('canvas');
        tempCanvas.style.position = 'absolute';
        tempCanvas.style.top = '0';
        tempCanvas.style.left = '0';
        tempCanvas.style.width = '100%';
        tempCanvas.style.height = '100%';
        tempCanvas.style.pointerEvents = 'none';
        tempCanvas.style.display = 'none';
        tempCanvas.style.zIndex = '10000';
        tempCanvas.style.touchAction = 'none';
        tempCanvas.style.imageRendering = 'pixelated';
        tempCanvas.width = container.offsetWidth;
        tempCanvas.height = container.offsetHeight;
        tempCtx = tempCanvas.getContext('2d');
        container.appendChild(tempCanvas);

        map.on('resize', () => {
            tempCanvas.width = container.offsetWidth;
            tempCanvas.height = container.offsetHeight;
        });

        initPaintUI();
        paintSystemReady = true;
    }

    function enterPaintMode() {
        if (!paintSystemReady) initPaintSystem();
        if (regionEditMode) toggleRegionEditMode();
        paintMode = true;

        tempCanvas.style.display = 'block';
        tempCanvas.style.pointerEvents = 'auto';
        tempCanvas.style.cursor = 'none';

        map.dragging.disable();
        map.touchZoom.disable();
        map.doubleClickZoom.disable();
        map.boxZoom.disable();
        map.keyboard.disable();

        document.getElementById('paint-bar').style.display = 'flex';
        map.invalidateSize();
        updatePaintToolUI();
        setupPaintListeners(true);
    }

    function exitPaintMode() {
        if (!paintMode) return;
        paintMode = false;
        isPainting = false;

        tempCanvas.style.display = 'none';
        tempCanvas.style.pointerEvents = 'none';
        clearTempCanvas();

        map.dragging.enable();
        map.touchZoom.enable();
        map.doubleClickZoom.enable();
        map.boxZoom.enable();
        map.keyboard.enable();

        document.getElementById('paint-bar').style.display = 'none';
        map.invalidateSize();
        setupPaintListeners(false);
    }

    function setupPaintListeners(attach) {
        const method = attach ? 'addEventListener' : 'removeEventListener';
        tempCanvas[method]('mousedown', onPaintMouseDown);
        document[method]('mousemove', onPaintMouseMove);
        document[method]('mouseup', onPaintMouseUp);
    }

    function updatePaintToolUI() {
        document.querySelectorAll('#paint-bar .paint-tools .btn-sm').forEach(b => b.classList.remove('btn-primary'));
        const btn = document.getElementById('paint-tool-' + paintTool);
        if (btn) btn.classList.add('btn-primary');
        document.getElementById('paint-size-val').textContent = paintSize;
    }

    function getScreenPos(e) {
        const rect = map.getContainer().getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function screenToImage(sx, sy) {
        const ll = map.containerPointToLatLng([sx, sy]);
        return { x: ll.lng, y: 2389 - ll.lat };
    }

    function getScreenBrushSize() {
        return paintSize * Math.pow(2, map.getZoom());
    }

    function getRegionAtPoint(imageX, imageY) {
        for (const r of data.regions) {
            const m = r.transform.match(/translate\(([\d.-]+),\s*([\d.-]+)\)/);
            const tx = m ? parseFloat(m[1]) : 0;
            const ty = m ? parseFloat(m[2]) : 0;
            const localX = imageX - tx;
            const localY = imageY - ty;
            try {
                const path = new Path2D(r.path);
                const c = document.createElement('canvas').getContext('2d');
                if (c.isPointInPath(path, localX, localY)) return r;
            } catch (e) {}
        }
        return null;
    }

    function onPaintMouseDown(e) {
        if (!paintMode || e.button !== 0) return;
        const sp = getScreenPos(e);

        if (paintTool === 'fill') {
            const ip = screenToImage(sp.x, sp.y);
            const region = getRegionAtPoint(ip.x, ip.y);
            if (region) {
                const m = region.transform.match(/translate\(([\d.-]+),\s*([\d.-]+)\)/);
                const tx = m ? parseFloat(m[1]) : 0;
                const ty = m ? parseFloat(m[2]) : 0;
                const path = new Path2D(region.path);
                offscreenCtx.save();
                offscreenCtx.translate(tx, ty);
                offscreenCtx.fillStyle = paintColor;
                offscreenCtx.fill(path);
                offscreenCtx.restore();
                updatePaintOverlay();
                data.paint.push({ tool: 'fill', color: paintColor, region: region.name });
                sbSavePaint();
            }
            return;
        }

        if (paintTool === 'pipette') {
            const ip = screenToImage(sp.x, sp.y);
            const ix = Math.round(Math.min(Math.max(ip.x, 0), 4095));
            const iy = Math.round(Math.min(Math.max(ip.y, 0), 2388));
            const paintPixel = offscreenCtx.getImageData(ix, iy, 1, 1).data;
            if (paintPixel[3] > 0) {
                paintColor = '#' + [paintPixel[0], paintPixel[1], paintPixel[2]].map(v => v.toString(16).padStart(2, '0')).join('');
                document.getElementById('paint-color').value = paintColor;
            } else {
                try {
                    const mapImg = document.querySelector('.leaflet-overlay-pane > img');
                    if (mapImg && mapImg.complete && mapImg.naturalWidth > 0) {
                        const c = document.createElement('canvas');
                        c.width = 4096; c.height = 2389;
                        const ctx = c.getContext('2d');
                        ctx.drawImage(mapImg, 0, 0);
                        const pixel = ctx.getImageData(ix, iy, 1, 1).data;
                        if (pixel[3] > 0) {
                            paintColor = '#' + [pixel[0], pixel[1], pixel[2]].map(v => v.toString(16).padStart(2, '0')).join('');
                            document.getElementById('paint-color').value = paintColor;
                        }
                    }
                } catch (e) {}
            }
            return;
        }

        isPainting = true;
        clearTempCanvas();
        const ip = screenToImage(sp.x, sp.y);
        paintPoints = [{ x: sp.x, y: sp.y }];
        paintImagePoints = [{ x: ip.x, y: ip.y }];

        tempCtx.lineCap = 'round';
        tempCtx.lineJoin = 'round';
        tempCtx.beginPath();
        tempCtx.arc(sp.x, sp.y, getScreenBrushSize() / 2, 0, Math.PI * 2);
        if (paintTool === 'eraser') {
            tempCtx.globalCompositeOperation = 'destination-out';
            tempCtx.fillStyle = 'rgba(0,0,0,1)';
        } else {
            tempCtx.fillStyle = paintColor;
        }
        tempCtx.fill();
        tempCtx.globalCompositeOperation = 'source-over';
    }

    function drawBrushCursor(sp) {
        clearTempCanvas();
        const sSize = getScreenBrushSize();
        const color = paintTool === 'eraser' ? 'rgba(255,255,255,0.6)' : paintColor;
        tempCtx.beginPath();
        tempCtx.arc(sp.x, sp.y, sSize / 2, 0, Math.PI * 2);
        tempCtx.strokeStyle = color;
        tempCtx.lineWidth = 2;
        if (tempCtx.setLineDash) tempCtx.setLineDash([4, 4]);
        tempCtx.stroke();
        if (tempCtx.setLineDash) tempCtx.setLineDash([]);
        tempCtx.globalCompositeOperation = 'source-over';
    }

    function onPaintMouseMove(e) {
        if (!paintMode) return;
        const sp = getScreenPos(e);
        if (isPainting) {
            const prev = paintPoints[paintPoints.length - 1];
            const ip = screenToImage(sp.x, sp.y);

            const sSize = getScreenBrushSize();
            tempCtx.lineCap = 'round';
            tempCtx.lineJoin = 'round';
            tempCtx.lineWidth = sSize;
            if (paintTool === 'eraser') {
                tempCtx.globalCompositeOperation = 'destination-out';
                tempCtx.strokeStyle = 'rgba(0,0,0,1)';
            } else {
                tempCtx.strokeStyle = paintColor;
            }
            tempCtx.beginPath();
            tempCtx.moveTo(prev.x, prev.y);
            tempCtx.lineTo(sp.x, sp.y);
            tempCtx.stroke();
            tempCtx.globalCompositeOperation = 'source-over';

            paintPoints.push({ x: sp.x, y: sp.y });
            paintImagePoints.push({ x: ip.x, y: ip.y });
        } else {
            drawBrushCursor(sp);
        }
    }

    function onPaintMouseUp(e) {
        if (!paintMode || !isPainting) return;
        isPainting = false;

        if (paintImagePoints.length > 0) {
            if (paintTool === 'eraser') {
                offscreenCtx.globalCompositeOperation = 'destination-out';
            }
            offscreenCtx.lineCap = 'round';
            offscreenCtx.lineJoin = 'round';
            offscreenCtx.lineWidth = paintSize;

            if (paintImagePoints.length === 1) {
                const p = paintImagePoints[0];
                const r = paintSize / 2;
                offscreenCtx.beginPath();
                offscreenCtx.arc(p.x, p.y, r, 0, Math.PI * 2);
                if (paintTool === 'eraser') {
                    offscreenCtx.fillStyle = 'rgba(0,0,0,1)';
                } else {
                    offscreenCtx.fillStyle = paintColor;
                }
                offscreenCtx.fill();
            } else {
                if (paintTool === 'eraser') {
                    offscreenCtx.strokeStyle = 'rgba(0,0,0,1)';
                } else {
                    offscreenCtx.strokeStyle = paintColor;
                }
                offscreenCtx.beginPath();
                offscreenCtx.moveTo(paintImagePoints[0].x, paintImagePoints[0].y);
                for (let i = 1; i < paintImagePoints.length; i++) {
                    offscreenCtx.lineTo(paintImagePoints[i].x, paintImagePoints[i].y);
                }
                offscreenCtx.stroke();
            }
            offscreenCtx.globalCompositeOperation = 'source-over';

            const pts = paintImagePoints.map(p => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]);
            data.paint.push({
                tool: paintTool, color: paintColor, size: paintSize, points: pts
            });
            sbSavePaint();

            updatePaintOverlay();
        }

        clearTempCanvas();
        paintPoints = [];
        paintImagePoints = [];

        if (e) drawBrushCursor(getScreenPos(e));
    }

    function paintUndo() {
        if (!data.paint || data.paint.length === 0) return;
        data.paint.pop();
        sbSavePaint();
        offscreenCtx.globalCompositeOperation = 'source-over';
        offscreenCtx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
        if (data.paint.length > 0) replayPaintStrokes(data.paint);
        updatePaintOverlay();
    }

    function updatePaintOverlay() {
        const gen = ++paintGen;
        offscreenCanvas.toBlob(blob => {
            if (gen !== paintGen) return;
            if (paintBlobUrl) URL.revokeObjectURL(paintBlobUrl);
            paintBlobUrl = URL.createObjectURL(blob);
            paintOverlay.setUrl(paintBlobUrl);
        }, 'image/png');
    }

    function clearTempCanvas() {
        if (!tempCtx || !tempCanvas) return;
        tempCtx.globalCompositeOperation = 'source-over';
        tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
    }

    function replayPaintStrokes(strokes) {
        const fillStrokes = strokes.filter(s => s.tool === 'fill');
        const lineStrokes = strokes.filter(s => s.tool !== 'fill');

        for (const s of lineStrokes) {
            offscreenCtx.lineCap = 'round';
            offscreenCtx.lineJoin = 'round';
            offscreenCtx.lineWidth = s.size || 8;
            if (s.tool === 'eraser') {
                offscreenCtx.globalCompositeOperation = 'destination-out';
                offscreenCtx.strokeStyle = 'rgba(0,0,0,1)';
            } else {
                offscreenCtx.strokeStyle = s.color;
            }
            offscreenCtx.beginPath();
            offscreenCtx.moveTo(s.points[0][0], s.points[0][1]);
            for (let i = 1; i < s.points.length; i++) {
                offscreenCtx.lineTo(s.points[i][0], s.points[i][1]);
            }
            offscreenCtx.stroke();
            offscreenCtx.globalCompositeOperation = 'source-over';
        }

        if (fillStrokes.length > 0) {
            for (const s of fillStrokes) {
                const region = data.regions.find(r => r.name === s.region);
                if (!region) continue;
                const m = region.transform.match(/translate\(([\d.-]+),\s*([\d.-]+)\)/);
                const tx = m ? parseFloat(m[1]) : 0;
                const ty = m ? parseFloat(m[2]) : 0;
                try {
                    const path = new Path2D(region.path);
                    offscreenCtx.save();
                    offscreenCtx.translate(tx, ty);
                    offscreenCtx.fillStyle = s.color;
                    offscreenCtx.fill(path);
                    offscreenCtx.restore();
                } catch (e) {}
            }
        }
    }

    function initPaintUI() {
        document.getElementById('paint-tool-brush').addEventListener('click', () => { paintTool = 'brush'; updatePaintToolUI(); });
        document.getElementById('paint-tool-eraser').addEventListener('click', () => { paintTool = 'eraser'; updatePaintToolUI(); });
        document.getElementById('paint-tool-fill').addEventListener('click', () => { paintTool = 'fill'; updatePaintToolUI(); });
        document.getElementById('paint-tool-pipette').addEventListener('click', () => { paintTool = 'pipette'; updatePaintToolUI(); });

        document.getElementById('paint-size').addEventListener('input', (e) => {
            paintSize = parseInt(e.target.value);
            document.getElementById('paint-size-val').textContent = paintSize;
        });
        document.getElementById('paint-color').addEventListener('input', (e) => { paintColor = e.target.value; });
        document.getElementById('paint-undo').addEventListener('click', paintUndo);
        document.getElementById('paint-exit').addEventListener('click', exitPaintMode);
    }

    // ─── TOGGLES ───
    let hoverEnabled = true;
    let clickEnabled = true;
    let markersVisible = true;

    function setHoverState(state) {
        hoverEnabled = state;
        document.getElementById('btn-toggle-hover').classList.toggle('off', !state);
        document.getElementById('btn-toggle-hover').title = state ? 'Desactivar bordes al pasar el ratón' : 'Activar bordes al pasar el ratón';
        if (!state) {
            data.regions.forEach(r => {
                if (r.name === activeRegion) return;
                document.querySelectorAll(`path[data-region="${r.name}"]:not([data-lake-edge])`).forEach(p => {
                    p.setAttribute('fill', hexAlpha(r.color || '#e94560', 0.1));
                    p.setAttribute('stroke', BOUNDARY_STROKE);
                    p.setAttribute('stroke-width', BOUNDARY_WIDTH);
                    p.removeAttribute('filter');
                });
                document.querySelectorAll(`path[data-region="${r.name}"][data-lake-edge]`).forEach(p => {
                    p.setAttribute('stroke', 'transparent');
                    p.setAttribute('stroke-width', '2');
                });
            });
        }
    }

    function setClickState(state) {
        clickEnabled = state;
        document.getElementById('btn-toggle-click').classList.toggle('off', !state);
        document.getElementById('btn-toggle-click').title = state ? 'Desactivar clic en países' : 'Activar clic en países';
        if (!state && activeRegion) closeRegionPanel();
    }

    document.getElementById('btn-toggle-hover').addEventListener('click', () => setHoverState(!hoverEnabled));
    document.getElementById('btn-toggle-click').addEventListener('click', () => setClickState(!clickEnabled));

    function toggleAll() {
        const newState = hoverEnabled || clickEnabled ? false : true;
        setHoverState(newState);
        setClickState(newState);
        const btn = document.getElementById('btn-toggle-all');
        btn.classList.toggle('off', !newState);
        btn.title = newState ? 'Desactivar todo' : 'Activar todo';
    }

    document.getElementById('btn-toggle-all').addEventListener('click', toggleAll);

    function setMarkersState(state) {
        markersVisible = state;
        const btn = document.getElementById('btn-toggle-markers');
        btn.classList.toggle('off', !state);
        btn.title = state ? 'Ocultar marcadores' : 'Mostrar marcadores';
        if (state) {
            layerGroup.addTo(map);
        } else {
            map.removeLayer(layerGroup);
        }
    }

    document.getElementById('btn-toggle-markers').addEventListener('click', () => setMarkersState(!markersVisible));

    // ─── PANEL DE REGIÓN ───
    let activeRegion = null;

    function openRegionPanel(region) {
        activeRegion = region.name;
        document.getElementById('region-panel-title').textContent = region.name;
        document.getElementById('region-panel-desc').textContent = region.description || '';

        // Edit mode fields
        const inEdit = editMode;
        document.getElementById('region-panel-read').style.display = inEdit ? 'none' : 'block';
        document.getElementById('region-panel-edit').style.display = inEdit ? 'block' : 'none';
        if (inEdit) {
            document.getElementById('region-edit-name').value = region.name || '';
            document.getElementById('region-edit-desc').value = region.description || '';
            document.getElementById('region-edit-color').value = region.color || '#e94560';
            document.getElementById('region-edit-save').dataset.regionName = region.name;
        }

        document.getElementById('region-panel').className = 'region-panel-open';

        // Reset all regions first
        data.regions.forEach(r => {
            document.querySelectorAll(`path[data-region="${r.name}"]:not([data-lake-edge])`).forEach(p => {
                p.setAttribute('stroke', 'rgba(255,255,255,0.5)');
                p.setAttribute('stroke-width', '2');
                p.setAttribute('fill', hexAlpha(r.color || '#e94560', 0.19));
                p.removeAttribute('filter');
            });
            document.querySelectorAll(`path[data-region="${r.name}"][data-lake-edge]`).forEach(p => {
                p.setAttribute('stroke', 'rgba(255,255,255,0.5)');
                p.setAttribute('stroke-width', '2');
            });
        });
        // Highlight selected
        const sel = document.querySelector(`path[data-region="${region.name}"]:not([data-lake-edge])`);
        if (sel) {
            sel.setAttribute('stroke', region.color || '#e94560');
            sel.setAttribute('stroke-width', '4');
            sel.setAttribute('fill', hexAlpha(region.color || '#e94560', 0.38));
            sel.setAttribute('filter', 'url(#region-glow)');
        }
        const selLake = document.querySelector(`path[data-region="${region.name}"][data-lake-edge]`);
        if (selLake) {
            selLake.setAttribute('stroke', region.color || '#e94560');
            selLake.setAttribute('stroke-width', '2');
        }
    }

    function saveRegionEdit() {
        const oldName = document.getElementById('region-edit-save').dataset.regionName;
        if (!oldName) { alert('Error: no hay región seleccionada'); return; }
        const region = data.regions.find(r => r.name === oldName);
        if (!region) { alert('Error: región "' + oldName + '" no encontrada'); return; }

        const newName = document.getElementById('region-edit-name').value.trim();
        if (!newName) { alert('El nombre es obligatorio'); return; }
        const desc = document.getElementById('region-edit-desc').value.trim();
        const color = document.getElementById('region-edit-color').value;

        const nameChanged = newName !== oldName;

        if (nameChanged) {
            sbDelete('regions', 'name', oldName);
            region.name = newName;
            document.getElementById('region-edit-save').dataset.regionName = newName;
        }

        region.description = desc;
        region.color = color;

        sbUpsert('regions', {
            name: region.name, path: region.path, transform: region.transform, color, description: desc,
            extrapaths: region.extraPaths ? JSON.parse(JSON.stringify(region.extraPaths)) : []
        }, 'name');

        try { rebuildSvgOverlay(); } catch (e) { console.error('rebuild error:', e); alert('Error al reconstruir el mapa'); return; }

        document.getElementById('region-panel-title').textContent = region.name;
        document.getElementById('region-panel-desc').textContent = desc;
        document.getElementById('region-edit-save').dataset.regionName = region.name;
        activeRegion = region.name;

        const sel = document.querySelector(`path[data-region="${region.name}"]:not([data-lake-edge])`);
        if (sel) {
            sel.setAttribute('stroke', color);
            sel.setAttribute('stroke-width', '4');
            sel.setAttribute('fill', hexAlpha(color, 0.38));
            sel.setAttribute('filter', 'url(#region-glow)');
        }
        const selLake = document.querySelector(`path[data-region="${region.name}"][data-lake-edge]`);
        if (selLake) {
            selLake.setAttribute('stroke', color);
            selLake.setAttribute('stroke-width', '2');
        }

        // Update region editor dropdown if open
        const selDropdown = document.getElementById('rb-region-select');
        if (selDropdown.style.display !== 'none' || regionEditMode) {
            const currentVal = selDropdown.value;
            selDropdown.innerHTML = '<option value="">— Nueva región —</option>';
            data.regions.forEach(r => {
                const opt = document.createElement('option');
                opt.value = r.name;
                opt.textContent = r.name;
                if (r.name === region.name) opt.selected = true;
                selDropdown.appendChild(opt);
            });
        }

        alert('Región guardada ✅');
    }

    function closeRegionPanel() {
        activeRegion = null;
        document.getElementById('region-panel').className = 'region-panel-closed';
        data.regions.forEach(r => {
            document.querySelectorAll(`path[data-region="${r.name}"]:not([data-lake-edge])`).forEach(p => {
                p.setAttribute('fill', hexAlpha(r.color || '#e94560', 0.1));
                p.setAttribute('stroke', BOUNDARY_STROKE);
                p.setAttribute('stroke-width', BOUNDARY_WIDTH);
                p.removeAttribute('filter');
            });
            document.querySelectorAll(`path[data-region="${r.name}"][data-lake-edge]`).forEach(p => {
                p.setAttribute('stroke', 'transparent');
                p.setAttribute('stroke-width', '2');
            });
        });
    }

    document.getElementById('region-panel-close').addEventListener('click', closeRegionPanel);
    document.getElementById('region-edit-save').addEventListener('click', saveRegionEdit);
    document.getElementById('region-edit-random-color').addEventListener('click', () => {
        const r = Math.floor(Math.random() * 200 + 55).toString(16).padStart(2, '0');
        const g = Math.floor(Math.random() * 200 + 55).toString(16).padStart(2, '0');
        const b = Math.floor(Math.random() * 200 + 55).toString(16).padStart(2, '0');
        document.getElementById('region-edit-color').value = '#' + r + g + b;
    });

    map.on('click', function () {
        if (regionEditMode) return;
        if (!clickEnabled) return;
        if (activeRegion) closeRegionPanel();
    });

    // ─── ESTADO ───
    let editMode = false;
    let placing = false;

    const markers = {};
    const layerGroup = L.layerGroup().addTo(map);
    let idCounter = 1;
    let editingId = null;

    // ─── PERSISTENCIA ───
    const STORAGE_KEY = 'mapa_rol_data';
    const TOKEN_KEY = 'mapa_rol_github_token';

    function getGitHubToken() {
        return localStorage.getItem(TOKEN_KEY) || '';
    }

    function setGitHubToken(token) {
        if (token) localStorage.setItem(TOKEN_KEY, token);
        else localStorage.removeItem(TOKEN_KEY);
    }

    function generateDataJs() {
        const pois = Object.values(markers).map(e => ({
            id: e.poi.id, name: e.poi.name, type: e.poi.type,
            color: e.poi.color, region: e.poi.region,
            coords: e.poi.coords, description: e.poi.description,
            links: e.poi.links
        }));
        const output = { ...data, pois };
        return 'const MAP_DATA = ' + JSON.stringify(output, null, 4) + ';\n';
    }

    async function syncToGitHub() {
        const token = getGitHubToken();
        if (!token) return;
        const status = document.getElementById('sync-status');
        status.style.display = 'inline';
        status.textContent = '☁️ subiendo...';

        const gh = data.github;
        const content = generateDataJs();
        const encoded = btoa(unescape(encodeURIComponent(content)));

        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                // Obtener SHA actual
                const getUrl = `https://api.github.com/repos/${gh.owner}/${gh.repo}/contents/${gh.path}`;
                const getRes = await fetch(getUrl, {
                    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
                });
                let sha = '';
                if (getRes.ok) {
                    const getData = await getRes.json();
                    sha = getData.sha;
                }

                // Subir archivo
                const putRes = await fetch(getUrl, {
                    method: 'PUT',
                    headers: {
                        Authorization: `token ${token}`,
                        Accept: 'application/vnd.github.v3+json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        message: 'Actualizar mapa desde editor',
                        content: encoded,
                        sha: sha || undefined,
                        branch: gh.branch
                    })
                });

                if (putRes.ok) {
                    status.textContent = '☁️ guardado en GitHub ✅ (tus amigos deben recargar)';
                    setTimeout(() => { status.textContent = ''; status.style.display = 'none'; }, 5000);
                    return;
                }

                const err = await putRes.json();
                if (putRes.status === 409 && attempt < 2) {
                    // SHA desactualizado, reintentar
                    status.textContent = '☁️ reintentando...';
                    continue;
                }
                status.textContent = '☁️ error: ' + (err.message || 'desconocido');
                setTimeout(() => { status.textContent = ''; status.style.display = 'none'; }, 5000);
                return;
            } catch (e) {
                if (attempt < 2) continue;
                status.textContent = '☁️ error de conexión';
                setTimeout(() => { status.textContent = ''; status.style.display = 'none'; }, 5000);
            }
        }
    }

    function saveState() {
        try {
            const pois = Object.values(markers).map(e => ({
                id: e.poi.id, name: e.poi.name, type: e.poi.type,
                color: e.poi.color, region: e.poi.region,
                coords: e.poi.coords, description: e.poi.description,
                links: e.poi.links
            }));
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ pois, editPassword: data.editPassword }));
        } catch (e) {}
    }

    function loadSavedData() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const saved = JSON.parse(raw);
            if (saved.pois) saved.pois.forEach(p => addMarkerFromData(p));
            if (saved.editPassword) data.editPassword = saved.editPassword;
        } catch (e) {}
    }

    // ─── CATEGORÍAS ───
    (function populateTypeSelect() {
        const sel = document.getElementById('edit-type');
        Object.entries(data.categories).forEach(([key, cat]) => {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = `${cat.icon} ${cat.label}`;
            sel.appendChild(opt);
        });
    })();

    // ─── ICONO ───
    function createIcon(type, color) {
        const cat = data.categories[type];
        const bg = color || (cat ? cat.color : '#e94560');
        const iconChar = cat ? cat.icon : '📍';
        return L.divIcon({
            className: 'custom-div-icon',
            html: `<div style="
                width: 30px; height: 30px;
                background: ${bg};
                border-radius: 50%;
                display: flex; align-items: center; justify-content: center;
                font-size: 15px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.5);
                border: 2px solid rgba(255,255,255,0.25);
                cursor: pointer;
                transition: transform 0.15s;
            ">${iconChar}</div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15],
            popupAnchor: [0, -16],
            tooltipAnchor: [15, -16]
        });
    }

    // ─── CARGAR POIs ───
    loadSavedData();
    if (Object.keys(markers).length === 0) {
        data.pois.forEach(poi => addMarkerFromData(poi));
    }

    function addMarkerFromData(poi) {
        const id = poi.id || 'm' + (idCounter++);
        const icon = createIcon(poi.type, poi.color);
        const cat = data.categories[poi.type];

        const marker = L.marker(poi.coords, { icon, draggable: false });
        marker.bindTooltip(poi.name, { direction: 'top', offset: [0, -14] });

        const linksHtml = poi.links && poi.links.length > 0
            ? `<div class="popup-links">${poi.links.map(l => `<a href="${l.url}" target="_blank">${l.text}</a>`).join('')}</div>`
            : '';

        marker.bindPopup(`
            <div class="popup-content">
                <div class="popup-type">${cat ? cat.icon + ' ' + cat.label : ''}</div>
                <h3>${poi.name}</h3>
                ${poi.region ? `<div class="popup-region">📍 ${poi.region}</div>` : ''}
                <div class="popup-desc">${poi.description || ''}</div>
                ${linksHtml}
            </div>
        `, { maxWidth: 300 });

        if (editMode) {
            marker.on('click', () => openEditModal(id));
            marker.dragging?.enable();
        }

        markers[id] = { marker, poi: { ...poi, id } };
        layerGroup.addLayer(marker);
        updateCounter();
    }

    // ─── AÑADIR MARCADOR ───
    function addNewMarker(latlng) {
        const id = 'm' + (idCounter++);
        const poi = {
            id, name: 'Nuevo punto', type: 'city',
            color: '#e94560', region: '',
            coords: [latlng.lat, latlng.lng],
            description: '', links: []
        };

        const icon = createIcon('city', '#e94560');
        const marker = L.marker([latlng.lat, latlng.lng], { icon, draggable: true });
        marker.bindTooltip('Nuevo punto', { direction: 'top', offset: [0, -14] });
        marker.bindPopup('<div class="popup-content"><h3>Nuevo punto</h3></div>', { maxWidth: 300 });

        marker.on('dragend', () => {
            const pos = marker.getLatLng();
            if (markers[id]) markers[id].poi.coords = [pos.lat, pos.lng];
            saveState();
        });
        marker.on('click', () => openEditModal(id));

        markers[id] = { marker, poi };
        layerGroup.addLayer(marker);
        updateCounter();
        saveState();
        openEditModal(id);
    }

    // ─── MODAL ───
    function openEditModal(id) {
        const entry = markers[id];
        if (!entry) return;
        editingId = id;

        const p = entry.poi;
        const cat = data.categories[p.type];
        document.getElementById('edit-id').value = id;
        document.getElementById('edit-coords').value = JSON.stringify(p.coords);
        document.getElementById('edit-name').value = p.name;
        document.getElementById('edit-type').value = p.type || 'city';
        document.getElementById('edit-color').value = p.color || (cat ? cat.color : '#e94560');
        document.getElementById('edit-region').value = p.region;
        document.getElementById('edit-desc').value = p.description || '';
        document.getElementById('edit-link').value = (p.links && p.links[0]) ? p.links[0].url : '';
        document.getElementById('edit-link-text').value = (p.links && p.links[0]) ? p.links[0].text : '';

        document.getElementById('modal-title').textContent = '✏️ Editar punto';
        document.getElementById('btn-delete').style.display = 'inline-block';
        document.getElementById('modal-overlay').style.display = 'flex';
    }

    // ─── GUARDAR ───
    function saveModal() {
        const id = document.getElementById('edit-id').value;
        const entry = markers[id];
        if (!entry) return;

        const name = document.getElementById('edit-name').value.trim();
        if (!name) { alert('El nombre es obligatorio'); return; }

        const type = document.getElementById('edit-type').value;
        const color = document.getElementById('edit-color').value;
        const region = document.getElementById('edit-region').value;
        const desc = document.getElementById('edit-desc').value.trim();
        const linkUrl = document.getElementById('edit-link').value.trim();
        const linkText = document.getElementById('edit-link-text').value.trim();
        const coords = JSON.parse(document.getElementById('edit-coords').value);

        entry.poi.name = name;
        entry.poi.type = type;
        entry.poi.color = color;
        entry.poi.region = region;
        entry.poi.description = desc;
        entry.poi.coords = coords;
        entry.poi.links = linkUrl ? [{ text: linkText || '🔗 Enlace', url: linkUrl }] : [];

        // Save to Supabase
        sbUpsert('pois', {
            id, name, category: type, color, region,
            coords: coords, description: desc,
            links: entry.poi.links.length > 0 ? entry.poi.links : []
        }, 'id');

        const cat = data.categories[type];
        entry.marker.setIcon(createIcon(type, color));
        entry.marker.setTooltipContent(name);

        const linksHtml = entry.poi.links.length > 0
            ? `<div class="popup-links">${entry.poi.links.map(l => `<a href="${l.url}" target="_blank">${l.text}</a>`).join('')}</div>`
            : '';

        entry.marker.setPopupContent(`
            <div class="popup-content">
                <div class="popup-type">${cat ? cat.icon + ' ' + cat.label : ''}</div>
                <h3>${name}</h3>
                ${region ? `<div class="popup-region">📍 ${region}</div>` : ''}
                <div class="popup-desc">${desc}</div>
                ${linksHtml}
            </div>
        `);

        closeModal();
        updateCounter();
        saveState();
    }

    // ─── ELIMINAR ───
    function deleteCurrent() {
        const id = document.getElementById('edit-id').value;
        const entry = markers[id];
        if (!entry) return;
        if (!confirm(`¿Eliminar "${entry.poi.name}"?`)) return;

        sbDelete('pois', 'id', id);

        layerGroup.removeLayer(entry.marker);
        delete markers[id];
        closeModal();
        updateCounter();
        saveState();
    }

    // ─── CERRAR MODAL ───
    function closeModal() {
        document.getElementById('modal-overlay').style.display = 'none';
        editingId = null;
    }

    // ─── CONTADOR ───
    function updateCounter() {
        document.getElementById('poi-count').textContent = Object.keys(markers).length;
    }

    // ─── EXPORTAR ───
    function exportData() {
        const pois = Object.values(markers).map(e => ({
            id: e.poi.id, name: e.poi.name, type: e.poi.type,
            color: e.poi.color, region: e.poi.region,
            coords: e.poi.coords, description: e.poi.description,
            links: e.poi.links
        }));

        const output = { ...data, pois };
        const json = JSON.stringify(output, null, 4);
        const jsContent = 'const MAP_DATA = ' + json + ';\n';

        const blob = new Blob([jsContent], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'data.js';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ─── TOGGLE EDIT MODE ───
    function toggleEditMode() {
        if (!editMode) {
            const password = prompt('Introduce la contraseña de edición:');
            if (password !== data.editPassword) {
                alert('Contraseña incorrecta');
                return;
            }
        }

        editMode = !editMode;
        const btn = document.getElementById('btn-edit');
        const bar = document.getElementById('edit-bar');
        const exportBtn = document.getElementById('btn-export');

        if (editMode) {
            if (window.__cursorStart) window.__cursorStart();
            btn.textContent = '👁️ Ver';
            btn.classList.add('editing');
            bar.style.display = 'flex';
            exportBtn.style.display = 'inline-block';
            const bp = document.getElementById('btn-paint');
            if (bp) bp.style.display = 'inline-block';
            document.getElementById('btn-password').style.display = 'inline-block';
            document.getElementById('btn-sync').style.display = 'inline-block';

            if (!getGitHubToken()) {
                const token = prompt(
                    '🔗 Conectar con GitHub\n\n' +
                    'Pega tu token de GitHub (Settings > Developer settings > Personal access tokens > Fine-grained tokens)\n' +
                    'Permisos necesarios: Contents (write)\n\n' +
                    'O deja vacío para saltar:'
                );
                if (token) {
                    setGitHubToken(token);
                    syncToGitHub();
                }
            }

            enableDragOnAll();
        } else {
            if (window.__cursorStop) window.__cursorStop();
            btn.textContent = '✏️ Editar';
            btn.classList.remove('editing');
            bar.style.display = 'none';
            exportBtn.style.display = 'none';
            const bp2 = document.getElementById('btn-paint');
            if (bp2) bp2.style.display = 'none';
            document.getElementById('btn-password').style.display = 'none';
            document.getElementById('btn-sync').style.display = 'none';
            document.getElementById('sync-status').style.display = 'none';
            if (paintMode) exitPaintMode();
            cancelPlacing();
            disableDragOnAll();
            closeModal();
        }

        // Refresh region panel if open
        if (activeRegion) {
            const region = data.regions.find(r => r.name === activeRegion);
            if (region) openRegionPanel(region);
        }
    }

    // ─── PLACING ───
    function onMapClick(e) {
        if (!placing) return;
        addNewMarker(e.latlng);
        cancelPlacing();
    }

    function startPlacing() {
        if (placing) { cancelPlacing(); return; }
        placing = true;
        const btn = document.getElementById('btn-add');
        btn.textContent = '✖ Cancelar';
        btn.classList.add('placing');
        map.getContainer().classList.add('map-placing');
        map.on('click', onMapClick);
    }

    function cancelPlacing() {
        if (!placing) return;
        placing = false;
        const btn = document.getElementById('btn-add');
        btn.textContent = '➕ Nueva ubicación';
        btn.classList.remove('placing');
        map.getContainer().classList.remove('map-placing');
        map.off('click', onMapClick);
    }

    function enableDragOnAll() {
        Object.values(markers).forEach(e => {
            e.marker.dragging?.enable();
            e.marker.off('click');
            e.marker.on('click', () => openEditModal(e.poi.id));
            e.marker.off('dragend');
            e.marker.on('dragend', () => {
                const pos = e.marker.getLatLng();
                e.poi.coords = [pos.lat, pos.lng];
                saveState();
            });
        });
    }

    function disableDragOnAll() {
        Object.values(markers).forEach(e => {
            e.marker.dragging?.disable();
            e.marker.off('click');
            e.marker.on('click', () => { if (e.poi.name) e.marker.openPopup(); });
        });
    }

    // ─── EVENTOS ───
    document.getElementById('btn-edit').addEventListener('click', toggleEditMode);
    document.getElementById('btn-add').addEventListener('click', startPlacing);
    const paintBtn = document.getElementById('btn-paint');
    if (paintBtn) {
        paintBtn.addEventListener('click', () => {
            if (paintMode) exitPaintMode();
            else enterPaintMode();
        });
    }
    document.getElementById('btn-password').addEventListener('click', () => {
        const old = prompt('Contraseña actual:');
        if (old !== data.editPassword) { alert('Incorrecta'); return; }
        const newPw = prompt('Nueva contraseña:');
        if (!newPw) return;
        const confirmPw = prompt('Confirma la nueva contraseña:');
        if (newPw !== confirmPw) { alert('No coinciden'); return; }
        data.editPassword = newPw;
        saveState();
        alert('Contraseña cambiada correctamente');
    });
    document.getElementById('btn-sync').addEventListener('click', () => {
        if (!getGitHubToken()) {
            const token = prompt('Pega tu token de GitHub:');
            if (token) setGitHubToken(token);
            else return;
        }
        syncToGitHub();
    });
    document.getElementById('btn-export').addEventListener('click', exportData);
    document.getElementById('btn-save').addEventListener('click', saveModal);
    document.getElementById('btn-cancel').addEventListener('click', closeModal);
    document.getElementById('btn-delete').addEventListener('click', deleteCurrent);
    document.getElementById('modal-close').addEventListener('click', closeModal);

    document.getElementById('btn-random-color').addEventListener('click', () => {
        const r = Math.floor(Math.random() * 200 + 55).toString(16).padStart(2, '0');
        const g = Math.floor(Math.random() * 200 + 55).toString(16).padStart(2, '0');
        const b = Math.floor(Math.random() * 200 + 55).toString(16).padStart(2, '0');
        document.getElementById('edit-color').value = '#' + r + g + b;
    });

    document.getElementById('modal-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closeModal(); cancelPlacing(); if (regionEditMode) toggleRegionEditMode(); }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
            if (paintMode) { e.preventDefault(); paintUndo(); }
            else if (regionEditMode) { e.preventDefault(); regionUndo(); }
        }
    });

    window.addEventListener('resize', () => map.invalidateSize());

    map.on('dragend', () => {
        if (editingId && markers[editingId]) {
            const pos = markers[editingId].marker.getLatLng();
            markers[editingId].poi.coords = [pos.lat, pos.lng];
            document.getElementById('edit-coords').value = JSON.stringify([pos.lat, pos.lng]);
        }
    });

    // ─── SUPABASE INIT ───
    loadFromSupabase().then(() => { setupRealtime(); });
})();
