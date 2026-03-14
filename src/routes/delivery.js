import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import Pedido from '../models/Pedido.js';
import User from '../models/User.js';
import Notificacion from '../models/Notificacion.js';
import DeliveryStats from '../models/DeliveryStats.js';
import mongoose from 'mongoose';
import { auth, requireRole, attachUser } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const router = Router();

router.use(auth, requireRole('delivery'), attachUser);

function getDeliveryId(req) {
  if (req.role === 'master' && (req.headers['x-delivery-id'] || req.query.deliveryId)) {
    const id = req.headers['x-delivery-id'] || req.query.deliveryId;
    if (mongoose.Types.ObjectId.isValid(id)) return new mongoose.Types.ObjectId(id);
  }
  return req.userId;
}

function kmEntre(lat1, lng1, lat2, lng2) {
  const n1 = Number(lat1);
  const n2 = Number(lng1);
  const n3 = Number(lat2);
  const n4 = Number(lng2);
  if (![n1, n2, n3, n4].every((v) => Number.isFinite(v))) return Infinity;
  const R = 6371; // km
  const dLat = (n3 - n1) * Math.PI / 180;
  const dLng = (n4 - n2) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(n1 * Math.PI / 180) * Math.cos(n3 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Actualizar posición del delivery en tiempo real (para que el cliente vea dónde va)
router.patch('/ubicacion',
  body('lat').isFloat(),
  body('lng').isFloat(),
  async (req, res) => {
    try {
      const err = validationResult(req);
      if (!err.isEmpty()) return res.status(400).json({ error: 'lat y lng requeridos', details: err.array() });
      await User.updateOne(
        { _id: getDeliveryId(req) },
        { ultimaLat: req.body.lat, ultimaLng: req.body.lng }
      );
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al actualizar ubicación' });
    }
  }
);

// Estado + ubicación del delivery (para frontend móvil):
// POST /api/delivery/estado
// Body: { "activo": boolean, "lat"?: number, "lng"?: number }
router.post('/estado',
  body('activo').isBoolean(),
  body('lat').optional().isFloat(),
  body('lng').optional().isFloat(),
  async (req, res) => {
    try {
      const err = validationResult(req);
      if (!err.isEmpty()) {
        return res.status(400).json({ error: 'Datos inválidos', details: err.array() });
      }

      const deliveryId = getDeliveryId(req);
      const update = {
        activoRecepcionPedidos: !!req.body.activo,
      };

      const lat = req.body.lat;
      const lng = req.body.lng;
      if (lat !== null && lat !== undefined && Number.isFinite(Number(lat))) {
        update.ultimaLat = Number(lat);
      }
      if (lng !== null && lng !== undefined && Number.isFinite(Number(lng))) {
        update.ultimaLng = Number(lng);
      }

      await User.updateOne({ _id: deliveryId }, update);

      res.json({
        ok: true,
        activo: !!req.body.activo,
        lat: update.ultimaLat ?? null,
        lng: update.ultimaLng ?? null,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al actualizar estado de delivery' });
    }
  }
);

// Activar/desactivar recepción de pedidos
router.patch('/activo', body('activo').isBoolean(), async (req, res) => {
  try {
    const user = await User.findById(getDeliveryId(req));
    if (!user?.deliveryAprobado) return res.status(403).json({ error: 'Delivery no aprobado' });

    await User.updateOne(
      { _id: getDeliveryId(req) },
      { activoRecepcionPedidos: !!req.body.activo }
    );
    res.json({ activoRecepcionPedidos: !!req.body.activo });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al actualizar' });
  }
});

// Pedidos validados disponibles para aceptar (solo si está activo)
router.get('/pedidos-disponibles', async (req, res) => {
  try {
    const user = await User.findById(getDeliveryId(req));
    if (!user?.deliveryAprobado || !user?.activoRecepcionPedidos) {
      return res.json([]);
    }

    const pedidos = await Pedido.find({
      estado: 'validado',
      deliveryId: null,
    })
      .populate('clienteId', 'nombre apellido telefono direccion estado municipio')
      .populate('farmaciaId', 'nombreFarmacia direccion telefono estado lat lng')
      .sort({ createdAt: 1 });

    // Añadir tiempo límite 1 min si no existe
    const now = new Date();
    const result = [];
    for (const p of pedidos) {
      let tiempoLimite = p.tiempoLimiteAceptar;
      if (!tiempoLimite) {
        tiempoLimite = new Date(p.createdAt.getTime() + 60 * 1000);
        if (now > tiempoLimite) continue; // ya pasó el minuto
      } else if (now > tiempoLimite) continue;
      const obj = {
        ...p.toObject(),
        tiempoLimiteAceptar: tiempoLimite,
        precioDelivery: p.costoDelivery,
      };
      if (p.farmaciaId?.lat != null && p.farmaciaId?.lng != null) {
        obj.coordsFarmacia = { lat: p.farmaciaId.lat, lng: p.farmaciaId.lng };
      }
      if (p.lat != null && p.lng != null) {
        obj.coordsEntrega = { lat: p.lat, lng: p.lng };
      }
      result.push(obj);
    }
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar pedidos' });
  }
});

// Aceptar pedido (dentro del minuto)
router.post('/pedidos/:id/aceptar', async (req, res) => {
  try {
    const user = await User.findById(getDeliveryId(req));
    if (!user?.deliveryAprobado || !user?.activoRecepcionPedidos) {
      return res.status(403).json({ error: 'Debe activar recepción de pedidos' });
    }

    const pedido = await Pedido.findById(req.params.id)
      .populate('farmaciaId', 'nombreFarmacia direccion telefono estado lat lng')
      .populate('clienteId', 'nombre apellido telefono direccion estado municipio');

    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (pedido.estado !== 'validado' || pedido.deliveryId) {
      return res.status(400).json({ error: 'Pedido ya asignado o no disponible' });
    }

    // Limitar a máximo 3 pedidos activos (asignado o en_camino)
    const activos = await Pedido.countDocuments({
      deliveryId: getDeliveryId(req),
      estado: { $in: ['asignado_delivery', 'en_camino'] },
    });
    if (activos >= 3) {
      return res.status(400).json({ error: 'Ya tienes el máximo de 3 pedidos activos.' });
    }

    // Verificar cercanía con pedidos activos existentes (si los hay)
    const pedidosActivos = await Pedido.find({
      deliveryId: getDeliveryId(req),
      estado: { $in: ['asignado_delivery', 'en_camino'] },
    }).select('lat lng');
    const latNueva = pedido.lat;
    const lngNueva = pedido.lng;
    for (const pa of pedidosActivos) {
      const dKm = kmEntre(pa.lat, pa.lng, latNueva, lngNueva);
      if (dKm === Infinity || dKm > 3) {
        return res.status(400).json({
          error: 'Las entregas no están lo suficientemente cerca para agrupar pedidos.',
        });
      }
    }

    const tiempoLimite = pedido.tiempoLimiteAceptar || new Date(pedido.createdAt.getTime() + 60 * 1000);
    if (new Date() > tiempoLimite) {
      return res.status(400).json({ error: 'Tiempo para aceptar agotado' });
    }

    pedido.deliveryId = getDeliveryId(req);
    pedido.estado = 'asignado_delivery';
    pedido.aceptadoEn = new Date();
    await pedido.save();

    await DeliveryStats.create({
      deliveryId: getDeliveryId(req),
      pedidoId: pedido._id,
      montoGanado: pedido.costoDelivery,
      kmRecorridos: 0,
    });

    await Notificacion.create({
      userId: pedido.clienteId._id,
      tipo: 'pedido_asignado',
      mensaje: 'Dona: ¡Buenas noticias! Un repartidor ya tomó tu pedido y va en camino. Te aviso cuando esté por llegar.',
      pedidoId: pedido._id,
    });

    res.json(pedido);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al aceptar pedido' });
  }
});

// Mis pedidos asignados (en camino, etc.) con datos de cliente y farmacia (incl. coordenadas farmacia)
router.get('/mis-pedidos', async (req, res) => {
  try {
    const deliveryId = getDeliveryId(req);
    const user = await User.findById(deliveryId).select('ultimaLat ultimaLng');
    const pedidos = await Pedido.find({ deliveryId })
      .populate('clienteId', 'nombre apellido telefono direccion estado municipio')
      .populate('farmaciaId', 'nombreFarmacia direccion telefono estado lat lng')
      .sort({ aceptadoEn: -1 });
    const list = pedidos.map((p) => {
      const obj = p.toObject();
      if (p.farmaciaId?.lat != null && p.farmaciaId?.lng != null) {
        obj.coordsFarmacia = { lat: p.farmaciaId.lat, lng: p.farmaciaId.lng };
      }
      if (p.lat != null && p.lng != null) {
        obj.coordsEntrega = { lat: p.lat, lng: p.lng };
      }
      if (user?.ultimaLat != null && user?.ultimaLng != null && p.lat != null && p.lng != null) {
        const dKm = kmEntre(user.ultimaLat, user.ultimaLng, p.lat, p.lng);
        obj.puedeMarcarEntregado = Number.isFinite(dKm) && dKm <= 0.15; // ~150m
      } else {
        obj.puedeMarcarEntregado = false;
      }
      return obj;
    });
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar pedidos' });
  }
});

// Actualizar ETA de entrega para un pedido (el cliente puede mostrarla)
router.patch('/pedidos/:id/eta',
  body('eta').isISO8601(),
  async (req, res) => {
    try {
      const err = validationResult(req);
      if (!err.isEmpty()) return res.status(400).json({ error: 'eta inválida (ISO 8601)', details: err.array() });
      const pedido = await Pedido.findOne({ _id: req.params.id, deliveryId: getDeliveryId(req) });
      if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
      pedido.etaEntrega = new Date(req.body.eta);
      await pedido.save();
      res.json(pedido);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al actualizar ETA' });
    }
  }
);

// Marcar en camino / entregado (estado genérico, usado internamente)
router.patch('/pedidos/:id/estado',
  body('estado').isIn(['en_camino', 'entregado']),
  async (req, res) => {
    try {
      const pedido = await Pedido.findOne({ _id: req.params.id, deliveryId: getDeliveryId(req) });
      if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });

      pedido.estado = req.body.estado;
      await pedido.save();

      if (req.body.estado === 'entregado') {
        await Notificacion.create({
          userId: pedido.clienteId,
          tipo: 'pedido_entregado',
          mensaje: 'Dona: Tu pedido ya fue entregado. Gracias por confiar en Zas!. Cualquier cosa, aquí estoy.',
          pedidoId: pedido._id,
        });
      }

      res.json(pedido);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al actualizar estado' });
    }
  }
);

// Marcar pedido como entregado (con validación de cercanía y actualización de stats)
router.post('/pedidos/:id/entregar', async (req, res) => {
  try {
    const deliveryId = getDeliveryId(req);
    const user = await User.findById(deliveryId).select('ultimaLat ultimaLng');
    const pedido = await Pedido.findOne({ _id: req.params.id, deliveryId })
      .populate('farmaciaId', 'lat lng');
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (!['asignado_delivery', 'en_camino'].includes(pedido.estado)) {
      return res.status(400).json({ error: 'Estado inválido para marcar entregado' });
    }

    // Verificar cercanía al punto de entrega (defensa extra además de puedeMarcarEntregado)
    if (user?.ultimaLat != null && user?.ultimaLng != null && pedido.lat != null && pedido.lng != null) {
      const dKm = kmEntre(user.ultimaLat, user.ultimaLng, pedido.lat, pedido.lng);
      if (!Number.isFinite(dKm) || dKm > 0.15) {
        return res.status(400).json({ error: 'Debes estar cerca del punto de entrega para marcar entregado.' });
      }
    }

    pedido.estado = 'entregado';
    await pedido.save();

    // Calcular km recorridos aprox. farmacia -> cliente (si hay coords)
    let kmPedido = 0;
    if (pedido.farmaciaId?.lat != null && pedido.farmaciaId?.lng != null && pedido.lat != null && pedido.lng != null) {
      kmPedido = kmEntre(pedido.farmaciaId.lat, pedido.farmaciaId.lng, pedido.lat, pedido.lng);
    }

    await DeliveryStats.updateOne(
      { deliveryId, pedidoId: pedido._id },
      { $set: { kmRecorridos: kmPedido } },
    );

    await Notificacion.create({
      userId: pedido.clienteId,
      tipo: 'pedido_entregado',
      mensaje: 'Dona: Tu pedido ya fue entregado. Gracias por confiar en Zas!. Cualquier cosa, aquí estoy.',
      pedidoId: pedido._id,
    });

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al marcar como entregado' });
  }
});

// Actualizar km en un pedido
router.patch('/pedidos/:id/km', body('km').isFloat({ min: 0 }), async (req, res) => {
  try {
    await DeliveryStats.updateOne(
      { pedidoId: req.params.id, deliveryId: getDeliveryId(req) },
      { $set: { kmRecorridos: req.body.km } }
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al actualizar km' });
  }
});

// Estadísticas: dinero ganado, total, km recorridos
router.get('/estadisticas', async (req, res) => {
  try {
    const stats = await DeliveryStats.aggregate([
      { $match: { deliveryId: getDeliveryId(req) } },
      {
        $group: {
          _id: null,
          totalGanado: { $sum: '$montoGanado' },
          totalKm: { $sum: '$kmRecorridos' },
          totalPedidos: { $sum: 1 },
        },
      },
    ]);

    const result = stats[0] || { totalGanado: 0, totalKm: 0, totalPedidos: 0 };
    res.json({
      totalGanado: Math.round(result.totalGanado * 100) / 100,
      totalKm: Math.round(result.totalKm * 100) / 100,
      totalPedidos: result.totalPedidos,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

export default router;
