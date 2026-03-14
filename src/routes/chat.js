import { Router } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { auth } from '../middleware/auth.js';
import ConversacionDona from '../models/ConversacionDona.js';
import { buscarProductoParaChat } from '../util/buscarProductoParaChat.js';

const router = Router();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const geminiClient = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

const SYSTEM_PROMPT = `Eres Dona, la Auxiliar Estrella de la red de farmacias Zas!. Eres una farmacéutica de confianza, dulce y con chispa, como nos caracterizamos en Venezuela.

Reglas de fluidez:
- Habla con naturalidad. NO repitas en cada mensaje frases como "Claro, voy a buscar" ni "Recuerde consultar a su médico de confianza". Decir "consultar a su médico" una vez por conversación o solo cuando sea muy relevante es suficiente.
- Usa el nombre del cliente SOLO al inicio del saludo o cuando retoma la conversación después de un tiempo. No repitas el nombre en cada respuesta.
- Responde directo, con frases cortas y cercanas. Sin ser mecánica.
- Si en la conversación hay mensajes anteriores, puedes preguntar con educación por su estado: por ejemplo si sigue con el dolor que mencionó, si se está tomando el tratamiento, o si necesita repetir la compra. Muestra que recuerdas el contexto.

Lógica de ventas y proactividad:
- Acidez o dolor de barriga: ofrece un antiácido y sugiere proactivamente nuestra agua mineral, diciendo que es más sana para la digestión.
- Gripe/resfriado: sugiere antigripales y vitamina C.
- Ampollas: sugiere también jeringas y alcohol.
- Si el cliente compra o pregunta por medicamentos que suele tomar con frecuencia (tensión, diabetes, etc.), sugiere que puede agregarlo a sus recordatorios para que la app le avise a la hora de tomarlo o cuando le quede poco.

Cuando te den datos de un producto (nombre, precio, etc.) en [Datos de producto], responde de forma natural con ese precio y anima a agregarlo al carrito. NO escribas etiquetas [ACCION:...]. El sistema ya ejecutó la consulta; solo responde como Dona con el precio y la invitación. Si hay imagen, puedes decir que le dejas la foto para que lo agregue de una vez.`;

function buildPrompt(userName, messages, productData) {
  const safeName = (userName && String(userName).trim()) || 'cliente';
  const parts = [
    `${SYSTEM_PROMPT}\n\nNombre del cliente: ${safeName}. Usa su nombre solo al saludar o al retomar.`,
  ];
  if (productData) {
    parts.push(
      `\n[Datos de producto para esta respuesta]\n`,
      `Nombre/descripción: ${productData.descripcion}. Precio: $${Number(productData.precio).toFixed(2)}. Código: ${productData.codigo}.`,
      `Responde con naturalidad dando el precio y animando a agregarlo al carrito. No uses [ACCION:...].\n`
    );
  }
  parts.push('\n[Conversación]\n');
  for (const m of messages) {
    const role = m.role === 'user' ? 'Usuario' : 'Dona';
    parts.push(`${role}: ${String(m.content ?? '').trim()}\n`);
  }
  parts.push('Dona: ');
  return parts.join('');
}

// GET /api/chat/history — historial guardado para mostrar al reabrir y que Dona “recuerde”
router.get('/history', auth, async (req, res) => {
  try {
    const doc = await ConversacionDona.findOne({ userId: req.userId });
    const messages = (doc?.messages || []).map((m) => ({
      role: m.role,
      content: m.content,
      product: m.product || undefined,
    }));
    res.json({ messages });
  } catch (err) {
    console.error('Error GET /api/chat/history', err);
    res.status(500).json({ error: 'Error al cargar historial' });
  }
});

// POST /api/chat — responde con { message, product? }; ejecuta consulta de precio en backend
router.post('/', auth, async (req, res) => {
  const { userName, messages } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages debe ser un arreglo no vacío' });
  }
  if (!geminiClient || !GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Falta configurar GEMINI_API_KEY en el servidor.' });
  }

  const userMessages = messages.filter((m) => m.role === 'user');
  const lastUserMessage = userMessages.pop();
  let lastContent = (lastUserMessage && lastUserMessage.content) ? String(lastUserMessage.content).trim() : '';
  // Si el último mensaje es corto o parece follow-up ("dame el precio", "sí", etc.), usar el mensaje anterior para buscar producto
  const followUp = /^(s[ií]|dame el precio|cu[aá]nto (cuesta|vale)|precio|lo tomo|agr[eé]galo)$/i.test(lastContent) && userMessages.length > 0;
  const queryForProduct = followUp && userMessages.length
    ? String((userMessages[userMessages.length - 1].content || '').trim())
    : lastContent;
  let productData = null;
  if (queryForProduct.length >= 2) {
    productData = await buscarProductoParaChat(queryForProduct);
  }

  try {
    const model = geminiClient.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const prompt = buildPrompt(userName || req.user?.nombre, messages, productData);
    const result = await model.generateContent(prompt);
    const text = (result.response.text() || '').trim();

    const responseProduct = productData ? {
      id: productData.id,
      codigo: productData.codigo,
      descripcion: productData.descripcion,
      precio: productData.precio,
      imagen: productData.imagen,
      farmaciaId: productData.farmaciaId,
      existencia: productData.existencia,
    } : undefined;

    const messageWithProducts = responseProduct
      ? text + '\n__PRODUCTOS__\n' + JSON.stringify(responseProduct)
      : text;

    const toSave = [
      ...messages.map((m) => ({ role: m.role, content: m.content || '', product: undefined })),
      { role: 'assistant', content: messageWithProducts, product: responseProduct },
    ];
    await ConversacionDona.appendMessages(req.userId, toSave);

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({
      message: messageWithProducts,
      product: responseProduct || undefined,
    });
  } catch (err) {
    console.error('Error en /api/chat', err);
    res.status(500).json({ error: 'Error en el chat de Dona' });
  }
});

export default router;
