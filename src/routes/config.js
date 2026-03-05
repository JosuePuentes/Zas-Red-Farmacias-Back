import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import Config from '../models/Config.js';
import { auth, requireRole } from '../middleware/auth.js';

const router = Router();
const CLAVE_BCV = 'bcv';

async function getBcv() {
  const doc = await Config.findOne({ clave: CLAVE_BCV });
  const envBcv = process.env.BCV_TASA ? Number(process.env.BCV_TASA) : null;
  return doc ? doc.valor : (envBcv || 36);
}

// Público: obtener tasa BCV para mostrar precios en Bs
router.get('/', async (req, res) => {
  try {
    const bcv = await getBcv();
    res.json({ bcv });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener configuración' });
  }
});

// Solo master: actualizar tasa BCV
router.put('/bcv',
  auth,
  requireRole('master'),
  body('valor').isFloat({ min: 0.0001 }),
  async (req, res) => {
    try {
      const err = validationResult(req);
      if (!err.isEmpty()) return res.status(400).json({ error: 'Valor de tasa BCV inválido' });

      const valor = Number(req.body.valor);
      await Config.findOneAndUpdate(
        { clave: CLAVE_BCV },
        { clave: CLAVE_BCV, valor },
        { upsert: true, new: true }
      );
      res.json({ bcv: valor });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al actualizar BCV' });
    }
  }
);

export default router;
export { getBcv };
