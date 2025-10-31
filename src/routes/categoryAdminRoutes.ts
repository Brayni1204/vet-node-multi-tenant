// src/routes/categoryAdminRoutes.ts
import { Router, Request, Response, NextFunction } from 'express';
import pool from '../db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { ParamsDictionary } from 'express-serve-static-core';

const router = Router();

// --- Copiamos las Interfaces y Middlewares de staffRoutes.ts ---

interface AdminRequest<P extends ParamsDictionary> extends Request<P> {
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

// --- RUTAS DEL CRUD DE CATEGORÍAS ---

// 1. OBTENER TODAS las categorías (para el admin)
router.get('/', verifyToken, ensureTenantAccess, async (req: AdminRequest<any>, res: Response) => {
    const { id: tenantDbId } = req.resolvedTenant!;

    try {
        const [categories] = await pool.execute<RowDataPacket[]>(
            'SELECT * FROM categories WHERE tenant_id = ? ORDER BY sort_order ASC, name ASC',
            [tenantDbId]
        );
        res.status(200).json({ categories });
    } catch (error) {
        console.error("Error al obtener categorías:", error);
        res.status(500).json({ message: 'Error del servidor.' });
    }
});

// 2. CREAR nueva categoría
router.post('/', verifyToken, ensureTenantAccess, async (req: AdminRequest<any>, res: Response) => {
    const { id: tenantDbId } = req.resolvedTenant!;
    const { name, sort_order = 0 } = req.body;

    if (!name) {
        return res.status(400).json({ message: 'El nombre es obligatorio.' });
    }

    try {
        const [result] = await pool.execute<ResultSetHeader>(
            'INSERT INTO categories (tenant_id, name, sort_order) VALUES (?, ?, ?)',
            [tenantDbId, name, sort_order]
        );
        res.status(201).json({ message: 'Categoría creada.', categoryId: result.insertId });
    } catch (error) {
        console.error("Error al crear categoría:", error);
        res.status(500).json({ message: 'Error del servidor.' });
    }
});

// 3. ACTUALIZAR categoría
router.put('/:categoryId', verifyToken, ensureTenantAccess, async (req: AdminRequest<{ categoryId: string }>, res: Response) => {
    const { id: tenantDbId } = req.resolvedTenant!;
    const { categoryId } = req.params;
    const { name, sort_order } = req.body;

    if (!name) {
        return res.status(400).json({ message: 'El nombre es obligatorio.' });
    }

    try {
        const [result] = await pool.execute<ResultSetHeader>(
            'UPDATE categories SET name = ?, sort_order = ? WHERE id = ? AND tenant_id = ?',
            [name, sort_order, categoryId, tenantDbId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Categoría no encontrada.' });
        }
        res.status(200).json({ message: 'Categoría actualizada.' });
    } catch (error) {
        console.error("Error al actualizar categoría:", error);
        res.status(500).json({ message: 'Error del servidor.' });
    }
});

// 4. ACTIVAR categoría
router.put('/:categoryId/activate', verifyToken, ensureTenantAccess, async (req: AdminRequest<{ categoryId: string }>, res: Response) => {
    const { id: tenantDbId } = req.resolvedTenant!;
    const { categoryId } = req.params;

    try {
        const [result] = await pool.execute<ResultSetHeader>(
            'UPDATE categories SET is_active = TRUE WHERE id = ? AND tenant_id = ?',
            [categoryId, tenantDbId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Categoría no encontrada.' });
        res.status(200).json({ message: 'Categoría activada.' });
    } catch (error) {
        res.status(500).json({ message: 'Error del servidor.' });
    }
});

// 5. DESACTIVAR categoría
router.put('/:categoryId/deactivate', verifyToken, ensureTenantAccess, async (req: AdminRequest<{ categoryId: string }>, res: Response) => {
    const { id: tenantDbId } = req.resolvedTenant!;
    const { categoryId } = req.params;

    try {
        const [result] = await pool.execute<ResultSetHeader>(
            'UPDATE categories SET is_active = FALSE WHERE id = ? AND tenant_id = ?',
            [categoryId, tenantDbId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Categoría no encontrada.' });
        res.status(200).json({ message: 'Categoría desactivada.' });
    } catch (error) {
        res.status(500).json({ message: 'Error del servidor.' });
    }
});


export default router;