import mongoose from 'mongoose';

const catalogoSchema = new mongoose.Schema({
  codigo: { type: String, required: true, unique: true },
  descripcion: { type: String, required: true },
}, { timestamps: true });

export default mongoose.model('Catalogo', catalogoSchema);
