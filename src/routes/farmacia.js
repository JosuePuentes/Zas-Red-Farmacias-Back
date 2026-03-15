import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import mongoose from 'mongoose';
import xlsx from 'xlsx';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Farmacia from '../models/Farmacia.js';
import Producto, { CATEGORIAS_PRODUCTO } from '../models/Producto.js';
import Pedido from '../models/Pedido.js';
import Notificacion from '../models/Notificacion.js';
import User from '../models/User.js';
import SolicitudPlanPro from '../models/SolicitudPlanPro.js';
import Proveedor from '../models/Proveedor.js';
import PrecioProveedor from '../models/PrecioProveedor.js';
import SolicitudProductoCliente from '../models/SolicitudProductoCliente.js';
import SolicitudProductoNoCatalogado from '../models/SolicitudProductoNoCatalogado.js';
import { notificarClientesProductoDisponible } from '../util/notificarProductoDisponible.js';
import { invalidarCacheInventarioMaster } from '../util/cacheInventarioMaster.js';
import { auth, requireRole, attachUser } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');

const router = Router();

router.use(auth, requireRole('farmacia'), attachUser);

function getFarmaciaId(req) {
  // Master entrando como farmacia: debe enviar X-Farmacia-Id o ?farmaciaId=
  if (req.role === 'master') {
    const id = req.headers['x-farmacia-id'] || req.query.farmaciaId;
    if (id && mongoose.Types.ObjectId.isValid(id)) return new mongoose.Types.ObjectId(id);
    return null;
  }
  return req.user?.farmaciaId?._id || req.user?.farmaciaId;
}

function clampPercentage(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function calcularPrecioConDescuento(precioBase, descuentoPorcentaje) {
  const base = Number(precioBase) || 0;
  const pct = clampPercentage(descuentoPorcentaje);
  const factor = 1 - pct / 100;
  return Math.round(base * factor * 100) / 100;
}

async function requirePlanFull(req, res, next) {
  const farmaciaId = getFarmaciaId(req);
  if (!farmaciaId) return res.status(403).json({ error: 'Farmacia no asignada' });
  if (req.role === 'master') return next();
  const farmacia = await Farmacia.findById(farmaciaId).select('planProActivo');
  if (!farmacia?.planProActivo) return res.status(403).json({ error: 'Requiere Plan Full activo' });
  next();
}

// --- Plan Pro ---
// GET /api/farmacia/plan-pro/estado → { activo: boolean }. Master sin farmacia elegida: activo true (acceso total).
router.get('/plan-pro/estado', async (req, res) => {
  try {
    const farmaciaId = getFarmaciaId(req);
    if (!farmaciaId) {
      if (req.role === 'master') return res.json({ activo: true });
      return res.status(403).json({ error: 'Farmacia no asignada' });
    }
    const farmacia = await Farmacia.findById(farmaciaId).select('planProActivo');
    res.json({ activo: !!farmacia?.planProActivo || req.role === 'master' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener estado Plan Pro' });
  }
});

// POST /api/farmacia/plan-pro/solicitud — body: bancoEmisor, numeroReferencia, comprobanteBase64 (o multipart comprobante)
router.post('/plan-pro/solicitud',
  body('bancoEmisor').notEmpty().trim(),
  body('numeroReferencia').notEmpty().trim(),
  upload.single('comprobante'),
  async (req, res) => {
    try {
      const err = validationResult(req);
      if (!err.isEmpty()) return res.status(400).json({ error: 'Datos inválidos', details: err.array() });

      const farmaciaId = getFarmaciaId(req);
      if (!farmaciaId) return res.status(403).json({ error: 'Farmacia no asignada' });

      const { bancoEmisor, numeroReferencia, comprobanteBase64 } = req.body;
      let comprobanteUrl = null;

      if (req.file) {
        comprobanteUrl = `/uploads/${req.file.filename}`;
      } else if (comprobanteBase64 && typeof comprobanteBase64 === 'string') {
        const base64 = comprobanteBase64.replace(/^data:image\/\w+;base64,/, '');
        const buf = Buffer.from(base64, 'base64');
        const ext = (comprobanteBase64.match(/^data:image\/(\w+);/) || [])[1] || 'jpg';
        const filename = `planpro-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const filepath = path.join(uploadDir, filename);
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        fs.writeFileSync(filepath, buf);
        comprobanteUrl = `/uploads/${filename}`;
      }

      if (!comprobanteUrl) {
        return res.status(400).json({ error: 'Debe enviar comprobante (multipart) o comprobanteBase64' });
      }

      const solicitud = await SolicitudPlanPro.create({
        farmaciaId,
        bancoEmisor: String(bancoEmisor).trim(),
        numeroReferencia: String(numeroReferencia).trim(),
        comprobanteUrl,
        estado: 'pendiente',
      });

      res.status(201).json({ message: 'Solicitud Plan Pro enviada', id: solicitud._id });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al enviar solicitud Plan Pro' });
    }
  }
);

// --- Proveedores (Plan Full) ---
router.get('/proveedores', requirePlanFull, async (req, res) => {
  try {
    const farmaciaId = getFarmaciaId(req);
    const list = await Proveedor.find({ farmaciaId }).sort({ nombreProveedor: 1 });
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar proveedores' });
  }
});

router.post('/proveedores', requirePlanFull, async (req, res) => {
  try {
    const farmaciaId = getFarmaciaId(req);
    const { rif, nombreProveedor, telefono, nombreAsesorVentas, direccion, condicionesComercialesPct, prontoPagoPct } = req.body;
    if (!rif || !nombreProveedor || !telefono) {
      return res.status(400).json({ error: 'Faltan: rif, nombreProveedor, telefono' });
    }
    const proveedor = await Proveedor.create({
      farmaciaId,
      rif: String(rif).trim(),
      nombreProveedor: String(nombreProveedor).trim(),
      telefono: String(telefono).trim(),
      nombreAsesorVentas: String(nombreAsesorVentas || '').trim(),
      direccion: String(direccion || '').trim(),
      condicionesComercialesPct: Number(condicionesComercialesPct) || 0,
      prontoPagoPct: Number(prontoPagoPct) || 0,
    });
    res.status(201).json(proveedor);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al crear proveedor' });
  }
});

router.patch('/proveedores/:id', requirePlanFull, async (req, res) => {
  try {
    const farmaciaId = getFarmaciaId(req);
    const prov = await Proveedor.findOne({ _id: req.params.id, farmaciaId });
    if (!prov) return res.status(404).json({ error: 'Proveedor no encontrado' });
    const { rif, nombreProveedor, telefono, nombreAsesorVentas, direccion, condicionesComercialesPct, prontoPagoPct } = req.body;
    if (rif != null) prov.rif = String(rif).trim();
    if (nombreProveedor != null) prov.nombreProveedor = String(nombreProveedor).trim();
    if (telefono != null) prov.telefono = String(telefono).trim();
    if (nombreAsesorVentas != null) prov.nombreAsesorVentas = String(nombreAsesorVentas).trim();
    if (direccion != null) prov.direccion = String(direccion).trim();
    if (condicionesComercialesPct != null) prov.condicionesComercialesPct = Number(condicionesComercialesPct) || 0;
    if (prontoPagoPct != null) prov.prontoPagoPct = Number(prontoPagoPct) || 0;
    await prov.save();
    res.json(prov);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al actualizar proveedor' });
  }
});

router.delete('/proveedores/:id', requirePlanFull, async (req, res) => {
  try {
    const farmaciaId = getFarmaciaId(req);
    const prov = await Proveedor.findOne({ _id: req.params.id, farmaciaId });
    if (!prov) return res.status(404).json({ error: 'Proveedor no encontrado' });
    await Proveedor.deleteOne({ _id: prov._id });
    res.json({ message: 'Proveedor eliminado' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al eliminar proveedor' });
  }
});

// Lista de precios Excel: form archivo + proveedorId. Columnas: codigo, descripcion, marca, precio, existencia.
router.post('/proveedores/lista-precio', requirePlanFull, upload.single('archivo'), async (req, res) => {
  try {
    const farmaciaId = getFarmaciaId(req);
    const proveedorId = req.body.proveedorId || req.query.proveedorId;
    if (!proveedorId || !mongoose.Types.ObjectId.isValid(proveedorId)) {
      return res.status(400).json({ error: 'proveedorId requerido' });
    }
    const proveedor = await Proveedor.findOne({ _id: proveedorId, farmaciaId });
    if (!proveedor) return res.status(404).json({ error: 'Proveedor no encontrado' });
    if (!req.file) return res.status(400).json({ error: 'No se envió archivo Excel' });

    const workbook = xlsx.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet);
    let insertados = 0;
    let actualizados = 0;

    for (const row of rows) {
      const codigo = String(row.codigo ?? row.Codigo ?? '').trim();
      const descripcion = String(row.descripcion ?? row.Descripcion ?? '').trim();
      const marca = String(row.marca ?? row.Marca ?? '').trim();
      const precio = Number(row.precio ?? row.Precio ?? 0);
      const existencia = Number(row.existencia ?? row.Existencia ?? 0);
      if (!codigo) continue;

      const existing = await PrecioProveedor.findOne({ farmaciaId, proveedorId, codigo });
      if (existing) {
        existing.descripcion = descripcion;
        existing.marca = marca;
        existing.precio = precio;
        existing.existencia = existencia;
        await existing.save();
        actualizados++;
      } else {
        await PrecioProveedor.create({
          farmaciaId,
          proveedorId,
          codigo,
          descripcion,
          marca,
          precio,
          existencia,
        });
        insertados++;
      }
    }

    res.json({ message: 'Lista de precios cargada', insertados, actualizados });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al procesar lista de precios' });
  }
});

// Lista comparativa: codigo, descripcion, marca, ofertas[] (proveedorId, proveedorNombre, precio, existencia). Sin existencia global ni solicitudes. Orden: mejor precio primero.
router.get('/proveedores/lista-comparativa', requirePlanFull, async (req, res) => {
  try {
    const farmaciaId = getFarmaciaId(req);
    const precios = await PrecioProveedor.find({ farmaciaId })
      .populate('proveedorId', 'nombreProveedor');
    const byCodigo = new Map();
    for (const p of precios) {
      const cod = p.codigo;
      if (!byCodigo.has(cod)) {
        byCodigo.set(cod, {
          codigo: cod,
          descripcion: p.descripcion || '',
          marca: p.marca || '',
          ofertas: [],
        });
      }
      byCodigo.get(cod).ofertas.push({
        proveedorId: p.proveedorId?._id?.toString?.() || p.proveedorId?.toString?.(),
        proveedorNombre: p.proveedorId?.nombreProveedor || '',
        precio: p.precio,
        existencia: p.existencia ?? 0,
      });
    }
    const lista = Array.from(byCodigo.values());
    for (const item of lista) {
      item.ofertas.sort((a, b) => a.precio - b.precio);
    }
    lista.sort((a, b) => {
      const pA = a.ofertas[0]?.precio ?? Infinity;
      const pB = b.ofertas[0]?.precio ?? Infinity;
      return pA - pB;
    });
    res.json(lista);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener lista comparativa' });
  }
});

// Dashboard farmacia: totalUsuariosApp, totalClientesFarmacia, ventasMesActual, ventasMesAnterior, totalPedidosMes, inventarioVariacionPct, usuariosCrecimientoPct, clientesCrecimientoPct. Todos opcionales.
router.get('/dashboard', async (req, res) => {
  try {
    const farmaciaId = getFarmaciaId(req);
    if (!farmaciaId) return res.status(403).json({ error: 'Farmacia no asignada' });

    const now = new Date();
    const inicioMesActual = new Date(now.getFullYear(), now.getMonth(), 1);
    const inicioMesAnterior = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const hace30Dias = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsuariosApp,
      usuariosHace30Dias,
      pedidosEntregadosMesActual,
      pedidosEntregadosMesAnterior,
      totalPedidosMes,
      clientesMesActualIds,
      clientesMesAnteriorIds,
      clientesFarmaciaIds,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ createdAt: { $lt: hace30Dias } }),
      Pedido.find({ farmaciaId, estado: 'entregado', createdAt: { $gte: inicioMesActual } }).select('total'),
      Pedido.find({ farmaciaId, estado: 'entregado', createdAt: { $gte: inicioMesAnterior, $lt: inicioMesActual } }).select('total'),
      Pedido.countDocuments({ farmaciaId, createdAt: { $gte: inicioMesActual } }),
      Pedido.distinct('clienteId', { farmaciaId, estado: 'entregado', createdAt: { $gte: inicioMesActual } }),
      Pedido.distinct('clienteId', { farmaciaId, estado: 'entregado', createdAt: { $gte: inicioMesAnterior, $lt: inicioMesActual } }),
      Pedido.distinct('clienteId', { farmaciaId, estado: 'entregado' }),
    ]);

    let ventasMesActual = 0;
    for (const p of pedidosEntregadosMesActual) ventasMesActual += p.total || 0;
    let ventasMesAnterior = 0;
    for (const p of pedidosEntregadosMesAnterior) ventasMesAnterior += p.total || 0;

    const totalClientesFarmacia = clientesFarmaciaIds.length;
    const clientesMesActual = clientesMesActualIds.length;
    const clientesMesAnterior = clientesMesAnteriorIds.length;
    const usuariosCrecimientoPct = usuariosHace30Dias > 0
      ? Math.round(((totalUsuariosApp - usuariosHace30Dias) / usuariosHace30Dias) * 10000) / 100
      : 0;
    const clientesCrecimientoPct = clientesMesAnterior > 0
      ? Math.round(((clientesMesActual - clientesMesAnterior) / clientesMesAnterior) * 10000) / 100
      : (clientesMesActual > 0 ? 100 : 0);

    res.json({
      totalUsuariosApp: totalUsuariosApp ?? 0,
      totalClientesFarmacia: totalClientesFarmacia ?? 0,
      ventasMesActual: Math.round((ventasMesActual ?? 0) * 100) / 100,
      ventasMesAnterior: Math.round((ventasMesAnterior ?? 0) * 100) / 100,
      totalPedidosMes: totalPedidosMes ?? 0,
      inventarioVariacionPct: 0,
      usuariosCrecimientoPct: usuariosCrecimientoPct ?? 0,
      clientesCrecimientoPct: clientesCrecimientoPct ?? 0,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error en dashboard' });
  }
});

// Pedidos de esta farmacia (con notificación)
router.get('/pedidos', async (req, res) => {
  try {
    const farmaciaId = getFarmaciaId(req);
    if (!farmaciaId) return res.status(403).json({ error: 'Farmacia no asignada' });

    const pedidos = await Pedido.find({ farmaciaId })
      .populate('clienteId', 'nombre apellido email telefono direccion cedula')
      .sort({ createdAt: -1 });

    const pendientes = await Pedido.countDocuments({
      farmaciaId,
      estado: 'pendiente_validacion',
    });

    res.json({ pedidos, totalPendientes: pendientes });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar pedidos' });
  }
});

// Validar pedido (aprobar)
router.post('/pedidos/:id/validar', async (req, res) => {
  try {
    const farmaciaId = getFarmaciaId(req);
    const pedido = await Pedido.findOne({ _id: req.params.id, farmaciaId });
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (pedido.estado !== 'pendiente_validacion') {
      return res.status(400).json({ error: 'El pedido ya fue procesado' });
    }

    pedido.estado = 'validado';
    pedido.tiempoLimiteAceptar = new Date(Date.now() + 60 * 1000); // 1 min para que delivery acepte
    await pedido.save();

    await Notificacion.create({
      userId: pedido.clienteId,
      tipo: 'pedido_validado',
      mensaje: 'Dona: Tu pedido ya fue validado por la farmacia. En breve un repartidor lo tomará. Te aviso.',
      pedidoId: pedido._id,
    });

    res.json({ message: 'Pedido validado', pedido });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al validar' });
  }
});

// Denegar pedido
router.post('/pedidos/:id/denegar', async (req, res) => {
  try {
    const farmaciaId = getFarmaciaId(req);
    const pedido = await Pedido.findOne({ _id: req.params.id, farmaciaId });
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (pedido.estado !== 'pendiente_validacion') {
      return res.status(400).json({ error: 'El pedido ya fue procesado' });
    }

    pedido.estado = 'denegado';
    await pedido.save();

    await Notificacion.create({
      userId: pedido.clienteId,
      tipo: 'pedido_denegado',
      mensaje: 'Dona: Lamentablemente la farmacia no pudo procesar tu pedido esta vez. Si quieres, puedo ayudarte a buscar otra opción.',
      pedidoId: pedido._id,
    });

    res.json({ message: 'Pedido denegado', pedido });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al denegar' });
  }
});

// Colección catalogo_maestro (base Zas): ean_13, description, brand, image_path — para vincular códigos de barras a nombres e imágenes
function getCatalogoMaestroCollection() {
  return mongoose.connection.useDb(process.env.MONGO_DB_CATALOGO || 'Zas').collection('catalogo_maestro');
}

// Cargar inventario por Excel: codigo (código de barras), descripcion, marca, precio, existencia.
// Hace match con catalogo_maestro por ean_13; vincula imagen y descripción del sistema. Si la descripción del Excel
// difiere de la del catálogo, se devuelve en conflictosDescripcion para que el frontend pregunte al usuario si quiere
// quedarse con la descripción del sistema o con la suya.
router.post('/inventario/upload', upload.single('archivo'), async (req, res) => {
  try {
    const farmaciaId = getFarmaciaId(req);
    if (!farmaciaId) return res.status(403).json({ error: 'Farmacia no asignada' });
    if (!req.file) return res.status(400).json({ error: 'No se envió archivo Excel' });

    const workbook = xlsx.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet);

    const farmacia = await Farmacia.findById(farmaciaId);
    const porcentaje = (farmacia?.porcentajePrecio || 0) / 100;

    const catalogoMaestro = getCatalogoMaestroCollection();

    let creados = 0;
    let actualizados = 0;
    let vinculadosCatalogo = 0;
    const conflictosDescripcion = [];
    const codigosProcesados = new Set();

    for (const row of rows) {
      const codigo = String(row.codigo ?? row.Codigo ?? row.ean_13 ?? row.barcode ?? '').trim();
      const descripcionExcel = String(row.descripcion ?? row.Descripcion ?? '').trim();
      const precio = Number(row.precio ?? row.Precio ?? 0);
      const existencia = Number(row.existencia ?? row.Existencia ?? 0);
      const categoriaRaw = String(row.categoria ?? row.Categoria ?? '').trim();

      if (!codigo) continue;

      let descripcion = '';
      let marca = '';
      let foto = null;
      let descripcionCatalogo = null;
      let descripcionPersonalizada = null;
      let usarDescripcionCatalogo = true;

      const cat = await catalogoMaestro.findOne({ ean_13: codigo });
      if (cat) {
        const descSistema = (cat.description || cat.descripcion || '').trim();
        descripcionCatalogo = descSistema;
        descripcionPersonalizada = descripcionExcel || descSistema;
        descripcion = descSistema;
        marca = (cat.brand || cat.marca || '').trim();
        foto = cat.image_path || cat.foto || null;
        usarDescripcionCatalogo = true;
        vinculadosCatalogo++;

        if (descripcionExcel && descripcionExcel !== descSistema) {
          conflictosDescripcion.push({
            codigo,
            descripcionSistema: descSistema,
            descripcionArchivo: descripcionExcel,
          });
        }
      } else {
        descripcion = descripcionExcel;
        marca = String(row.marca ?? row.Marca ?? '').trim();
        descripcionPersonalizada = descripcionExcel;
        usarDescripcionCatalogo = false;
      }

      if (!descripcion) continue;

      const descuentoRaw = row.descuentoPorcentaje ?? row.DescuentoPorcentaje ?? row.descuento ?? row.Descuento;
      const descuentoPorcentaje = clampPercentage(descuentoRaw);

      const precioConPorcentaje = precio * (1 + porcentaje);
      const precioConDescuento = calcularPrecioConDescuento(precioConPorcentaje, descuentoPorcentaje);

      const categoria = CATEGORIAS_PRODUCTO.includes(categoriaRaw) ? categoriaRaw : undefined;

      const existing = await Producto.findOne({ farmaciaId, codigo });
      codigosProcesados.add(codigo);

      if (existing) {
        existing.descripcion = descripcion;
        existing.descripcionCatalogo = descripcionCatalogo;
        existing.descripcionPersonalizada = descripcionPersonalizada;
        existing.usarDescripcionCatalogo = usarDescripcionCatalogo;
        existing.marca = marca;
        existing.foto = foto;
        existing.precioBase = precioConPorcentaje;
        existing.existencia = existencia;
        if (categoria) existing.categoria = categoria;
        existing.descuentoPorcentaje = descuentoPorcentaje;
        existing.precioConPorcentaje = descuentoPorcentaje ? precioConDescuento : precioConPorcentaje;
        await existing.save();
        actualizados++;
      } else {
        await Producto.create({
          farmaciaId,
          codigo,
          descripcion,
          descripcionCatalogo,
          descripcionPersonalizada,
          usarDescripcionCatalogo,
          marca,
          foto,
          categoria,
          precioBase: precioConPorcentaje,
          descuentoPorcentaje,
          precioConPorcentaje: descuentoPorcentaje ? precioConDescuento : precioConPorcentaje,
          existencia,
        });
        creados++;
      }
    }

    for (const codigo of codigosProcesados) {
      const hayStock = await Producto.exists({ codigo, existencia: { $gt: 0 } });
      if (hayStock) {
        try {
          await notificarClientesProductoDisponible(codigo);
        } catch (err) {
          console.error('Notificar producto disponible:', err);
        }
      }
    }

    invalidarCacheInventarioMaster();

    res.json({
      message: 'Inventario cargado',
      creados,
      actualizados,
      vinculadosCatalogo,
      conflictosDescripcion,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al procesar Excel' });
  }
});

// Resolver descripciones: el usuario elige por producto si usar la descripción del sistema o la del archivo.
// Body: { decisiones: [ { codigo, usar: 'catalogo' | 'farmacia' } ] }
router.post('/inventario/resolver-descripciones',
  body('decisiones').isArray(),
  body('decisiones.*.codigo').notEmpty().trim(),
  body('decisiones.*.usar').isIn(['catalogo', 'farmacia']),
  async (req, res) => {
    try {
      const err = validationResult(req);
      if (!err.isEmpty()) return res.status(400).json({ error: 'Datos inválidos', details: err.array() });

      const farmaciaId = getFarmaciaId(req);
      if (!farmaciaId) return res.status(403).json({ error: 'Farmacia no asignada' });

      let actualizados = 0;
      for (const d of req.body.decisiones) {
        const codigo = String(d.codigo).trim();
        const usarCatalogo = d.usar === 'catalogo';

        const prod = await Producto.findOne({ farmaciaId, codigo });
        if (!prod) continue;

        prod.usarDescripcionCatalogo = usarCatalogo;
        prod.descripcion = usarCatalogo
          ? (prod.descripcionCatalogo || prod.descripcion)
          : (prod.descripcionPersonalizada || prod.descripcion);
        await prod.save();
        actualizados++;
      }

      res.json({ message: 'Descripciones actualizadas', actualizados });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al resolver descripciones' });
    }
  }
);

// Listar productos de la farmacia (opcional, para ver inventario)
router.get('/productos', async (req, res) => {
  try {
    const farmaciaId = getFarmaciaId(req);
    const productos = await Producto.find({ farmaciaId }).sort({ codigo: 1 });
    res.json(productos);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar productos' });
  }
});

function getDescripcionEfectiva(p) {
  if (p.usarDescripcionCatalogo && p.descripcionCatalogo) return p.descripcionCatalogo;
  return p.descripcionPersonalizada || p.descripcion;
}

function mapProductoToDTO(p) {
  const descuento = typeof p.descuentoPorcentaje === 'number' ? clampPercentage(p.descuentoPorcentaje) : 0;
  const precioBase = Number(p.precioBase) || 0;
  const precioConPorcentaje = typeof p.precioConPorcentaje === 'number'
    ? Math.round(p.precioConPorcentaje * 100) / 100
    : calcularPrecioConDescuento(precioBase, descuento);

  return {
    id: p._id,
    codigo: p.codigo,
    descripcion: getDescripcionEfectiva(p),
    descripcionCatalogo: p.descripcionCatalogo,
    descripcionPersonalizada: p.descripcionPersonalizada,
    usarDescripcionCatalogo: !!p.usarDescripcionCatalogo,
    principioActivo: p.principioActivo,
    presentacion: p.presentacion,
    marca: p.marca,
    categoria: p.categoria,
    precio: precioBase,
    descuentoPorcentaje: descuento,
    precioConPorcentaje,
    existencia: p.existencia,
    imagen: p.foto,
    farmaciaId: p.farmaciaId,
  };
}

// Inventario detallado para la farmacia.
// Query: q (búsqueda en servidor por código/descripción/marca), page, page_size (si se envían → respuesta { items, total }).
// - Base: catálogo maestro (filtrado por q si viene); por código se fusiona producto de la farmacia y, si Plan Full, existencia global y solicitudes.
router.get('/inventario', async (req, res) => {
  try {
    const farmaciaId = getFarmaciaId(req);
    if (!farmaciaId) return res.status(403).json({ error: 'Farmacia no asignada' });
    const farmacia = await Farmacia.findById(farmaciaId).select('planProActivo');

    const q = (req.query.q && String(req.query.q).trim()) || '';
    const pageParam = parseInt(req.query.page, 10);
    const pageSizeParam = parseInt(req.query.page_size, 10);
    const usePagination = Number.isInteger(pageParam) && Number.isInteger(pageSizeParam) && pageParam >= 1 && pageSizeParam >= 1;
    const page = usePagination ? Math.max(1, pageParam) : 1;
    const page_size = usePagination ? Math.min(500, Math.max(1, pageSizeParam)) : 0;
    const skip = usePagination ? (page - 1) * page_size : 0;

    const dbCatalogo = mongoose.connection.useDb(process.env.MONGO_DB_CATALOGO || 'Zas');
    const coll = dbCatalogo.collection('catalogo_maestro');

    const baseFilter = { ean_13: { $exists: true, $ne: '' } };
    let catalogFilter = baseFilter;
    if (q) {
      const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(escapeRegex(q), 'i');
      catalogFilter = {
        ...baseFilter,
        $or: [
          { ean_13: re },
          { description: re },
          { brand: re },
        ],
      };
    }

    let total = 0;
    let catalogoDocs;
    if (usePagination) {
      total = await coll.countDocuments(catalogFilter);
      catalogoDocs = await coll
        .find(catalogFilter, { projection: { ean_13: 1, description: 1, brand: 1, image_path: 1 } })
        .sort({ ean_13: 1 })
        .skip(skip)
        .limit(page_size)
        .toArray();
    } else {
      catalogoDocs = await coll
        .find(catalogFilter, { projection: { ean_13: 1, description: 1, brand: 1, image_path: 1 } })
        .sort({ ean_13: 1 })
        .toArray();
    }

    const codigos = [...new Set(catalogoDocs.map((d) => d.ean_13).filter(Boolean))];
    const productosFarmacia = codigos.length
      ? await Producto.find({ farmaciaId, codigo: { $in: codigos } }).sort({ codigo: 1 })
      : [];
    const productoByCodigo = new Map(productosFarmacia.map((p) => [p.codigo, p]));

    let globalByCodigo = new Map();
    let solicitudesByCodigo = new Map();
    if (farmacia?.planProActivo && codigos.length) {
      const [globalAgg, solicitudesAgg] = await Promise.all([
        Producto.aggregate([
          { $match: { codigo: { $in: codigos } } },
          { $group: { _id: '$codigo', existenciaGlobal: { $sum: '$existencia' } } },
        ]),
        SolicitudProductoCliente.aggregate([
          { $match: { codigo: { $in: codigos } } },
          { $group: { _id: '$codigo', productosSolicitados: { $sum: 1 } } },
        ]),
      ]);
      globalByCodigo = new Map(globalAgg.map((g) => [g._id, g.existenciaGlobal]));
      solicitudesByCodigo = new Map(solicitudesAgg.map((s) => [s._id, s.productosSolicitados]));
    }

    const dto = catalogoDocs.map((d) => {
      const codigo = d.ean_13;
      const prod = productoByCodigo.get(codigo) || null;
      const descuento = prod ? clampPercentage(prod.descuentoPorcentaje) : 0;
      const precioBase = prod ? Number(prod.precioBase) || 0 : null;
      const precioConPorcentaje = prod ? calcularPrecioConDescuento(precioBase, descuento) : null;

      const descripcionCatalogo = (d.description && d.description.trim())
        || (prod && prod.descripcionCatalogo)
        || (prod && prod.descripcion)
        || '';

      const marca = (d.brand && d.brand.trim())
        || (prod && prod.marca)
        || '';

      const base = {
        id: prod ? prod._id.toString() : null,
        codigo,
        descripcion: descripcionCatalogo,
        descripcionCatalogo: prod?.descripcionCatalogo || descripcionCatalogo,
        descripcionPersonalizada: prod?.descripcionPersonalizada || null,
        usarDescripcionCatalogo: prod ? !!prod.usarDescripcionCatalogo : true,
        principioActivo: prod?.principioActivo || null,
        presentacion: prod?.presentacion || null,
        marca,
        categoria: prod?.categoria || null,
        precio: precioBase,
        descuentoPorcentaje: descuento,
        precioConPorcentaje,
        existencia: prod?.existencia ?? 0,
        imagen: prod?.foto || d.image_path || null,
        farmaciaId,
      };

      if (farmacia?.planProActivo) {
        return {
          ...base,
          existenciaGlobal: globalByCodigo.get(codigo) ?? 0,
          productosSolicitados: solicitudesByCodigo.get(codigo) ?? 0,
        };
      }

      return base;
    });

    if (usePagination) {
      res.json({ items: dto, total });
    } else {
      res.json(dto);
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener inventario' });
  }
});

// GET /api/farmacia/solicitudes-no-catalogadas — solicitudes por nombre (productos no en catálogo), agrupado por nombre.
router.get('/solicitudes-no-catalogadas', async (req, res) => {
  try {
    const list = await SolicitudProductoNoCatalogado.aggregate([
      { $match: { nombre: { $exists: true, $ne: '' } } },
      { $addFields: { nombreNorm: { $toLower: '$nombre' } } },
      { $group: { _id: '$nombreNorm', cantidad: { $sum: 1 }, nombreDisplay: { $first: '$nombre' } } },
      { $project: { nombre: '$nombreDisplay', cantidad: 1, _id: 0 } },
      { $sort: { cantidad: -1 } },
    ]);
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar solicitudes no catalogadas' });
  }
});

// Resolver conflictos de descripción: body { decisiones: [ { codigo, usar: 'catalogo' | 'farmacia' } ] }
router.post('/inventario/resolver-descripciones', async (req, res) => {
  try {
    const decisiones = Array.isArray(req.body.decisiones) ? req.body.decisiones : [];
    const invalid = decisiones.some((d) => !d?.codigo || !['catalogo', 'farmacia'].includes(d.usar));
    if (invalid) return res.status(400).json({ error: 'decisiones: array de { codigo, usar: \"catalogo\"|\"farmacia\" }' });

    const farmaciaId = getFarmaciaId(req);
    if (!farmaciaId) return res.status(403).json({ error: 'Farmacia no asignada' });

    let resueltos = 0;

    for (const d of decisiones) {
      const codigo = String(d.codigo).trim();
      if (!codigo) continue;

      const producto = await Producto.findOne({ farmaciaId, codigo });
      if (!producto) continue;

      if (d.usar === 'catalogo') {
        // Mantener descripción del sistema (catalogo)
        producto.usarDescripcionCatalogo = true;
        if (producto.descripcionCatalogo) {
          producto.descripcion = producto.descripcionCatalogo;
        }
        await producto.save();
        resueltos++;
        continue;
      }

      // usar === 'farmacia' → crear producto interno clonando foto y datos base
      const descripcionArchivo = producto.descripcionPersonalizada || producto.descripcion;
      const descripcionFinal = descripcionArchivo || producto.descripcionCatalogo || producto.descripcion || codigo;
      const codigoInterno = `INT-${farmaciaId}-${codigo}`;

      // Si ya existe un interno con ese codigoInterno para esta farmacia, lo reutilizamos
      let interno = await Producto.findOne({ farmaciaId, codigo: codigoInterno });
      if (!interno) {
        interno = await Producto.create({
          farmaciaId,
          codigo: codigoInterno,
          descripcion: descripcionFinal,
          descripcionCatalogo: producto.descripcionCatalogo,
          descripcionPersonalizada: descripcionArchivo,
          usarDescripcionCatalogo: false,
          principioActivo: producto.principioActivo,
          presentacion: producto.presentacion,
          marca: producto.marca,
          categoria: producto.categoria,
          precioBase: producto.precioBase,
          descuentoPorcentaje: producto.descuentoPorcentaje || 0,
          precioConPorcentaje: producto.precioConPorcentaje,
          existencia: producto.existencia,
          foto: producto.foto,
        });
      } else {
        // Actualizar interno con los últimos datos de la farmacia
        interno.descripcion = descripcionFinal;
        interno.descripcionPersonalizada = descripcionArchivo;
        interno.usarDescripcionCatalogo = false;
        interno.precioBase = producto.precioBase;
        interno.descuentoPorcentaje = producto.descuentoPorcentaje || 0;
        interno.precioConPorcentaje = producto.precioConPorcentaje;
        interno.existencia = producto.existencia;
        interno.foto = producto.foto;
        await interno.save();
      }

      // Opcional: dejar el producto original usando la descripción de catálogo
      producto.usarDescripcionCatalogo = true;
      if (producto.descripcionCatalogo) {
        producto.descripcion = producto.descripcionCatalogo;
      }
      await producto.save();

      resueltos++;
    }

    res.json({ ok: true, resueltos });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al resolver descripciones' });
  }
});

// Actualizar descuentos de productos (masivo e individual)
router.patch('/inventario/descuentos', async (req, res) => {
  try {
    const farmaciaId = getFarmaciaId(req);
    if (!farmaciaId) return res.status(403).json({ error: 'Farmacia no asignada' });

    const payload = Array.isArray(req.body) ? req.body : [];
    if (!payload.length) return res.status(400).json({ error: 'Body debe ser un array de descuentos' });

    let updated = 0;

    for (const item of payload) {
      const { id, descuentoPorcentaje } = item || {};
      if (!id) continue;
      if (!mongoose.Types.ObjectId.isValid(id)) continue;

      const producto = await Producto.findOne({ _id: id, farmaciaId });
      if (!producto) continue;

      const porcentaje = clampPercentage(descuentoPorcentaje);
      const precioBase = producto.precioBase;
      const precioConPorcentaje = calcularPrecioConDescuento(precioBase, porcentaje);

      producto.descuentoPorcentaje = porcentaje;
      producto.precioConPorcentaje = precioConPorcentaje;
      await producto.save();
      updated++;
    }

    res.json({ ok: true, updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al actualizar descuentos' });
  }
});

export default router;
