// src/index.ts
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Configuración de la base de datos
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
};

app.get('/', (req, res) => {
    res.send('Backend de veterinaria funcionando!');
});

// Rutas de la API (las crearemos en el próximo paso)
// app.use('/api/tenants', tenantRoutes);
// app.use('/api/appointments', appointmentRoutes);

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});