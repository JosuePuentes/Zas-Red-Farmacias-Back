import { Router } from 'express';
import Notificacion from '../models/Notificacion.js';
import { auth } from '../middleware/auth.js';

const router = Router();

router.use(auth);

router.get('/', async (req, res) => {
  try {
    const list = await Notificacion.find({ userId: req.userId })
      .populate('pedidoId')
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar notificaciones' });
  }
});

router.patch('/:id/leer', async (req, res) => {
  try {
    await Notificacion.updateOne(
      { _id: req.params.id, userId: req.userId },
      { leido: true }
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al marcar' });
  }
});

router.get('/sin-leer/count', async (req, res) => {
  try {
    const count = await Notificacion.countDocuments({
      userId: req.userId,
      leido: false,
    });
    res.json({ count });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error' });
  }
});

export default router;
