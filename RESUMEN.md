# Resumen del proyecto — Editor de regiones en mapa interactivo

## Stack
- HTML + CSS + JS vanilla + Leaflet.js (CRS.Simple)
- Sin frameworks, sin librerías extra

## Archivos
- `index.html` — estructura
- `styles.css` — estilos
- `script.js` — toda la lógica
- `data.js` — datos de regiones (única fuente de verdad, `MAP_DATA.regions[]`)
- `Mapa-Figma.png` — imagen del mapa (4096×2389)

## Persistencia
- NO hay localStorage para regiones. Solo `data.js` → GitHub sync → Netlify.
- El botón ☁️ Sincronizar hace push a main y Netlify auto-deployea.
- Token de GitHub guardado en `localStorage` clave `mapa_rol_github_token`.
- Contraseña de edición: `1`.

## Sistema de coordenadas (CRS.Simple)
- `lat=0` está ABAJO de la imagen, `lat=2389` está ARRIBA (lat aumenta hacia arriba).
- SVG `Y=0` está ARRIBA, `Y=2389` está ABAJO (Y aumenta hacia abajo).
- **Al parsear SVG → CRS**: `lat = IMG_H - svgY` donde `IMG_H = 2389`.
- **Al guardar CRS → SVG**: `svgY = IMG_H - lat`.
- Mapa: `map.containerPointToLatLng(p)` devuelve `LatLng(lat, lng)` con la transformación CRS.Simple.

## Editor de fronteras (regiones)
### Abrir editor
- Botón 🗺️ Fronteras en el header → `toggleRegionEditMode()`.
- Muestra `#region-bar` con dropdown + botones.
- Desactiva hover, click, drag, zoom, teclado en el mapa.
- Muestra bordes de regiones existentes con `setRegionVisibility(true)`.
- Escape o volver a 🗺️ Fronteras sale del modo edición.

### Seleccionar región desde dropdown
- `loadRegionVerts(region)` → `parseRegionPath(region)` convierte SVG path a array de `{x, y}` en CRS.
- Muestra vértices como `L.marker` con `L.divIcon` (círculos blancos numerados).
- Muestra preview del polígono (`L.polygon`) semi-transparente rojo.
- Hace `map.fitBounds()` con `maxZoom: 1`.

### Crear nueva región desde cero
- Seleccionar "— Nueva región —" en el dropdown.
- Clic en el mapa vacío añade un vértice en esa posición.
- **Último vértice** resaltado en amarillo para saber cuál se puede arrastrar.
- **Línea de preview** discontinua roja desde el último vértice al mouse.
- Mínimo 3 vértices para guardar.

### Editar vértices existentes (arrastrar)
- Los `L.marker` tienen `draggable: true`.
- Al arrastrar: `marker.on('drag')` actualiza `regionVerts[i]` y `rebuildRegionPreview()`.
- Al terminar drag: se limpia la preview line.

### Eliminar un vértice (doble clic)
- `dblclick` en un vértice → `regionVerts.splice(i, 1)`.
- Mínimo 3 vértices (no deja borrar si quedan menos de 3).
- `stopPropagation()` en `mousedown` y `click` del marcador evita interferencias.

### Insertar vértice en borde
- Clic en el polígono rojo de preview → encuentra la arista más cercana con `distToSegment()`.
- Inserta el nuevo vértice entre los dos vértices de esa arista.

### Selección múltiple y borrado
- Botón 🟦 Seleccionar → `toggleSelectMode()`.
- Clic en cada vértice lo selecciona (fondo azul).
- Botón 🗑️ Borrar (N) → `deleteSelected()` elimina todos los seleccionados.
- Sale del modo selección automáticamente después de borrar.
- Clic en mapa vacío en modo selección → sale del modo selección.

### Guardar (botón 💾)
- `regionSave()`:
  1. Convierte `regionVerts` de CRS a SVG coords (`y = IMG_H - p.y`).
  2. Genera path SVG en formato relativo `M...L...Z`.
  3. Calcula `transform` (translate al minX/minY).
  4. Actualiza `data.regions` en memoria (modifica o agrega).
  5. Llama a `rebuildSvgOverlay()` para refrescar el SVG en el mapa.
  6. Pregunta si recargar para ver cambios.

### Rehacer SVG overlay
- `rebuildSvgOverlay()` reemplaza `L.svgOverlay` completo.
- Usa `svgOverlayRef` global para trackear y remover el anterior.

### Click en mapa para añadir vértices
- `onRegionMapClick()` con debounce de 400ms.
- `getImageCoords(e.containerPoint)` → `{x, y}` en CRS.
- Si está en modo selección: sale del modo selección (a menos que sea post-drag).

### Undo / Clear
- `regionUndo()`: saca el último vértice.
- `regionClear()`: limpia todo y vuelve al estado inicial.

### Funciones auxiliares
- `parseRegionPath(region)`: parser SVG path character-by-character (M/L/H/V/C/Q/Z absolutos y relativos).
- `distToSegment()`: calcula distancia punto-a-segmento para inserción en borde.
- `updateRegionUI()`: muestra/oculta botones según nº de vértices.
- `rebuildVertexMarkers()`: recrea todos los `L.marker` de vértices.
- `rebuildRegionPreview()`: recrea el `L.polygon` de preview.
- `updatePreviewLine()`: dibuja/limpia la línea discontinua al mouse.

## Conclusión importante sobre coordenadas
El SVG dentro de `L.svgOverlay` mantiene su propio sistema Y (0 arriba, 2389 abajo). Leaflet con CRS.Simple invierte Y (0 abajo, 2389 arriba). Toda conversión entre SVG y CRS usa `y = IMG_H - svgY` con `IMG_H = 2389`.
