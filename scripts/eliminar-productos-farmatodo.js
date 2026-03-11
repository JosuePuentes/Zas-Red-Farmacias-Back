/**
 * Elimina de catalogo_maestro (base Zas) los productos cuya descripción o marca
 * contenga "Farmatodo" (origen de la ingesta; no deben quedar en nuestra base).
 *
 * Uso: desde backend/  node scripts/eliminar-productos-farmatodo.js
 * Requiere MONGODB_URI en .env. Opcional: MONGO_DB_CATALOGO (default: Zas)
 */
import 'dotenv/config';
import mongoose from 'mongoose';

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Define MONGODB_URI en .env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const dbName = process.env.MONGO_DB_CATALOGO || 'Zas';
  const coll = mongoose.connection.useDb(dbName).collection('catalogo_maestro');

  const filter = {
    $or: [
      { description: { $regex: /Farmatodo/i } },
      { brand: { $regex: /Farmatodo/i } },
    ],
  };

  const count = await coll.countDocuments(filter);
  console.log(`Documentos a eliminar (descripción o marca con "Farmatodo"): ${count}`);

  if (count === 0) {
    console.log('Nada que eliminar.');
    await mongoose.disconnect();
    process.exit(0);
    return;
  }

  const result = await coll.deleteMany(filter);
  console.log(`Eliminados: ${result.deletedCount}`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
