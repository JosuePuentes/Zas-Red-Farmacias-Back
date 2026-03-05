/**
 * Crear el primer usuario master.
 * Uso: desde backend/ node scripts/seedMaster.js
 * Requiere MONGODB_URI en .env. Opcional: MASTER_EMAIL, MASTER_PASSWORD
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/models/User.js';

async function seed() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Define MONGODB_URI en .env');
    process.exit(1);
  }
  const email = process.env.MASTER_EMAIL || 'admin@zas.com';
  const password = process.env.MASTER_PASSWORD || 'admin123';

  await mongoose.connect(uri);
  const exists = await User.findOne({ email });
  if (exists) {
    console.log('Ya existe un usuario con ese correo.');
    process.exit(0);
  }
  await User.create({
    email,
    password,
    role: 'master',
    nombre: 'Administrador',
    activo: true,
  });
  console.log('Usuario master creado:', email);
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
