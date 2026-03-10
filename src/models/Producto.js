import mongoose from 'mongoose';

export const CATEGORIAS_PRODUCTO = [
  'Analgésicos y Antipiréticos',
  'Antibióticos',
  'Antiinflamatorios',
  'Antigripales y Tos',
  'Cuidados Especializados',
  'Cardiovascular',
  'Gastrointestinal',
  'Salud Visual',
  'Diabetes',
  'Salud y Bienestar',
  'Vitaminas y Suplementos',
  'Cuidado Personal',
  'Primeros Auxilios',
  'Mamá y Bebé',
  'Maternidad',
  'Infantil',
];

const productoSchema = new mongoose.Schema({
  farmaciaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Farmacia', required: true },
  codigo: { type: String, required: true },
  descripcion: { type: String, required: true },
  descripcionCatalogo: { type: String },      // descripción del sistema (catalogo_maestro) cuando hay match
  descripcionPersonalizada: { type: String },  // descripción que trajo el Excel de la farmacia
  usarDescripcionCatalogo: { type: Boolean, default: true }, // true = mostrar descripcionCatalogo; false = descripcionPersonalizada
  principioActivo: String,
  presentacion: String,
  marca: String,
  categoria: { type: String, enum: CATEGORIAS_PRODUCTO, required: false },
  precioBase: { type: Number, required: true },
  descuentoPorcentaje: { type: Number, default: 0 },
  precioConPorcentaje: { type: Number },
  existencia: { type: Number, required: true, default: 0 },
  foto: String,
}, { timestamps: true });

productoSchema.virtual('descripcionVisible').get(function () {
  if (this.usarDescripcionCatalogo && this.descripcionCatalogo) return this.descripcionCatalogo;
  if (this.descripcionPersonalizada) return this.descripcionPersonalizada;
  return this.descripcion;
});

productoSchema.set('toJSON', { virtuals: true });
productoSchema.set('toObject', { virtuals: true });

// Índice para búsqueda por farmacia y filtros
productoSchema.index({ farmaciaId: 1, codigo: 1 }, { unique: true });
productoSchema.index({ farmaciaId: 1, descripcion: 'text', marca: 'text' });

export default mongoose.model('Producto', productoSchema);
