// src/routes/orderRoutes.ts
import { Router, Request, Response, NextFunction } from 'express';
import pool from '../db';
import { RowDataPacket, ResultSetHeader, OkPacket } from 'mysql2';
import { ParamsDictionary } from 'express-serve-static-core';

const router = Router();

// --- Interfaces y Middlewares ---
interface OrderRequest<P extends ParamsDictionary> extends Request<P> {
    user?: {
        id: number; // ID del CLIENTE
        tenant_id: string; // Slug (e.g., 'chavez')
        role: 'client'; // Solo clientes pueden ordenar
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

// Middleware de Token para CLIENTES
const verifyClientToken = (req: OrderRequest<any>, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ message: 'No autenticado.' });
    }
    try {
        const [tenant_slug, role, client_id] = token.split(':');

        if (!tenant_slug || role !== 'client' || !client_id) {
            return res.status(401).json({ message: 'Token de cliente no válido.' });
        }

        req.user = {
            id: parseInt(client_id, 10),
            tenant_id: tenant_slug,
            role: 'client'
        };

    } catch (e) {
        return res.status(401).json({ message: 'Token inválido.' });
    }
    next();
};

// Middleware de Acceso (verifica que el token del cliente coincida con el subdominio)
const ensureTenantAccess = async (req: OrderRequest<any>, res: Response, next: NextFunction) => {
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
        return res.status(403).json({ message: 'Acceso denegado.' });
    }
    next();
};


// -----------------------------------------------------------------------------
// 1. CREAR NUEVO PEDIDO (RESERVA)
// POST /api/orders
// -----------------------------------------------------------------------------
router.post('/', verifyClientToken, ensureTenantAccess, async (req: OrderRequest<any>, res: Response) => {
    const { items, pickupDate }: {
        items: { productId: number, quantity: number }[],
        pickupDate: string // Formato 'YYYY-MM-DD'
    } = req.body;

    const { id: tenantDbId } = req.resolvedTenant!;
    const clientId = req.user!.id;

    if (!items || items.length === 0 || !pickupDate) {
        return res.status(400).json({ message: 'Faltan productos o fecha de recojo.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        let totalAmount = 0;
        const productPrices: { [key: number]: number } = {};

        // 1. Verificar stock y calcular total
        for (const item of items) {
            const [rows] = await connection.execute<RowDataPacket[]>(
                'SELECT price, stock FROM products WHERE id = ? AND tenant_id = ? AND is_available = TRUE FOR UPDATE',
                [item.productId, tenantDbId]
            );

            if (rows.length === 0) {
                throw new Error(`El producto con ID ${item.productId} no está disponible.`);
            }
            const product = rows[0];
            if (product.stock < item.quantity) {
                throw new Error(`Stock insuficiente para el producto ID ${item.productId}. Disponible: ${product.stock}`);
            }

            const price = parseFloat(product.price);
            productPrices[item.productId] = price;
            totalAmount += price * item.quantity;
        }

        // 2. Crear la orden
        // (Tu lógica de expiration_date puede ser más compleja, aquí un ejemplo simple)
        const expirationDate = new Date(pickupDate);
        expirationDate.setDate(expirationDate.getDate() + 2); // Expira 2 días después de la fecha de recojo

        const [orderResult] = await connection.execute<OkPacket>(
            `INSERT INTO orders (tenant_id, client_id, total_amount, status, pickup_date, expiration_date) 
             VALUES (?, ?, ?, 'pending_pickup', ?, ?)`,
            [tenantDbId, clientId, totalAmount, pickupDate, expirationDate]
        );
        const orderId = orderResult.insertId;

        // 3. Insertar items y actualizar stock
        for (const item of items) {
            // Insertar en order_items
            await connection.execute(
                'INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
                [orderId, item.productId, item.quantity, productPrices[item.productId]]
            );

            // Actualizar stock en products
            await connection.execute(
                'UPDATE products SET stock = stock - ? WHERE id = ?',
                [item.quantity, item.productId]
            );
        }

        // 4. Confirmar transacción
        await connection.commit();

        res.status(201).json({
            message: 'Reserva creada exitosamente.',
            orderId: orderId,
            total: totalAmount
        });

    } catch (error) {
        await connection.rollback();
        console.error("Error al crear la orden:", error);
        const errorMessage = error instanceof Error ? error.message : 'Error del servidor.';
        res.status(500).json({ message: errorMessage });
    } finally {
        connection.release();
    }
});

export default router;