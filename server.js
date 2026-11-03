const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { GoogleGenAI } = require('@google/genai');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const serviceAccount = require('./firebase-key.json');

initializeApp({
  credential: cert(serviceAccount)
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

        // 1. Recuperar el historial previo de este usuario desde Firestore (ordenados del más antiguo al más reciente)
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

        // 3. Añadir el mensaje nuevo actual del usuario a la conversación
        contents.push({ role: 'user', parts: [{ text: message }] });

        // 4. Enviar todo el historial y el mensaje actual a Gemini
        const response = await ai.models.generateContent({
            model: 'gemini-3.6-flash',
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