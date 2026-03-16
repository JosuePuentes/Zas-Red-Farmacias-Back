import { Router } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { auth } from '../middleware/auth.js';
import ConversacionDona from '../models/ConversacionDona.js';
import { buscarProductoParaChat } from '../util/buscarProductoParaChat.js';

const router = Router();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const geminiClient = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

const SYSTEM_PROMPT = `Eres Dona, la Auxiliar Estrella de la red de farmacias Zas!. Eres una farmacéutica especialista en medicamentos, dulce y con chispa, como nos caracterizamos en Venezuela.

Reglas de tono y respeto:
- Habla con naturalidad, en un tono dulce pero profesional.
- NO uses en ningún caso expresiones como "mi amor", "mi vida", "mi reina", "mi cielo", "mi corazón" ni diminutivos similares de confianza excesiva.
- Usa frases como "te explico con calma", "aquí estoy para ayudarte", "cuenta conmigo" para sonar cercana sin perder el respeto.
- Usa el nombre del cliente SOLO al inicio del saludo o cuando retoma la conversación después de un tiempo. No repitas el nombre en cada respuesta.

Reglas de fluidez:
- Responde en 2 o 3 frases cortas: una frase de empatía, una frase explicando qué tipo de medicamento sirve para ese malestar y, si hay productos, una frase diciendo que le muestras opciones.
- NO repitas en cada mensaje frases como "Claro, voy a buscar" ni "Recuerde consultar a su médico de confianza".
- Cuando recomiendes medicamentos, incluye UNA sola vez por conversación (o solo cuando sea muy relevante) un recordatorio claro del tipo: "Recuerda que siempre es importante consultar con tu médico o con tu farmacéutico de confianza antes de tomar cualquier medicamento." No lo repitas en todos los mensajes.
- Si en la conversación hay mensajes anteriores, puedes preguntar con educación por su estado: por ejemplo si sigue con el dolor que mencionó, si se está tomando el tratamiento, o si necesita repetir la compra. Muestra que recuerdas el contexto.

Manejo de síntomas vs nombres de medicamentos:
- Si el mensaje del usuario describe un síntoma (por ejemplo "me duele la cabeza", "tengo fiebre", "me arde el estómago", "tengo acidez", "tengo tos", "tengo alergia", "tengo gripe"), NO respondas diciendo que eso no es un nombre de medicamento.
- Primero, reconoce el síntoma con empatía y explica qué tipo de medicamento suele usarse (por ejemplo, para dolor de cabeza → analgésicos suaves como paracetamol o ibuprofeno; para fiebre → antipiréticos como paracetamol; para acidez/dolor de estómago → antiácidos o protectores gástricos, etc.). Usa tu conocimiento como si hubieras leído muchos libros de medicina.
- Después, indica al usuario que recuerde siempre consultar con su médico o con su farmacéutico de confianza antes de tomar cualquier medicamento (usa la advertencia médica solo una vez por conversación).
- Luego, cuando el sistema te haya proporcionado datos de productos en [Datos de producto] o en el contexto, menciona que le muestras algunas opciones disponibles para ese síntoma. Si no hay productos, aclara qué medicamento o familia de medicamentos sería adecuado y que en este momento no está disponible en catálogo, invitando a solicitarlo por nombre.
- Nunca pidas al usuario que te diga un medicamento específico para que tú puedas ayudarlo. Tu trabajo es proponer tú misma medicamentos concretos o familias de medicamentos adecuados según el síntoma (por ejemplo "ibuprofeno 400 mg en tabletas" o "gel antiinflamatorio con diclofenac"), y luego la app mostrará los productos disponibles o las opciones para solicitarlos.

Correcciones de nombres:
- Si el usuario escribe mal el nombre de un medicamento pero es obvio a qué medicamento se refiere, corrige amablemente el nombre en tu respuesta, del tipo: "Creo que te refieres a [nombre correcto]".

Lógica de ventas y proactividad:
- Acidez o dolor de barriga: ofrece un antiácido y sugiere proactivamente nuestra agua mineral, diciendo que es más sana para la digestión.
- Gripe/resfriado: sugiere antigripales y vitamina C.
- Ampollas: sugiere también jeringas y alcohol.
- Si el cliente compra o pregunta por medicamentos que suele tomar con frecuencia (tensión, diabetes, etc.), sugiere que puede agregarlo a sus recordatorios para que la app le avise a la hora de tomarlo o cuando le quede poco.

Preguntas generales y conversación:
- Si el usuario hace preguntas que no son sobre medicamentos ni productos (por ejemplo "dónde quedan las farmacias", "sabes algo", "y entonces", "por qué no"), responde con firmeza pero siempre amable, aclarando que eres el auxiliar virtual de la farmacia y que tu función principal es ayudar con medicamentos, compras y dudas de salud sencillas.
- Si preguntan por ubicación de farmacias, puedes decir que no manejas direcciones exactas desde aquí y sugerir que usen la app, la web o mapas para ver las farmacias cercanas.
- Si el usuario parece estar jugando o probando tus respuestas, responde de forma sutil y cariñosa (sin ser grosera), recordando que estás allí para ayudarle con lo que necesite de la farmacia y devolviendo la conversación al tema de salud o productos cuando sea posible.

Cuando te den datos de un producto (nombre, precio, etc.) en [Datos de producto], responde de forma natural con ese precio y anima a agregarlo al carrito. NO escribas etiquetas [ACCION:...]. El sistema ya ejecutó la consulta; solo responde como Dona con el precio y la invitación. Si hay imagen, puedes decir que le dejas la foto para que lo agregue de una vez.`;

function detectSymptomKeywords(text) {
  const t = (text || '').toLowerCase();
  const keywords = new Set();

  if (t.includes('dolor de cabeza') || t.includes('jaqueca') || t.includes('migraña') || t.includes('migra?a')) {
    keywords.add('paracetamol');
    keywords.add('ibuprofeno');
  }
  if (t.includes('fiebre') || t.includes('temperatura alta')) {
    keywords.add('paracetamol');
    keywords.add('ibuprofeno');
  }
  if (t.includes('dolor de estomago') || t.includes('dolor de estómago') || t.includes('ardor en el estomago') || t.includes('ardor en el estómago') || t.includes('acidez') || t.includes('agruras')) {
    keywords.add('antiacido');
    keywords.add('omeprazol');
  }
  if (t.includes('tos')) {
    keywords.add('antitusivo');
  }
  if (t.includes('gripe') || t.includes('resfriado')) {
    keywords.add('antigripal');
    keywords.add('vitamina c');
  }
  if (t.includes('alergia') || t.includes('rinitis')) {
    keywords.add('loratadina');
    keywords.add('antihistamínico');
    keywords.add('antihistaminico');
  }

  // Irritación en los ojos / lagañas / conjuntivitis leve
  if (
    t.includes('lagaña') ||
    t.includes('lagañas') ||
    (t.includes('ojo') && t.includes('irrit')) ||
    (t.includes('ojos') && t.includes('irrit')) ||
    t.includes('conjuntivitis') ||
    t.includes('picor en los ojos') ||
    t.includes('picazón en los ojos') ||
    t.includes('picazon en los ojos')
  ) {
    keywords.add('lagrimas artificiales');
    keywords.add('colirio lubricante');
    keywords.add('colirio antihistaminico');
  }

  // Dolores musculares y articulares (codo, rodilla, espalda, etc.)
  if (
    t.includes('codo') ||
    t.includes('rodilla') ||
    t.includes('espalda') ||
    t.includes('hombro') ||
    t.includes('dedo') ||
    t.includes('meñique') ||
    t.includes('deo meñique') ||
    t.includes('pierna') && t.includes('dolor') ||
    t.includes('musculo') ||
    t.includes('músculo') ||
    t.includes('dolor muscular') ||
    t.includes('dolor en el musculo') ||
    t.includes('dolor en el músculo') ||
    t.includes('dolor articular') ||
    t.includes('dolor en la articulacion') ||
    t.includes('dolor en la articulación')
  ) {
    keywords.add('ibuprofeno');
    keywords.add('naproxeno');
    keywords.add('diclofenac');
    keywords.add('gel antiinflamatorio');
  }

  // --- Síntomas respiratorios ---
  // Tos seca
  if (
    (t.includes('tos') && t.includes('seca')) ||
    t.includes('tos seca')
  ) {
    keywords.add('dextrometorfano');
    keywords.add('jarabe antitusigeno');
  }

  // Tos con flema / congestión de pecho
  if (
    (t.includes('tos') && (t.includes('flema') || t.includes('moco'))) ||
    t.includes('congestion en el pecho') ||
    t.includes('congestión en el pecho') ||
    t.includes('pecho congestionado')
  ) {
    keywords.add('ambroxol');
    keywords.add('bromhexina');
    keywords.add('jarabe expectorante');
  }

  // Congestión nasal / nariz tapada
  if (
    t.includes('nariz tapada') ||
    t.includes('congestion nasal') ||
    t.includes('congestión nasal') ||
    (t.includes('moco') && t.includes('nariz'))
  ) {
    keywords.add('oximetazolina');
    keywords.add('pseudoefedrina');
    keywords.add('spray nasal descongestionante');
  }

  // Dolor de garganta
  if (
    t.includes('dolor de garganta') ||
    (t.includes('garganta') && (t.includes('dolor') || t.includes('ardor') || t.includes('irrita')))
  ) {
    keywords.add('pastillas para la garganta');
    keywords.add('spray para la garganta');
  }

  // --- Sistema digestivo ---
  // Acidez / ardor en el pecho
  if (
    t.includes('acidez') ||
    t.includes('ardor en el pecho') ||
    t.includes('ardor en el estomago') ||
    t.includes('ardor en el estómago') ||
    t.includes('reflujo')
  ) {
    keywords.add('antiacido');
    keywords.add('milanta');
    keywords.add('hidroxido de aluminio');
    keywords.add('omeprazol');
  }

  // Gases / flatulencia / hinchazón
  if (
    t.includes('gases') ||
    t.includes('flatulencia') ||
    t.includes('hinchazon') && t.includes('estomago') ||
    t.includes('hinchazón') && t.includes('estómago') ||
    t.includes('barriga inflamada')
  ) {
    keywords.add('simeticona');
  }

  // Diarrea
  if (
    t.includes('diarrea') ||
    (t.includes('heces') && t.includes('liquidas')) ||
    (t.includes('heces') && t.includes('líquidas'))
  ) {
    keywords.add('loperamida');
    keywords.add('suero oral');
  }

  // Estreñimiento
  if (
    t.includes('estrenimiento') ||
    t.includes('estreñimiento') ||
    (t.includes('dificultad') && t.includes('ir al baño'))
  ) {
    keywords.add('laxante');
    keywords.add('fibra');
  }

  // Náuseas / vómitos
  if (
    t.includes('nauseas') ||
    t.includes('náuseas') ||
    t.includes('vomito') ||
    t.includes('vómito') ||
    t.includes('ganas de vomitar')
  ) {
    keywords.add('metoclopramida');
    keywords.add('domperidona');
  }

  // --- Dolores específicos adicionales ---
  // Dolor de riñones / cólico renal
  if (
    t.includes('dolor de riñones') ||
    t.includes('dolor de rinones') ||
    t.includes('colico renal') ||
    t.includes('cólico renal')
  ) {
    keywords.add('hioscina');
    keywords.add('dipirona');
    keywords.add('buscapina');
  }

  // Dolor menstrual / cólicos menstruales
  if (
    t.includes('dolor menstrual') ||
    t.includes('colicos menstruales') ||
    t.includes('cólicos menstruales') ||
    (t.includes('colico') && t.includes('regla')) ||
    (t.includes('cólico') && t.includes('regla'))
  ) {
    keywords.add('ibuprofeno');
    keywords.add('naproxeno');
    keywords.add('buscapina fem');
  }

  // Dolor de muela
  if (
    t.includes('dolor de muela') ||
    t.includes('dolor de muelea') || // error común de escritura
    (t.includes('muela') && t.includes('dolor'))
  ) {
    keywords.add('ketoprofeno');
    keywords.add('ketorolaco');
  }

  // --- Infecciones comunes ---
  // Infección urinaria / ardor al orinar
  if (
    t.includes('infeccion urinaria') ||
    t.includes('infección urinaria') ||
    (t.includes('ardor') && t.includes('orinar')) ||
    (t.includes('orina') && t.includes('ardor'))
  ) {
    keywords.add('fenazopiridina');
    keywords.add('analgesico urinario');
  }

  // Hongos en piel o pies
  if (
    t.includes('hongos en los pies') ||
    t.includes('pie de atleta') ||
    (t.includes('hongos') && (t.includes('piel') || t.includes('uña') || t.includes('uñas'))) ||
    t.includes('micosis')
  ) {
    keywords.add('clotrimazol');
    keywords.add('terbinafina');
    keywords.add('crema antifungica');
  }

  // --- Cuidado crónico ---
  // Tensión alta / hipertensión
  if (
    t.includes('tension alta') ||
    t.includes('tensión alta') ||
    t.includes('hipertension') ||
    t.includes('hipertensión') ||
    (t.includes('presion') && t.includes('alta')) ||
    (t.includes('presión') && t.includes('alta'))
  ) {
    keywords.add('losartan');
    keywords.add('enalapril');
    keywords.add('amlodipina');
  }

  // Azúcar alta / diabetes
  if (
    t.includes('azucar alta') ||
    t.includes('azúcar alta') ||
    t.includes('diabetes') ||
    (t.includes('glucosa') && t.includes('alta'))
  ) {
    keywords.add('metformina');
    keywords.add('glibenclamida');
  }

  // Mareos / vértigo
  if (
    t.includes('mareado') ||
    t.includes('mareo') ||
    t.includes('me siento mareado') ||
    t.includes('vertigo') ||
    t.includes('vértigo')
  ) {
    keywords.add('dimenhidrinato');
    keywords.add('betahistina');
    keywords.add('medicamento para el mareo');
  }

  // Caída del cabello
  if (
    t.includes('se me cae el pelo') ||
    t.includes('se me esta cayendo el pelo') ||
    t.includes('se me está cayendo el pelo') ||
    t.includes('caida del cabello') ||
    t.includes('caída del cabello') ||
    (t.includes('pelo') && t.includes('cayendo')) ||
    (t.includes('cabello') && t.includes('cayendo'))
  ) {
    keywords.add('minoxidil');
    keywords.add('shampoo anticaida');
    keywords.add('vitaminas para el cabello');
  }

  // Caspa
  if (
    t.includes('caspa') ||
    (t.includes('escamas') && t.includes('cuero cabelludo'))
  ) {
    keywords.add('shampoo ketoconazol');
    keywords.add('shampoo anticaspa');
    keywords.add('piritiona de zinc');
  }

  return Array.from(keywords);
}

function isGreetingOrSmallTalk(text) {
  const t = (text || '').toLowerCase().trim();
  if (!t) return false;
  const patterns = [
    /^hola\b/,
    /^(buen[oa]s?\s+(d[ií]as|tardes|noches))/,
    /^hey\b/,
    /^buenas\b/,
    /^como estas\??$/,
    /^cómo estas\??$/,
    /^como te va\??$/,
    /^que tal\??$/,
    /^qué tal\??$/,
  ];
  if (patterns.some((re) => re.test(t))) return true;

  // Frases cortas de conversación general que no deben disparar búsqueda de productos
  if (t.length <= 60) {
    if (
      t.startsWith('donde queda') ||
      t.startsWith('dónde queda') ||
      t.startsWith('donde quedan') ||
      t.startsWith('dónde quedan') ||
      t === 'sabes algo?' ||
      t === 'sabes algo' ||
      t === 'cuando?' ||
      t === 'cuándo?' ||
      t === 'y entonces?' ||
      t === 'y entonces' ||
      t === 'porque no?' ||
      t === 'por qué no?' ||
      t === 'porque no' ||
      t === 'por que no' ||
      t === 'ok' ||
      t === 'ok.' ||
      t === 'vale' ||
      t === 'gracias' ||
      t === 'muestrame' ||
      t === 'muéstrame'
    ) {
      return true;
    }
  }

  return false;
}

function buildPrompt(userName, messages, productData) {
  const safeName = (userName && String(userName).trim()) || 'cliente';
  const parts = [
    `${SYSTEM_PROMPT}\n\nNombre del cliente: ${safeName}. Usa su nombre solo al saludar o al retomar.`,
  ];
  if (productData && productData.length > 0) {
    const conStock = productData.filter((p) => p.disponible);
    const primerConStock = conStock[0];
    if (primerConStock) {
      parts.push(
        `\n[Datos de producto para esta respuesta]\n`,
        `El producto "${primerConStock.descripcion}" (código ${primerConStock.codigo}) SÍ está disponible. Precio: $${Number(primerConStock.precio).toFixed(2)}.`,
        `Responde en tono Dona tipo: "Lo tenemos en $${Number(primerConStock.precio).toFixed(2)}, aquí te lo dejo para agregar al carrito." No uses [ACCION:...].\n`
      );
    } else {
      const primero = productData[0];
      if (!primero.codigo) {
        parts.push(
          `\n[Datos de producto para esta respuesta]\n`,
          `El producto "${primero.descripcion}" NO está en nuestro catálogo (es una solicitud por nombre).`,
          `Responde en tono Dona: que no lo tenemos en catálogo pero puede solicitarlo por nombre y le avisamos si lo conseguimos. No uses [ACCION:...].\n`
        );
      } else {
        parts.push(
          `\n[Datos de producto para esta respuesta]\n`,
          `El producto "${primero.descripcion}" (código ${primero.codigo}) NO está disponible en este momento.`,
          `Responde en tono Dona tipo: "Es el [nombre del medicamento] pero no tenemos disponible; puedes solicitarlo y te avisamos cuando llegue." No uses [ACCION:...].\n`
        );
      }
    }
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
  let queryForProduct = followUp && userMessages.length
    ? String((userMessages[userMessages.length - 1].content || '').trim())
    : lastContent;

  // Normalizar preguntas tipo "tienes ibuprofeno", "hay paracetamol", "dispones de...", etc.
  const productoPreguntaRegex = /^\s*(tienes?|tiene|dispones?|disponible\s*de?|hay|haber|tienen|disponen)\s+(.+)/i;
  let m = queryForProduct.match(productoPreguntaRegex);
  if (m && m[2]) {
    queryForProduct = String(m[2]).trim();
  }

  // Normalizar preguntas tipo "qué es bueno para X", "como me quito X", "como puedo tratar X", etc.
  const genericaSintomaRegex = /^\s*((que|qué)\s+es\s+buen[oa]\s+para|como\s+me\s+quito|cómo\s+me\s+quito|como\s+puedo\s+tratar|cómo\s+puedo\s+tratar|como\s+puedo\s+curar(me)?|cómo\s+puedo\s+curar(me)?|como\s+puedo\s+curarme|cómo\s+puedo\s+curarme)\s+(.+)/i;
  m = queryForProduct.match(genericaSintomaRegex);
  if (m && m[3]) {
    queryForProduct = String(m[3]).replace(/[?.!]+$/, '').trim();
  }

  const ignoreProductSearch = isGreetingOrSmallTalk(queryForProduct);
  const symptomKeywords = ignoreProductSearch ? [] : detectSymptomKeywords(queryForProduct);

  let productData = [];
  if (!ignoreProductSearch && symptomKeywords.length > 0) {
    const resultLists = await Promise.all(symptomKeywords.map((kw) => buscarProductoParaChat(kw)));
    const merged = [];
    const seen = new Set();
    for (const list of resultLists) {
      for (const p of list) {
        const key = `${p.codigo || ''}|${p.id || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(p);
      }
    }
    productData = merged;
  } else if (!ignoreProductSearch && queryForProduct.length >= 2) {
    productData = await buscarProductoParaChat(queryForProduct);
  }

  try {
    const model = geminiClient.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const prompt = buildPrompt(userName || req.user?.nombre, messages, productData);
    const result = await model.generateContent(prompt);
    const text = (result.response.text() || '').trim();

    const productsPayload = productData.length > 0
      ? productData.map((p) => ({
          id: p.id,
          codigo: p.codigo,
          descripcion: p.descripcion,
          precio: p.precio,
          imagen: p.imagen,
          farmaciaId: p.farmaciaId,
          disponible: p.disponible,
          existencia: p.existencia,
        }))
      : [];

    const toSave = [
      ...messages.map((m) => ({ role: m.role, content: m.content || '', product: undefined })),
      { role: 'assistant', content: text, product: productsPayload.length ? productsPayload : undefined },
    ];
    await ConversacionDona.appendMessages(req.userId, toSave);

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({
      message: text,
      productos: productsPayload.length ? productsPayload : [],
    });
  } catch (err) {
    console.error('Error en /api/chat', err);

    // Manejo específico de límite de cuota / 429 de Gemini
    if (err?.status === 429) {
      return res.status(429).json({
        error: 'Dona ha recibido muchas consultas seguidas y por hoy llegó al límite permitido. Por favor, intenta de nuevo en unos minutos mientras se restablece el servicio.',
        retryAfterSeconds: 60,
      });
    }

    res.status(500).json({ error: 'Error en el chat de Dona' });
  }
});

export default router;
