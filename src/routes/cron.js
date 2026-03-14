import { Router } from 'express';
import RecordatorioMedicamento from '../models/RecordatorioMedicamento.js';
import Notificacion from '../models/Notificacion.js';

const router = Router();

// Protección por secreto (configurar CRON_SECRET en Render)
function requireCronSecret(req, res, next) {
  const secret = req.query.secret || req.headers['x-cron-secret'];
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

// Parsea "14:00" o "14:30" a minutos desde medianoche
function parseHora(str) {
  if (!str || typeof str !== 'string') return null;
  const [h, m] = str.trim().split(':').map(Number);
  if (!Number.isInteger(h) || h < 0 || h > 23) return null;
  const min = Number.isInteger(m) ? m : 0;
  if (min < 0 || min > 59) return null;
  return h * 60 + min;
}

// GET /api/cron/recordatorios-hora?secret=XXX — ejecutar cada 15 min desde Render Cron
// Envía notificaciones tipo "Dona: Recuerda, [nombre], tomarte tu pastilla de las 2:00pm"
router.get('/recordatorios-hora', requireCronSecret, async (req, res) => {
  try {
    const now = new Date();
    const currentDay = now.getDay();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const windowStart = currentMinutes;
    const windowEnd = currentMinutes + 14;

    const recordatorios = await RecordatorioMedicamento.find({
      activo: true,
      hora: { $exists: true, $ne: null, $ne: '' },
    }).populate('clienteId', 'nombre');

    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let enviadas = 0;
    for (const rec of recordatorios) {
      const horaMin = parseHora(rec.hora);
      if (horaMin == null) continue;
      if (horaMin < windowStart || horaMin > windowEnd) continue;

      const dias = rec.dias && rec.dias.length ? rec.dias : [0, 1, 2, 3, 4, 5, 6];
      if (!dias.includes(currentDay)) continue;

      const yaEnviada = rec.ultimaNotificacionHoraFecha && new Date(rec.ultimaNotificacionHoraFecha).getTime() >= startOfToday.getTime();
      if (yaEnviada) continue;

      const clienteId = rec.clienteId?._id || rec.clienteId;
      if (!clienteId) continue;

      const nombre = (rec.clienteId?.nombre || '').trim() || 'querido';
      const horaFormato = rec.hora || '';

      await Notificacion.create({
        userId: clienteId,
        tipo: 'recordatorio_hora',
        mensaje: `Dona: Recuerda, ${nombre}, tomarte tu pastilla de las ${horaFormato}. ¡Cuídate!`,
        recordatorioId: rec._id,
      });

      rec.ultimaNotificacionHoraFecha = startOfToday;
      await rec.save();
      enviadas++;
    }

    res.json({ ok: true, enviadas });
  } catch (e) {
    console.error('Error cron recordatorios-hora', e);
    res.status(500).json({ error: 'Error al procesar recordatorios por hora' });
  }
});

export default router;
