# Instrucciones para la IA del Frontend — Zas Red Farmacias

Este documento mantiene sincronizado el frontend con el backend. Úsalo como referencia al generar o modificar el frontend.

---

## Base URL y autenticación

- **API base:** `http://localhost:4000/api` (desarrollo). En producción usar la URL del backend.
- **Proxy Vite (recomendado):** En `vite.config.js` configurar:
  ```js
  proxy: {
    '/api': { target: 'http://localhost:4000', changeOrigin: true },
    '/uploads': { target: 'http://localhost:4000', changeOrigin: true },
  }
  ```
  Así el frontend usa `/api` y `/uploads` sin CORS.
- **Autenticación:** Todas las rutas protegidas envían el token en el header:
  ```http
  Authorization: Bearer <token>
  ```
- **Token:** Se obtiene en `POST /api/auth/login` o `POST /api/auth/register/cliente`. Guardar en `localStorage` (ej. clave `token`) y enviarlo en cada petición autenticada.

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
| GET | `/api/cliente/productos` | `?estado=&q=` | Catálogo; filtro por estado Venezuela y búsqueda |
| GET | `/api/cliente/estados` | — | Lista estados Venezuela |
| GET | `/api/cliente/carrito` | — | Items con producto poblado |
| POST | `/api/cliente/carrito` | `{ productoId, cantidad }` | Agregar al carrito |
| PATCH | `/api/cliente/carrito/:productoId` | `{ cantidad }` | Actualizar cantidad |
| DELETE | `/api/cliente/carrito/:productoId` | — | Quitar del carrito |
| GET | `/api/cliente/checkout/resumen` | — | `{ subtotal, costoDelivery, total, numFarmacias, direccion }` |
| POST | `/api/cliente/checkout/procesar` | FormData: `metodoPago`, `comprobante` (archivo) | Crea pedido(s), vacía carrito |
| PATCH | `/api/cliente/ubicacion` | `{ lat, lng }` | GPS del cliente |
| GET | `/api/cliente/mis-pedidos` | — | Pedidos del cliente |

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

## Resumen para la IA del frontend

1. Usar **un solo login**; redirigir por `user.role` a `/admin`, `/farmacia`, `/cliente` o `/delivery`.
2. Obtener **BCV** con `GET /api/config` al cargar la app; mostrar en todos los precios **$** y debajo **Bs. (precio × BCV)**; en headers de cliente/farmacia/delivery mostrar **BCV: X.XX Bs/$** arriba a la derecha.
3. Enviar **Authorization: Bearer &lt;token&gt;** en todas las peticiones a rutas protegidas.
4. Para **crear farmacia** (master) enviar todos los campos indicados, incluido `estado` (lista de estados Venezuela).
5. **Checkout cliente:** FormData con `metodoPago` y archivo `comprobante`.
6. **Inventario farmacia:** Excel con columnas codigo, descripcion, marca, precio, existencia; el backend aplica el porcentaje de la farmacia al precio.

Con esto el frontend puede mantenerse alineado con este backend.
