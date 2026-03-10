# Instrucciones para el frontend: Plan Full – Proveedores, lista comparativa, inventario extendido y solicitud de producto

Todas las rutas requieren **Authorization: Bearer &lt;token&gt;**. Rutas de farmacia con Plan Full requieren que la farmacia tenga `planProActivo: true` (si no, el backend responde 403).

---

## 1. Portal farmacia – Plan Full: Proveedores

Solo visible/habilitado si la farmacia tiene Plan Full activo. Comprobar con `GET /api/farmacia/plan-pro/estado` → `{ activo: true }`.

### CRUD Proveedores

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/farmacia/proveedores` | Lista de proveedores de la farmacia. |
| POST | `/api/farmacia/proveedores` | Crear proveedor. |
| PATCH | `/api/farmacia/proveedores/:id` | Actualizar proveedor. |
| DELETE | `/api/farmacia/proveedores/:id` | Eliminar proveedor. |

**Body POST /api/farmacia/proveedores**

```json
{
  "rif": "J-12345678-9",
  "nombreProveedor": "Distribuidora XYZ",
  "telefono": "04141234567",
  "nombreAsesorVentas": "Juan Pérez",
  "direccion": "Av. Principal 123",
  "condicionesComercialesPct": 5,
  "prontoPagoPct": 2
}
```

- **Obligatorios:** `rif`, `nombreProveedor`, `telefono`.
- **Opcionales:** `nombreAsesorVentas`, `direccion`, `condicionesComercialesPct`, `prontoPagoPct` (porcentajes numéricos).

**Body PATCH**  
Mismos campos; solo se envían los que se quieren actualizar.

**Respuesta GET**  
Array de objetos con: `_id`, `farmaciaId`, `rif`, `nombreProveedor`, `telefono`, `nombreAsesorVentas`, `direccion`, `condicionesComercialesPct`, `prontoPagoPct`, `createdAt`, `updatedAt`.

---

## 2. Lista de precios por proveedor (Excel)

Solo Plan Full.

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/farmacia/proveedores/lista-precio` | Subir Excel de lista de precios y asociarla a un proveedor. |

**Request:** `multipart/form-data`  
- `archivo`: archivo Excel.  
- `proveedorId`: ID del proveedor al que pertenece la lista.

**Columnas del Excel:** `codigo`, `descripcion`, `marca`, `precio`, `existencia` (nombres en mayúscula/minúscula aceptados).

**Respuesta:**  
`{ message: 'Lista de precios cargada', insertados, actualizados }`

---

## 3. Lista comparativa (todos los proveedores, mejor precio primero)

Solo Plan Full.

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/farmacia/proveedores/lista-comparativa` | Productos de todos los proveedores de la farmacia, agrupados por código, ordenados por mejor precio. |

**Respuesta**

```json
[
  {
    "codigo": "7501055314105",
    "descripcion": "Acetaminofén 500mg",
    "marca": "Genérico",
    "mejorPrecio": 1.2,
    "proveedorMejorPrecio": "Proveedor A",
    "ofertas": [
      {
        "proveedorId": "...",
        "nombreProveedor": "Proveedor A",
        "rif": "J-111",
        "precio": 1.2,
        "existencia": 100
      },
      {
        "proveedorId": "...",
        "nombreProveedor": "Proveedor B",
        "rif": "J-222",
        "precio": 1.35,
        "existencia": 50
      }
    ]
  }
]
```

- En la lista principal mostrar al menos: código, descripción, marca, mejor precio, proveedor del mejor precio.
- En “Ver más” / detalle: mostrar `ofertas` (todos los proveedores que tienen el producto con precio y existencia).

---

## 4. Inventario con columnas Plan Full (existencia global y productos solicitados)

Solo si la farmacia tiene Plan Full, el backend añade dos campos más a cada ítem del inventario.

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/farmacia/inventario` | Inventario de la farmacia. Si Plan Full: cada ítem incluye `existenciaGlobal` y `productosSolicitados`. |

**Respuesta (cada ítem)**  
Mismos campos que antes (id, codigo, descripcion, precio, existencia, etc.).  
Si Plan Full, además:

- **existenciaGlobal:** suma de `existencia` de todos los productos con el mismo `codigo` en todas las farmacias (solo el número, sin indicar dónde).
- **productosSolicitados:** número de veces que clientes han hecho “Solicitar producto” para ese código (cada click = 1 solicitud).

En la tabla de inventario del portal farmacia (Plan Full) se pueden añadir dos columnas: “Existencia global” y “Productos solicitados”.

---

## 5. Portal cliente – Solicitar producto (cuando no hay stock)

Para productos del catálogo que no tienen stock en ninguna farmacia, el cliente puede hacer click en “Solicitar producto”. El backend aplica un límite de **1 solicitud por producto cada 7 días** por cliente.

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/cliente/solicitar-producto` | Registrar solicitud de un producto por código. |

**Body**

```json
{
  "codigo": "7501055314105"
}
```

**Reglas en backend**

- Si existe algún producto con ese `codigo` y `existencia > 0`, responde **400** con mensaje tipo: “Este producto ya está disponible. Puedes agregarlo al carrito.”
- Si el cliente ya solicitó ese `codigo` en los últimos 7 días, responde **400** con:
  - `error`: “Ya solicitaste este producto recientemente. Podrás volver a solicitarlo en 7 días.”
  - `proximaDisponible`: fecha/hora (ISO) a partir de la cual puede volver a solicitar.

**Respuesta 201**  
`{ message: 'Solicitud registrada. Te avisaremos cuando esté disponible.' }`

**Flujo en el frontend**

- En el catálogo, para ítems sin stock (existencia 0 o no disponible): mostrar botón “Solicitar producto”.
- Al hacer click: `POST /api/cliente/solicitar-producto` con `codigo` del producto.
- Si 400 con `proximaDisponible`: mostrar mensaje y deshabilitar el botón hasta esa fecha (o mostrar “Podrás solicitar de nuevo el dd/mm”).
- Si 201: mostrar mensaje de confirmación y deshabilitar el botón para ese producto 7 días (opcionalmente guardar en estado local la fecha de próximo permitido).

---

## 6. Notificación cuando el producto solicitado está disponible

**Backend (ya implementado)**  
Cuando se carga o actualiza inventario (Excel) y algún producto con ese `codigo` pasa a tener `existencia > 0` en alguna farmacia, el backend:

- Busca solicitudes de clientes para ese `codigo` que aún no hayan sido notificadas.
- Crea una notificación para cada cliente con `tipo: 'producto_solicitado_disponible'` y mensaje con nombre del producto y precio desde el que está disponible.
- Marca esas solicitudes como notificadas para no repetir.

**Frontend**  
No hay endpoint nuevo. El cliente sigue usando la lista de notificaciones existente (`GET /api/notificaciones` o el que usen). Mostrar las notificaciones con `tipo === 'producto_solicitado_disponible'` igual que el resto (ej. en campana o panel de notificaciones), con el mensaje que envía el backend.

---

## 7. Resumen de endpoints nuevos / modificados

| Método | Ruta | Quién | Notas |
|--------|------|--------|--------|
| GET | `/api/farmacia/proveedores` | Farmacia | Plan Full |
| POST | `/api/farmacia/proveedores` | Farmacia | Plan Full |
| PATCH | `/api/farmacia/proveedores/:id` | Farmacia | Plan Full |
| DELETE | `/api/farmacia/proveedores/:id` | Farmacia | Plan Full |
| POST | `/api/farmacia/proveedores/lista-precio` | Farmacia | Plan Full, multipart archivo + proveedorId |
| GET | `/api/farmacia/proveedores/lista-comparativa` | Farmacia | Plan Full |
| GET | `/api/farmacia/inventario` | Farmacia | Si Plan Full: items con existenciaGlobal y productosSolicitados |
| POST | `/api/cliente/solicitar-producto` | Cliente | Body: { codigo } |

Notificaciones de “producto disponible” se reciben por el flujo normal de notificaciones (`tipo: 'producto_solicitado_disponible'`).
