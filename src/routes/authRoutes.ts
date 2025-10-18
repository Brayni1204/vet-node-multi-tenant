// src/routes/authRoutes.ts
import { Router, Request } from 'express';
import pool from '../db';
import { RowDataPacket } from 'mysql2';

// Interfaz para definir la estructura de los datos del usuario
interface User extends RowDataPacket {
    id: number;
    tenant_id: number;
    email: string;
    password: string;
    name: string;
    is_admin: boolean;
}

// Interfaz para el Request para asegurar el acceso a req.tenantId
interface LoginRequest extends Request {
    tenantId?: string; // El slug del subdominio (e.g., 'chavez') - campo inyectado por el middleware
    params: {
        tenantId: string;
        [key: string]: any;
    }
}

const router = Router();

// Ruta de inicio de sesión para administradores
router.post('/admin/login', async (req: LoginRequest, res) => {
    // 1. Obtener email y password del cuerpo de la solicitud
    const { email, password } = req.body;

    // 2. Obtener el tenantId (slug) del campo custom inyectado por el middleware.
    const tenantSlug = req.tenantId; // e.g., 'chavez'

    if (!tenantSlug) {
        return res.status(400).json({ message: 'Tenant ID is missing from the request URL or host.' });
    }

    try {
        // 🚨 CAMBIO CLAVE: Usamos 'tenant_id' en lugar de 'slug' para buscar el ID numérico.
        const [tenantRows] = await pool.execute<RowDataPacket[]>(
            'SELECT id FROM tenants WHERE tenant_id = ?', // <--- CORRECCIÓN AQUÍ
            [tenantSlug]
        );

        if (tenantRows.length === 0) {
            return res.status(404).json({ message: 'Tenant no encontrado' });
        }

        const tenantIdNumeric = tenantRows[0].id;

        // *** PASO 2: Buscar al usuario, FILTRANDO POR EL ID NUMÉRICO DEL INQUILINO ***
        const [rows] = await pool.execute<User[]>(
            'SELECT * FROM users WHERE email = ? AND is_admin = 1 AND tenant_id = ?',
            [email, tenantIdNumeric]
        );

        if (rows.length > 0) {
            const user = rows[0];
            if (user.password === password) {
                // Inicio de sesión exitoso
                res.status(200).json({
                    message: 'Inicio de sesión exitoso',
                    token: 'admin-token',
                    user: { id: user.id, email: user.email, name: user.name, tenantId: user.tenant_id }
                });
            } else {
                res.status(401).json({ message: 'Credenciales inválidas' });
            }
        } else {
            res.status(401).json({ message: 'Credenciales inválidas' });
        }
    } catch (error) {
        console.error("Error en /admin/login:", error);
        res.status(500).json({ message: 'Error del servidor. Consulte los logs para más detalles.' });
    }
});

export default router;