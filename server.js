const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { GoogleGenAI } = require('@google/genai');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

// Detectar si tenemos el JSON local o si usamos variables de entorno (Render)
let credentialConfig;
try {
  const serviceAccount = require('./firebase-key.json');
  credentialConfig = cert(serviceAccount);
} catch (e) {
  // Limpiamos posibles comillas y convertimos los \n en saltos de línea reales de forma segura
  let rawKey = process.env.FIREBASE_PRIVATE_KEY || '';
  rawKey = rawKey.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');

  credentialConfig = cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: rawKey
  });
}

initializeApp({
  credential: credentialConfig
});

const db = getFirestore();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.get('/', (req, res) => {
    res.send('¡Servidor con Firebase, Memoria y Gemini funcionando!');
});

app.post('/api/chat', async (req, res) => {
    try {
        const { message, userId } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'El mensaje es obligatorio' });
        }

        const idUsuario = userId || 'usuario_anonimo';

        // 1. Recuperar el historial previo de este usuario desde Firestore
        const chatRef = db.collection('chats');
        const snapshot = await chatRef
            .where('userId', '==', idUsuario)
            .orderBy('timestamp', 'asc')
            .get();

        // 2. Construir el historial en el formato que espera Gemini
        let contents = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.userMessage) {
                contents.push({ role: 'user', parts: [{ text: data.userMessage }] });
            }
            if (data.botReply) {
                contents.push({ role: 'model', parts: [{ text: data.botReply }] });
            }
        });

        // 3. Añadir el mensaje nuevo actual del usuario
        contents.push({ role: 'user', parts: [{ text: message }] });

        // 4. Enviar todo a Gemini
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: contents,
        });

        const replyText = response.text;

        // 5. Guardar este nuevo intercambio en Firestore
        await chatRef.add({
            userId: idUsuario,
            userMessage: message,
            botReply: replyText,
            timestamp: FieldValue.serverTimestamp()
        });

        // 6. Responder al cliente
        res.json({ reply: replyText, historyLength: contents.length });

    } catch (error) {
        console.error('Error en el servidor:', error);
        res.status(500).json({ 
            error: 'Hubo un error al procesar tu solicitud',
            details: error.message || error.toString()
        });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor con memoria corriendo en http://localhost:${PORT}`);
});
