// src/index.ts
import 'dotenv/config';
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';

// Rutas
import authRoutes from './routes/authRoutes';
import tenantRoutes from './routes/tenantRoutes';
import serviceRoutes from './routes/serviceRoutes';
import externalRoutes from './routes/externalRoutes';
import appointmentRoutes from './routes/appointmentRoutes';
import staffRoutes from './routes/staffRoutes';

const app: Express = express();
const port = process.env.PORT || 4000;

// Middleware para resolver el tenantId del subdominio
const resolveTenant = (req: Request, res: Response, next: NextFunction) => {

    if (req.path.startsWith('/api/external')) {
        return next();
    }

    const host = req.hostname;

    let tenantSlug = null;
    if (host !== 'localhost' && host !== '127.0.0.1' && host.includes('.')) {
        tenantSlug = host.split('.')[0];
    } else {
        // Para desarrollo local sin subdominio, usamos un header de fallback (o un default)
        tenantSlug = req.headers['x-tenant-slug'] || 'chavez';
    }

    // Inyectamos el slug en la solicitud para que las rutas puedan usarlo
    (req as any).tenantId = tenantSlug;

    next();
};

app.use(cors({
    origin: (origin, callback) => {
        // Permitir solicitudes sin origen (curl, postman, etc.)
        if (!origin) return callback(null, true);

        // Permitir el origen del frontend (puerto 5173) y el backend (puerto 4000)
        if (origin.endsWith(':5173') || origin.endsWith(':4000')) {
            return callback(null, true);
        }

        return callback(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
}));

// Usamos los parsers de body de Express (Multer se encarga de multipart, por lo que JSON y URL-encoded son seguros)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(resolveTenant);

// 🎯 CRUCIAL: Configuración para servir archivos estáticos (subidos).
// Mapeamos la URL /uploads al directorio 'uploads' en el sistema de archivos.
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Rutas de API
app.use('/api/auth', authRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/tenants/:tenantId/services', serviceRoutes); // Montamos las rutas de servicio
app.use('/api/external', externalRoutes);
app.use('/api/appointments', appointmentRoutes); // Asumiendo que esta es la ruta
app.use('/api/tenants/:tenantId/staff', staffRoutes);

// Ruta de prueba
app.get('/', (req: Request, res: Response) => {
    res.send(`Backend API running. Tenant: ${(req as any).tenantId}`);
});

app.listen(port, () => {
    console.log(`⚡️ [server]: Server is running at http://localhost:${port}`);
});