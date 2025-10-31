// src/routes/storeRoutes.ts
import { Router, Request, Response, NextFunction } from 'express';
import pool from '../db';
import { RowDataPacket } from 'mysql2';
import { ParamsDictionary } from 'express-serve-static-core';

const router = Router();

// --- INTERFACES ---
interface StoreRequest<P extends ParamsDictionary> extends Request<P> {
    tenantId?: string; // Inyectado por resolveTenant
    resolvedTenantId?: number; // Lo añadiremos nosotros
}

// --- HELPERS (Como los que usas en staffRoutes.ts) ---
const getTenantNumericId = async (tenantSlug: string): Promise<number | null> => {
    try {
        const [tenantRows] = await pool.execute<RowDataPacket[]>(
            'SELECT id FROM tenants WHERE tenant_id = ?',
            [tenantSlug]
        );
        return tenantRows.length > 0 ? tenantRows[0].id : null;
    } catch (error) {
        console.error("Error al obtener ID numérico del tenant:", error);
        return null;
    }
};

const getDisplayImageUrl = (path: string, hostname: string) => {
    if (!path) return null;
    // Aseguramos que la URL se construya con el puerto 4000
    const host = hostname.split(':')[0]; // Quita el puerto de vite (5173) si existe
    return path.startsWith('http') ? path : `http://${host}:4000${path}`;
};

// --- MIDDLEWARE: Resolver ID numérico del Tenant ---
// Este middleware es público, no valida token, solo traduce el slug (req.tenantId)
// a un ID numérico (req.resolvedTenantId) para usar en las consultas.
const resolveTenantDbId = async (req: StoreRequest<any>, res: Response, next: NextFunction) => {
    const tenantSlug = req.tenantId;

    if (!tenantSlug) {
        return res.status(400).json({ message: 'El ID de inquilino (slug) no se encontró en la solicitud.' });
    }

    const tenantNumericId = await getTenantNumericId(tenantSlug);

    if (tenantNumericId === null) {
        return res.status(404).json({ message: `Inquilino con ID ${tenantSlug} no encontrado.` });
    }

    req.resolvedTenantId = tenantNumericId; // Inyectamos el ID numérico
    next();
};

// -----------------------------------------------------------------------------
// 🛍️ 1. OBTENER TODAS LAS CATEGORÍAS (Público)
// GET /api/store/categories
// -----------------------------------------------------------------------------
router.get('/categories', resolveTenantDbId, async (req: StoreRequest<any>, res: Response) => {
    const tenantId = req.resolvedTenantId!; // ID numérico del tenant

    try {
        const query = `
            SELECT id, name 
            FROM categories 
            WHERE tenant_id = ? 
            ORDER BY sort_order ASC, name ASC
        `;
        
        const [categories] = await pool.execute<RowDataPacket[]>(query, [tenantId]);

        res.status(200).json({ categories });

    } catch (error) {
        console.error("Error al obtener categorías:", error);
        res.status(500).json({ message: 'Error del servidor al obtener categorías.' });
    }
});

// -----------------------------------------------------------------------------
// 📦 2. OBTENER PRODUCTOS (Público, con filtros)
// GET /api/store/products?category=1&search=query
// -----------------------------------------------------------------------------
router.get('/products', resolveTenantDbId, async (req: StoreRequest<any>, res: Response) => {
    const tenantId = req.resolvedTenantId!; // ID numérico del tenant
    const { category, search } = req.query; // Filtros desde la URL

    try {
        let query = `
            SELECT 
                p.id, p.category_id, p.name, p.description, p.price, p.stock,
                i.url AS image
            FROM products p
            LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = TRUE
            LEFT JOIN images i ON pi.image_id = i.id
            WHERE p.tenant_id = ? AND p.is_available = TRUE AND p.stock > 0
        `;
        const queryParams: (string | number)[] = [tenantId];

        // Aplicar filtro de categoría
        if (category && typeof category === 'string' && category !== 'all') {
            query += ' AND p.category_id = ?';
            queryParams.push(parseInt(category, 10));
        }

        // Aplicar filtro de búsqueda
        if (search && typeof search === 'string' && search.trim() !== '') {
            query += ' AND (p.name LIKE ? OR p.description LIKE ?)';
            queryParams.push(`%${search.trim()}%`);
            queryParams.push(`%${search.trim()}%`);
        }

        query += ' ORDER BY p.name ASC';

        const [rows] = await pool.execute<RowDataPacket[]>(query, queryParams);

        const products = rows.map((row: any) => ({
            id: row.id,
            category_id: row.category_id,
            name: row.name,
            description: row.description,
            price: parseFloat(row.price), // Aseguramos que sea un número
            stock: row.stock,
            image: row.image ? getDisplayImageUrl(row.image, req.hostname) : null
        }));

        res.status(200).json({ products });

    } catch (error) {
        console.error("Error al obtener productos:", error);
        res.status(500).json({ message: 'Error del servidor al obtener productos.' });
    }
});

export default router;