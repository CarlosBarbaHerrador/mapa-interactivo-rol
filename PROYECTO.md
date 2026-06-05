# Mapa Interactivo de Rol

## Stack
- HTML + CSS + JavaScript vanilla en IIFE
- Leaflet.js con `L.CRS.Simple` (mapa de imágenes, no coordenadas reales)
- Sin frameworks, sin bundlers

## Estructura
- `index.html` — layout, barras de herramientas, modal
- `styles.css` — todos los estilos
- `data.js` — **variable global `MAP_DATA`** con toda la configuración: bounds, zoom, categorías, regiones, POIs, password
- `script.js` — toda la lógica en una IIFE `(function(){ ... })()`

## Mapa
- Imagen de 4096×2389 px: `Mapa-Figma.png`
- Leaflet Simple CRS, bounds `[[0,0], [2389,4096]]`
- Zoom: min -2, max 3, inicial 0

## Sistema de Regiones (SVG Overlay)
- Cada región tiene: `name`, `path` (SVG path relativo), `transform` (translate), `color`, `description`, `extraPaths`
- Las regiones se renderizan con `L.svgOverlay` en un SVG con viewBox `0 0 4096 2389`
- `extraPaths` son paths adicionales del mismo país: `[{ d, transform, type: 'island'|'lake' }]`
- Los **lagos** usan un `<mask>` SVG (rectángulo blanco + lago en negro) para hacer huecos en fill y stroke
- Los bordes de lagos están en un grupo separado (sin máscara) con `data-lake-edge`, invisibles por defecto, se iluminan en hover
- Las **islas** son paths adicionales con el mismo fill/stroke/hover que el path principal
- Hover/click en el `<g>` del país (no en paths individuales): al hover se ilumina todo el grupo (continente + islas + bordes de lago)

### Funciones clave:
- `createRegionSvg(svgNS, region)` — crea el `<g>` con paths, máscara de lagos, bordes de lagos y eventos hover/click
- `initRegions()` — crea el SVG overlay inicial
- `rebuildSvgOverlay()` — destruye y reconstruye el SVG overlay (tras guardar cambios)
- `setRegionVisibility(visible)` — `true` = oculta, `false` = muestra (usado en editor)
- `openRegionPanel(region)` / `closeRegionPanel()` — panel lateral de región (desc, color)
- `saveRegionEdit()` — guarda desc/color del panel
- `setHoverState(state)` / `setClickState(state)` — toggle interactividad

## Editor de Fronteras
- Botón "Editar fronteras" en `#edit-bar` → `toggleRegionEditMode()`
- Al entrar: se ocultan los overlays SVG (`setRegionVisibility(true)`), se muestra `#region-bar`, se desactiva drag/zoom del mapa
- Al salir: se restauran overlays, drag/zoom, se limpian vectores

### Variables de estado:
- `regionVerts` — vértices del path principal (activo cuando `_activeSubIdx === -1`)
- `_subPaths` — array de `{ verts: [], type: 'island'|'lake' }`
- `_activeSubIdx` — -1 = main, ≥0 = índice en `_subPaths`
- `_subPolygons` — preview de sub-paths no activos (Leaflet polygons)
- `_regionUndoStack` — historial de undo por path activo

### Funciones del editor:
- `onRegionMapClick(e)` — añade vértice al path activo
- `rebuildVertexMarkers()` — renderiza marcadores Leaflet para vértices activos
- `rebuildRegionPreview()` — renderiza polígono del path activo + `rebuildSubPolygons()`
- `regionUndo()` — deshace último cambio del path activo
- `regionClear()` — limpia todo (verts, sub-paths, undo)
- `regionSave()` — serializa main + sub-paths a `extraPaths`, reconstruye overlay, sale del editor
- `loadRegionVerts(region)` — carga región existente incluyendo `extraPaths`
- `startSubPath(type)` — empieza a dibujar isla/lago
- `switchToMainPath()` — vuelve a editar path principal
- `updatePathNav()` — muestra píldoras para navegar entre paths
- `toggleSelectMode()` / `deleteSelected()` — selección múltiple y borrado de vértices
- `vertsToSvgPath(verts)` — convierte vértices a SVG path D + transform
- `parseRegionPath(region)` / `parseSubPathVerts(d, transform)` — parsea SVG path a array de vértices

### Botones en `#region-bar`:
- Select de región (`#rb-region-select`)
- `#rb-undo`, `#rb-clear`, `#rb-save`, `#rb-select`, `#rb-delete-selected`
- `#rb-add-island`, `#rb-add-lake` (visibles cuando main tiene ≥3 vértices)
- `#rb-main` (visible cuando se está editando un sub-path)
- `#rb-path-nav` — píldoras de navegación entre sub-paths
- `#rb-status` — barra de estado

## Sistema de Pintura
- Offscreen canvas 4096×2389 + `L.imageOverlay` para mostrar pintura
- `tempCanvas` encima del mapa para previsualización del trazo en tiempo real
- Herramientas: brush, eraser, fill (relleno por región vectorial), pipette
- Fill: usa `Path2D` + `isPointInPath` sobre los paths SVG de las regiones
- Pipette: lee del canvas de pintura, si es transparente lee del `<img>` de Leaflet
- Undo: guarda historial de strokes, replay al deshacer
- Ctrl+Z: en modo pintura → `paintUndo()`, en modo editor → `regionUndo()`

## POIs (Puntos de Interés)
- Array `data.pois` con objetos: `{ name, category, coords: [lat,lng], description, links }`
- Marcadores Leaflet con iconos según categoría
- Modal para crear/editar (con password `data.editPassword`)

## Constantes
- `BOUNDARY_STROKE = 'none'` — sin línea negra permanente
- `BOUNDARY_WIDTH = '0'`
- Las líneas de borde solo se ven en hover/panel (color de la región)

## Datos (data.js)
Se guarda en MAP_DATA. Actualmente hay 1 región de ejemplo (Masenvour) con 1 lago. POIs vacío. Password = "1".
