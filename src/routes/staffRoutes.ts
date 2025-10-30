// src/routes/staffRoutes.ts (Implementación multi-inquilino corregida para subdominio)
import { Router, Request, Response, NextFunction } from 'express';
import pool from '../db';
import bcrypt from 'bcryptjs';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { ParamsDictionary } from 'express-serve-static-core';

// Router con mergeParams: true (mantenemos por si las subrutas necesitan params)
const router = Router({ mergeParams: true });

// Interfaces adaptadas para el StaffRouter
interface StaffRouteParams extends ParamsDictionary {
    // Solo usamos staffId aquí, ya que el tenantId viene del subdominio
    staffId: string;
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
        tenant_id: string; // Slug (e.g., 'chavez') - Del usuario autenticado
        role: 'admin' | 'doctor' | 'receptionist' | 'client';
    };
    tenantId?: string; // Slug inyectado por resolveTenant middleware (CRUCIAL)
    // Nuevo: El tenant resuelto a partir del SLUG
    resolvedTenant?: {
        id: number; // El ID numérico del tenant solicitado
        slug: string; // El slug del tenant solicitado
    }
}

// 🎯 FUNCIÓN AUXILIAR - Obtiene ID y Slug por SLUG
const getTenantInfoBySlug = async (tenantSlug: string): Promise<{ id: number; slug: string } | null> => {
    const [tenantRows] = await pool.execute<RowDataPacket[]>(
        'SELECT id, tenant_id FROM tenants WHERE tenant_id = ?',
        [tenantSlug]
    );
    if (tenantRows.length === 0) return null;
    return { id: tenantRows[0].id, slug: tenantRows[0].tenant_id };
};


// -----------------------------------------------------------------------------
// 🔐 MIDDLEWARE DE AUTENTICACIÓN (Simulación dinámica de JWT - NO CAMBIA)
const verifyToken = (req: StaffRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'No autenticado. Token no proporcionado.' });
    }

    try {
        const [tenant_slug, role] = token.split(':');

        if (!tenant_slug || !['admin', 'doctor', 'receptionist', 'client'].includes(role)) {
            return res.status(401).json({ message: 'Token de simulación no válido.' });
        }

        (req as any).user = {
            id: 1, // Mock ID
            tenant_id: tenant_slug, // El tenant_id (slug) del usuario autenticado
            role: role as any,
        };

        if (req.user?.role === 'client') {
            return res.status(403).json({ message: 'Acceso denegado. Los clientes no pueden acceder a la gestión de personal.' });
        }

    } catch (e) {
        return res.status(401).json({ message: 'Token inválido o expirado.' });
    }

    next();
};

// 🛡️ MIDDLEWARE DE AUTORIZACIÓN MULTI-INQUILINO (ADAPTADO)
const ensureTenantAccess = async (req: StaffRequest, res: Response, next: NextFunction) => {
    const requestedTenantSlug = req.tenantId; // Obtenido del subdominio/header
    const authenticatedTenantSlug = req.user?.tenant_id;

    if (!requestedTenantSlug) {
        return res.status(400).json({ message: 'El ID de inquilino (slug) no se encontró en la solicitud.' });
    }

    // 1. Obtener información del inquilino solicitado a partir del SLUG
    const tenantInfo = await getTenantInfoBySlug(requestedTenantSlug);

    if (tenantInfo === null) {
        return res.status(404).json({ message: `Inquilino con ID ${requestedTenantSlug} no encontrado.` });
    }

    req.resolvedTenant = tenantInfo; // Almacenamos la info resuelta

    // 2. Comprobación de que el usuario autenticado pertenece al inquilino solicitado
    if (!req.user || authenticatedTenantSlug !== requestedTenantSlug) {
        return res.status(403).json({
            message: 'Acceso denegado. No tiene permisos para acceder a los recursos de este inquilino.'
        });
    }

    next();
};

// 🧑‍💻 MIDDLEWARE DE AUTORIZACIÓN DE ROL (NO CAMBIA)
const isAllowedToManageStaff = (req: StaffRequest, res: Response, next: NextFunction) => {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ message: 'Acceso denegado. Solo administradores pueden gestionar personal.' });
    }
    next();
};
// -----------------------------------------------------------------------------

// 🎯 1. RUTA GET para obtener la lista de personal
router.get('/', verifyToken, ensureTenantAccess, async (req: StaffRequest, res: Response) => {
    // Usamos el ID numérico y el slug resueltos
    const { id: tenantDbId, slug: tenantSlug } = req.resolvedTenant!;

    try {
        const [staff] = await pool.execute<StaffRow[]>(
            `SELECT id, email, name, is_admin, role 
             FROM staff 
             WHERE tenant_id = ?`,
            [tenantDbId] // Buscar por ID numérico en la DB
        );

        res.status(200).json({
            message: 'Lista de personal obtenida exitosamente',
            users: staff.map(s => ({
                id: s.id,
                tenant_id: tenantSlug, // Devolvemos el slug
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
router.post('/', verifyToken, ensureTenantAccess, isAllowedToManageStaff, async (req: StaffRequest, res: Response) => {
    const { email, password, name, role }: any = req.body;
    // Usamos el tenant resuelto
    const { id: tenantDbId, slug: tenantSlug } = req.resolvedTenant!;

    if (!email || !password || !name || !role) {
        return res.status(400).json({ message: 'Faltan campos obligatorios.' });
    }
    if (!['doctor', 'receptionist', 'admin'].includes(role)) {
        return res.status(400).json({ message: 'Rol de personal no válido.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

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
            [tenantDbId, email, hashedPassword, name, is_admin, role]
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
                tenant_id: tenantSlug
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

// 🎯 3. RUTA PUT para edición (PUT /api/staff/:staffId) - Corrección al problema de la consulta
router.put('/:staffId', verifyToken, ensureTenantAccess, isAllowedToManageStaff, async (req: StaffRequest, res: Response) => {
    const { staffId } = req.params;
    const { name, role, password }: any = req.body;
    const { id: tenantDbId } = req.resolvedTenant!;

    if (!name || !role) {
        return res.status(400).json({ message: 'Faltan campos obligatorios: nombre y rol.' });
    }
    if (!['doctor', 'receptionist', 'admin'].includes(role)) {
        return res.status(400).json({ message: 'Rol de personal no válido.' });
    }

    const is_admin = (role === 'admin');
    const updateFields: string[] = ['name = ?', 'role = ?', 'is_admin = ?'];
    const updateValues: (string | number | boolean)[] = [name, role, is_admin];

    // Si se proporciona una nueva contraseña, la hasheamos y la incluimos
    if (password) {
        const saltRounds = process.env.SALT_ROUNDS ? parseInt(process.env.SALT_ROUNDS) : 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        updateFields.push('password = ?');
        updateValues.push(hashedPassword);
    }

    // Añadir el filtro WHERE al final: ID del staff y ID numérico del tenant
    updateValues.push(staffId);
    updateValues.push(tenantDbId);

    const updateQuery = `UPDATE staff SET ${updateFields.join(', ')} WHERE id = ? AND tenant_id = ?`;

    try {
        const [result] = await pool.execute<ResultSetHeader>(
            updateQuery,
            updateValues
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: `Personal con ID ${staffId} no encontrado en este inquilino.` });
        }

        res.status(200).json({ message: 'Personal actualizado exitosamente.' });
    } catch (error) {
        console.error("Error al actualizar personal:", error);
        res.status(500).json({ message: 'Error del servidor al actualizar personal.' });
    }
});


// 🎯 4. RUTA DELETE para eliminación (DELETE /api/staff/:staffId)
router.delete('/:staffId', verifyToken, ensureTenantAccess, isAllowedToManageStaff, async (req: StaffRequest, res: Response) => {
    const staffId = req.params.staffId;
    // 🔑 Usamos el ID numérico del tenant resuelto para la consulta
    const { id: tenantDbId } = req.resolvedTenant!;

    try {
        const [result] = await pool.execute<ResultSetHeader>(
            'DELETE FROM staff WHERE id = ? AND tenant_id = ?',
            [staffId, tenantDbId] // Se asegura que el staff a eliminar pertenece al tenant del host
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



// 🎯 RUTA DELETE para eliminación
router.delete('/:staffId', verifyToken, ensureTenantAccess, isAllowedToManageStaff, async (req: StaffRequest, res: Response) => {
    // Usamos el ID numérico del tenant resuelto para la consulta
    const { id: tenantDbId } = req.resolvedTenant!;
    const staffId = req.params.staffId;

    try {
        const [result] = await pool.execute<ResultSetHeader>(
            'DELETE FROM staff WHERE id = ? AND tenant_id = ?',
            [staffId, tenantDbId] // Se asegura que el staff a eliminar pertenece al tenant de la URL
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