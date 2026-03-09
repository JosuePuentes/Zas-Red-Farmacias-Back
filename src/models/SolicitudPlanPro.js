import mongoose from 'mongoose';

const solicitudPlanProSchema = new mongoose.Schema({
  farmaciaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Farmacia', required: true },
  bancoEmisor: { type: String, required: true, trim: true },
  numeroReferencia: { type: String, required: true, trim: true },
  comprobanteUrl: { type: String, required: true },
  estado: {
    type: String,
    enum: ['pendiente', 'aprobado', 'denegado'],
    default: 'pendiente',
  },
}, { timestamps: true });

solicitudPlanProSchema.index({ farmaciaId: 1 });
solicitudPlanProSchema.index({ estado: 1 });

export default mongoose.model('SolicitudPlanPro', solicitudPlanProSchema);
