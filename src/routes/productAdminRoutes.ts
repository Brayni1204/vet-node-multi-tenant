// src/routes/productAdminRoutes.ts
import { Router, Request, Response, NextFunction } from 'express';
import pool from '../db';
import { RowDataPacket, ResultSetHeader, OkPacket } from 'mysql2';

import { ParamsDictionary } from 'express-serve-static-core';
import upload from '../middleware/uploadMiddleware'; // Reutilizamos el middleware de subida
import fs from 'fs';
import path from 'path';

const router = Router();

// --- Copiamos las Interfaces y Middlewares de staffRoutes.ts ---

interface AdminRequest<P extends ParamsDictionary> extends Request<P> {
    file?: Express.Multer.File; // Para Multer
    user?: {
        id: number;
        tenant_id: string; // Slug (e.g., 'chavez')
        role: 'admin' | 'doctor' | 'receptionist' | 'client';
    };
    tenantId?: string; // Slug inyectado por resolveTenant
    resolvedTenant?: {
        id: number; // El ID numérico del tenant
        slug: string; // El slug del tenant
    }
}

interface ImageRow extends RowDataPacket {
    id: number;
    storage_key: string;
}

// Helper para obtener ID numérico
const getTenantInfoBySlug = async (tenantSlug: string): Promise<{ id: number; slug: string } | null> => {
    const [tenantRows] = await pool.execute<RowDataPacket[]>(
        'SELECT id, tenant_id FROM tenants WHERE tenant_id = ?',
        [tenantSlug]
    );
    if (tenantRows.length === 0) return null;
    return { id: tenantRows[0].id, slug: tenantRows[0].tenant_id };
};

// Middleware de Token (idéntico a staffRoutes)
const verifyToken = (req: AdminRequest<any>, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ message: 'No autenticado. Token no proporcionado.' });
    }
    try {
        const [tenant_slug, role] = token.split(':');
        if (!tenant_slug || !['admin', 'doctor', 'receptionist'].includes(role)) {
            return res.status(401).json({ message: 'Token de simulación no válido.' });
        }
        req.user = { id: 1, tenant_id: tenant_slug, role: role as any };
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Acceso denegado. Solo administradores.' });
        }
    } catch (e) {
        return res.status(401).json({ message: 'Token inválido.' });
    }
    next();
};

// Middleware de Acceso (idéntico a staffRoutes)
const ensureTenantAccess = async (req: AdminRequest<any>, res: Response, next: NextFunction) => {
    const requestedTenantSlug = req.tenantId;
    const authenticatedTenantSlug = req.user?.tenant_id;

    if (!requestedTenantSlug) {
        return res.status(400).json({ message: 'Slug de inquilino no encontrado.' });
    }

    const tenantInfo = await getTenantInfoBySlug(requestedTenantSlug);
    if (tenantInfo === null) {
        return res.status(404).json({ message: `Inquilino ${requestedTenantSlug} no encontrado.` });
    }
    req.resolvedTenant = tenantInfo;

    if (!req.user || authenticatedTenantSlug !== requestedTenantSlug) {
        return res.status(403).json({
            message: 'Acceso denegado. No tiene permisos para este inquilino.'
        });
    }
    next();
};

// Helper para borrar archivos
const deleteFile = (filePath: string) => {
    const absolutePath = path.join(__dirname, '..', '..', filePath);
    if (fs.existsSync(absolutePath)) {
        fs.unlink(absolutePath, (err) => {
            if (err) console.error("Error al borrar archivo antiguo:", absolutePath, err);
        });
    }
};

// Helper para construir URL de imagen
const getDisplayImageUrl = (path: string, hostname: string) => {
    if (!path) return null;
    const host = hostname.split(':')[0];
    return path.startsWith('http') ? path : `http://${host}:4000${path}`;
};


// --- RUTAS DEL CRUD DE PRODUCTOS ---

// 1. OBTENER TODOS los productos (para el admin)
router.get('/', verifyToken, ensureTenantAccess, async (req: AdminRequest<any>, res: Response) => {
    const { id: tenantDbId } = req.resolvedTenant!;
    const { status, search, category } = req.query;

    try {
        let query = `
            SELECT 
                p.id, p.category_id, p.name, p.description, p.price, p.stock, p.is_available, 
                i.url AS image,
                c.name AS category_name
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = TRUE
            LEFT JOIN images i ON pi.image_id = i.id
            WHERE p.tenant_id = ?
        `;
        const queryParams: (string | number)[] = [tenantDbId];

        // Filtro de estado
        if (status === 'available') {
            query += ' AND p.is_available = TRUE';
        } else if (status === 'unavailable') {
            query += ' AND p.is_available = FALSE';
        }

        // Filtro de categoría
        if (category && category !== 'all') {
            query += ' AND p.category_id = ?';
            queryParams.push(parseInt(category as string, 10));
        }

        // Filtro de búsqueda
        if (search) {
            query += ' AND (p.name LIKE ? OR p.description LIKE ?)';
            queryParams.push(`%${search}%`);
            queryParams.push(`%${search}%`);
        }

        query += ' ORDER BY p.name ASC';

        const [rows] = await pool.execute<RowDataPacket[]>(query, queryParams);

        const products = rows.map((row: any) => ({
            ...row,
            price: parseFloat(row.price),
            is_available: row.is_available === 1,
            image: row.image ? getDisplayImageUrl(row.image, req.hostname) : null
        }));

        res.status(200).json({ products });

    } catch (error) {
        console.error("Error al obtener productos (admin):", error);
        res.status(500).json({ message: 'Error del servidor.' });
    }
});

// 2. CREAR nuevo producto
router.post('/', verifyToken, ensureTenantAccess, upload.single('image'), async (req: AdminRequest<any>, res: Response) => {
    const { id: tenantDbId } = req.resolvedTenant!;
    const { name, description, price, stock, category_id } = req.body;
    const file = req.file;

    if (!name || !price || !stock || !category_id || !file) {
        if (file) deleteFile(file.path); // Borrar imagen si faltan datos
        return res.status(400).json({ message: 'Faltan campos obligatorios (nombre, precio, stock, categoría e imagen).' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Insertar el producto
        const [productResult] = await connection.execute<OkPacket>(
            'INSERT INTO products (tenant_id, category_id, name, description, price, stock, is_available) VALUES (?, ?, ?, ?, ?, ?, TRUE)',
            [tenantDbId, category_id, name, description, price, stock]
        );
        const productId = productResult.insertId;

        // 2. Insertar la imagen
        const imageUrl = `/uploads/${file.filename}`;
        const storageKey = file.filename;

        const [imageResult] = await connection.execute<OkPacket>(
            'INSERT INTO images (tenant_id, storage_key, url, alt_text) VALUES (?, ?, ?, ?)',
            [tenantDbId, storageKey, imageUrl, name]
        );
        const imageId = imageResult.insertId;

        // 3. Vincular producto e imagen
        await connection.execute(
            'INSERT INTO product_images (product_id, image_id, is_primary) VALUES (?, ?, TRUE)',
            [productId, imageId]
        );

        await connection.commit();
        res.status(201).json({ message: 'Producto creado exitosamente.' });

    } catch (error) {
        await connection.rollback();
        if (file) deleteFile(file.path); // Borrar imagen en caso de error de DB
        console.error("Error al crear producto:", error);
        res.status(500).json({ message: 'Error del servidor al crear el producto.' });
    } finally {
        connection.release();
    }
});

// 3. ACTUALIZAR producto
router.put('/:productId', verifyToken, ensureTenantAccess, upload.single('image'), async (req: AdminRequest<{ productId: string }>, res: Response) => {
    const { id: tenantDbId } = req.resolvedTenant!;
    const { productId } = req.params;
    const { name, description, price, stock, category_id } = req.body;
    const file = req.file; // Archivo nuevo (opcional)

    if (!name || !price || !stock || !category_id) {
        if (file) deleteFile(file.path);
        return res.status(400).json({ message: 'Faltan campos obligatorios (nombre, precio, stock, categoría).' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Actualizar datos del producto
        await connection.execute(
            'UPDATE products SET name = ?, description = ?, price = ?, stock = ?, category_id = ? WHERE id = ? AND tenant_id = ?',
            [name, description, price, stock, category_id, productId, tenantDbId]
        );

        // 2. Si se subió una imagen nueva, reemplazar la anterior
        if (file) {
            // A. Encontrar la imagen antigua
            const [currentImageRows] = await connection.execute<ImageRow[]>(
                `SELECT i.id, i.storage_key FROM images i
                 JOIN product_images pi ON i.id = pi.image_id
                 WHERE pi.product_id = ? AND pi.is_primary = TRUE`,
                [productId]
            );

            // B. Insertar la nueva imagen
            const newImageUrl = `/uploads/${file.filename}`;
            const newStorageKey = file.filename;
            const [newImageResult] = await connection.execute<OkPacket>(
                'INSERT INTO images (tenant_id, storage_key, url, alt_text) VALUES (?, ?, ?, ?)',
                [tenantDbId, newStorageKey, newImageUrl, name]
            );
            const newImageId = newImageResult.insertId;

            if (currentImageRows.length > 0) {
                // C. Si existía una, actualizar el vínculo
                const oldImage = currentImageRows[0];
                await connection.execute(
                    'UPDATE product_images SET image_id = ? WHERE product_id = ? AND image_id = ?',
                    [newImageId, productId, oldImage.id]
                );
                // D. Eliminar la imagen antigua de la DB (la de 'images')
                await connection.execute('DELETE FROM images WHERE id = ?', [oldImage.id]);
                // E. Programar borrado del archivo físico antiguo (se hace fuera de la tx)
                setImmediate(() => deleteFile(oldImage.storage_key.startsWith('/') ? oldImage.storage_key : `/uploads/${oldImage.storage_key}`));
            } else {
                // C. Si no existía, crear el vínculo
                await connection.execute(
                    'INSERT INTO product_images (product_id, image_id, is_primary) VALUES (?, ?, TRUE)',
                    [productId, newImageId]
                );
            }
        }

        await connection.commit();
        res.status(200).json({ message: 'Producto actualizado exitosamente.' });

    } catch (error) {
        await connection.rollback();
        if (file) deleteFile(file.path); // Borrar imagen nueva si falla la tx
        console.error("Error al actualizar producto:", error);
        res.status(500).json({ message: 'Error del servidor al actualizar el producto.' });
    } finally {
        connection.release();
    }
});


// 4. ACTIVAR producto
router.put('/:productId/activate', verifyToken, ensureTenantAccess, async (req: AdminRequest<{ productId: string }>, res: Response) => {
    const { id: tenantDbId } = req.resolvedTenant!;
    const { productId } = req.params;

    try {
        const [result] = await pool.execute<ResultSetHeader>(
            'UPDATE products SET is_available = TRUE WHERE id = ? AND tenant_id = ?',
            [productId, tenantDbId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Producto no encontrado.' });
        res.status(200).json({ message: 'Producto activado.' });
    } catch (error) {
        res.status(500).json({ message: 'Error del servidor.' });
    }
});

// 5. DESACTIVAR producto
router.put('/:productId/deactivate', verifyToken, ensureTenantAccess, async (req: AdminRequest<{ productId: string }>, res: Response) => {
    const { id: tenantDbId } = req.resolvedTenant!;
    const { productId } = req.params;

    try {
        const [result] = await pool.execute<ResultSetHeader>(
            'UPDATE products SET is_available = FALSE WHERE id = ? AND tenant_id = ?',
            [productId, tenantDbId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Producto no encontrado.' });
        res.status(200).json({ message: 'Producto desactivado.' });
    } catch (error) {
        res.status(500).json({ message: 'Error del servidor.' });
    }
});

export default router;