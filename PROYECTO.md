# Mapa Interactivo de Rol

## Stack
- HTML + CSS + JavaScript vanilla en IIFE
- Leaflet.js con `L.CRS.Simple` (mapa de imágenes, no coordenadas reales)
- **Supabase** como backend: persistencia, tiempo real, multijugador
- Sin frameworks, sin bundlers

## Estructura
- `index.html` — layout, barras de herramientas, modal
- `styles.css` — todos los estilos
- `data.js` — configuración estática (bounds, zoom, categorías, password), **ya no contiene datos dinámicos**
- `supabase.js` — crea y exporta el cliente Supabase (`var sb = ...`)
- `script.js` — toda la lógica en una IIFE `(function(){ ... })()`
- `init.sql` — esquema original de tablas Supabase
- `migration.sql` — migraciones para adaptar tablas al frontend

## Supabase
- Proyecto: `rmfoquszgkuntfhlkhcd.supabase.co`
- Tablas: `regions`, `pois`, `paint`, `cursors` (todo con RLS público)
- Las tablas `regions`, `pois`, `paint`, `cursors` tienen Realtime habilitado
- Anon key en `supabase.js` (pública, segura por RLS)

### Flujo:
1. **script.js** crea `sbUpsert()`, `sbDelete()`, `sbSavePaint()` helpers
2. **loadFromSupabase()** se llama al inicio: fetchea regions, pois, paint de Supabase y reemplaza datos estáticos
3. **setupRealtime()** se suscribe a cambios en las 4 tablas; cualquier cambio → recarga datos automáticamente (tiempo real)
4. Cada edición (región, POI, pintura) escribe directo a Supabase, todos los clientes lo ven al instante

### Cursor tracking:
- En modo edición, cada mouse move envía coordenadas a `cursors` (throttle 80ms)
- Los demás ven círculos con tooltip del usuario
- Limpieza automática de cursores viejos (>5 segundos)

## Mapa
- Imagen de 4096×2389 px: `Mapa-Figma.png`
- Leaflet Simple CRS, bounds `[[0,0], [2389,4096]]`
- Zoom: min -2, max 3, inicial 0

## Sistema de Regiones (SVG Overlay)
- Cada región tiene: `name`, `path` (SVG path relativo), `transform` (translate), `color`, `description`, `extraPaths`
- Se renderizan con `L.svgOverlay` en un SVG con viewBox `0 0 4096 2389`
- `extraPaths`: paths adicionales del mismo país: `[{ d, transform, type: 'island'|'lake' }]`
- Lagos usan `<mask>` SVG (rectángulo blanco + lago en negro) para huecos en fill y stroke
- Bordes de lagos en grupo separado (sin máscara) con `data-lake-edge`, invisibles por defecto, se iluminan en hover
- Islas: same fill/stroke/hover que path principal
- Hover/click en `<g>` del país (no paths individuales): se ilumina el grupo completo

## Editor de Fronteras
- Botón "🗺️ Editar regiones" toggle
- Soporta multi-path: main + islas/lagos (sub-paths con píldoras de navegación)
- Undo por path activo (snapshot de vértices antes de cada mutación)
- Dropdown de selección de región existente

## Sistema de Pintura
- Offscreen canvas 4096×2389 + `L.imageOverlay`
- Herramientas: brush, eraser, fill, pipette
- Datos guardados en Supabase como array de strokes en una fila (`id=0, tool='_state'`)
- Se inicia automáticamente si hay pintura existente (aunque no se haya abierto el modo pintura)

## POIs (Puntos de Interés)
- Marcadores Leaflet con iconos según categoría
- Modal para crear/editar/eliminar en modo edición
- Se sincronizan a Supabase con UPSERT (por id)

## Estado actual
- ✅ Persistencia en Supabase (regiones, POIs, pintura)
- ✅ Tiempo real: cambios se ven en otros clientes sin recargar
- ✅ Cursores multijugador en modo edición
- ✅ Auto-inicialización de pintura desde Supabase
- ✅ Carga inicial desde Supabase (reemplaza data.js para datos dinámicos)

## Pendiente / Mejoras posibles
- Botón "Limpiar toda la pintura"
- Botón "Resetear regiones a original"
- Exportar/importar datos desde Supabase
- Mejor UI para el estado de conexión

## Cómo usarlo
1. Abrir `index.html` (local o desplegado)
2. Click "✏️ Editar" → password: `1`
3. Editar regiones, añadir POIs, pintar
4. Todo se guarda solo en Supabase

## Repo
- GitHub: `https://github.com/CarlosBarbaHerrador/mapa-interactivo-rol.git`
- Rama: `main`
