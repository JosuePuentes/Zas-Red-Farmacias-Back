import mongoose from 'mongoose';

const conversacionDonaSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  messages: [{
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, default: '' },
    product: { type: mongoose.Schema.Types.Mixed },
    createdAt: { type: Date, default: Date.now },
  }],
  lastInteractionAt: { type: Date, default: Date.now },
}, { timestamps: true });

conversacionDonaSchema.index({ userId: 1 });
conversacionDonaSchema.index({ lastInteractionAt: 1 });

// Mantener solo los últimos N mensajes para no inflar el documento
const MAX_MESSAGES = 80;

conversacionDonaSchema.statics.appendMessages = async function (userId, newMessages) {
  const doc = await this.findOne({ userId });
  const prev = (doc?.messages || []).slice(-(MAX_MESSAGES - newMessages.length));
  const messages = [...prev, ...newMessages];
  await this.findOneAndUpdate(
    { userId },
    { $set: { messages, lastInteractionAt: new Date() } },
    { upsert: true, new: true }
  );
};

export default mongoose.model('ConversacionDona', conversacionDonaSchema);
