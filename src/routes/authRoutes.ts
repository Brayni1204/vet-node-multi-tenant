// src/routes/authRoutes.ts (Modificado)
import { Router, Request, Response } from 'express';
import pool from '../db';
import { RowDataPacket } from 'mysql2';
import bcrypt from 'bcryptjs';

// Interfaz para definir la estructura de los datos del PERSONAL (antigua users renombrada a staff)
interface Staff extends RowDataPacket {
    id: number;
    tenant_id: number;
    email: string;
    password: string; // Contiene el hash cifrado
    name: string;
    is_admin: boolean;
    role: 'admin' | 'doctor' | 'receptionist'; // 🆕 Nuevo campo de rol para el personal
}

// Interfaz para la tabla de CLIENTES
interface Client extends RowDataPacket {
    id: number;
    tenant_id: number;
    email: string;
    password: string;
    name: string;
    phone: string;
    address: string;
}

interface LoginRequest extends Request {
    tenantId?: string;
    params: {
        tenantId: string;
        [key: string]: any;
    }
}

const router = Router();

// =================================================================
// 🎯 1. RUTA DE LOGIN PARA PERSONAL ADMINISTRATIVO (Busca en la tabla `staff`)
// =================================================================
router.post('/admin/login', async (req: LoginRequest, res: Response) => {
    const { email, password } = req.body;
    const tenantSlug = req.tenantId;

    if (!tenantSlug || !email || !password) {
        return res.status(400).json({ message: 'Credenciales incompletas.' });
    }

    try {
        const [tenantRows] = await pool.execute<RowDataPacket[]>(
            'SELECT id FROM tenants WHERE tenant_id = ?',
            [tenantSlug]
        );

        if (tenantRows.length === 0) {
            return res.status(401).json({ message: 'Credenciales inválidas' });
        }

        const tenantIdNumeric = tenantRows[0].id;

        // ⚠️ Busca en la tabla `staff`
        const [rows] = await pool.execute<Staff[]>(
            `SELECT id, tenant_id, email, password, name, is_admin, role 
             FROM staff 
             WHERE email = ? AND tenant_id = ?`,
            [email, tenantIdNumeric]
        );

        if (rows.length === 0) {
            return res.status(401).json({ message: 'Credenciales inválidas' });
        }

        const staffUser = rows[0];
        const isMatch = await bcrypt.compare(password, staffUser.password);

        if (isMatch) {
            const { password: userPassword, ...userData } = staffUser;

            res.status(200).json({
                message: `Inicio de sesión exitoso como ${staffUser.role}`,
                token: `${staffUser.role}-token`,
                user: { ...userData, tenantId: tenantSlug }
            });
        } else {
            return res.status(401).json({ message: 'Credenciales inválidas' });
        }
    } catch (error) {
        console.error("Error en /admin/login:", error);
        res.status(500).json({ message: 'Error del servidor. Consulte los logs para más detalles.' });
    }
});

// =================================================================
// 🎯 2. RUTA DE LOGIN PARA CLIENTES (Nueva ruta, busca en la tabla `clients`)
// =================================================================
router.post('/client/login', async (req: LoginRequest, res: Response) => {
    const { email, password } = req.body;
    const tenantSlug = req.tenantId;

    if (!tenantSlug || !email || !password) {
        return res.status(400).json({ message: 'Credenciales incompletas.' });
    }

    try {
        const [tenantRows] = await pool.execute<RowDataPacket[]>(
            'SELECT id FROM tenants WHERE tenant_id = ?',
            [tenantSlug]
        );

        if (tenantRows.length === 0) {
            return res.status(401).json({ message: 'Credenciales inválidas' });
        }

        const tenantIdNumeric = tenantRows[0].id;

        // ⚠️ Busca en la tabla `clients`
        const [rows] = await pool.execute<Client[]>(
            `SELECT id, tenant_id, email, password, name, phone, address 
             FROM clients 
             WHERE email = ? AND tenant_id = ?`,
            [email, tenantIdNumeric]
        );

        if (rows.length === 0) {
            return res.status(401).json({ message: 'Credenciales inválidas' });
        }

        const clientUser = rows[0];
        const isMatch = await bcrypt.compare(password, clientUser.password);

        if (isMatch) {
            const { password: userPassword, ...clientData } = clientUser;

            res.status(200).json({
                message: 'Inicio de sesión de cliente exitoso',
                token: 'client-token',
                user: { ...clientData, role: 'client', tenantId: tenantSlug } // Rol 'client' inyectado
            });
        } else {
            return res.status(401).json({ message: 'Credenciales inválidas' });
        }
    } catch (error) {
        console.error('Error en /client/login:', error);
        res.status(500).json({ message: 'Error del servidor. Consulte los logs para más detalles.' });
    }
});

router.post('/admin/logout', (req: Request, res: Response) => {
    // Aquí puedes incluir lógica futura, como invalidar tokens en una lista negra (blacklist).
    // Por ahora, simplemente respondemos con éxito para que el cliente limpie su sesión.
    res.status(200).json({ message: 'Sesión de personal cerrada exitosamente en el backend.' });
});

export default router;