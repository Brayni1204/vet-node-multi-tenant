// src/routes/serviceRoutes.ts
import { Router, Request, Response, NextFunction } from 'express';
import pool from '../db';
import { RowDataPacket, OkPacket } from 'mysql2';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { ParamsDictionary } from 'express-serve-static-core';

const router = Router({ mergeParams: true });

// --- INTERFACES (Sin cambios) ---
interface ServiceItemParams extends ParamsDictionary {
    serviceId: string;
}

interface ServiceRequest<P extends ParamsDictionary> extends Request<P> {
    file?: Express.Multer.File;
    user?: {
        id: number;
        tenant_id: string;
        role: 'admin' | 'doctor' | 'receptionist' | 'client';
    };
    tenantId?: string;
}

interface ImageRow extends RowDataPacket {
    id: number;
    tenant_id: number;
    storage_key: string;
    url: string;
    alt_text: string;
}

// --- HELPERS Y CONFIGURACIÓN (Sin cambios) ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

const getTenantNumericId = async (tenantSlug: string): Promise<number | null> => {
    const [tenantRows] = await pool.execute<RowDataPacket[]>(
        'SELECT id FROM tenants WHERE tenant_id = ?',
        [tenantSlug]
    );
    return tenantRows.length > 0 ? tenantRows[0].id : null;
};

const getDisplayImageUrl = (path: string, hostname: string) => {
    if (!path) return null;
    return path.startsWith('http') ? path : `http://${hostname}:4000${path}`;
};


// --- MIDDLEWARES (Sin cambios) ---
const verifyToken = (req: ServiceRequest<any>, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];

    if (!token) {
        if (req.method === 'GET' && req.route.path === '/') return next();
        return res.status(401).json({ message: 'No autenticado. Token no proporcionado.' });
    }

    try {
        const [tenant_slug, role] = token.split(':');

        if (!tenant_slug || !['admin', 'doctor', 'receptionist', 'client'].includes(role)) {
            return res.status(401).json({ message: 'Token de simulación no válido.' });
        }

        (req as any).user = {
            id: 1, // Mock ID
            tenant_id: tenant_slug,
            role: role as any,
        };

    } catch (e) {
        return res.status(401).json({ message: 'Token inválido o expirado.' });
    }

    next();
};

const ensureTenantAccess = async (req: ServiceRequest<any>, res: Response, next: NextFunction) => {
    const requestedTenantSlug = req.tenantId;

    if (!requestedTenantSlug) {
        return res.status(400).json({ message: 'El ID de inquilino (slug) no se encontró en la solicitud.' });
    }

    if (req.method === 'GET' && req.route.path === '/') {
        return next();
    }

    if (!req.user) {
        return res.status(401).json({ message: 'Se requiere autenticación para esta acción.' });
    }

    const authenticatedTenantSlug = req.user.tenant_id;

    if (authenticatedTenantSlug !== requestedTenantSlug) {
        return res.status(403).json({
            message: 'Acceso denegado. No tiene permisos para acceder a los recursos de este inquilino.'
        });
    }

    next();
};

const isAllowedToManageServices = (req: ServiceRequest<any>, res: Response, next: NextFunction) => {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ message: 'Acceso denegado. Solo administradores pueden gestionar servicios.' });
    }
    next();
};
// -----------------------------------------------------------------------------


// 1. OBTENER SERVICIOS (GET /api/services)
router.get('/', ensureTenantAccess, async (req: ServiceRequest<any>, res: Response) => {
    const tenantSlug = req.tenantId!;
    const { status, search } = req.query;

    try {
        const tenantNumericId = await getTenantNumericId(tenantSlug);

        if (tenantNumericId === null) {
            return res.status(404).json({ message: `Inquilino con ID ${tenantSlug} no encontrado.` });
        }

        let query = `
            SELECT 
                s.id, s.title, s.description, s.is_active, 
                i.url AS image
            FROM services s
            LEFT JOIN service_images si ON s.id = si.service_id AND si.is_primary = TRUE
            LEFT JOIN images i ON si.image_id = i.id
            WHERE s.tenant_id = ?
        `;
        const queryParams: (string | number | boolean)[] = [tenantNumericId];

        const isAdmin = req.user?.role === 'admin';

        // 🚨 LÓGICA DE FILTRADO CORREGIDA 🚨
        if (isAdmin) {
            // Caso Admin: Aplicamos filtro SOLO si el estado es 'active' o 'inactive'
            if (status === 'active') {
                query += ' AND s.is_active = TRUE';
            } else if (status === 'inactive') {
                query += ' AND s.is_active = FALSE';
            }
            // Si status es 'all', NO añadimos condición, devolviendo todos.
        } else {
            // Caso Público/No-Admin: Siempre forzamos a mostrar solo los activos
            query += ' AND s.is_active = TRUE';
        }

        if (search) {
            query += ' AND (s.title LIKE ? OR s.description LIKE ?)';
            queryParams.push(`%${search}%`);
            queryParams.push(`%${search}%`);
        }

        query += ' ORDER BY s.id DESC';

        const [rows] = await pool.execute<RowDataPacket[]>(query, queryParams);

        const servicesWithImages = rows.map((row: any) => ({
            id: row.id,
            title: row.title,
            description: row.description,
            // Convertimos TINYINT(1) o BOOLEAN de MySQL a booleano de JavaScript
            is_active: row.is_active === 1,
            image: row.image ? getDisplayImageUrl(row.image, req.hostname) : null
        }));

        res.status(200).json({
            message: 'Servicios obtenidos exitosamente',
            services: servicesWithImages,
        });

    } catch (error) {
        console.error("Error al obtener servicios:", error);
        res.status(500).json({ message: 'Error del servidor al obtener servicios.' });
    }
});


// 2. CREAR UN NUEVO SERVICIO (POST /api/services) (Sin cambios)
router.post('/', verifyToken, ensureTenantAccess, isAllowedToManageServices, upload.single('image'), async (req: ServiceRequest<any>, res: Response) => {
    const tenantSlug = req.tenantId!;
    const { title, description } = req.body;
    const file = req.file;

    if (!title || !description || !file) {
        if (file) fs.unlinkSync(file.path);
        return res.status(400).json({ message: 'Faltan campos obligatorios (title, description, image).' });
    }

    const connection = await pool.getConnection();

    try {
        const tenantNumericId = await getTenantNumericId(tenantSlug);
        if (tenantNumericId === null) {
            if (file) fs.unlinkSync(file.path);
            return res.status(404).json({ message: `Inquilino con ID ${tenantSlug} no encontrado.` });
        }

        await connection.beginTransaction();

        const [serviceResult] = await connection.execute<OkPacket>(
            'INSERT INTO services (tenant_id, title, description) VALUES (?, ?, ?)',
            [tenantNumericId, title, description]
        );
        const serviceId = serviceResult.insertId;

        const imageUrl = `/uploads/${file.filename}`;
        const storageKey = file.filename;

        const [imageResult] = await connection.execute<OkPacket>(
            'INSERT INTO images (tenant_id, storage_key, url, alt_text) VALUES (?, ?, ?, ?)',
            [tenantNumericId, storageKey, imageUrl, title]
        );
        const imageId = imageResult.insertId;

        await connection.execute(
            'INSERT INTO service_images (service_id, image_id, is_primary, sort_order) VALUES (?, ?, TRUE, 0)',
            [serviceId, imageId]
        );

        await connection.commit();

        res.status(201).json({
            message: 'Servicio creado exitosamente!',
            serviceId: serviceId,
            imageUrl: getDisplayImageUrl(imageUrl, req.hostname)
        });

    } catch (error) {
        await connection.rollback();
        if (file) fs.unlinkSync(file.path);
        console.error("Error al crear servicio:", error);
        res.status(500).json({ message: 'Error del servidor al crear el servicio.' });
    } finally {
        connection.release();
    }
});

// 3. ACTUALIZAR UN SERVICIO (PUT /api/services/:serviceId) (Sin cambios)
router.put('/:serviceId', verifyToken, ensureTenantAccess, isAllowedToManageServices, upload.single('image'), async (req: ServiceRequest<ServiceItemParams>, res: Response) => {
    const tenantSlug = req.tenantId!;
    const { serviceId } = req.params;
    const { title, description } = req.body;
    const file = req.file;

    if (!title || !description || !serviceId) {
        if (file) fs.unlinkSync(file.path);
        return res.status(400).json({ message: 'Faltan campos obligatorios o ID de servicio.' });
    }

    const connection = await pool.getConnection();

    try {
        const tenantNumericId = await getTenantNumericId(tenantSlug);

        if (tenantNumericId === null) {
            if (file) fs.unlinkSync(file.path);
            return res.status(404).json({ message: `Inquilino con ID ${tenantSlug} no encontrado.` });
        }

        await connection.beginTransaction();

        const [updateServiceResult] = await connection.execute<OkPacket>(
            'UPDATE services SET title = ?, description = ? WHERE id = ? AND tenant_id = ?',
            [title, description, serviceId, tenantNumericId]
        );

        let finalImageUrl = null;
        if (file) {
            const [currentImageRows] = await connection.execute<ImageRow[]>(
                `SELECT i.id, i.storage_key FROM images i
                 JOIN service_images si ON i.id = si.image_id
                 WHERE si.service_id = ? AND si.is_primary = TRUE`,
                [serviceId]
            );

            const storageKey = file.filename;
            const newImageUrl = `/uploads/${file.filename}`;
            let imageId;
            finalImageUrl = newImageUrl;

            if (currentImageRows.length > 0) {
                const currentImage = currentImageRows[0];
                imageId = currentImage.id;

                await connection.execute(
                    'UPDATE images SET storage_key = ?, url = ?, alt_text = ? WHERE id = ?',
                    [storageKey, newImageUrl, title, imageId]
                );

                try {
                    const oldFilePath = path.join('uploads', currentImage.storage_key);
                    if (fs.existsSync(oldFilePath)) {
                        fs.unlinkSync(oldFilePath);
                    }
                } catch (e) {
                    console.error('Error al eliminar archivo antiguo:', e);
                }

            } else {
                const [imageResult] = await connection.execute<OkPacket>(
                    'INSERT INTO images (tenant_id, storage_key, url, alt_text) VALUES (?, ?, ?, ?)',
                    [tenantNumericId, storageKey, newImageUrl, title]
                );
                imageId = imageResult.insertId;

                await connection.execute(
                    'INSERT INTO service_images (service_id, image_id, is_primary, sort_order) VALUES (?, ?, TRUE, 0)',
                    [serviceId, imageId]
                );
            }
        }

        if (updateServiceResult.affectedRows === 0 && !file) {
            const [rows] = await connection.execute<RowDataPacket[]>(
                'SELECT id FROM services WHERE id = ? AND tenant_id = ?',
                [serviceId, tenantNumericId]
            );
            if (rows.length === 0) {
                await connection.rollback();
                return res.status(404).json({ message: `Servicio con ID ${serviceId} no encontrado para este inquilino.` });
            }
        }

        await connection.commit();

        if (!finalImageUrl) {
            const [imageRow] = await connection.execute<ImageRow[]>(
                `SELECT i.url FROM images i 
                 JOIN service_images si ON i.id = si.image_id
                 WHERE si.service_id = ? AND si.is_primary = TRUE`,
                [serviceId]
            );
            finalImageUrl = imageRow.length > 0 ? imageRow[0].url : null;
        }


        res.status(200).json({
            message: 'Servicio actualizado exitosamente!',
            imageUrl: finalImageUrl ? getDisplayImageUrl(finalImageUrl, req.hostname) : null
        });

    } catch (error) {
        await connection.rollback();
        if (file) fs.unlinkSync(file.path);
        console.error("Error al actualizar servicio:", error);
        res.status(500).json({ message: 'Error del servidor al actualizar el servicio.' });
    } finally {
        connection.release();
    }
});

// 4. RUTA PARA DESACTIVAR SERVICIO (PUT /api/services/:serviceId/deactivate) (Sin cambios)
router.put('/:serviceId/deactivate', verifyToken, ensureTenantAccess, isAllowedToManageServices, async (req: ServiceRequest<ServiceItemParams>, res: Response) => {
    const tenantSlug = req.tenantId!;
    const { serviceId } = req.params;

    try {
        const tenantNumericId = await getTenantNumericId(tenantSlug);
        if (tenantNumericId === null) return res.status(404).json({ message: `Inquilino con ID ${tenantSlug} no encontrado.` });

        const [result] = await pool.execute<OkPacket>(
            'UPDATE services SET is_active = FALSE WHERE id = ? AND tenant_id = ?',
            [serviceId, tenantNumericId]
        );

        if (result.affectedRows === 0) return res.status(404).json({ message: `Servicio con ID ${serviceId} no encontrado para este inquilino.` });

        res.status(200).json({ message: 'Servicio desactivado exitosamente!' });

    } catch (error) {
        console.error("Error al desactivar servicio:", error);
        res.status(500).json({ message: 'Error del servidor al desactivar el servicio.' });
    }
});

// 5. RUTA PARA ACTIVAR SERVICIO (PUT /api/services/:serviceId/activate) (Sin cambios)
router.put('/:serviceId/activate', verifyToken, ensureTenantAccess, isAllowedToManageServices, async (req: ServiceRequest<ServiceItemParams>, res: Response) => {
    const tenantSlug = req.tenantId!;
    const { serviceId } = req.params;

    try {
        const tenantNumericId = await getTenantNumericId(tenantSlug);
        if (tenantNumericId === null) return res.status(404).json({ message: `Inquilino con ID ${tenantSlug} no encontrado.` });

        const [result] = await pool.execute<OkPacket>(
            'UPDATE services SET is_active = TRUE WHERE id = ? AND tenant_id = ?',
            [serviceId, tenantNumericId]
        );

        if (result.affectedRows === 0) return res.status(404).json({ message: `Servicio con ID ${serviceId} no encontrado para este inquilino.` });

        res.status(200).json({ message: 'Servicio activado exitosamente!' });

    } catch (error) {
        console.error("Error al activar servicio:", error);
        res.status(500).json({ message: 'Error del servidor al activar el servicio.' });
    }
});

export default router;