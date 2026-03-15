# Instrucciones Backend: Inventario del portal Farmacia

Resumen de endpoints y formato de datos para el inventario en el portal Farmacia.

---

## 1. GET /api/farmacia/inventario

- **Query:** `q` (búsqueda en servidor por código, descripción o marca), `page`, `page_size` (el frontend usa 50 por página).
- **Respuesta recomendada:** `{ "items": [ ... ], "total": N }` con solo la página pedida (no el listado completo), para que la carga sea rápida.
- Si el backend devuelve un array completo (sin paginación), el frontend sigue funcionando pero puede ir lento con muchos productos.
- Los filtros por columna (código, descripción, marca, etc.) se aplican en el **frontend** sobre la página actual; el backend no tiene que implementar esos filtros, solo `q`, `page` y `page_size`.

---

## 2. Campos de cada producto

Cada ítem en `items` (o en el array si no hay paginación) debe incluir los campos que usa el frontend:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| **id** | string \| null | ID del producto (null si solo está en catálogo, sin inventario en la farmacia). |
| **codigo** | string | Código de barras / EAN. |
| **descripcion** | string | Descripción del producto. |
| **marca** | string | Marca. |
| **categoria** | string \| null | Categoría/departamento. |
| **existencia** | number | Cantidad en stock en la farmacia. |
| **precio** | number | Precio base. |
| **descuentoPorcentaje** | number | Porcentaje de descuento (0–100). |
| **precioConPorcentaje** | number \| null | Precio final aplicando descuento. |
| **farmaciaId** | string | ID de la farmacia. |

**Opcionales (Plan Pro):**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| **existenciaGlobal** | number | Suma de existencias de ese código en todas las farmacias. |
| **productosSolicitados** | number | Cantidad de solicitudes de clientes para ese código. |

El backend puede incluir además campos como `imagen`, `descripcionCatalogo`, `descripcionPersonalizada`, `usarDescripcionCatalogo`, `principioActivo`, `presentacion`, etc., si el frontend los utiliza.

---

## 3. PATCH /api/farmacia/inventario/descuentos

- **Body:** array de objetos `{ id, descuentoPorcentaje }` para guardar los descuentos editados en la tabla.
  - **id:** ID del producto (MongoDB ObjectId como string).
  - **descuentoPorcentaje:** número (0–100).
- El backend valida que cada `id` corresponda a un producto de la farmacia del usuario y actualiza `descuentoPorcentaje` y el precio resultante (`precioConPorcentaje`).

---

## 4. Carga por Excel

- **POST** a **/api/farmacias/:farmaciaId/inventario/cargar-excel** (o la ruta equivalente en tu API).
- **Content-Type:** multipart con campo `file` (archivo Excel).
- Comportamiento: igual que hoy (procesar filas, vincular catálogo, conflictos de descripción, etc.). No cambia con respecto a la implementación actual.

---

## 5. Resumen de endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/farmacia/inventario` | Inventario paginado; query `q`, `page`, `page_size`; respuesta `{ items, total }`. |
| PATCH | `/api/farmacia/inventario/descuentos` | Actualizar descuentos; body: array de `{ id, descuentoPorcentaje }`. |
| POST | `/api/farmacias/:farmaciaId/inventario/cargar-excel` | Carga masiva por Excel (multipart `file`). |

Los filtros por columna se aplican en el frontend sobre la página actual; el backend solo ofrece búsqueda `q` y paginación.
