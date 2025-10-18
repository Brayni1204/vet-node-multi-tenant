// src/index.ts (Modificado para usar subdominios)
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

import tenantRoutes from './routes/tenantRoutes';
import authRoutes from './routes/authRoutes';
import appointmentRoutes from './routes/appointmentRoutes';

dotenv.config();

const app = express();

// 1. Interfaz para extender el objeto Request de Express (ajuste de TypeScript)
interface CustomRequest extends Request {
    tenantId?: string;
}

// 2. Middleware para extraer el tenantId del subdominio
// La configuración CORS está bien, pero se ajusta ligeramente para los nuevos tipos de Request
const corsOptions = {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        if (!origin) {
            return callback(null, true);
        }

        const hostname = new URL(origin).hostname;
        // Mantiene la lógica para permitir todos los subdominios de '.localhost'
        if (hostname.endsWith('.localhost') || hostname === 'localhost') {
            return callback(null, true);
        }

        callback(new Error('No permitido por CORS'));
    },
    credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());

// 1. Interfaz para extender el objeto Request de Express (ajuste de TypeScript)
interface CustomRequest extends Request {
    tenantId?: string;
}

// 2. Middleware para extraer el tenantId del subdominio
const extractTenantIdFromSubdomain = (req: CustomRequest, res: Response, next: NextFunction) => {
    const host = req.hostname; // e.g., 'chavez.localhost'
    const TENANT_HOST_REGEX = /^([a-z0-9-]+)\.localhost(?::\d+)?$/i;
    const match = host.match(TENANT_HOST_REGEX);
    if (match && match[1] && match[1] !== 'www' && match[1] !== 'localhost') {
        const tenantId = match[1];
        req.tenantId = tenantId; 
        req.params.tenantId = tenantId; // Hack de compatibilidad
    }
    next();
};

// APLICAR el middleware de extracción del tenantId antes de definir las rutas
app.use(extractTenantIdFromSubdomain);

// 3. Usamos las rutas sin el prefijo dinámico en el path.
app.use('/api/tenants', tenantRoutes);
app.use('/api/auth', authRoutes);
app.use('/api', appointmentRoutes);

// Configuración de la base de datos (código de configuración no utilizado aquí directamente)
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