import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import Pedido from '../models/Pedido.js';
import User from '../models/User.js';
import Notificacion from '../models/Notificacion.js';
import DeliveryStats from '../models/DeliveryStats.js';
import { auth, requireRole, attachUser } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const router = Router();

router.use(auth, requireRole('delivery'), attachUser);

// Activar/desactivar recepción de pedidos
router.patch('/activo', body('activo').isBoolean(), async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user?.deliveryAprobado) return res.status(403).json({ error: 'Delivery no aprobado' });

    await User.updateOne(
      { _id: req.userId },
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
    const user = await User.findById(req.userId);
    if (!user?.deliveryAprobado || !user?.activoRecepcionPedidos) {
      return res.json([]);
    }

    const pedidos = await Pedido.find({
      estado: 'validado',
      deliveryId: null,
    })
      .populate('clienteId', 'nombre apellido telefono direccion')
      .populate('farmaciaId', 'nombreFarmacia direccion telefono')
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
    const user = await User.findById(req.userId);
    if (!user?.deliveryAprobado || !user?.activoRecepcionPedidos) {
      return res.status(403).json({ error: 'Debe activar recepción de pedidos' });
    }

    const pedido = await Pedido.findById(req.params.id)
      .populate('farmaciaId', 'nombreFarmacia direccion telefono')
      .populate('clienteId', 'nombre apellido telefono direccion');

    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (pedido.estado !== 'validado' || pedido.deliveryId) {
      return res.status(400).json({ error: 'Pedido ya asignado o no disponible' });
    }

    const tiempoLimite = pedido.tiempoLimiteAceptar || new Date(pedido.createdAt.getTime() + 60 * 1000);
    if (new Date() > tiempoLimite) {
      return res.status(400).json({ error: 'Tiempo para aceptar agotado' });
    }

    pedido.deliveryId = req.userId;
    pedido.estado = 'asignado_delivery';
    pedido.aceptadoEn = new Date();
    await pedido.save();

    await DeliveryStats.create({
      deliveryId: req.userId,
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

// Mis pedidos asignados (en camino, etc.)
router.get('/mis-pedidos', async (req, res) => {
  try {
    const pedidos = await Pedido.find({ deliveryId: req.userId })
      .populate('clienteId', 'nombre apellido telefono direccion')
      .populate('farmaciaId', 'nombreFarmacia direccion telefono')
      .sort({ aceptadoEn: -1 });
    res.json(pedidos);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar pedidos' });
  }
});

// Marcar en camino / entregado
router.patch('/pedidos/:id/estado',
  body('estado').isIn(['en_camino', 'entregado']),
  async (req, res) => {
    try {
      const pedido = await Pedido.findOne({ _id: req.params.id, deliveryId: req.userId });
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
      { pedidoId: req.params.id, deliveryId: req.userId },
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
      { $match: { deliveryId: req.userId } },
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
