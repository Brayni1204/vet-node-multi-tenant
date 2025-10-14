import { Router } from 'express';
import pool from '../db';
import { RowDataPacket } from 'mysql2';

const router = Router();

// Interfaz para definir la estructura de los datos del usuario
interface User extends RowDataPacket {
    id: number;
    tenant_id: number;
    email: string;
    password: string; // En una app real, la contraseña estaría hasheada
    name: string;
    is_admin: boolean;
}

// Ruta de inicio de sesión para administradores
router.post('/admin/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const [rows] = await pool.execute('SELECT * FROM users WHERE email = ? AND is_admin = 1', [email]);

        // Asignamos el tipo de dato al resultado de la consulta
        const users = rows as User[];

        if (users.length > 0) {
            const user = users[0];
            // Aquí, en una aplicación real, compararías la contraseña encriptada
            if (user.password === password) { // Simulación
                res.status(200).json({
                    message: 'Inicio de sesión exitoso',
                    token: 'admin-token',
                    user: { id: user.id, email: user.email, name: user.name }
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

// Puedes agregar rutas para el login/registro de clientes aquí
// router.post('/register', ...);

export default router;