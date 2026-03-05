import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: {
    type: String,
    enum: ['master', 'farmacia', 'cliente', 'delivery'],
    required: true,
  },
  // Común
  nombre: String,
  activo: { type: Boolean, default: true },

  // Cliente
  cedula: String,
  apellido: String,
  direccion: String,
  telefono: String,

  // Farmacia (referencia al documento Farmacia)
  farmaciaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Farmacia' },

  // Delivery (tras aprobación)
  fotoCarnet: String,
  deliveryAprobado: { type: Boolean, default: false },
  activoRecepcionPedidos: { type: Boolean, default: false },
  ultimaLat: Number,
  ultimaLng: Number,
}, { timestamps: true });

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

export default mongoose.model('User', userSchema);
