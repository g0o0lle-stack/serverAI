const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { GoogleGenAI } = require('@google/genai');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

// Inicialización de Firebase con soporte para entorno local y Render
let credentialConfig;
try {
  // Intento de carga local (si tienes el archivo firebase-key.json en tu PC)
  const serviceAccount = require('./firebase-key.json');
  credentialConfig = cert(serviceAccount);
  console.log("> Usando credenciales locales de Firebase.");
} catch (e) {
  // Entorno de producción (Render): limpiar y dar formato correcto a la clave privada
  let rawKey = process.env.FIREBASE_PRIVATE_KEY || '';
  rawKey = rawKey.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');

  credentialConfig = cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: rawKey
  });
  console.log("> Usando credenciales de Firebase desde variables de entorno de Render.");
}

initializeApp({
  credential: credentialConfig
});

const db = getFirestore();
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// Servir la carpeta 'public' estáticamente (donde tienes tu index.html)
app.use(express.static('public'));

// Inicializar el cliente de la API de Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Endpoint principal para el chat con memoria
app.post('/api/chat', async (req, res) => {
    try {
        const { message, userId } = req.body;

        if (!message || !userId) {
            return res.status(400).json({ error: 'Faltan los campos message o userId' });
        }

        const chatRef = db.collection('chats').doc(userId).collection('messages');

        // 1. Guardar el mensaje del usuario en Firestore
        await chatRef.add({
            role: 'user',
            content: message,
            timestamp: FieldValue.serverTimestamp()
        });

        // 2. Recuperar el historial reciente de la conversación para darle contexto a la IA
        const snapshot = await chatRef.orderBy('timestamp', 'asc').limit(20).get();
        const history = snapshot.docs.map(doc => {
            const data = doc.data();
            return `${data.role === 'user' ? 'Usuario' : 'Asistente'}: ${data.content}`;
        }).join('\n');

        // 3. Crear el prompt completo con el historial de memoria
        const prompt = `Eres un asistente virtual amable y servicial con memoria de las conversaciones anteriores.
Historial de la conversación:
${history}

Usuario: ${message}
Asistente:`;

        // 4. Llamar a la API de Gemini
        const response = await ai.models.generateContent({
            model: 'gemini-3.6-flash',
            contents: prompt,
        });

        const botReply = response.text || 'No he podido generar una respuesta.';

        // 5. Guardar la respuesta del bot en Firestore
        await chatRef.add({
            role: 'assistant',
            content: botReply,
            timestamp: FieldValue.serverTimestamp()
        });

        // 6. Enviar la respuesta de vuelta al frontend
        res.json({ reply: botReply });

    } catch (error) {
        console.error('Error en el servidor (/api/chat):', error);
        res.status(500).json({ error: 'Error interno del servidor', details: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`> Servidor corriendo en puerto ${PORT}`);
});
