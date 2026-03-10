import mongoose from 'mongoose';

const recordatorioMedicamentoSchema = new mongoose.Schema({
  clienteId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  codigo: { type: String, required: true },
  descripcion: { type: String, required: true },
  imagen: String,
  fechaCompra: { type: Date, required: true },
  cantidadInicial: { type: Number, required: true, min: 1 },
  cantidadPorToma: { type: Number, required: true, min: 0.5 },
  intervaloHoras: { type: Number, required: true, min: 0.25 },
  precioReferencia: Number,
  fechaEstimadaFin: { type: Date, required: true },
  notificadoFinProximo: { type: Boolean, default: false },
  activo: { type: Boolean, default: true },
}, { timestamps: true });

recordatorioMedicamentoSchema.index({ clienteId: 1, activo: 1 });

export default mongoose.model('RecordatorioMedicamento', recordatorioMedicamentoSchema);
