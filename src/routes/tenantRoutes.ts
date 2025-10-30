// src/routes/tenantRoutes.ts (Corregido y Asegurado para Subdominio)
import { Router, Request, Response, NextFunction } from 'express';
import pool from '../db';
import { RowDataPacket, OkPacket } from 'mysql2';
import { ParamsDictionary } from 'express-serve-static-core';

const router = Router();

// Interfaces para tipado
interface TenantRouteParams extends ParamsDictionary {
    tenantId: string;
}

interface TenantRequest<P = TenantRouteParams> extends Request<P> {
    tenantId?: string; // El slug del subdominio/header inyectado por resolveTenant (CRUCIAL)
    user?: {
        id: number;
        tenant_id: string; // Slug del inquilino autenticado (e.g., 'chavez')
        role: 'admin' | 'doctor' | 'receptionist' | 'client';
    };
}

// Interfaz para la respuesta del inquilino (tenant)
interface Tenant extends RowDataPacket {
    id: number;
    tenant_id: string; // Es el slug (chavez)
    name: string;
    phone: string;
    email: string;
    address: string;
    schedule: string;
    logo_url: string;
    primary_color: string;
    secondary_color: string;
}

// -----------------------------------------------------------------------------
// 🔐 MIDDLEWARE DE AUTENTICACIÓN (Reutilizado para inyectar req.user)
const verifyToken = (req: TenantRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];

    if (!token) {
        // Permitimos pasar a la validación de inquilino si no hay token para el /profile GET
        if (req.method === 'GET' && req.route.path === '/profile') return next();
        return res.status(401).json({ message: 'No autenticado. Token no proporcionado.' });
    }

    try {
        const [tenant_slug, role] = token.split(':');

        if (!tenant_slug || !['admin', 'doctor', 'receptionist', 'client'].includes(role)) {
            return res.status(401).json({ message: 'Token de simulación no válido.' });
        }

        (req as any).user = {
            id: 1,
            tenant_id: tenant_slug,
            role: role as any,
        };

    } catch (e) {
        return res.status(401).json({ message: 'Token inválido o expirado.' });
    }

    next();
};

// 🛡️ MIDDLEWARE DE AUTORIZACIÓN MULTI-INQUILINO (CRUCIAL)
const ensureTenantAccessBySlug = (req: TenantRequest<any>, res: Response, next: NextFunction) => {
    const requestedTenantSlug = req.tenantId; // Desde el middleware `resolveTenant` (header/host)
    const authenticatedTenantSlug = req.user?.tenant_id;

    // CASO 1: Acceso público a perfil (GET /profile sin autenticación)
    if (req.method === 'GET' && req.route.path === '/profile' && !req.user) {
        if (!requestedTenantSlug) {
            return res.status(400).json({ message: 'Tenant ID is missing from the request URL or host.' });
        }
        return next();
    }

    // CASO 2: Acceso que requiere autenticación (PUT /:tenantId o GET /profile con token)
    if (!authenticatedTenantSlug || !requestedTenantSlug) {
        return res.status(403).json({ message: 'Falta información de inquilino o usuario autenticado.' });
    }

    // Comprobación de que el usuario autenticado pertenece al inquilino solicitado
    if (authenticatedTenantSlug !== requestedTenantSlug) {
        return res.status(403).json({
            message: 'Acceso denegado. No tiene permisos para acceder a los recursos de este inquilino.'
        });
    }

    // Si la ruta PUT tiene un :tenantId en los params (e.g., /api/tenants/chavez), validamos que sea consistente.
    if (req.params.tenantId && req.params.tenantId !== requestedTenantSlug) {
        return res.status(403).json({
            message: 'Inconsistencia de inquilino. El recurso solicitado no coincide con su sesión.'
        });
    }

    next();
};

// 🧑‍💻 MIDDLEWARE DE AUTORIZACIÓN DE ROL
const isAdminStaff = (req: TenantRequest<any>, res: Response, next: NextFunction) => {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ message: 'Acceso denegado. Solo administradores pueden modificar el perfil del inquilino.' });
    }
    next();
};

// -----------------------------------------------------------------------------


// 🎯 RUTA para obtener el perfil del inquilino (GET /api/tenants/profile)
router.get('/profile', verifyToken, ensureTenantAccessBySlug, async (req: TenantRequest, res: Response) => {
    // Usamos el slug inyectado por el middleware resolveTenant (subdominio)
    const tenantSlug = req.tenantId;

    try {
        const [rows] = await pool.execute<Tenant[]>(
            'SELECT id, tenant_id, name, phone, email, address, schedule, logo_url, primary_color, secondary_color FROM tenants WHERE tenant_id = ?',
            [tenantSlug]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: `Tenant con ID ${tenantSlug} no encontrado` });
        }

        const tenantData = rows[0];

        // La URL estática necesita el hostname
        const logoUrl = tenantData.logo_url.startsWith('http')
            ? tenantData.logo_url
            : `http://${req.hostname}:4000${tenantData.logo_url}`;


        res.status(200).json({
            message: 'Perfil del inquilino obtenido exitosamente',
            tenant: {
                id: tenantData.id,
                tenantId: tenantData.tenant_id, // Slug
                name: tenantData.name,
                phone: tenantData.phone,
                email: tenantData.email,
                address: tenantData.address,
                schedule: tenantData.schedule,
                logoUrl: logoUrl,
                primaryColor: tenantData.primary_color,
                secondaryColor: tenantData.secondary_color,
            }
        });
    } catch (error) {
        console.error("Error al obtener el perfil del inquilino:", error);
        res.status(500).json({ message: 'Error del servidor al obtener el perfil.' });
    }
});


// 🎯 RUTA PUT para actualizar el perfil del inquilino (PUT /api/tenants/:tenantId)
// El :tenantId en este caso DEBE coincidir con el slug inyectado en req.tenantId
router.put('/:tenantId', verifyToken, ensureTenantAccessBySlug, isAdminStaff, async (req: TenantRequest<TenantRouteParams>, res: Response) => {
    const tenantSlug = req.params.tenantId;
    const { name, address, phone, schedule, email } = req.body;

    if (!name || !address || !phone || !schedule || !email) {
        return res.status(400).json({ message: 'Faltan campos obligatorios para la actualización del perfil.' });
    }

    try {
        const [result] = await pool.execute<OkPacket>(
            `UPDATE tenants 
             SET name = ?, address = ?, phone = ?, schedule = ?, email = ? 
             WHERE tenant_id = ?`,
            [name, address, phone, schedule, email, tenantSlug]
        );

        if (result.affectedRows === 0) {
            const [rows] = await pool.execute<RowDataPacket[]>(
                'SELECT id FROM tenants WHERE tenant_id = ?',
                [tenantSlug]
            );

            if (rows.length === 0) {
                return res.status(404).json({ message: `Tenant con ID ${tenantSlug} no encontrado.` });
            }

            return res.status(200).json({
                message: 'Perfil del inquilino actualizado exitosamente (sin cambios en los datos enviados).',
                updatedFields: { name, address, phone, schedule, email }
            });
        }

        res.status(200).json({
            message: 'Perfil del inquilino actualizado exitosamente!',
            updatedFields: { name, address, phone, schedule, email }
        });

    } catch (error) {
        console.error("Error al actualizar el perfil del inquilino:", error);
        res.status(500).json({ message: 'Error del servidor al actualizar el perfil.' });
    }
});

export default router;