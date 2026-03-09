import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import mongoose from 'mongoose';
import xlsx from 'xlsx';
import Farmacia from '../models/Farmacia.js';
import Producto from '../models/Producto.js';
import Pedido from '../models/Pedido.js';
import Notificacion from '../models/Notificacion.js';
import User from '../models/User.js';
import { auth, requireRole, attachUser } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const router = Router();

router.use(auth, requireRole('farmacia'), attachUser);

function getFarmaciaId(req) {
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
  return Math.round(base * 100 * factor) / 100;
}

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

// Cargar inventario por Excel: codigo, descripcion, marca, precio, existencia
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

    let creados = 0;
    let actualizados = 0;

    for (const row of rows) {
      const codigo = String(row.codigo ?? row.Codigo ?? '').trim();
      const descripcion = String(row.descripcion ?? row.Descripcion ?? '').trim();
      const marca = String(row.marca ?? row.Marca ?? '').trim();
      const precio = Number(row.precio ?? row.Precio ?? 0);
      const existencia = Number(row.existencia ?? row.Existencia ?? 0);
      const categoriaRaw = String(row.categoria ?? row.Categoria ?? '').trim();

      if (!codigo || !descripcion) continue;

      const descuentoRaw = row.descuentoPorcentaje ?? row.DescuentoPorcentaje ?? row.descuento ?? row.Descuento;
      const descuentoPorcentaje = clampPercentage(descuentoRaw);

      const precioConPorcentaje = precio * (1 + porcentaje);
      const precioConDescuento = calcularPrecioConDescuento(precioConPorcentaje, descuentoPorcentaje);

      const existing = await Producto.findOne({ farmaciaId, codigo });
      if (existing) {
        existing.descripcion = descripcion;
        existing.marca = marca;
        existing.precioBase = precioConPorcentaje;
        existing.existencia = existencia;
        if (categoriaRaw) existing.categoria = categoriaRaw;
        existing.descuentoPorcentaje = descuentoPorcentaje;
        existing.precioConPorcentaje = descuentoPorcentaje ? precioConDescuento : precioConPorcentaje;
        await existing.save();
        actualizados++;
      } else {
        await Producto.create({
          farmaciaId,
          codigo,
          descripcion,
          marca,
          categoria: categoriaRaw || undefined,
          precioBase: precioConPorcentaje,
          descuentoPorcentaje,
          precioConPorcentaje: descuentoPorcentaje ? precioConDescuento : precioConPorcentaje,
          existencia,
        });
        creados++;
      }
    }

    res.json({ message: 'Inventario cargado', creados, actualizados });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al procesar Excel' });
  }
});

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

function mapProductoToDTO(p) {
  const descuento = typeof p.descuentoPorcentaje === 'number' ? clampPercentage(p.descuentoPorcentaje) : 0;
  const precioBase = Number(p.precioBase) || 0;
  const precioConPorcentaje = typeof p.precioConPorcentaje === 'number'
    ? Math.round(p.precioConPorcentaje * 100) / 100
    : calcularPrecioConDescuento(precioBase, descuento);

  return {
    id: p._id,
    codigo: p.codigo,
    descripcion: p.descripcion,
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
