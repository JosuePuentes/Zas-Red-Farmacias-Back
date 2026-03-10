# Instrucciones para la IA del Backend — Zas Red Farmacias

Proyecto: **Zas Red Farmacias** (backend Node/Express). El frontend sigue `INSTRUCCIONES_FRONTEND_IA.md`. Este documento es la referencia para la IA que modifica el backend. Si trabajas desde el repo del frontend, copia este contenido al chat para que la IA del backend lo tenga.

---

## Prompt para pegar a la IA del backend

```
Proyecto: Zas Red Farmacias (backend Node). El frontend ya está implementado según INSTRUCCIONES_FRONTEND_IA.md.
Sigue el archivo INSTRUCCIONES_BACKEND_IA.md (está en el repo del backend; copia su contenido aquí si no tienes acceso). En resumen:
1. Inventario: match por código de barras con catalogo_maestro; conflictos de descripción y resolver-descripciones.
2. Catálogo: GET /api/cliente/catalogo con q, page, page_size, lat/lng opcional; respuesta con items y total.
3. Delivery: GET /api/cliente/delivery/estimado devuelve { costo }; evitar que delivery sea más caro que los productos.
4. Carrito y auth: mantener POST /carrito/agregar, cambiar-farmacia según lo documentado en el frontend.
```

---

## 1. Inventario (farmacia)

- **POST /api/farmacia/inventario/upload** (FormData `archivo` Excel): hace match del código de barras del Excel con `catalogo_maestro.ean_13` (colección en base `Zas`). Vincula automáticamente imagen (`foto`) y descripción/marca del catálogo. Si la descripción del Excel difiere de la del catálogo, incluir ese producto en **conflictosDescripcion**.
- **Respuesta:** `{ message, creados, actualizados, vinculadosCatalogo, conflictosDescripcion }`. `conflictosDescripcion` es un array de `{ codigo, descripcionSistema, descripcionArchivo }`.
- **POST /api/farmacia/inventario/resolver-descripciones**: body `{ decisiones: [ { codigo, usar: 'catalogo' | 'farmacia' } ] }`. Actualiza cada producto para usar la descripción del sistema (catalogo) o la del archivo (farmacia).
- **Modelo Producto:** incluir `descripcionCatalogo`, `descripcionPersonalizada`, `usarDescripcionCatalogo`. La descripción mostrada es la que corresponda según `usarDescripcionCatalogo`.

---

## 2. Catálogo (cliente)

- **GET /api/cliente/catalogo**: query `estado`, `farmaciaId`, `q` (búsqueda texto), `page`, `page_size`, `lat`, `lng` (opcionales, para futuro orden por cercanía). Respuesta: `{ items, page, page_size, total }`. Cada item tiene id, codigo, descripcion, marca, precio, descuentoPorcentaje, precioConPorcentaje, imagen, farmaciaId, existencia. No exponer nombre de farmacia al cliente.
- Devolver ofertas por producto/comercio (varias filas por mismo producto si hay varias farmacias); el frontend puede mostrar el mejor precio y "Otros comercios".

---

## 3. Delivery estimado

- **GET /api/cliente/delivery/estimado**: query opcional `lat`, `lng`. Respuesta: `{ costo: number }`. Calcular según carrito actual y número de farmacias; **evitar que el costo de delivery sea mayor que el subtotal de los productos** (por ejemplo limitar a un % del subtotal o al mínimo entre costo calculado y subtotal).

---

## 4. Carrito y auth

- Mantener **POST /api/cliente/carrito** (agregar), **PATCH/DELETE** carrito, y lógica de **cambiar-farmacia** si está documentada en el frontend (carrito anclado a una farmacia; si el cliente agrega producto de otra farmacia, ofrecer cambiar todo el carrito).
- Auth: login único, roles master/farmacia/cliente/delivery, token JWT en header `Authorization: Bearer <token>`.

---

## 5. Base de datos

- **catalogo_maestro** está en la base **Zas** (o la que indique `MONGO_DB_CATALOGO`). Usar `mongoose.connection.useDb('Zas').collection('catalogo_maestro')` para el match por `ean_13`.
- Productos de inventario (farmacia) en la base por defecto del backend, modelo **Producto** con `farmaciaId`, `codigo`, `descripcion`, `descripcionCatalogo`, `descripcionPersonalizada`, `usarDescripcionCatalogo`, `foto`, etc.

---

## 6. Reglas para la IA del backend

1. No eliminar ni cambiar rutas o campos que el frontend ya use según `INSTRUCCIONES_FRONTEND_IA.md`.
2. Añadir solo endpoints y campos documentados; mantener compatibilidad con la respuesta esperada por el frontend.
3. Inventario: siempre hacer match por código de barras con `catalogo_maestro`; devolver conflictos de descripción cuando Excel y catálogo difieran.
4. Catálogo: respuesta paginada `{ items, page, page_size, total }`; soportar `q`, `page`, `page_size`.
5. Delivery estimado: devolver `{ costo }` y asegurar que el costo no supere el subtotal del carrito.

Con esto el backend permanece alineado con el frontend.
