// src/routes/staffRoutes.ts (Implementación final)
import { Router, Request, Response, NextFunction } from 'express';
import pool from '../db';
import bcrypt from 'bcryptjs';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { ParamsDictionary } from 'express-serve-static-core';

// Router con mergeParams: true, necesario para leer :tenantId del path
const router = Router({ mergeParams: true });

// Interfaces adaptadas para el StaffRouter
interface StaffRouteParams extends ParamsDictionary {
    // ⚠️ CRUCIAL: Este ID es el ID numérico del tenant (e.g., 1, 2, 3)
    tenantId: string;
}

interface StaffRow extends RowDataPacket {
    id: number;
    tenant_id: number; // El ID numérico real en la tabla staff
    email: string;
    password: string;
    name: string;
    is_admin: boolean;
    role: 'admin' | 'doctor' | 'receptionist';
}

interface StaffRequest extends Request<StaffRouteParams> {
    user?: {
        id: number;
        tenant_id: string; // Slug (e.g., 'chavez')
        role: 'admin' | 'doctor' | 'receptionist' | 'client';
    };
    tenantId?: string; // Slug inyectado por resolveTenant middleware (usado para authRoutes)
}

// ⚠️ PLACEHOLDER DE MIDDLEWARE DE AUTENTICACIÓN Y AUTORIZACIÓN ⚠️
// Simulamos la inyección de req.user y verificación básica de token
const verifyToken = (req: StaffRequest, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.split(' ')[1];

    // Simulación: Asumimos que el usuario es un administrador del tenant 'chavez'
    // En un sistema real, esto se obtendría del JWT.
    (req as any).user = {
        id: 1,
        tenant_id: 'chavez',
        role: 'admin',
    };

    if (!token || !req.user || req.user.role === 'client') {
        return res.status(401).json({ message: 'No autenticado o acceso insuficiente.' });
    }

    next();
};

const isAllowedToManageStaff = (req: StaffRequest, res: Response, next: NextFunction) => {
    // Solo el administrador (rol 'admin') tiene permiso para crear/listar/editar personal
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ message: 'Acceso denegado. Solo administradores pueden gestionar personal.' });
    }
    next();
};


// 🎯 FUNCIÓN AUXILIAR (Ajustada para usar el ID numérico directamente)
// Como ServicesAdmin.tsx y StaffAdmin.tsx están enviando el ID numérico directamente en el path,
// el router solo necesita obtener el slug (tenant_id) para devolverlo al frontend.
const getTenantInfoById = async (tenantNumericId: string): Promise<{ id: number; slug: string } | null> => {
    const [tenantRows] = await pool.execute<RowDataPacket[]>(
        'SELECT id, tenant_id FROM tenants WHERE id = ?',
        [tenantNumericId]
    );
    if (tenantRows.length === 0) return null;
    return { id: tenantRows[0].id, slug: tenantRows[0].tenant_id };
};


// 🎯 1. RUTA GET para obtener la lista de personal
router.get('/', verifyToken, async (req: StaffRequest, res: Response) => {
    // ⚠️ Usamos req.params.tenantId, que el frontend ha enviado como ID numérico.
    const tenantIdNumeric = req.params.tenantId;

    try {
        const tenantInfo = await getTenantInfoById(tenantIdNumeric);
        if (tenantInfo === null) {
            return res.status(404).json({ message: `Inquilino con ID ${tenantIdNumeric} no encontrado.` });
        }

        // Obtenemos solo el personal del tenant (la tabla clients se gestiona aparte)
        const [staff] = await pool.execute<StaffRow[]>(
            `SELECT id, email, name, is_admin, role 
             FROM staff 
             WHERE tenant_id = ?`,
            [tenantInfo.id] // Buscar por ID numérico en la DB
        );

        res.status(200).json({
            message: 'Lista de personal obtenida exitosamente',
            users: staff.map(s => ({
                id: s.id,
                tenant_id: tenantInfo.slug, // Devolvemos el slug
                email: s.email,
                name: s.name,
                is_admin: s.is_admin,
                role: s.role,
            }))
        });

    } catch (error) {
        console.error("Error al obtener la lista de personal:", error);
        res.status(500).json({ message: 'Error del servidor al obtener la lista de personal.' });
    }
});

// 🎯 2. RUTA POST para crear nuevo personal (Doctor/Recepcionista/Admin)
router.post('/', verifyToken, isAllowedToManageStaff, async (req: StaffRequest, res: Response) => {
    const { email, password, name, role }: any = req.body;
    // ⚠️ Obtenemos el ID numérico del parámetro de ruta
    const tenantIdNumeric = req.params.tenantId;

    if (!tenantIdNumeric || !email || !password || !name || !role) {
        return res.status(400).json({ message: 'Faltan campos obligatorios.' });
    }
    if (!['doctor', 'receptionist', 'admin'].includes(role)) {
        return res.status(400).json({ message: 'Rol de personal no válido.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const tenantInfo = await getTenantInfoById(tenantIdNumeric);
        if (tenantInfo === null) {
            await connection.rollback();
            return res.status(404).json({ message: `Tenant con ID ${tenantIdNumeric} no encontrado.` });
        }

        // 1. Verificar si el email ya existe en la tabla `staff` o `clients`
        const [existingStaff] = await connection.execute<RowDataPacket[]>(
            'SELECT id FROM staff WHERE email = ?',
            [email]
        );
        const [existingClient] = await connection.execute<RowDataPacket[]>(
            'SELECT id FROM clients WHERE email = ?',
            [email]
        );
        if (existingStaff.length > 0 || existingClient.length > 0) {
            await connection.rollback();
            return res.status(409).json({ message: `El email '${email}' ya está registrado.` });
        }


        const saltRounds = process.env.SALT_ROUNDS ? parseInt(process.env.SALT_ROUNDS) : 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        const is_admin = (role === 'admin');

        // Insertar el nuevo personal en la tabla `staff`
        const [userResult] = await connection.execute<ResultSetHeader>(
            `INSERT INTO staff (tenant_id, email, password, name, is_admin, role)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [tenantInfo.id, email, hashedPassword, name, is_admin, role]
        );

        await connection.commit();

        res.status(201).json({
            message: `Personal ${name} creado exitosamente como ${role}!`,
            user: {
                id: userResult.insertId,
                email,
                name,
                role,
                is_admin,
                tenant_id: tenantInfo.slug
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error("Error al crear el personal:", error);
        res.status(500).json({ message: 'Error del servidor al crear el personal.' });
    } finally {
        connection.release();
    }
});

// 🎯 Agrega aquí las rutas PUT para edición y DELETE para eliminación si las necesitas
// Ejemplo de DELETE (simulando):
router.delete('/:staffId', verifyToken, isAllowedToManageStaff, async (req: StaffRequest, res: Response) => {
    const tenantIdNumeric = req.params.tenantId;
    const staffId = req.params.staffId;

    try {
        const [result] = await pool.execute<ResultSetHeader>(
            'DELETE FROM staff WHERE id = ? AND tenant_id = ?',
            [staffId, tenantIdNumeric]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: `Personal con ID ${staffId} no encontrado en este inquilino.` });
        }

        res.status(200).json({ message: 'Personal eliminado exitosamente.' });
    } catch (error) {
        console.error("Error al eliminar personal:", error);
        res.status(500).json({ message: 'Error del servidor al eliminar personal.' });
    }
});

export default router;