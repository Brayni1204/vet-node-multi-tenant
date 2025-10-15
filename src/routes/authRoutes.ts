// src/routes/authRoutes.ts
import { Router } from 'express';
import pool from '../db';
import { RowDataPacket } from 'mysql2';

const router = Router();

// Interfaz para definir la estructura de los datos del usuario
interface User extends RowDataPacket {
    id: number;
    tenant_id: number;
    email: string;
    password: string;
    name: string;
    is_admin: boolean;
}

// Ruta de inicio de sesión para administradores
router.post('/admin/login', async (req, res) => {
    const { email, password, tenantId } = req.body; // Extraemos el tenantId del cuerpo
    try {
        const [rows] = await pool.execute<User[]>('SELECT * FROM users WHERE email = ? AND is_admin = 1', [email]);

        if (rows.length > 0) {
            const user = rows[0];
            if (user.password === password) {
                // Generar token JWT en una app real
                res.status(200).json({
                    message: 'Inicio de sesión exitoso',
                    token: 'admin-token', // En una app real, este token sería dinámico
                    user: { id: user.id, email: user.email, name: user.name, tenantId: user.tenant_id }
                });
            } else {
                res.status(401).json({ message: 'Credenciales inválidas' });
            }
        } else {
            res.status(401).json({ message: 'Credenciales inválidas' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error del servidor' });
    }
});

export default router;