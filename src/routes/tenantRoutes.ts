// src/routes/tenantRoutes.ts (Contenido Propuesto)
import { Router, Request, Response } from 'express';
import pool from '../db';
import { RowDataPacket } from 'mysql2';

const router = Router();

// Interfaz para el Request con el campo tenantId
interface TenantRequest extends Request {
    tenantId?: string; // El slug del subdominio (e.g., 'chavez')
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

// 🎯 RUTA para obtener el perfil del inquilino
router.get('/profile', async (req: TenantRequest, res: Response) => {
    const tenantSlug = req.tenantId;
    if (!tenantSlug) {
        return res.status(400).json({ message: 'Tenant ID is missing from the request URL or host.' });
    }
    try {
        const [rows] = await pool.execute<Tenant[]>(
            'SELECT * FROM tenants WHERE tenant_id = ?',
            [tenantSlug]
        );
        if (rows.length === 0) {
            return res.status(404).json({ message: `Tenant con ID ${tenantSlug} no encontrado` });
        }
        const tenantData = rows[0];
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
                logoUrl: tenantData.logo_url,
                primaryColor: tenantData.primary_color,
                secondaryColor: tenantData.secondary_color,
            }
        });
    } catch (error) {
        console.error("Error al obtener el perfil del inquilino:", error);
        res.status(500).json({ message: 'Error del servidor al obtener el perfil.' });
    }
});

router.put('/:tenantId', async (req: TenantRequest, res: Response) => {
    // Capturamos el tenantId (que es el slug o ID del tenant, ej: 'chavez-vet') del parámetro de ruta.
    const { tenantId } = req.params;
    const { name, address, phone, schedule, email } = req.body;

    if (!tenantId) {
        return res.status(400).json({ message: 'Tenant ID is missing from the request URL.' });
    }

    // Se asume que el frontend envía los campos name, address, phone, schedule, email en el body.
    if (!name || !address || !phone || !schedule || !email) {
        return res.status(400).json({ message: 'Faltan campos obligatorios para la actualización del perfil.' });
    }

    try {
        // Ejecutamos la consulta de actualización. Buscamos por la columna 'tenant_id'.
        const [result] = await pool.execute(
            `UPDATE tenants 
             SET name = ?, address = ?, phone = ?, schedule = ?, email = ? 
             WHERE tenant_id = ?`, // Usamos tenant_id para el lookup con el slug (e.g., 'chavez-vet')
            [name, address, phone, schedule, email, tenantId]
        );

        const updateResult = result as any;

        if (updateResult.affectedRows === 0) {
            // Verificamos si el tenant existe (podría ser 0 si no hubo cambios)
            const [rows] = await pool.execute<RowDataPacket[]>(
                'SELECT id FROM tenants WHERE tenant_id = ?',
                [tenantId]
            );

            if (rows.length === 0) {
                return res.status(404).json({ message: `Tenant con ID ${tenantId} no encontrado.` });
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