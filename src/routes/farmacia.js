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

// Dashboard: total productos vendidos, total $ vendidos, total clientes
router.get('/dashboard', async (req, res) => {
  try {
    const farmaciaId = getFarmaciaId(req);
    if (!farmaciaId) return res.status(403).json({ error: 'Farmacia no asignada' });

    const pedidosEntregados = await Pedido.find({
      farmaciaId,
      estado: 'entregado',
    });

    let totalVendido = 0;
    let totalProductosVendidos = 0;
    const clientesIds = new Set();

    for (const p of pedidosEntregados) {
      totalVendido += p.total;
      clientesIds.add(p.clienteId.toString());
      for (const it of p.items) {
        totalProductosVendidos += it.cantidad;
      }
    }

    const pedidosPendientes = await Pedido.countDocuments({
      farmaciaId,
      estado: 'pendiente_validacion',
    });

    res.json({
      totalVendido: Math.round(totalVendido * 100) / 100,
      totalProductosVendidos,
      totalClientes: clientesIds.size,
      pedidosPendientes,
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
      mensaje: 'Tu pedido ha sido validado por la farmacia.',
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
      mensaje: 'Tu pedido fue denegado por la farmacia.',
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

// Inventario detallado para la farmacia (incluye descuentos)
router.get('/inventario', async (req, res) => {
  try {
    const farmaciaId = getFarmaciaId(req);
    if (!farmaciaId) return res.status(403).json({ error: 'Farmacia no asignada' });
    const productos = await Producto.find({ farmaciaId }).sort({ codigo: 1 });
    const dto = productos.map(mapProductoToDTO);
    res.json(dto);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener inventario' });
  }
});

// Resolver conflictos de descripción: body { decisiones: [ { codigo, usar: 'catalogo' | 'farmacia' } ] }
router.post('/inventario/resolver-descripciones', async (req, res) => {
    try {
      const decisiones = Array.isArray(req.body.decisiones) ? req.body.decisiones : [];
      const invalid = decisiones.some(d => !d?.codigo || !['catalogo', 'farmacia'].includes(d.usar));
      if (invalid) return res.status(400).json({ error: 'decisiones: array de { codigo, usar: "catalogo"|"farmacia" }' });

      const farmaciaId = getFarmaciaId(req);
      if (!farmaciaId) return res.status(403).json({ error: 'Farmacia no asignada' });

      let resueltos = 0;
      for (const d of decisiones) {
        const producto = await Producto.findOne({ farmaciaId, codigo: d.codigo });
        if (!producto) continue;
        const usarCatalogo = d.usar === 'catalogo';
        producto.usarDescripcionCatalogo = usarCatalogo;
        producto.descripcion = usarCatalogo && producto.descripcionCatalogo
          ? producto.descripcionCatalogo
          : (producto.descripcionPersonalizada || producto.descripcion);
        await producto.save();
        resueltos++;
      }
      res.json({ ok: true, resueltos });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al resolver descripciones' });
    }
  }
);

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
