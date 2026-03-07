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
      result.push({
        ...p.toObject(),
        tiempoLimiteAceptar: tiempoLimite,
        precioDelivery: p.costoDelivery,
      });
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
      mensaje: 'Un repartidor ha aceptado tu pedido.',
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
    const pedidos = await Pedido.find({ deliveryId: getDeliveryId(req) })
      .populate('clienteId', 'nombre apellido telefono direccion estado municipio')
      .populate('farmaciaId', 'nombreFarmacia direccion telefono estado lat lng')
      .sort({ aceptadoEn: -1 });
    res.json(pedidos);
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

// Marcar en camino / entregado
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
          mensaje: 'Tu pedido ha sido entregado.',
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
