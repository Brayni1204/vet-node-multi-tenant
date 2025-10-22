// src/routes/authRoutes.ts
import { Router, Request, Response } from 'express';
import pool from '../db';
import { RowDataPacket } from 'mysql2';
// 🆕 Importamos bcryptjs para la comparación de hash
import bcrypt from 'bcryptjs';

// Interfaz para definir la estructura de los datos del usuario
interface User extends RowDataPacket {
    id: number;
    tenant_id: number;
    email: string;
    password: string; // Contiene el hash cifrado
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
router.post('/admin/login', async (req: LoginRequest, res: Response) => { // ⚠️ Aseguramos que 'res' sea de tipo Response
    // 1. Obtener email y password del cuerpo de la solicitud
    const { email, password } = req.body;

    // 2. Obtener el tenantId (slug) del campo custom inyectado por el middleware.
    const tenantSlug = req.tenantId; // e.g., 'chavez'

    if (!tenantSlug) {
        return res.status(400).json({ message: 'Tenant ID is missing from the request URL or host.' });
    }

    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required.' });
    }

    try {
        // 3. Obtener el ID numérico del tenant a partir del slug.
        const [tenantRows] = await pool.execute<RowDataPacket[]>(
            'SELECT id FROM tenants WHERE tenant_id = ?',
            [tenantSlug]
        );

        // Utilizamos 401 Credenciales inválidas para no revelar si el tenant existe o no.
        if (tenantRows.length === 0) {
            return res.status(401).json({ message: 'Credenciales inválidas' });
        }

        const tenantIdNumeric = tenantRows[0].id;

        // 4. Buscar al usuario, FILTRANDO POR EL ID NUMÉRICO DEL INQUILINO y asegurando que sea admin.
        const [rows] = await pool.execute<User[]>(
            // ⚠️ Seleccionamos explícitamente el campo 'password' que contiene el hash
            'SELECT id, tenant_id, email, password, name, is_admin FROM users WHERE email = ? AND is_admin = 1 AND tenant_id = ?',
            [email, tenantIdNumeric]
        );

        if (rows.length === 0) {
            // No encontrado, o no es administrador para este tenant
            return res.status(401).json({ message: 'Credenciales inválidas' });
        }

        const user = rows[0];

        // 5. 🔑 CORRECCIÓN CRUCIAL: Comparar la contraseña con el hash cifrado
        const isMatch = await bcrypt.compare(password, user.password);

        if (isMatch) {
            // 6. Inicio de sesión exitoso
            // Eliminamos la contraseña (hash) del objeto de respuesta por seguridad
            const { password: userPassword, ...userData } = user;

            res.status(200).json({
                message: 'Inicio de sesión exitoso',
                token: 'admin-token', // NOTA: Reemplazar con la generación de un JWT real.
                user: { ...userData, tenantId: tenantSlug }
            });
        } else {
            // 7. Contraseña no coincide
            res.status(401).json({ message: 'Credenciales inválidas' });
        }
    } catch (error) {
        console.error("Error en /admin/login:", error);
        res.status(500).json({ message: 'Error del servidor. Consulte los logs para más detalles.' });
    }
});

export default router;