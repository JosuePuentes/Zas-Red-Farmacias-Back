import mongoose from 'mongoose';

const configSchema = new mongoose.Schema({
  clave: { type: String, required: true, unique: true },
  valor: { type: Number, required: true },
}, { timestamps: true });

export default mongoose.model('Config', configSchema);
