import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { connectDB } from './config/db.js';

const __dirnameUp = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirnameUp, '../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
import authRoutes from './routes/auth.js';
import masterRoutes from './routes/master.js';
import farmaciaRoutes from './routes/farmacia.js';
import farmaciasRoutes from './routes/farmacias.js';
import clienteRoutes from './routes/cliente.js';
import deliveryRoutes from './routes/delivery.js';
import solicitudDeliveryRoutes from './routes/solicitudDelivery.js';
import solicitudFarmaciaRoutes from './routes/solicitudFarmacia.js';
import notificacionesRoutes from './routes/notificaciones.js';
import configRoutes from './routes/config.js';

const app = express();
app.use(cors());
app.use(express.json());

// Archivos subidos (comprobantes, fotos)
app.use('/uploads', express.static(uploadDir));

app.use('/api/auth', authRoutes);
app.use('/api/master', masterRoutes);
app.use('/api/farmacia', farmaciaRoutes);
app.use('/api/farmacias', farmaciasRoutes);
app.use('/api/cliente', clienteRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/solicitud-delivery', solicitudDeliveryRoutes);
app.use('/api/solicitud-farmacia', solicitudFarmaciaRoutes);
app.use('/api/notificaciones', notificacionesRoutes);
app.use('/api/config', configRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;
connectDB().then(() => {
  app.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT}`));
});
