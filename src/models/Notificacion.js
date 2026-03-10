import mongoose from 'mongoose';

const notificacionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tipo: { type: String, required: true }, // 'pedido_nuevo', 'pedido_validado', 'recordatorio_quedapoco', etc.
  mensaje: { type: String, required: true },
  pedidoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pedido' },
  recordatorioId: { type: mongoose.Schema.Types.ObjectId, ref: 'RecordatorioMedicamento' },
  leido: { type: Boolean, default: false },
}, { timestamps: true });

notificacionSchema.index({ userId: 1, leido: 1 });

export default mongoose.model('Notificacion', notificacionSchema);
