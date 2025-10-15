// src/index.ts
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

import tenantRoutes from './routes/tenantRoutes';
import authRoutes from './routes/authRoutes';
import appointmentRoutes from './routes/appointmentRoutes';

dotenv.config();

const app = express();

const corsOptions = {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        if (!origin) {
            return callback(null, true);
        }

        const hostname = new URL(origin).hostname;
        if (hostname.endsWith('.localhost') || hostname === 'localhost') {
            return callback(null, true);
        }

        callback(new Error('No permitido por CORS'));
    },
    credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());

// Usamos las rutas. Las rutas que dependen del inquilino tienen un prefijo dinámico.
app.use('/:tenantId/api/tenants', tenantRoutes);
app.use('/:tenantId/api/auth', authRoutes);
app.use('/:tenantId/api', appointmentRoutes);

// Configuración de la base de datos
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
};

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});