(function () {
    const data = MAP_DATA;

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

    // ─── PERSISTENCIA DE REGIONES ───
    const REGION_STORAGE_KEY = 'mapa_rol_regions';

    function saveRegionsState() {
        try {
            const saved = data.regions.map(r => ({
                name: r.name, description: r.description,
                color: r.color, path: r.path, transform: r.transform
            }));
            localStorage.setItem(REGION_STORAGE_KEY, JSON.stringify(saved));
        } catch (e) {}
    }

    function loadRegionsData() {
        try {
            const raw = localStorage.getItem(REGION_STORAGE_KEY);
            if (!raw) return;
            const saved = JSON.parse(raw);
            saved.forEach(sr => {
                const match = data.regions.find(r => r.name === sr.name);
                if (match) {
                    if (sr.description !== undefined) match.description = sr.description;
                    if (sr.color !== undefined) match.color = sr.color;
                }
            });
        } catch (e) {}
    }

    loadRegionsData();

    // ─── REGIONES (SVG overlay) ───
    function initRegions() {
        if (!data.regions || data.regions.length === 0) return;

        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('viewBox', '0 0 2048 1382');
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
            const path = document.createElementNS(svgNS, 'path');
            path.setAttribute('d', region.path);
            if (region.transform) {
                path.setAttribute('transform', region.transform);
            }
            path.setAttribute('data-region', region.name);
            path.setAttribute('fill', region.color ? region.color + '30' : 'rgba(233,69,96,0.15)');
            path.setAttribute('stroke', 'rgba(255,255,255,0.5)');
            path.setAttribute('stroke-width', '2');
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('stroke-linejoin', 'round');
            path.style.pointerEvents = 'auto';
            path.style.cursor = 'pointer';
            path.style.transition = 'all 0.2s ease';

            path.addEventListener('mouseenter', () => {
                path.setAttribute('stroke', region.color || '#e94560');
                path.setAttribute('stroke-width', '4');
                path.setAttribute('fill', (region.color || '#e94560') + '60');
                path.setAttribute('filter', 'url(#region-glow)');
            });

            path.addEventListener('mouseleave', () => {
                if (activeRegion !== region.name) {
                    path.setAttribute('stroke', 'rgba(255,255,255,0.5)');
                    path.setAttribute('stroke-width', '2');
                    path.setAttribute('fill', (region.color || '#e94560') + '30');
                    path.removeAttribute('filter');
                }
            });

            path.addEventListener('click', (e) => {
                e.stopPropagation();
                openRegionPanel(region);
            });

            svg.appendChild(path);
        });

        const overlay = L.svgOverlay(svg, data.bounds, { interactive: false });
        overlay.addTo(map);
    }

    initRegions();

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
            document.getElementById('region-edit-desc').value = region.description || '';
            document.getElementById('region-edit-color').value = region.color || '#e94560';
            document.getElementById('region-edit-save').dataset.regionName = region.name;
        }

        document.getElementById('region-panel').className = 'region-panel-open';

        // Reset all regions first
        data.regions.forEach(r => {
            const p = document.querySelector(`[data-region="${r.name}"]`);
            if (!p) return;
            p.setAttribute('stroke', 'rgba(255,255,255,0.5)');
            p.setAttribute('stroke-width', '2');
            p.setAttribute('fill', (r.color || '#e94560') + '30');
            p.removeAttribute('filter');
        });
        // Highlight selected
        const sel = document.querySelector(`[data-region="${region.name}"]`);
        if (sel) {
            sel.setAttribute('stroke', region.color || '#e94560');
            sel.setAttribute('stroke-width', '4');
            sel.setAttribute('fill', (region.color || '#e94560') + '60');
            sel.setAttribute('filter', 'url(#region-glow)');
        }
    }

    function saveRegionEdit() {
        const name = document.getElementById('region-edit-save').dataset.regionName;
        if (!name) return;
        const region = data.regions.find(r => r.name === name);
        if (!region) return;

        const desc = document.getElementById('region-edit-desc').value.trim();
        const color = document.getElementById('region-edit-color').value;

        region.description = desc;
        region.color = color;

        // Update path visuals
        const path = document.querySelector(`[data-region="${name}"]`);
        if (path) {
            path.setAttribute('stroke', color);
            path.setAttribute('fill', color + '60');
            path.setAttribute('stroke-width', '4');
            path.setAttribute('filter', 'url(#region-glow)');
        }

        document.getElementById('region-panel-desc').textContent = desc;
        saveRegionsState();
    }

    function closeRegionPanel() {
        activeRegion = null;
        document.getElementById('region-panel').className = 'region-panel-closed';
        data.regions.forEach(r => {
            const path = document.querySelector(`[data-region="${r.name}"]`);
            if (!path) return;
            path.setAttribute('stroke', 'rgba(255,255,255,0.5)');
            path.setAttribute('stroke-width', '2');
            path.setAttribute('fill', (r.color || '#e94560') + '30');
            path.removeAttribute('filter');
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
            btn.textContent = '👁️ Ver';
            btn.classList.add('editing');
            bar.style.display = 'flex';
            exportBtn.style.display = 'inline-block';
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
            btn.textContent = '✏️ Editar';
            btn.classList.remove('editing');
            bar.style.display = 'none';
            exportBtn.style.display = 'none';
            document.getElementById('btn-password').style.display = 'none';
            document.getElementById('btn-sync').style.display = 'none';
            document.getElementById('sync-status').style.display = 'none';
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
        if (e.key === 'Escape') { closeModal(); cancelPlacing(); }
    });

    window.addEventListener('resize', () => map.invalidateSize());

    map.on('dragend', () => {
        if (editingId && markers[editingId]) {
            const pos = markers[editingId].marker.getLatLng();
            markers[editingId].poi.coords = [pos.lat, pos.lng];
            document.getElementById('edit-coords').value = JSON.stringify([pos.lat, pos.lng]);
        }
    });

})();
