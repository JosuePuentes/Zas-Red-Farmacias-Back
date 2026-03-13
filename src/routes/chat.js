import { Router } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { auth } from '../middleware/auth.js';

const router = Router();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const geminiClient = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

router.post('/', auth, async (req, res) => {
  const { userName, messages } = req.body || {};

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages debe ser un arreglo' });
  }
  if (!geminiClient || !GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Falta configurar GEMINI_API_KEY en el servidor.' });
  }

  const safeName = typeof userName === 'string' && userName.trim()
    ? userName.trim()
    : (req.user?.nombre || 'cliente');

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  try {
    // Usamos un modelo estable soportado por la API actual.
    const model = geminiClient.getGenerativeModel({ model: 'gemini-1.0-pro' });

    const systemInstruction = [
      'Eres Dona, auxiliar de confianza de una red de farmacias llamada Zas!.',
      'Tono: profesional, empático y cercano, como una doctora amable.',
      `Trata al usuario por su nombre: ${safeName}.`,
      'No repitas saludos largos en cada respuesta: responde directo a la pregunta, con frases cortas y claras.',
      'Venta cruzada:',
      '- Si el usuario habla de "ampollas", sugiere también jeringas y alcohol.',
      '- Si habla de "gripe" o "resfriado", sugiere antigripales y vitamina C.',
      'Cada vez que recomiendes un medicamento o producto de farmacia, termina tu respuesta con:',
      '"Recuerde consultar a su médico de confianza".',
      'Si el usuario indica que quiere comprar, agregar algo al carrito, ver precio o pagar, responde INCLUYENDO CLARAMENTE una de estas etiquetas al final:',
      '- [ACCION:AGREGAR_AL_CARRITO codigo="..."]',
      '- [ACCION:CONSULTAR_PRECIO codigo="..."]',
      '- [ACCION:IR_A_PAGO]',
      'Sin más datos técnicos. El resto del mensaje debe ser natural.',
    ].join('\n');

    const history = messages.map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: String(m.content ?? '') }],
    }));

    const chat = model.startChat({
      history: [
        {
          role: 'user',
          parts: [{ text: systemInstruction }],
        },
        ...history,
      ],
    });

    const stream = await chat.sendMessageStream('Responde al último mensaje del usuario.');

    for await (const chunk of stream.stream) {
      const text = chunk.text();
      if (text) {
        res.write(text);
      }
    }

    res.end();
  } catch (err) {
    console.error('Error en /api/chat', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Error en el chat de Dona' });
    }
    res.end();
  }
});

export default router;

