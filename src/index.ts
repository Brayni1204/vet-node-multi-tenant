import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

import tenantRoutes from './routes/tenantRoutes';
import authRoutes from './routes/authRoutes';
import appointmentRoutes from './routes/appointmentRoutes';

dotenv.config();

const app = express();

// Configuración de CORS
const corsOptions = {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        // Permitir solicitudes sin origen (como las de Postman o CURL)
        if (!origin) {
            return callback(null, true);
        }

        // Lista de dominios permitidos (puedes agregar tu dominio de producción aquí)
        const allowedOrigins = ['http://localhost:5173'];

        // Patrón para permitir subdominios dinámicos de localhost
        const hostname = new URL(origin).hostname;
        if (hostname.endsWith('.localhost') || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        callback(new Error('No permitido por CORS'));
    },
    credentials: true
};

app.use(cors(corsOptions));
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

// Usamos las rutas
app.use('/api/tenants', tenantRoutes);
app.use('/api/auth', authRoutes);
app.use('/api', appointmentRoutes);

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});