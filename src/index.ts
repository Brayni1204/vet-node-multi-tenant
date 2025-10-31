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
import storeRoutes from './routes/storeRoutes';
import categoryAdminRoutes from './routes/categoryAdminRoutes'; // 👈 AÑADIR
import productAdminRoutes from './routes/productAdminRoutes'; // 👈 AÑADIR
import clientAuthRoutes from './routes/clientAuthRoutes'; // 👈 AÑADIR
import orderRoutes from './routes/orderRoutes';           // 👈 AÑADIR

const app: Express = express();
const port = process.env.PORT || 4000;

// Middleware para resolver el tenantId del subdominio (NO CAMBIA)
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
        if (!origin) return callback(null, true);
        if (origin.endsWith(':5173') || origin.endsWith(':4000')) {
            return callback(null, true);
        }
        return callback(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(resolveTenant);

app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Rutas de API - Rutas montadas de forma simplificada
app.use('/api/auth', authRoutes);
app.use('/api/tenants', tenantRoutes); // Maneja /profile y /:tenantId
app.use('/api/services', serviceRoutes); // Montado en /api/services
app.use('/api/external', externalRoutes);
app.use('/api/appointments', appointmentRoutes); // Montado en /api/appointments
app.use('/api/staff', staffRoutes); // Montado en /api/staff
app.use('/api/store', storeRoutes);
app.use('/api/categories', categoryAdminRoutes);
app.use('/api/products', productAdminRoutes);
app.use('/api/client/auth', clientAuthRoutes); // Autenticación de Clientes
app.use('/api/orders', orderRoutes);

// Ruta de prueba
app.get('/', (req: Request, res: Response) => {
    res.send(`Backend API running. Tenant: ${(req as any).tenantId}`);
});

app.listen(port, () => {
    console.log(`⚡️ [server]: Server is running at http://localhost:${port}`);
});