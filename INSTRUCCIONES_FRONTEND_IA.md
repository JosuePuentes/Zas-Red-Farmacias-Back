# Instrucciones para la IA del Frontend — Zas Red Farmacias

Este documento mantiene sincronizado el frontend con el backend. **La IA del frontend debe aplicar estas instrucciones al pie de la letra para estar sincronizada con el backend.**

---

## Prompt para pegar a la IA del frontend

Copia y pega esto al inicio del chat con la IA del frontend cuando trabajes en este proyecto:

```
Proyecto: Zas Red Farmacias. Backend en Node (Express) desplegado en https://zas-red-farmacias-back.onrender.com.
Debes seguir SIEMPRE el archivo INSTRUCCIONES_FRONTEND_IA.md de este repositorio (o el que me proporcione el usuario) para:
- Base URL del API (producción: https://zas-red-farmacias-back.onrender.com/api)
- Login único por rol (master/farmacia/cliente/delivery) y redirección
- Formato de catálogo, carrito, checkout, inventario farmacia y BCV
- No inventar endpoints ni campos; usar solo los documentados.
```

---

## Base URL y autenticación

- **API base (desarrollo):** `http://localhost:4000/api`
- **API base (producción):** `https://zas-red-farmacias-back.onrender.com/api`
- **Variable de entorno recomendada:** `VITE_API_URL` (ej. `https://zas-red-farmacias-back.onrender.com`). Todas las peticiones: `${VITE_API_URL}/api/...`.
- **Proxy Vite (solo desarrollo):** En `vite.config.js`:
  ```js
  proxy: {
    '/api': { target: 'http://localhost:4000', changeOrigin: true },
    '/uploads': { target: 'http://localhost:4000', changeOrigin: true },
  }
  ```
- **Autenticación:** Rutas protegidas llevan el header:
  ```http
  Authorization: Bearer <token>
  ```
- **Token:** Obtener con `POST /api/auth/login` o `POST /api/auth/register/cliente`. Guardar en `localStorage` (clave `token`) y enviarlo en cada petición que requiera auth.

---

## Login único y roles

- **Un solo login:** `POST /api/auth/login` con `{ email, password }`.
- **Respuesta:** `{ token, user: { _id, email, role, nombre, farmaciaId?, fotoCarnet?, deliveryAprobado?, activoRecepcionPedidos? } }`.
- **Roles:** `master` | `farmacia` | `cliente` | `delivery`.
- **Redirección según rol:**
  - `master` → `/admin`
  - `farmacia` → `/farmacia`
  - `cliente` → `/cliente`
  - `delivery` → `/delivery`

No mostrar texto del tipo “¿Eres cliente o farmacia?”; solo correo y contraseña. El backend devuelve el rol y el frontend redirige al panel correspondiente.

---

## Tasa BCV (precios en $ y Bolívares)

- **Tasa BCV:** La define solo el **usuario master** en Admin → Tasa BCV. El backend la guarda en configuración.
- **Obtener tasa (público):** `GET /api/config` → `{ bcv: number }`.
- **Actualizar tasa (solo master):** `PUT /api/config/bcv` con `{ valor: number }`. Requiere token master.
- **Uso en UI:** En toda la app mostrar precios así:
  - **Arriba:** precio en USD, ej. `$10.00`
  - **Debajo:** precio en Bolívares, ej. `Bs. 360.00` (precio × BCV).
- **En headers:** En los layouts de **cliente**, **farmacia** y **delivery** mostrar arriba a la derecha: `BCV: XX.XX Bs/$` (solo lectura; la actualiza el master).

---

## Endpoints por módulo

### Auth (público / autenticado)
| Método | Ruta | Body | Respuesta / Notas |
|--------|------|------|-------------------|
| POST | `/api/auth/login` | `{ email, password }` | `{ token, user }` |
| POST | `/api/auth/register/cliente` | `{ email, password, cedula, nombre, apellido, direccion, telefono? }` | `{ token, user }` |
| GET | `/api/auth/me` | — | Usuario actual (requiere token) |

### Config (BCV)
| Método | Ruta | Body | Respuesta / Notas |
|--------|------|------|-------------------|
| GET | `/api/config` | — | `{ bcv: number }` (público) |
| PUT | `/api/config/bcv` | `{ valor: number }` | `{ bcv }` (solo master) |

### Master (todas requieren token master)
| Método | Ruta | Body | Notas |
|--------|------|------|--------|
| GET | `/api/master/usuarios` | — | Lista usuarios (sin master) con tipo |
| POST | `/api/master/farmacias` | Ver abajo | Crea usuario farmacia + registro Farmacia |
| GET | `/api/master/solicitudes-delivery` | — | Solicitudes pendientes |
| POST | `/api/master/solicitudes-delivery/:id/aprobar` | `{ password }` | Crea User delivery, asigna contraseña |
| POST | `/api/master/solicitudes-delivery/:id/denegar` | — | Deniega solicitud |
| GET | `/api/master/pedidos` | — | Todos los pedidos |

Body crear farmacia: `{ email, password, nombreFarmacia, rif, gerenteEncargado, direccion, telefono, estado, porcentajePrecio }`. `estado` = uno de los estados de Venezuela (lista en backend `constants/estados.js`).

### Farmacia (token farmacia)
| Método | Ruta | Body / Form | Notas |
|--------|------|-------------|--------|
| GET | `/api/farmacia/dashboard` | — | `totalVendido`, `totalProductosVendidos`, `totalClientes`, `pedidosPendientes` |
| GET | `/api/farmacia/pedidos` | — | `{ pedidos, totalPendientes }` |
| POST | `/api/farmacia/pedidos/:id/validar` | — | Aprueba pedido |
| POST | `/api/farmacia/pedidos/:id/denegar` | — | Rechaza pedido |
| POST | `/api/farmacia/inventario/upload` | FormData `archivo` (Excel) | Columnas: codigo, descripcion, marca, precio, existencia |
| GET | `/api/farmacia/productos` | — | Productos de la farmacia |

### Cliente (token cliente)
| Método | Ruta | Query / Body | Notas |
|--------|------|--------------|--------|
| GET | `/api/cliente/productos` | `?estado=&q=` | Catálogo; filtro por estado y búsqueda por texto |
| GET | `/api/cliente/catalogo` | `?estado=&farmaciaId=` | Catálogo con precios y descuentos; opcional filtrar por farmacia |
| GET | `/api/cliente/estados` | — | Lista estados Venezuela |
| GET | `/api/cliente/carrito` | — | Items con producto poblado |
| POST | `/api/cliente/carrito` | `{ productoId, cantidad }` | Agregar al carrito |
| PATCH | `/api/cliente/carrito/:productoId` | `{ cantidad }` | Actualizar cantidad |
| DELETE | `/api/cliente/carrito/:productoId` | — | Quitar del carrito |
| GET | `/api/cliente/checkout/resumen` | — | `{ subtotal, costoDelivery, total, numFarmacias, direccion }` |
| POST | `/api/cliente/checkout/procesar` | FormData: `metodoPago`, `comprobante` (archivo) | Crea pedido(s), vacía carrito |
| PATCH | `/api/cliente/ubicacion` | `{ lat, lng }` | GPS del cliente |
| GET | `/api/cliente/mis-pedidos` | — | Pedidos del cliente |

**Formato respuesta GET /api/cliente/catalogo:** Array de objetos:
- `id` (string), `codigo`, `descripcion`, `principioActivo`, `presentacion`, `marca`, `categoria`
- `precio` (number), `descuentoPorcentaje` (number), `precioConPorcentaje` (number)
- `imagen` (string, ruta o URL; puede ser null)
- `farmaciaId` (string, ID; no mostrar nombre de farmacia al cliente)
- `existencia` (number). Si es 0, no permitir agregar al carrito; mostrar "Sin stock".

**Formato respuesta GET /api/cliente/productos:** Array de objetos con `_id`, `codigo`, `descripcion`, `marca`, `categoria`, `precio`, `existencia`, `foto`, `farmaciaId`, `estadoFarmacia`. Misma regla: no mostrar nombre de farmacia; si `existencia === 0`, mostrar "Sin stock" y deshabilitar agregar al carrito.

### Delivery (token delivery)
| Método | Ruta | Body | Notas |
|--------|------|------|--------|
| PATCH | `/api/delivery/activo` | `{ activo: boolean }` | Activar/desactivar recepción de pedidos |
| GET | `/api/delivery/pedidos-disponibles` | — | Pedidos validados sin asignar |
| POST | `/api/delivery/pedidos/:id/aceptar` | — | Aceptar pedido (límite 1 min) |
| GET | `/api/delivery/mis-pedidos` | — | Pedidos asignados al delivery |
| PATCH | `/api/delivery/pedidos/:id/estado` | `{ estado: 'en_camino' \| 'entregado' }` | Actualizar estado |
| GET | `/api/delivery/estadisticas` | — | `totalGanado`, `totalKm`, `totalPedidos` |

### Solicitud delivery (público, sin token)
| Método | Ruta | Body / Form | Notas |
|--------|------|-------------|--------|
| POST | `/api/solicitud-delivery` | FormData: correo, tipoVehiculo (moto/carro), cedula, nombreCompleto, direccion, telefono, numeroLicencia, fotoLicencia, carnetCirculacion, fotoCarnet (archivos) | Envía solicitud; master aprueba/deniega |

### Notificaciones (token)
| Método | Ruta | Notas |
|--------|------|--------|
| GET | `/api/notificaciones` | Lista notificaciones del usuario |
| PATCH | `/api/notificaciones/:id/leer` | Marcar como leída |

---

## Archivos estáticos

- **Subidas:** Comprobantes e imágenes se sirven en `GET /uploads/<filename>`.
- En desarrollo con proxy, usar rutas relativas: `/uploads/<filename>`.

---

## Catálogo (portal cliente)

- **Origen de datos:** El catálogo que ve el cliente sale de los productos que cada farmacia ha subido (inventario Excel). Si ninguna farmacia ha subido inventario, la lista estará vacía: mostrar mensaje tipo "No hay productos disponibles" y no fallar.
- **Endpoints a usar:** `GET /api/cliente/catalogo` (recomendado para listado con precios/descuentos) o `GET /api/cliente/productos?estado=&q=` para filtro por estado y búsqueda.
- **Búsqueda:** Enviar `q` con el texto que escribe el usuario (ej. debounce 300 ms). Backend busca en codigo, descripcion, principioActivo, marca.
- **Imágenes:** Si `imagen` o `foto` viene con ruta relativa (ej. `/uploads/xxx`), construir URL como `${VITE_API_URL}${imagen}`. Si es null, mostrar placeholder.
- **Sin stock:** Si `existencia <= 0`, no mostrar botón "Agregar al carrito" o mostrarlo deshabilitado con texto "Sin stock".

---

## Reglas obligatorias para la IA del frontend

1. **Un solo login:** Pantalla única con email y contraseña. Tras login, redirigir según `user.role`: `master` → `/admin`, `farmacia` → `/farmacia`, `cliente` → `/cliente`, `delivery` → `/delivery`. No preguntar "¿Eres cliente o farmacia?".
2. **URL del API:** En producción usar `https://zas-red-farmacias-back.onrender.com`. Definir `VITE_API_URL` y usarla en todas las llamadas a `/api` y `/uploads`.
3. **Token:** Guardar `token` del login en `localStorage`; enviar header `Authorization: Bearer <token>` en todas las rutas protegidas. Si el backend responde 401, redirigir a login y limpiar token.
4. **BCV:** Al cargar la app, llamar `GET /api/config` y guardar `bcv`. En precios mostrar: línea 1 `$X.XX`, línea 2 `Bs. (X × bcv)`. En header de cliente/farmacia/delivery mostrar "BCV: X.XX Bs/$".
5. **Catálogo:** Usar `GET /api/cliente/catalogo` o `/api/cliente/productos`; si el array viene vacío, mostrar estado vacío. No mostrar nunca el nombre de la farmacia al cliente; solo identificar por colores o códigos si el backend lo envía.
6. **Carrito:** Agregar con `POST /api/cliente/carrito` body `{ productoId, cantidad }`. Si el backend responde 400 "Producto no disponible o sin stock", mostrar mensaje y no agregar.
7. **Checkout:** FormData con `metodoPago` y archivo `comprobante`. Tras éxito, vaciar estado de carrito en el frontend.
8. **Inventario farmacia:** Excel con columnas: codigo, descripcion, marca, precio, existencia (nombres en español; el backend acepta también mayúsculas). Subir con FormData campo `archivo`.
9. **No inventar endpoints ni campos:** Usar solo las rutas y los cuerpos/respuestas descritos en este documento. Si falta algo, consultar este archivo o al responsable del backend.

Con esto el frontend permanece sincronizado con el backend.
