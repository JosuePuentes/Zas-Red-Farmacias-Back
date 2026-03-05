/**
 * Valida que el usuario master exista en MongoDB con role 'master'.
 * Si existe con otro role, lo actualiza a 'master'.
 * Uso: desde backend/ con MONGODB_URI en env.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/models/User.js';

const MASTER_EMAIL = process.env.MASTER_EMAIL || 'admin@zas.com';

async function validar() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Define MONGODB_URI en .env');
    process.exit(1);
  }
  await mongoose.connect(uri);

  const user = await User.findOne({ email: MASTER_EMAIL });
  if (!user) {
    console.error('No existe usuario con email:', MASTER_EMAIL);
    process.exit(1);
  }

  const roleActual = (user.role || '').toString();
  if (roleActual.toLowerCase() !== 'master') {
    user.role = 'master';
    await user.save();
    console.log('Usuario actualizado: role cambiado de "%s" a "master"', roleActual);
  } else {
    console.log('OK: Usuario master existe con role "master":', MASTER_EMAIL);
  }
  process.exit(0);
}

validar().catch((err) => {
  console.error(err);
  process.exit(1);
});
