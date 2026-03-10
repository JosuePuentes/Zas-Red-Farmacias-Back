import { Router } from 'express';
import mongoose from 'mongoose';
import { body, validationResult } from 'express-validator';
import Producto from '../models/Producto.js';
import Farmacia from '../models/Farmacia.js';
import Carrito from '../models/Carrito.js';
import Pedido from '../models/Pedido.js';
import Notificacion from '../models/Notificacion.js';
import User from '../models/User.js';
import { auth, requireRole, attachUser } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { ESTADOS_VENEZUELA } from '../constants/estados.js';

const router = Router();

router.use(auth, requireRole('cliente'), attachUser);

function getClienteId(req) {
  if (req.role === 'master' && (req.headers['x-cliente-id'] || req.query.clienteId)) {
    const id = req.headers['x-cliente-id'] || req.query.clienteId;
    if (mongoose.Types.ObjectId.isValid(id)) return new mongoose.Types.ObjectId(id);
  }
  return req.userId;
}

function clampPercentage(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function getDescuento(producto) {
  if (typeof producto.descuentoPorcentaje === 'number') {
    return clampPercentage(producto.descuentoPorcentaje);
  }
  return 0;
}

function getPrecioConPorcentaje(producto) {
  const base = Number(producto.precioBase) || 0;
  const descuento = getDescuento(producto);
  if (typeof producto.precioConPorcentaje === 'number') {
    return Math.round(producto.precioConPorcentaje * 100) / 100;
  }
  if (descuento > 0) {
    const factor = 1 - descuento / 100;
    return Math.round(base * factor * 100) / 100;
  }
  return base;
}

// Catálogo: productos con filtro por estado (Venezuela). No se muestra nombre de farmacia.
router.get('/productos', async (req, res) => {
  try {
    const { estado, q } = req.query;
    let filter = { existencia: { $gt: 0 } };

    if (estado && ESTADOS_VENEZUELA.includes(estado)) {
      const farmacias = await Farmacia.find({ estado }).select('_id');
      const ids = farmacias.map((f) => f._id);
      filter.farmaciaId = { $in: ids };
    }

    if (q && String(q).trim()) {
      const search = new RegExp(String(q).trim(), 'i');
      filter.$or = [
        { codigo: search },
        { descripcion: search },
        { principioActivo: search },
        { marca: search },
      ];
    }

    const productos = await Producto.find(filter)
      .populate('farmaciaId', 'estado _id')
      .sort({ descripcion: 1 });

    // Precio ya viene con % aplicado (precioBase en Producto). En cliente no mostramos nombre farmacia, solo agrupamos por farmaciaId.
    const list = productos.map((p) => ({
      _id: p._id,
      codigo: p.codigo,
      descripcion: p.descripcion,
      principioActivo: p.principioActivo,
      presentacion: p.presentacion,
      marca: p.marca,
      categoria: p.categoria,
      precio: p.precioBase,
      existencia: p.existencia,
      foto: p.foto,
      farmaciaId: p.farmaciaId?._id,
      estadoFarmacia: p.farmaciaId?.estado,
    }));

    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar productos' });
  }
});

// Catálogo para nuevo frontend: mismos productos con información de descuentos. Query: estado, farmaciaId, q, page, page_size, lat, lng (lat/lng reservados para futuro orden por cercanía).
router.get('/catalogo', async (req, res) => {
  try {
    const { estado, farmaciaId, q, page = 0, page_size = 20 } = req.query;
    const filter = { existencia: { $gt: 0 } };

    if (farmaciaId) {
      filter.farmaciaId = farmaciaId;
    }

    if (estado && ESTADOS_VENEZUELA.includes(estado)) {
      const farmacias = await Farmacia.find({ estado }).select('_id');
      const ids = farmacias.map((f) => f._id);
      filter.farmaciaId = { $in: ids };
    }

    if (q && String(q).trim()) {
      const search = new RegExp(String(q).trim(), 'i');
      filter.$or = [
        { codigo: search },
        { descripcion: search },
        { principioActivo: search },
        { marca: search },
      ];
    }

    const skip = Math.max(0, parseInt(page, 10) || 0) * Math.max(1, Math.min(100, parseInt(page_size, 10) || 20));
    const limit = Math.max(1, Math.min(100, parseInt(page_size, 10) || 20));

    const [productos, total] = await Promise.all([
      Producto.find(filter)
        .populate('farmaciaId', 'estado _id')
        .sort({ descripcion: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Producto.countDocuments(filter),
    ]);

    const respuesta = productos.map((p) => {
      const descuento = getDescuento(p);
      const precioBase = Number(p.precioBase) || 0;
      const precioCon = getPrecioConPorcentaje(p);
      return {
        id: p._id.toString(),
        codigo: p.codigo,
        descripcion: p.descripcion,
        principioActivo: p.principioActivo,
        presentacion: p.presentacion,
        marca: p.marca,
        categoria: p.categoria,
        precio: precioBase,
        descuentoPorcentaje: descuento,
        precioConPorcentaje: precioCon,
        imagen: p.foto,
        farmaciaId: (p.farmaciaId?._id || p.farmaciaId)?.toString(),
        existencia: p.existencia,
      };
    });

    res.json({
      items: respuesta,
      page: Math.max(0, parseInt(page, 10) || 0),
      page_size: limit,
      total,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar catálogo' });
  }
});

// Costo de delivery estimado según carrito actual y opcionalmente lat/lng. El costo no supera el subtotal (evitar que delivery sea más caro que los productos).
router.get('/delivery/estimado', async (req, res) => {
  try {
    const items = await Carrito.find({ clienteId: getClienteId(req) }).populate('productoId');
    let subtotal = 0;
    const byFarmacia = new Map();
    for (const it of items) {
      const p = it.productoId;
      if (!p) continue;
      const precioUnitario = getPrecioConPorcentaje(p);
      const monto = precioUnitario * it.cantidad;
      subtotal += monto;
      const fid = (p.farmaciaId && (p.farmaciaId._id || p.farmaciaId))?.toString();
      if (fid) byFarmacia.set(fid, (byFarmacia.get(fid) || 0) + monto);
    }
    const numFarmacias = byFarmacia.size || 1;
    const costoDeliveryBase = 2;
    const costoDeliveryExtra = (numFarmacias - 1) * 1.5;
    let costo = Math.round((costoDeliveryBase + Math.max(0, costoDeliveryExtra)) * 100) / 100;
    if (subtotal > 0 && costo > subtotal) {
      costo = Math.round(Math.min(costo, subtotal * 0.5) * 100) / 100;
    }
    res.json({ costo });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al estimar delivery' });
  }
});

// Estados para filtro
router.get('/estados', (req, res) => {
  res.json(ESTADOS_VENEZUELA);
});

// Carrito: agregar
router.post('/carrito',
  body('productoId').isMongoId(),
  body('cantidad').isInt({ min: 1 }),
  async (req, res) => {
    try {
      const err = validationResult(req);
      if (!err.isEmpty()) return res.status(400).json({ error: 'Datos inválidos' });

      const producto = await Producto.findById(req.body.productoId);
      if (!producto || producto.existencia < req.body.cantidad) {
        return res.status(400).json({ error: 'Producto no disponible o sin stock' });
      }

      let item = await Carrito.findOne({
        clienteId: getClienteId(req),
        productoId: req.body.productoId,
      });
      if (item) {
        item.cantidad = Math.min(item.cantidad + req.body.cantidad, producto.existencia);
        await item.save();
      } else {
        item = await Carrito.create({
          clienteId: getClienteId(req),
          productoId: req.body.productoId,
          cantidad: Math.min(req.body.cantidad, producto.existencia),
        });
      }

      const carrito = await Carrito.find({ clienteId: getClienteId(req) })
        .populate('productoId');
      res.json(carrito);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al agregar al carrito' });
    }
  }
);

// Carrito: listar
router.get('/carrito', async (req, res) => {
  try {
    const items = await Carrito.find({ clienteId: getClienteId(req) })
      .populate('productoId');
    res.json(items);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener carrito' });
  }
});

// Carrito: actualizar cantidad
router.patch('/carrito/:productoId',
  body('cantidad').isInt({ min: 0 }),
  async (req, res) => {
    try {
      const err = validationResult(req);
      if (!err.isEmpty()) return res.status(400).json({ error: 'Cantidad inválida' });
      if (req.body.cantidad === 0) {
        await Carrito.deleteOne({ clienteId: getClienteId(req), productoId: req.params.productoId });
      } else {
        const producto = await Producto.findById(req.params.productoId);
        if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });
        await Carrito.updateOne(
          { clienteId: getClienteId(req), productoId: req.params.productoId },
          { cantidad: Math.min(req.body.cantidad, producto.existencia) }
        );
      }
      const carrito = await Carrito.find({ clienteId: getClienteId(req) }).populate('productoId');
      res.json(carrito);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al actualizar carrito' });
    }
  }
);

// Carrito: eliminar item
router.delete('/carrito/:productoId', async (req, res) => {
  try {
    await Carrito.deleteOne({ clienteId: getClienteId(req), productoId: req.params.productoId });
    const carrito = await Carrito.find({ clienteId: getClienteId(req) }).populate('productoId');
    res.json(carrito);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

// Resumen checkout: total + costo delivery (según lógica; aquí se puede usar distancia o fijo)
router.get('/checkout/resumen', async (req, res) => {
  try {
    const items = await Carrito.find({ clienteId: getClienteId(req) }).populate('productoId');
    const cliente = await User.findById(getClienteId(req));
    let subtotal = 0;
    const byFarmacia = new Map();

    for (const it of items) {
      const p = it.productoId;
      if (!p) continue;
      const precioUnitario = getPrecioConPorcentaje(p);
      const monto = precioUnitario * it.cantidad;
      subtotal += monto;
      const fid = p.farmaciaId?.toString() || p.farmaciaId;
      if (!byFarmacia.has(fid)) byFarmacia.set(fid, 0);
      byFarmacia.set(fid, byFarmacia.get(fid) + monto);
    }

    // Costo delivery: ejemplo base 2$ + 0.5$ por cada farmacia adicional
    const numFarmacias = byFarmacia.size;
    const costoDeliveryBase = 2;
    const costoDeliveryExtra = (numFarmacias - 1) * 1.5;
    const costoDelivery = Math.round((costoDeliveryBase + Math.max(0, costoDeliveryExtra)) * 100) / 100;
    const total = Math.round((subtotal + costoDelivery) * 100) / 100;

    res.json({
      subtotal,
      costoDelivery,
      total,
      numFarmacias,
      direccion: cliente?.direccion,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al calcular resumen' });
  }
});

// Procesar compra: subir comprobante y crear pedido(s) por farmacia. Body puede incluir direccionEntrega, latEntrega, lngEntrega.
router.post('/checkout/procesar',
  body('metodoPago').isIn(['pago_movil', 'transferencia', 'zelle', 'binance']),
  body('direccionEntrega').optional().trim(),
  body('latEntrega').optional().isFloat(),
  body('lngEntrega').optional().isFloat(),
  upload.single('comprobante'),
  async (req, res) => {
    try {
      const err = validationResult(req);
      if (!err.isEmpty()) return res.status(400).json({ error: 'Datos inválidos' });

      if (!req.file) return res.status(400).json({ error: 'Debe cargar el comprobante de pago' });

      const cliente = await User.findById(getClienteId(req));
      const items = await Carrito.find({ clienteId: getClienteId(req) }).populate('productoId');
      if (!items.length) return res.status(400).json({ error: 'Carrito vacío' });

      const comprobanteUrl = `/uploads/${req.file.filename}`;
      const direccionEntrega = (req.body.direccionEntrega && String(req.body.direccionEntrega).trim()) || cliente.direccion || '';
      const lat = req.body.latEntrega != null ? Number(req.body.latEntrega) : cliente.ultimaLat;
      const lng = req.body.lngEntrega != null ? Number(req.body.lngEntrega) : cliente.ultimaLng;

      // Agrupar por farmacia
      const porFarmacia = new Map();
      for (const it of items) {
        const p = it.productoId;
        if (!p) continue;
        const fid = p.farmaciaId?.toString() || p.farmaciaId;
        if (!porFarmacia.has(fid)) porFarmacia.set(fid, []);
        const precioUnitario = getPrecioConPorcentaje(p);
        porFarmacia.get(fid).push({ productoId: p._id, cantidad: it.cantidad, precioUnitario, codigo: p.codigo, descripcion: p.descripcion });
      }

      const costoDeliveryBase = 2;
      const numFarmacias = porFarmacia.size;
      const costoDeliveryPorPedido = Math.round((costoDeliveryBase + (numFarmacias - 1) * 1.5) / numFarmacias * 100) / 100;

      const pedidosCreados = [];

      for (const [farmaciaId, articulos] of porFarmacia) {
        let subtotal = 0;
        const lineas = articulos.map((a) => {
          subtotal += a.precioUnitario * a.cantidad;
          return {
            productoId: a.productoId,
            codigo: a.codigo,
            descripcion: a.descripcion,
            cantidad: a.cantidad,
            precioUnitario: a.precioUnitario,
          };
        });
        const costoDelivery = costoDeliveryPorPedido;
        const total = Math.round((subtotal + costoDelivery) * 100) / 100;

        const pedido = await Pedido.create({
          clienteId: getClienteId(req),
          farmaciaId: new mongoose.Types.ObjectId(farmaciaId),
          items: lineas,
          subtotal,
          costoDelivery,
          total,
          direccionEntrega,
          lat,
          lng,
          metodoPago: req.body.metodoPago,
          comprobanteUrl,
          estado: 'pendiente_validacion',
        });
        pedidosCreados.push(pedido);

        const farmacia = await Farmacia.findById(farmaciaId);
        const userFarmacia = await User.findOne({ farmaciaId });
        if (userFarmacia) {
          await Notificacion.create({
            userId: userFarmacia._id,
            tipo: 'pedido_nuevo',
            mensaje: `Nuevo pedido #${pedido._id.toString().slice(-6)}`,
            pedidoId: pedido._id,
          });
        }
      }

      await Carrito.deleteMany({ clienteId: getClienteId(req) });

      res.status(201).json({ message: 'Compra procesada', pedidos: pedidosCreados });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al procesar compra' });
    }
  }
);

// Actualizar ubicación (GPS) del cliente
router.patch('/ubicacion', body('lat').isFloat(), body('lng').isFloat(), async (req, res) => {
  try {
    await User.updateOne(
      { _id: getClienteId(req) },
      { ultimaLat: req.body.lat, ultimaLng: req.body.lng }
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al actualizar ubicación' });
  }
});

// Mis pedidos (incluye etaEntrega para mostrar ETA al cliente)
router.get('/mis-pedidos', async (req, res) => {
  try {
    const pedidos = await Pedido.find({ clienteId: getClienteId(req) })
      .populate('farmaciaId', 'nombreFarmacia direccion estado lat lng')
      .populate('deliveryId', 'nombre ultimaLat ultimaLng')
      .sort({ createdAt: -1 });
    res.json(pedidos);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar pedidos' });
  }
});

// Seguimiento de un pedido: estado, dirección y coords de entrega, ETA, posición del delivery en tiempo real
router.get('/pedidos/:id/seguimiento', async (req, res) => {
  try {
    const pedido = await Pedido.findOne({ _id: req.params.id, clienteId: getClienteId(req) })
      .populate('farmaciaId', 'nombreFarmacia direccion telefono lat lng')
      .populate('deliveryId', 'nombre telefono ultimaLat ultimaLng');
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    const p = pedido.toObject();
    res.json({
      id: p._id,
      estado: p.estado,
      direccionEntrega: p.direccionEntrega,
      latEntrega: p.lat,
      lngEntrega: p.lng,
      etaEntrega: p.etaEntrega,
      farmacia: p.farmaciaId,
      delivery: p.deliveryId ? {
        nombre: p.deliveryId.nombre,
        telefono: p.deliveryId.telefono,
        lat: p.deliveryId.ultimaLat,
        lng: p.deliveryId.ultimaLng,
      } : null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener seguimiento' });
  }
});

export default router;
