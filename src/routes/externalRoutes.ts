// src/routes/externalRoutes.ts
import { Router, Request, Response, NextFunction } from 'express';
import pool from '../db';
import bcrypt from 'bcryptjs';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

const router = Router();

// Middleware de autenticación para la API externa
const authenticateExternalApi = (req: Request, res: Response, next: NextFunction) => {
    const externalToken = req.headers['x-external-api-token'];
    const expectedToken = process.env.EXTERNAL_API_TOKEN;

    if (!expectedToken) {
        console.error("Error: EXTERNAL_API_TOKEN no está configurado en .env");
        return res.status(500).json({ message: 'Error de configuración del servidor.' });
    }

    if (externalToken !== expectedToken) {
        return res.status(401).json({ message: 'Token de autenticación inválido o faltante.' });
    }

    next();
};

// 🎯 RUTA POST para registrar un nuevo inquilino y un usuario administrador
// Endpoint: POST /api/external/register-tenant
router.post('/register-tenant', authenticateExternalApi, async (req: Request, res: Response) => {
    const { tenant_id, name, email, password }: any = req.body;

    // 1. Validación de campos obligatorios (Sin cambios)
    if (!tenant_id || !name || !email || !password) {
        return res.status(400).json({ message: 'Faltan campos obligatorios: tenant_id, name, email, password.' });
    }

    const PROD_DOMAIN_BASE = 'veterinaria.techinnovats.com';
    const LOCAL_DOMAIN_HOST = 'localhost:5173';

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 2. Verificar si el tenant_id ya existe (Sin cambios)
        const [existingTenant] = await connection.execute<RowDataPacket[]>(
            'SELECT id FROM tenants WHERE tenant_id = ?',
            [tenant_id]
        );
        if (existingTenant.length > 0) {
            await connection.rollback();
            return res.status(409).json({ message: `El ID de inquilino '${tenant_id}' ya está en uso.` });
        }

        // 3. Verificar si el email ya existe en la nueva tabla `staff`
        // ⚠️ Cambiado de 'users' a 'staff'
        const [existingStaff] = await connection.execute<RowDataPacket[]>(
            'SELECT id FROM staff WHERE email = ?',
            [email]
        );
        // Opcional: También verificamos la tabla `clients` para evitar colisiones de email global
        const [existingClient] = await connection.execute<RowDataPacket[]>(
            'SELECT id FROM clients WHERE email = ?',
            [email]
        );

        if (existingStaff.length > 0 || existingClient.length > 0) {
            await connection.rollback();
            // Mensaje genérico para no revelar la estructura interna
            return res.status(409).json({ message: `El email de usuario '${email}' ya está registrado.` });
        }

        // 4. Cifrar la contraseña (Sin cambios)
        const saltRounds = process.env.SALT_ROUNDS ? parseInt(process.env.SALT_ROUNDS) : 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // 5. Datos por defecto / aleatorios (Sin cambios)
        const defaultLogoUrl = process.env.DEFAULT_LOGO_URL || '/uploads/default-logo.png';
        const defaultData = {
            phone: 'N/A',
            address: 'Dirección por definir',
            schedule: 'Lun-Vie: 9am - 5pm',
            logo_url: defaultLogoUrl,
            primary_color: '#007bff',
            secondary_color: '#6c757d',
        };

        // 6. Insertar el nuevo inquilino (Sin cambios)
        const [tenantResult] = await connection.execute<ResultSetHeader>(
            `INSERT INTO tenants (tenant_id, name, phone, email, address, schedule, logo_url, primary_color, secondary_color)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                tenant_id,
                name,
                defaultData.phone,
                email,
                defaultData.address,
                defaultData.schedule,
                defaultData.logo_url,
                defaultData.primary_color,
                defaultData.secondary_color,
            ]
        );
        const tenantId = tenantResult.insertId;

        // 7. Crear el usuario administrador
        // ⚠️ Insertamos en la tabla `staff` y añadimos el campo `role`
        const [userResult] = await connection.execute<ResultSetHeader>(
            `INSERT INTO staff (tenant_id, email, password, name, is_admin, role)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                tenantId,
                email,
                hashedPassword,
                name,
                true,     // is_admin: true
                'admin',  // 🆕 Rol de administrador
            ]
        );

        // 8. Commit de la transacción (Sin cambios)
        await connection.commit();
        const productionUrl = `${tenant_id}.${PROD_DOMAIN_BASE}`;
        const localUrl = `http://${tenant_id}.${LOCAL_DOMAIN_HOST}/`;

        res.status(201).json({
            message: 'Empresa y usuario administrador creados exitosamente!',
            tenant: {
                id: tenantId,
                tenant_id: tenant_id,
                name: name,
                email: email,
                logo_url: defaultData.logo_url,
            },
            user: {
                id: userResult.insertId,
                email: email,
                name: name,
                is_admin: true,
                role: 'admin', // 🆕 Incluimos el rol
            },
            access: {
                productionUrl: productionUrl,
                localUrl: localUrl
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error("Error al registrar el inquilino/usuario:", error);
        res.status(500).json({ message: 'Error interno del servidor al completar el registro.' });
    } finally {
        connection.release();
    }
});

export default router;