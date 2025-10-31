// src/routes/clientAuthRoutes.ts
import { Router, Request, Response } from 'express';
import pool from '../db';
import bcrypt from 'bcryptjs';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { ParamsDictionary } from 'express-serve-static-core';

const router = Router();

// --- Interfaces y Helpers ---
interface ClientAuthRequest extends Request<ParamsDictionary> {
    tenantId?: string; // Inyectado por resolveTenant
}

interface ClientRow extends RowDataPacket {
    id: number;
    tenant_id: number;
    email: string;
    password: string;
    name: string;
    phone: string;
    address: string;
}

const getTenantNumericId = async (tenantSlug: string): Promise<number | null> => {
    const [tenantRows] = await pool.execute<RowDataPacket[]>(
        'SELECT id FROM tenants WHERE tenant_id = ?',
        [tenantSlug]
    );
    return tenantRows.length > 0 ? tenantRows[0].id : null;
};

// -----------------------------------------------------------------------------
// 1. REGISTRO DE CLIENTE (POST /api/client/auth/register)
// -----------------------------------------------------------------------------
router.post('/register', async (req: ClientAuthRequest, res: Response) => {
    const { name, email, password, phone, address } = req.body;
    const tenantSlug = req.tenantId;

    if (!name || !email || !password) {
        return res.status(400).json({ message: 'Nombre, email y contraseña son obligatorios.' });
    }
    if (!tenantSlug) {
        return res.status(400).json({ message: 'Inquilino no identificado.' });
    }

    const connection = await pool.getConnection();
    try {
        const tenantNumericId = await getTenantNumericId(tenantSlug);
        if (tenantNumericId === null) {
            return res.status(404).json({ message: `Inquilino ${tenantSlug} no encontrado.` });
        }

        await connection.beginTransaction();

        // Verificar que el email no exista en 'clients' O 'staff'
        const [existingClient] = await connection.execute<RowDataPacket[]>(
            'SELECT id FROM clients WHERE email = ?', [email]
        );
        const [existingStaff] = await connection.execute<RowDataPacket[]>(
            'SELECT id FROM staff WHERE email = ?', [email]
        );

        if (existingClient.length > 0 || existingStaff.length > 0) {
            await connection.rollback();
            return res.status(409).json({ message: 'El correo electrónico ya está en uso.' });
        }

        // Hashear contraseña
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Insertar nuevo cliente
        const [result] = await connection.execute<ResultSetHeader>(
            'INSERT INTO clients (tenant_id, name, email, password, phone, address) VALUES (?, ?, ?, ?, ?, ?)',
            [tenantNumericId, name, email, hashedPassword, phone || null, address || null]
        );

        await connection.commit();

        res.status(201).json({
            message: 'Usuario registrado exitosamente.',
            clientId: result.insertId
        });

    } catch (error) {
        await connection.rollback();
        console.error("Error en registro de cliente:", error);
        res.status(500).json({ message: 'Error del servidor al registrar el cliente.' });
    } finally {
        connection.release();
    }
});

// -----------------------------------------------------------------------------
// 2. LOGIN DE CLIENTE (POST /api/client/auth/login)
// -----------------------------------------------------------------------------
router.post('/login', async (req: ClientAuthRequest, res: Response) => {
    const { email, password } = req.body;
    const tenantSlug = req.tenantId;

    if (!email || !password) {
        return res.status(400).json({ message: 'Email y contraseña son obligatorios.' });
    }
    if (!tenantSlug) {
        return res.status(400).json({ message: 'Inquilino no identificado.' });
    }

    try {
        const tenantNumericId = await getTenantNumericId(tenantSlug);
        if (tenantNumericId === null) {
            return res.status(404).json({ message: `Inquilino ${tenantSlug} no encontrado.` });
        }

        // Buscar al cliente por email Y tenant_id
        const [rows] = await pool.execute<ClientRow[]>(
            'SELECT * FROM clients WHERE email = ? AND tenant_id = ?',
            [email, tenantNumericId]
        );

        if (rows.length === 0) {
            return res.status(401).json({ message: 'Credenciales inválidas.' });
        }

        const client = rows[0];

        // Comparar contraseña
        const isMatch = await bcrypt.compare(password, client.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Credenciales inválidas.' });
        }

        // --- Generar Token de Simulación (igual que en admin) ---
        // En un futuro, aquí generarías un JWT real.
        // Formato: "tenant_slug:role:client_id"
        const token = `${tenantSlug}:client:${client.id}`;

        res.status(200).json({
            message: 'Inicio de sesión exitoso.',
            token,
            user: {
                id: client.id,
                name: client.name,
                email: client.email,
                role: 'client' // Rol fijo
            }
        });

    } catch (error) {
        console.error("Error en login de cliente:", error);
        res.status(500).json({ message: 'Error del servidor al iniciar sesión.' });
    }
});

export default router;