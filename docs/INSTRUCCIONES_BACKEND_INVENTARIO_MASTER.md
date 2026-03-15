# Instrucciones Backend: Inventario Maestro y Solicitar Producto

Resumen de endpoints y flujo para el inventario agregado por código (vista admin) y las solicitudes de producto por parte del cliente.

---

## 1. GET /api/master/inventario (solo admin)

- **Rol:** solo **admin** (usuario con `role: 'master'`).
- **Query:** `page` (default 1), `page_size` (default 300, máx. 500).
- **Respuesta:** siempre `{ items: [...], total: N }`, donde:
  - **items**: lista paginada de productos agregados por **código**, cada uno con:
    - **codigo**, **descripcion**, **marca**, **departamento** (categoría), **existenciaGlobal**, **solicitudes** (objeto con **cantidad**; el detalle de quién solicitó se obtiene por endpoint aparte para no hacer la respuesta pesada).
  - **total**: número total de productos (códigos) en el catálogo maestro.

La base de códigos sale del **catálogo maestro** (colección `catalogo_maestro` en la base de catálogo). La existencia y la categoría se calculan desde la colección **Producto** (inventario por farmacia). El detalle de solicitudes por código se obtiene con **GET /api/master/inventario/solicitudes-detalle?codigo=XXX** (ver sección de rendimiento).

---

## 2. Rendimiento: MongoDB y backend

- **Paginación:** el endpoint de inventario acepta `page` y `page_size` y responde siempre con `{ items: [...], total: N }`.
- **Índices en MongoDB:**
  - En la colección de inventario (**Producto**): `codigo`, y compuesto `farmaciaId + codigo`.
  - En solicitudes de producto (**SolicitudProductoCliente**): `codigo`, y compuesto `notificadoEnDisponible + codigo`.
- **Agregación:** usar pipeline de agregación (`$group`, `$skip`, `$limit`) en lugar de cargar todo en la app: se pagina sobre el catálogo maestro y solo se agregan existencias/solicitudes para los códigos de la página actual.
- **Caché (opcional):** cachear el resultado agregado 1–5 minutos e invalidar al actualizar inventario (carga Excel). Variable de entorno opcional: `INVENTARIO_MASTER_CACHE_TTL_MS`.
- **solicitudesDetalle (opcional):** cargar solo al expandir mediante endpoint aparte por código (**GET /api/master/inventario/solicitudes-detalle?codigo=XXX**), que devuelve `{ codigo, detalle: [{ userId, nombre, email, fecha }] }`, para no hacer la respuesta del listado pesada.

---

## 3. POST /api/cliente/solicitar-producto (cliente logueado)

- **Rol:** cliente autenticado (o master con cabecera de suplencia si aplica).
- **Body:** `{ "codigo": "<código de producto>" }`.
- **Comportamiento:**
  - Guarda la solicitud en **SolicitudProductoCliente** (`userId`, `codigo`, `fecha` implícita en `createdAt`).
  - Si el producto **ya tiene stock** en alguna farmacia: responde 400 con mensaje tipo "Este producto ya está disponible. Puedes agregarlo al carrito."
  - **Límite de duplicados:** una misma solicitud (mismo cliente y mismo código) solo se acepta una vez cada **7 días**. Si el cliente vuelve a solicitar antes:
    - Responde 400 con mensaje y opcionalmente **`proximaDisponible`** (fecha ISO a partir de la cual puede volver a solicitar).

- El frontend usa este endpoint cuando el cliente pulsa "Solicitar" en un producto sin stock.

---

## 4. Notificación cuando haya stock

Cuando un producto **pase a tener existencia global > 0** (es decir, al menos una farmacia tiene existencia de ese código):

1. Buscar en **SolicitudProductoCliente** las solicitudes **pendientes** para ese `codigo` (por ejemplo, donde `notificadoEnDisponible` sea `null`).
2. Enviar **notificación** a cada usuario que solicitó: mensaje tipo *"El producto que solicitaste ya está disponible"* (el backend puede redactarlo en voz de Dona u otro texto acordado).
3. Marcar cada solicitud como **notificada** (por ejemplo, guardar la fecha en `notificadoEnDisponible`).

Este flujo debe ejecutarse siempre que se **actualice o cargue inventario** (por ejemplo, tras subir un Excel en una farmacia) y algún producto con ese código pase a tener existencia > 0 en alguna farmacia. En el backend ya existe la utilidad `notificarClientesProductoDisponible(codigo)` que realiza estos pasos; debe invocarse desde las rutas de carga/actualización de inventario.

---

## 5. Solicitudes no catalogadas y solicitar por nombre

- **POST /api/cliente/solicitar-producto-por-nombre** (cliente logueado): body `{ "nombre": "<nombre del producto>" }`. Guarda la solicitud en una colección/tabla de **solicitudes no catalogadas** (productos que el cliente pide por nombre cuando no están en catálogo). Límite opcional: una vez cada 7 días por cliente/nombre (respuesta 400 con `proximaDisponible` si aplica).
- **GET /api/master/solicitudes-no-catalogadas** (solo admin): devuelve `[{ nombre, cantidad }]` agrupado por nombre (cantidad de solicitudes por cada nombre).
- **GET /api/farmacia/solicitudes-no-catalogadas** (farmacia): devuelve `[{ nombre, cantidad }]` agrupado por nombre.

En el chat de Dona, cuando se recomienda un medicamento que **no está en catálogo**, se envía en `__PRODUCTOS__` un objeto con **descripcion** (nombre) y **sin codigo**, **disponible: false**, para que el frontend muestre “Solicitar” y llame a solicitar por nombre.

---

## Resumen de endpoints

| Método | Ruta | Rol | Descripción |
|--------|------|-----|-------------|
| GET | `/api/master/inventario` | admin (master) | Query: `page`, `page_size`. Respuesta: `{ items, total }`. Inventario agregado por código. |
| GET | `/api/master/inventario/solicitudes-detalle` | admin (master) | Query: `codigo`. Detalle de quién solicitó ese producto (para expandir fila). |
| GET | `/api/master/solicitudes-no-catalogadas` | admin (master) | Lista `[{ nombre, cantidad }]` agrupado por nombre (solicitudes por nombre, no catalogados). |
| GET | `/api/farmacia/solicitudes-no-catalogadas` | farmacia | Lista `[{ nombre, cantidad }]` agrupado por nombre (solicitudes no catalogadas). |
| POST | `/api/cliente/solicitar-producto` | cliente | Registrar solicitud de producto por código; límite 7 días por cliente/código; opcional `proximaDisponible` en 400. |
| POST | `/api/cliente/solicitar-producto-por-nombre` | cliente | Body: `{ nombre }`. Registrar solicitud por nombre (producto no en catálogo); límite 7 días por cliente/nombre. |

---

## Modelos relacionados

- **SolicitudProductoCliente:** `clienteId`, `codigo`, `notificadoEnDisponible` (fecha o null).
- **SolicitudProductoNoCatalogado:** `clienteId`, `nombre` (string), para solicitudes por nombre cuando el producto no está en catálogo.
- **Producto:** inventario por farmacia (`farmaciaId`, `codigo`, `existencia`, `categoria`, etc.).
- **Notificacion:** para enviar al usuario el aviso de producto disponible.
